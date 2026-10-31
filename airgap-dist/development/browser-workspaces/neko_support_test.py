"""Support view gates an existing browser window with parent-checked input commands."""
import pathlib
import re
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which('node'), 'Node required')
class SupportInputTest(unittest.TestCase):
    def test_parent_control_acknowledgement_and_view_only(self):
        html = pathlib.Path(__file__).with_name('neko-support.html').read_text()
        source = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
        program = r'''
const vm = require('node:vm'), assert = require('node:assert/strict');
const messages=[], listeners={}, elements=[];
const parent={postMessage:(message,origin)=>messages.push({message,origin})};
const nav={children:[],dataset:{},replaceChildren(){this.children=[]},append(e){this.children.push(e)}};
const status={};
const context={URL,AbortController,location:{origin:'https://browser.test'},
 window:{parent,addEventListener:(type,fn)=>listeners[type]=fn,removeEventListener(){}},
 document:{referrer:'https://coder.test/',querySelector:s=>s==='nav'?nav:status,
  createElement(tag){const e={tag,dataset:{},style:{},blur(){this.blurred=true},remove(){},setAttribute(){},addEventListener(type,fn){this[type]=fn}};elements.push(e);return e},
  body:{append(){}}},
 fetch:async()=>({ok:true,json:async()=>({sessions:['existing-window']})}),setInterval:()=>1,clearInterval(){}};
vm.runInNewContext(process.argv[1],context);
(async()=>{
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nav.children.length,1);
 nav.children[0].click();
 const frame=elements.find(e=>e.tag==='iframe');
 assert.equal(frame.src,'/sessions/existing-window/?embed=1&existing=1&support=1');
 assert.equal(frame.inert,true);
 const command={source:parent,origin:'https://coder.test',data:{type:'coder:support-control',enabled:true}};
 listeners.message({...command,source:{}});
 listeners.message({...command,origin:'https://untrusted.test'});
 assert.equal(frame.inert,true);
 listeners.message(command);
 assert.equal(frame.inert,false);
 assert.equal(frame.style.pointerEvents,'auto');
 assert.equal(messages.at(-1).message.enabled,true);
 assert.equal(messages.at(-1).message.type,'coder:support-control-state');
 assert.equal(messages.at(-1).origin,'https://coder.test');
 listeners.message({...command,data:{type:'coder:support-control',enabled:false}});
 assert.equal(frame.inert,true);
 assert.equal(frame.style.pointerEvents,'none');
 assert.equal(frame.blurred,true);
 assert.equal(messages.at(-1).message.enabled,false);
})().catch(error=>{console.error(error);process.exitCode=1});
'''
        result = subprocess.run(['node', '-e', program, source], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
