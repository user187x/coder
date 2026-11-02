"""Apply an immutable Browser lease policy before dropping root privileges."""
import json
import os
import pathlib
import re


def browser_policy(terms):
    if not terms:
        return None
    if terms.get('no_root') is not True or terms.get('sandbox_only') is not True:
        raise ValueError('Lease requires no root and an isolated Browser instance.')
    mode, domains = terms.get('website_mode'), terms.get('websites')
    if mode not in ('all', 'allowlist', 'blocklist') or not isinstance(domains, list) or len(domains) > 100:
        raise ValueError('Invalid lease website policy.')
    if (mode == 'all') != (len(domains) == 0):
        raise ValueError('Website list does not match policy mode.')
    for domain in domains:
        if not isinstance(domain, str) or len(domain) > 253 or not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+', domain):
            raise ValueError('Invalid website domain.')
    return {
        'URLBlocklist': ['*'] if mode == 'allowlist' else domains if mode == 'blocklist' else [],
        'URLAllowlist': domains if mode == 'allowlist' else [],
        'ExtensionInstallBlocklist': ['*'], 'DeveloperToolsAvailability': 2,
        'BrowserAddPersonEnabled': False, 'BrowserGuestModeEnabled': False,
        'IncognitoModeAvailability': 1, 'BrowserSignin': 0, 'SyncDisabled': True,
    }


if __name__ == '__main__':
    policy = browser_policy(json.loads(os.environ.get('CODER_BROWSER_LEASE_POLICY', '{}')))
    if policy is not None:
        path = pathlib.Path('/etc/chromium/policies/managed/coder-lease.json')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(policy))
        path.chmod(0o644)
        os.chown(path, 0, 0)
