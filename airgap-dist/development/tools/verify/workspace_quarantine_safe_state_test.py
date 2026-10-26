"""Durable Cloud Drive intent and late quarantine/reconnect races."""
import contextlib
import json
import os
import pathlib
import stat
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from platform_unit_test import load

WID = '11111111-2222-4333-8444-555555555555'
OTHER = '22222222-2222-4333-8444-555555555555'
OWNER = '33333333-2222-4333-8444-555555555555'
ORG = '44444444-2222-4333-8444-555555555555'
CURRENT = {'workspace_id': WID, 'organization_id':ORG, 'owner_id': OWNER, 'revision': ORG,
           'enabled':True, 'manual_start_required':True}


class SafeStateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.safe = load('safe-state-test', 'safe.py')
        self.safe.LINKS_FILE = self.temp.name + '/links.json'
        self.safe.SOURCES_FILE = self.temp.name + '/sources.json'
        self.safe.LOG = lambda **kwargs: None
        self.safe.KUBE = None
        self.safe.WORKSPACE_INFO = lambda token,wid: {'id':wid,'owner_id':OWNER,'name':'workspace'}
        self.safe.shared_now = lambda: {}
        self.safe.connections = lambda user: {}
        self.handler=type('Handler', (), {'token': lambda self:'token'})()
        self.user={'id':OWNER,'username':'owner'}

    def test_durable_write_syncs_file_before_replace_and_directory_after(self):
        events=[]
        fsync,replace=os.fsync,os.replace
        def sync(fd):
            events.append('directory' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file')
            return fsync(fd)
        def commit(src,dst):
            events.append('replace')
            return replace(src,dst)
        with patch.object(self.safe.os,'fsync',side_effect=sync), patch.object(self.safe.os,'replace',side_effect=commit):
            self.safe._write_json(self.safe.LINKS_FILE,{WID:CURRENT})
        self.assertEqual(events,['file','replace','directory'])
        self.assertEqual(os.stat(self.safe.LINKS_FILE).st_mode & 0o777,0o600)
        self.assertEqual(self.safe.disconnected(),{WID:CURRENT})
        self.assertEqual(os.listdir(self.temp.name),['links.json'])

    def test_failed_replace_keeps_previous_intent_and_removes_private_staging_file(self):
        self.safe._write_json(self.safe.LINKS_FILE,{WID:CURRENT})
        with patch.object(self.safe.os,'replace',side_effect=OSError('commit failed')),self.assertRaises(OSError):
            self.safe._write_json(self.safe.LINKS_FILE,{})
        self.assertEqual(self.safe.disconnected(),{WID:CURRENT})
        self.assertEqual(os.listdir(self.temp.name),['links.json'])

    def test_corrupt_connection_or_source_state_does_not_silently_reconnect(self):
        for path,read in ((self.safe.LINKS_FILE,self.safe.disconnected),(self.safe.SOURCES_FILE,self.safe.sources)):
            pathlib.Path(path).write_text('{broken')
            with self.subTest(path=path),self.assertRaises(RuntimeError): read()

    def test_flock_serializes_independent_threads_without_losing_intents(self):
        acquired,attempted=threading.Event(),threading.Event()
        failures=[]
        def first():
            try:
                with self.safe.local_lock(self.safe.LINKS_FILE):
                    data=self.safe.disconnected()
                    acquired.set()
                    if not attempted.wait(3): raise RuntimeError('Second writer did not start')
                    data[WID]=CURRENT
                    self.safe._write_json(self.safe.LINKS_FILE,data)
            except BaseException as exc: failures.append(exc)
        def second():
            try:
                attempted.set()
                with self.safe.local_lock(self.safe.LINKS_FILE):
                    data=self.safe.disconnected()
                    if WID not in data: raise RuntimeError('Serialized reader missed first commit')
                    data[OTHER]=CURRENT
                    self.safe._write_json(self.safe.LINKS_FILE,data)
            except BaseException as exc: failures.append(exc)
        one=threading.Thread(target=first);one.start()
        self.assertTrue(acquired.wait(3))
        two=threading.Thread(target=second);two.start()
        one.join(3);two.join(3)
        self.assertFalse(one.is_alive() or two.is_alive())
        self.assertEqual(failures,[])
        self.assertEqual(set(self.safe.disconnected()),{WID,OTHER})

    def test_quarantine_that_arrives_during_workspace_lookup_prevents_reconnect_commit(self):
        blocked=[False]
        self.safe.QUARANTINE=lambda wid:{'enabled':blocked[0],'manual_start_required':False}
        def lookup(token,wid):
            blocked[0]=True
            return {'id':wid,'owner_id':OWNER,'name':'workspace'}
        self.safe.WORKSPACE_INFO=lookup
        self.safe._write_json(self.safe.LINKS_FILE,{WID:CURRENT})
        with self.assertRaises(PermissionError):
            self.safe.set_connected(self.handler,self.user,WID,{'connected':True})
        self.assertEqual(self.safe.disconnected(),{WID:CURRENT})

    def test_source_commit_rechecks_policy_after_external_folder_check(self):
        blocked=[False]
        self.safe.QUARANTINE=lambda wid:{'enabled':blocked[0],'manual_start_required':False}
        self.safe.encryption_on=lambda owner:False
        self.safe.busy=lambda owner:False
        def find(wid):
            blocked[0]=True
            return None
        self.safe._source_pod=find
        with self.assertRaises(PermissionError):
            self.safe.set_source(self.handler,self.user,{'workspace':WID,'path':'/home/coder/data'})
        self.assertEqual(self.safe.sources(),{})

    def test_quarantine_endpoint_network_runs_after_all_local_file_locks_release(self):
        self.safe._write_json(self.safe.SOURCES_FILE,{OWNER:{'workspace':WID,'owner':OWNER,'accessKey':'old','secretKey':'old'}})
        held=[]
        original=self.safe.local_lock
        @contextlib.contextmanager
        def tracking(path):
            with original(path):
                held.append(path)
                try: yield
                finally: held.remove(path)
        def withdraw(owner):
            self.assertEqual(held,[])
            self.assertTrue(self.safe.sources()[OWNER]['suspended'])
        with patch.object(self.safe,'local_lock',tracking),patch.object(self.safe,'source_endpoint_snapshot',return_value=[]),patch.object(self.safe,'delete_source_endpoints',side_effect=lambda endpoints:withdraw(OWNER)):
            self.safe.withdraw_quarantine(CURRENT)
        self.assertEqual(self.safe.disconnected()[WID]['quarantine_revision'],ORG)

    def test_old_orphan_cleanup_does_not_remove_reselected_source_or_any_volume(self):
        calls=[]
        def snapshot(owner):
            self.safe._write_json(self.safe.SOURCES_FILE,{OWNER:{'workspace':OTHER,'generation':'new'}})
            return [('old-service','old-uid','old-version')]
        self.safe.delete_source_endpoints=lambda endpoints:calls.extend(endpoints)
        self.safe.source_endpoint_snapshot=snapshot
        self.assertFalse(self.safe.remove_source_objects(OWNER))
        self.assertEqual(calls,[])

    def test_source_endpoint_deletes_are_uid_version_fenced_and_never_touch_storage(self):
        calls=[]
        class Kube:
            def call(self, method,path,body=None):
                calls.append((method,path,body))
                if method=='GET':
                    return 200,{'metadata':{'uid':'captured-uid','resourceVersion':'captured-version','labels':{'platform.coder/user-id':OWNER}}}
                return 409,{}
        self.safe.KUBE=Kube()
        with self.assertRaises(RuntimeError): self.safe.remove_source_objects(OWNER)
        deletes=[call for call in calls if call[0]=='DELETE']
        self.assertEqual(len(deletes),1)
        self.assertEqual(deletes[0][2]['preconditions'],{'uid':'captured-uid','resourceVersion':'captured-version'})
        self.assertFalse(any('persistentvolume' in call[1] for call in calls))

    def test_generation_change_updates_unchanged_service_selector_and_secret_data(self):
        calls=[]
        src={'workspace':WID,'generation':'new-generation','owner':OWNER,'accessKey':'a','secretKey':'s'}
        metadata={'uid':'uid','resourceVersion':'rv','labels':{'platform.coder/user-id':OWNER,self.safe.SOURCE_GENERATION:'old-generation'}}
        class Kube:
            def call(self, method,path,body=None,patch_type=None):
                calls.append((method,path,body))
                if method=='GET': return 200,{'metadata':metadata,'spec':{'selector':{'com.coder.workspace.id':WID}}}
                return 200,{}
        self.safe.KUBE=Kube()
        with patch.object(self.safe,'ensure_secret'),patch.object(self.safe,'ensure_volume',return_value=True),patch.object(self.safe,'source_volume_objects',return_value=()),patch.object(self.safe,'service_ip',return_value='127.0.0.1'):
            self.safe.ensure_source_objects(OWNER,'owner',src,set())
        update=next(body for method,path,body in calls if method=='PATCH')
        self.assertEqual(update['metadata']['labels'][self.safe.SOURCE_GENERATION],'new-generation')
        self.assertEqual(update['metadata']['uid'],'uid')
        self.assertEqual(update['metadata']['resourceVersion'],'rv')

    def test_secret_generation_update_is_not_skipped_when_credentials_are_unchanged(self):
        want={'accessKeyID':'fixture-key','secretAccessKey':'fixture-secret'}
        data={key:self.safe.base64.b64encode(value.encode()).decode() for key,value in want.items()}
        labels={'platform.coder/user-id':OWNER,self.safe.SOURCE_GENERATION:'new-generation'}
        calls=[]
        class Kube:
            def call(self,method,path,body=None):
                calls.append((method,body))
                if method=='GET': return 200,{'metadata':{'resourceVersion':'rv','labels':{self_generation:'old-generation'}},'data':data}
                return 200,{}
        self_generation=self.safe.SOURCE_GENERATION
        self.safe.KUBE=Kube()
        self.assertTrue(self.safe.ensure_secret('source',want,labels))
        method,body=calls[-1]
        self.assertEqual(method,'PUT')
        self.assertEqual(body['metadata']['labels'][self_generation],'new-generation')
        self.assertEqual(body['metadata']['resourceVersion'],'rv')
        self.assertEqual(body['data'],data)

    def test_obsolete_restrictive_guard_cannot_write_files_or_delete_endpoints(self):
        @contextlib.contextmanager
        def reject(current):
            raise PermissionError('Policy changed')
            yield
        self.safe.QUARANTINE_GUARD=type('Guard',(),{'restrict':staticmethod(reject)})()
        with patch.object(self.safe,'source_endpoint_snapshot') as lookup,self.assertRaises(PermissionError):
            self.safe.withdraw_quarantine(CURRENT)
        lookup.assert_not_called()
        self.assertEqual(self.safe.disconnected(),{})
        self.assertEqual(self.safe.sources(),{})
