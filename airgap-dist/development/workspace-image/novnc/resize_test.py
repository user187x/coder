"""Exercise embedded noVNC resizing and viewer ownership without a VNC server."""
import pathlib
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which("node"), "Node required")
class ResizeTest(unittest.TestCase):
    def test_parent_fit_preserves_focus_ownership(self):
        source = pathlib.Path(__file__).with_name("coder-resize.js").read_text()
        source = source.replace('import UI from "./ui.js";', '')
        program = r'''
const assert = require('node:assert/strict');
const vm = require('node:vm');
const listeners = {}, timers = new Map(), requests = [];
let focused = false, setting = 'remote', sequence = 0, resize = false;
const parent = {};
const rfb = {
 get resizeSession() { return resize; },
 set resizeSession(value) { resize=value; if(value) requests.push('fit'); },
};
const context = {
 URL,
 location: {href:'https://workspace.test/?resize=remote'},
 UI: { rfb, getSetting:()=>setting, connect(){}, addSettingChangeHandler(){} },
 window: {parent,innerWidth:1200,innerHeight:700,addEventListener:(name,fn)=>listeners[name]=fn},
 document: {hasFocus:()=>focused,referrer:'https://coder.test/@admin/test',visibilityState:'visible',addEventListener(){}},
 setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id},
 clearTimeout:id=>timers.delete(id),
};
vm.runInNewContext(process.argv[1],context);
const fit = {source:parent,origin:'https://coder.test',data:{type:'coder:desktop-fit'}};
listeners.message({...fit,origin:'https://other.test'});
listeners.message({...fit,source:{}});
assert.equal(requests.length,0);
listeners.message(fit);
assert.equal(resize,true);
assert.equal(requests.length,1);
listeners.message(fit);
assert.equal(timers.size,1);
for(const fn of timers.values()) fn();
timers.clear();
assert.equal(resize,false);
focused=true;
listeners.focus();
assert.equal(resize,true);
listeners.message(fit);
for(const fn of timers.values()) fn();
assert.equal(resize,true);
focused=false;
listeners.blur();
assert.equal(resize,false);
setting='scale';
const before=requests.length;
listeners.message(fit);
assert.equal(requests.length,before);
setting='remote';
context.window.innerHeight=0;
listeners.message(fit);
assert.equal(requests.length,before);
context.window.innerHeight=700;
context.document.visibilityState='hidden';
listeners.message(fit);
assert.equal(requests.length,before);
'''
        subprocess.run(["node", "-e", program, source], check=True, capture_output=True, text=True)

    def test_support_input_requires_parent_and_acknowledges_connected_transport(self):
        source = pathlib.Path(__file__).with_name("coder-resize.js").read_text().replace('import UI from "./ui.js";', '')
        program = r'''
const assert = require('node:assert/strict');
const vm = require('node:vm');
const listeners = {}, remote = {}, messages = [];
const parent = {postMessage:(data,origin)=>messages.push({data,origin})};
const rfb = {viewOnly:false,resizeSession:true,scaleViewport:false,addEventListener:(type,fn)=>remote[type]=fn};
const UI = {rfb:process.argv[2]==='already-connecting'?rfb:undefined,connected:false,connect(){this.rfb=rfb},getSetting:()=> 'remote',addSettingChangeHandler(){}};
const context = {URL,UI,location:{href:'https://desktop.test/?support=1'},
 window:{parent,addEventListener:(type,fn)=>listeners[type]=fn},
 document:{referrer:'https://coder.test/',addEventListener(){}},setTimeout,clearTimeout};
vm.runInNewContext(process.argv[1],context);
UI.connect();
assert.equal(rfb.viewOnly,true);
assert.equal(rfb.resizeSession,false);
assert.equal(rfb.scaleViewport,true);
assert.equal(messages.length,0);
UI.connected=true;
remote.connect();
assert.ok(messages.some(m=>m.data.type==='coder:support-ready'&&m.origin==='https://coder.test'));
const command = {source:parent,origin:'https://coder.test',data:{type:'coder:support-control',enabled:true}};
listeners.message({...command,source:{}});
listeners.message({...command,origin:'https://untrusted.test'});
assert.equal(rfb.viewOnly,true);
listeners.message(command);
assert.equal(rfb.viewOnly,false);
assert.equal(JSON.stringify(messages.at(-1).data),JSON.stringify({type:'coder:support-control-state',enabled:true}));
listeners.message({...command,data:{type:'coder:support-control',enabled:false}});
assert.equal(rfb.viewOnly,true);
assert.equal(JSON.stringify(messages.at(-1).data),JSON.stringify({type:'coder:support-control-state',enabled:false}));
remote.disconnect();
assert.equal(messages.at(-1).data.type,'coder:support-ended');
'''
        for state in ["not-started", "already-connecting"]:
            with self.subTest(state=state):
                subprocess.run(["node", "-e", program, source, state], check=True, capture_output=True, text=True)


if __name__ == "__main__":
    unittest.main()
