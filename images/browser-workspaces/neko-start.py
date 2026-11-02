"""Initialize missing profile files without changing an existing user's profile."""
import json
import os
import pathlib
import shutil
import stat

source = pathlib.Path('/opt/neko-default-profile')
home = pathlib.Path('/home/neko')
for original in source.rglob('*'):
    target = home / original.relative_to(source)
    if target.exists() or target.is_symlink():
        continue
    if original.is_symlink():
        target.symlink_to(os.readlink(original))
        os.lchown(target, 1000, 1000)
        continue
    if original.is_dir():
        target.mkdir()
    else:
        shutil.copyfile(original, target)
    target.chmod(stat.S_IMODE(original.stat().st_mode))
    os.chown(target, 1000, 1000)
# Chromium uses this spelling for its "Show shortcuts" preference.
preferences_path = home / '.config/chromium/Default/Preferences'
preferences = json.loads(preferences_path.read_text()) if preferences_path.exists() else {}
preferences.setdefault('ntp', {}).setdefault('shortcust_visible', False)
preferences_path.parent.mkdir(parents=True, exist_ok=True)
preferences_path.write_text(json.dumps(preferences))
os.chown(preferences_path, 1000, 1000)

owner = os.environ.get('WORKSPACE_OWNER', '')
if not owner or any(character not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._@+-' for character in owner):
    raise SystemExit('Invalid workspace owner')
pathlib.Path('/var/www/coder-owner.js').write_text('window.CODER_NEKO_OWNER=' + json.dumps(owner) + ';\n')
os.setgroups([1000])
os.setgid(1000)
os.setuid(1000)
os.execv('/usr/bin/supervisord', ['supervisord', '-c', '/etc/neko/coder-supervisord.conf'])
