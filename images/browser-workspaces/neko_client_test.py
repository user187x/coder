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

    def test_transport_uses_https_only_when_an_owner_has_no_playable_video(self):
        source = pathlib.Path(__file__).with_name('neko-transport.js').read_text()
        program = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
function run({support = false, width = 2}) {
  let tick, time = 0, destination;
  class MediaStream {}
  const location = {href: 'https://coder.test/sessions/example/?embed=1' + (support ? '&support=1' : ''),
    search: '?embed=1', replace: url => { destination = url.href; }};
  const document = {hidden:false, addEventListener(){}, querySelector: () => ({
    srcObject:new MediaStream(), readyState:4, videoWidth:width, videoHeight:width})};
  vm.runInNewContext(process.argv[1], {URL, location, MediaStream, HTMLMediaElement:{HAVE_CURRENT_DATA:2},
    performance:{now:()=>time}, document, window:{setInterval:fn=>{tick=fn}, clearInterval(){}, addEventListener(){}}});
  time = 21000;
  tick?.();
  return destination;
}
assert.equal(run({support:true}), undefined);
assert.equal(run({width:800}), undefined);
assert.equal(run({width:2}), 'https://coder.test/sessions/example/compatibility.html?embed=1');
"""
        subprocess.run(['node', '-e', program, source], check=True, capture_output=True, text=True)

    def test_panel_switches_viewer_without_changing_session(self):
        source = pathlib.Path(__file__).with_name('neko-transport.js').read_text()
        program = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
const origin = 'https://coder.test';
const session = origin + '/@owner/workspace/apps/neko/sessions/app123/';
let href = session + '?embed=1&panel=1', message, reported, tick;
const parent = {postMessage: (data, target) => { assert.equal(target, origin); reported = data.mode; }};
const window = {parent, addEventListener: (name, fn) => {if (name === 'message') message = fn;},
  setInterval: fn => {tick = fn;}, clearInterval: () => {tick = undefined;}};
const load = () => vm.runInNewContext(process.argv[1], {URL, window,
  location: {href, replace: url => {href = url.href;}}, history: {replaceState: (_, __, url) => {href = url.href;}},
  performance: {now: () => 30000}, document: {addEventListener() {}, querySelector() {return null;}}});
const select = (mode, source = parent, from = origin) =>
  message({source, origin: from, data: {type: 'coder:browser-set-transport', mode}});
load();
assert.equal(reported, 'webrtc');
select('https', {});
select('https', parent, 'https://other.test');
select('invalid');
assert.equal(href, session + '?embed=1&panel=1');
select('webrtc'); tick();
assert.equal(tick, undefined);
select('https');
assert.equal(href, session + 'compatibility.html?embed=1&panel=1&transport=https');
load();
assert.equal(reported, 'https');
select('webrtc');
assert.equal(href, session + '?embed=1&panel=1&transport=webrtc');
load();
assert.equal(reported, 'webrtc');
assert.equal(tick, undefined);
"""
        result = subprocess.run(['node', '-e', program, source], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_panel_commands_require_the_same_origin_parent(self):
        source = pathlib.Path(__file__).with_name('neko-panel.js').read_text()
        program = r"""
const assert = require('node:assert/strict');
const vm = require('node:vm');
(async () => {
        const listeners = {}, timers = new Map(), resolutions = [];
        let clicked = 0, nextTimer = 0;
const parent = {postMessage() {}};
const video = {muted:true, volume:1, addEventListener() {}};
const root = {toggleAttribute() {}};
const context = {
 URL, location:{href:'https://coder.test/app/?embed=1',origin:'https://coder.test'},
         window:{parent,innerWidth:1200,innerHeight:600,setInterval:()=>1,clearInterval(){},
          setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id},
          clearTimeout:id=>timers.delete(id),
          addEventListener:(name,fn)=>{listeners[name]=fn},removeEventListener(){}},
 document:{documentElement:root,head:{appendChild(){}},createElement:()=>({}),
 querySelector:selector=>selector==='video'?video:{dispatchEvent:()=>{clicked++}}},
 MutationObserver:class {observe(){} disconnect(){}},
 MouseEvent:class {},
         fetch:async (url,options)=>{resolutions.push([String(url),JSON.parse(options.body)]);return {ok:true}},
};
vm.runInNewContext(process.argv[1], context);
        listeners.message({origin:'https://other.test',source:parent,data:{type:'coder:browser-mute',muted:false}});
assert.equal(video.muted,true);
        listeners.message({origin:'https://coder.test',source:{},data:{type:'coder:browser-resolution'}});
assert.equal(clicked,0);
        listeners.message({origin:'https://coder.test',source:parent,data:{type:'coder:browser-mute',muted:false}});
assert.equal(video.muted,false);
listeners.message({origin:'https://other.test',source:parent,data:{type:'coder:browser-volume',volume:0.2}});
assert.equal(video.volume,1);
listeners.message({origin:'https://coder.test',source:parent,data:{type:'coder:browser-volume',volume:0.4}});
assert.equal(video.volume,0.4);
listeners.message({origin:'https://coder.test',source:parent,data:{type:'coder:browser-volume',volume:5}});
assert.equal(video.volume,1);
listeners.message({origin:'https://coder.test',source:parent,data:{type:'coder:browser-volume',volume:NaN}});
assert.equal(video.volume,1);
        listeners.message({origin:'https://coder.test',source:parent,data:{type:'coder:browser-resolution'}});
assert.equal(clicked,1);
        context.window.innerWidth = 1536;
        listeners.resize();
        await [...timers.values()][0]();
        assert.deepEqual(resolutions, [['https://coder.test/app/api/room/screen', {width:1536,height:600,rate:60}]]);
        listeners.message({origin:'https://coder.test',source:parent,data:{type:'coder:browser-fit',width:1800,height:900}});
        await [...timers.values()][0]();
        assert.deepEqual(resolutions[1][1], {width:1800,height:900,rate:60});
})().catch(error => {console.error(error);process.exitCode=1});
"""
        result = subprocess.run(['node', '-e', program, source], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

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
