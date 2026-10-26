"""Port policy edits are authorized, bounded, revision checked, and capability negotiated."""
import base64
import unittest
import workspace_tunnels_test as existing

tunnels = existing.tunnels


class TunnelPortPolicyTest(existing.WorkspaceTunnelsTest):
    def supported(self, wid, capable=True):
        return tunnels.sync(wid, dict(public_key=base64.b64encode(wid.encode()[:32]).decode(),
            endpoint='192.168.1.%d:51871' % (1 if wid == self.a else 2), applied_revision=-1,
            port_policy_version=1 if capable else 0))

    def test_ports_require_updated_helpers_and_reach_each_policy(self):
        link = self.create()
        ports = [dict(protocol='tcp', port=27182)]
        with self.assertRaisesRegex(ValueError, 'Update both'):
            tunnels.configure_ports('session', self.user, self.org, link['id'], dict(revision=link['revision'], ports=ports))
        self.supported(self.a)
        self.supported(self.b)
        result = tunnels.configure_ports('session', self.user, self.org, link['id'], dict(revision=link['revision'], ports=ports))
        self.assertEqual(result['ports'], ports)
        policy = self.supported(self.a)
        self.assertEqual(policy['peers'][0]['ports'], ports)
        self.assertEqual(policy['port_policy_version'], 1)
        # Downgrading one helper must remove the restricted peer from both policies.
        self.supported(self.b, False)
        self.assertEqual(self.supported(self.a)['peers'], [])

    def test_stale_edit_and_invalid_ports_do_not_change_policy(self):
        link = self.create()
        with self.assertRaisesRegex(ValueError, 'connection changed'):
            tunnels.configure_ports('session', self.user, self.org, link['id'], dict(revision=-1, ports=None))
        for ports in ([], [dict(protocol='sctp', port=80)], [dict(protocol='tcp', port=True)], [dict(protocol='udp', port=65536)], [dict(protocol='tcp', port=80)] * 2):
            with self.subTest(ports=ports), self.assertRaises(ValueError):
                tunnels.clean_ports(ports)
        self.assertEqual(tunnels.listing('session', self.user, self.org)[0]['revision'], link['revision'])


if __name__ == '__main__':
    unittest.main()
