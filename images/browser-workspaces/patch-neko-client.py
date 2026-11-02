"""Connect both pinned N.eko clients through their private Coder app session."""
import hashlib
import pathlib
import re

CONNECT = '''this.passwordLoginEnabled=false;
var self=this,owner=window.CODER_NEKO_OWNER||"Workspace";
return this.$http.get("api/whoami").catch(function(error){
if(error.response&&error.response.status===401)return self.$http.post("api/login",{username:owner,password:""});
throw error;
}).then(function(){self.$accessor.login({displayname:owner,password:""});}).catch(function(){
self.$swal({title:"Unable to connect",text:"Refresh this app to retry.",icon:"error"});
});'''


def patch_bundle(source, legacy=False):
    if legacy:
        marker = 'this.loadOAuthConfig()'
        if source.count(marker) != 1:
            raise ValueError('The pinned legacy N.eko connection component has changed.')
        position = source.index(marker)
        start = source.rfind('{key:"mounted",value:', 0, position)
        end = source.index('},{key:"connecting",', position)
        if start < 0:
            raise ValueError('The legacy connection method was not found.')
        source = source[:start] + '{key:"mounted",value:function(){' + CONNECT + '}' + source[end:]
        ice = 'n'
    else:
        marker = 'async mounted(){if(await this.loadOAuthConfig())return;'
        if source.count(marker) != 1:
            raise ValueError('The pinned N.eko connection component has changed.')
        source = source.replace(marker, 'async mounted(){' + CONNECT + 'if(await this.loadOAuthConfig())return;')
        ice = 't'
    overlay = ',"mutedOverlay",!0)'
    if source.count(overlay) != 1:
        raise ValueError('The pinned audio overlay default has changed.')
    source = source.replace(overlay, ',"mutedOverlay",!1)')
    mouse = 'key:"onMouseDown",value:function(e){' if legacy else 'onMouseDown(e){'
    if source.count(mouse) != 1:
        raise ValueError('The pinned browser input handler has changed.')
    source = source.replace(mouse, mouse + 'if(this.muted&&!document.documentElement.hasAttribute("data-coder-muted"))this.unmute();')
    peer = 'new RTCPeerConnection({iceServers:' + ice + '}):new RTCPeerConnection'
    if source.count(peer) != 1:
        raise ValueError('The pinned N.eko WebRTC construction has changed.')
    connection = 'new RTCPeerConnection({iceServers:' + ice + ',iceTransportPolicy:"relay"})'
    source = source.replace(peer, connection + ':' + connection)
    if ',"passwordLoginEnabled",!0)' not in source:
        raise ValueError('The pinned login form default has changed.')
    source = source.replace(',"passwordLoginEnabled",!0)', ',"passwordLoginEnabled",!1)')
    return source.replace('e._v(e._s(e.$t("connect.login_title")))', 'e._v("Connecting to your browser")')


def patch(root):
    index = root / 'index.html'
    html = index.read_text()
    for legacy in (False, True):
        pattern = r'app-legacy\.[a-z0-9]+\.js' if legacy else r'app\.[a-z0-9]+\.js'
        files = [path for path in (root / 'js').iterdir() if re.fullmatch(pattern, path.name)]
        if len(files) != 1:
            raise ValueError('Expected one N.eko client bundle of each type.')
        path = files[0]
        source = patch_bundle(path.read_text(), legacy)
        name = ('app-legacy.coder-' if legacy else 'app.coder-') + hashlib.sha256(source.encode()).hexdigest()[:12] + '.js'
        (root / 'js' / name).write_text(source)
        path.unlink()
        html = html.replace(path.name, name)
    html = html.replace('<head>', '<head><script src="coder-owner.js"></script><script defer src="coder-panel.js"></script>', 1)
    index.write_text(html)


if __name__ == '__main__':
    patch(pathlib.Path('/var/www'))
