"""Verify first-visit session establishment without stored N.eko credentials."""
import importlib.util
import json
import pathlib
import shutil
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('patch_neko', pathlib.Path(__file__).with_name('patch-neko-client.py'))
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)


@unittest.skipUnless(shutil.which('node'), 'Node required')
class NekoClientTest(unittest.TestCase):
    def test_home_button_opens_new_tab(self):
        policy = json.loads(pathlib.Path(__file__).with_name('chromium-browser-policy.json').read_text())
        self.assertTrue(policy['ShowHomeButton'])
        self.assertTrue(policy['HomepageIsNewTabPage'])
        dockerfile = pathlib.Path(__file__).with_name('Dockerfile.neko').read_text()
        self.assertIn('COPY chromium-browser-policy.json /etc/chromium/policies/managed/coder-browser.json', dockerfile)

    def test_session_creation_and_errors(self):
        program = r'''
const assert = require('node:assert/strict');
const connect = new Function(process.argv[1]);
global.window = {CODER_NEKO_OWNER: 'workspace-owner'};
(async () => {
 for (const status of [200, 401, 503]) {
  const requests = [], logins = [], errors = [];
  await connect.call({
   $http: {
    get: async path => { requests.push(['GET',path]); if(status !== 200) throw {response:{status}}; },
    post: async (path,body) => { requests.push(['POST',path,body]); },
   },
   $accessor: {login: credentials => logins.push(credentials)},
   $swal: message => errors.push(message),
  });
  assert.equal(logins.length, status === 503 ? 0 : 1);
  assert.equal(errors.length, status === 503 ? 1 : 0);
  if(status === 401) assert.deepEqual(requests[1], ['POST','api/login',{username:'workspace-owner',password:''}]);
  else assert.equal(requests.length,1);
 }
})().catch(error => {console.error(error);process.exitCode=1});
'''
        subprocess.run(['node', '-e', program, patcher.CONNECT], check=True, capture_output=True, text=True)

    def test_panel_commands_require_the_same_origin_parent(self):
        source = pathlib.Path(__file__).with_name('neko-panel.js').read_text()
        program = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
let receive, clicked = 0;
const parent = {postMessage() {}};
const video = {muted:true, addEventListener() {}};
const root = {toggleAttribute() {}};
const context = {
 URL, location:{href:'https://coder.test/app/?embed=1',origin:'https://coder.test'},
 window:{parent,innerWidth:1200,addEventListener:(name,fn)=>{receive=fn}},
 document:{documentElement:root,head:{appendChild(){}},createElement:()=>({}),
 querySelector:selector=>selector==='video'?video:{dispatchEvent:()=>{clicked++}}},
 MutationObserver:class {observe(){} disconnect(){}},
 MouseEvent:class {},
};
vm.runInNewContext(process.argv[1], context);
receive({origin:'https://other.test',source:parent,data:{type:'coder:browser-mute',muted:false}});
assert.equal(video.muted,true);
receive({origin:'https://coder.test',source:{},data:{type:'coder:browser-resolution'}});
assert.equal(clicked,0);
receive({origin:'https://coder.test',source:parent,data:{type:'coder:browser-mute',muted:false}});
assert.equal(video.muted,false);
receive({origin:'https://coder.test',source:parent,data:{type:'coder:browser-resolution'}});
assert.equal(clicked,1);
"""
        subprocess.run(['node', '-e', program, source], check=True, capture_output=True, text=True)

    def test_both_clients_disable_manual_login_and_require_relay(self):
        modern = 'async mounted(){if(await this.loadOAuthConfig())return;old();} x(this,"passwordLoginEnabled",!0); new RTCPeerConnection({iceServers:t}):new RTCPeerConnection'
        legacy = '{key:"mounted",value:function(){this.loadOAuthConfig();old();}},{key:"connecting",get:function(){}} x(e,"passwordLoginEnabled",!0); new RTCPeerConnection({iceServers:n}):new RTCPeerConnection'
        modern += ' x(this,"mutedOverlay",!0); onMouseDown(e){old();}'
        legacy += ' x(e,"mutedOverlay",!0); {key:"onMouseDown",value:function(e){old();}}'
        for source, is_legacy in [(modern, False), (legacy, True)]:
            patched = patcher.patch_bundle(source, is_legacy)
            self.assertIn(patcher.CONNECT, patched)
            self.assertIn(',"mutedOverlay",!1)', patched)
            self.assertIn('if(this.muted&&!document.documentElement.hasAttribute("data-coder-muted"))this.unmute();', patched)
            self.assertNotIn(',"passwordLoginEnabled",!0)', patched)
            self.assertEqual(patched.count('iceTransportPolicy:"relay"'), 2)


if __name__ == '__main__':
    unittest.main()
