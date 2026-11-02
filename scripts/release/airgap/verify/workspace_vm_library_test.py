"""The VM ISO facade exposes only the existing read-only shared library."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import driveaudit
import drivesource
import safe


class LibraryTest(unittest.TestCase):
    def test_active_account_can_read_library_but_never_write_even_as_admin(self):
        with mock.patch.object(safe, '_audit_account', return_value={'status': 'active', 'admin': True}), \
             mock.patch.object(safe, 'turned_off', return_value={}):
            self.assertTrue(safe.audit_permission('actor', driveaudit.ISO_LIBRARY_OWNER, 'disk.iso'))
            self.assertFalse(safe.audit_permission('actor', driveaudit.ISO_LIBRARY_OWNER, 'disk.iso', write=True))
        with mock.patch.object(safe, '_audit_account', return_value={'status': 'suspended'}):
            self.assertFalse(safe.audit_permission('actor', driveaudit.ISO_LIBRARY_OWNER, 'disk.iso'))

    def test_library_resolves_only_fixed_existing_prefix_and_never_account_storage(self):
        with mock.patch.object(safe, 'client', return_value='private-backend-client'), \
             mock.patch.object(safe, 'bucket', return_value='private-backend-bucket'), \
             mock.patch.object(safe, 'sources') as sources:
            self.assertEqual(safe.drive_of(driveaudit.ISO_LIBRARY_OWNER),
                             ('private-backend-client', 'private-backend-bucket', 'library/isos/', None))
            sources.assert_not_called()

    def test_gateway_allows_exact_library_alias_and_actor_prefix_only(self):
        gateway = driveaudit.Gateway(mock.Mock(), mock.Mock(), lambda actor, owner, path, write: not write,
                                     lambda owner: False, 1024, mock.Mock())
        self.assertEqual(gateway.path('actor', driveaudit.ISO_LIBRARY_OWNER, 'actor/disk.iso'), 'disk.iso')
        for owner, key, write in ((driveaudit.ISO_LIBRARY_OWNER, 'other/disk.iso', False),
                                  (driveaudit.ISO_LIBRARY_OWNER, 'actor/../private', False),
                                  ('library-other', 'actor/disk.iso', False),
                                  (driveaudit.ISO_LIBRARY_OWNER, 'actor/disk.iso', True)):
            with self.assertRaises(drivesource.S3Fail):
                gateway.path('actor', owner, key, write)


if __name__ == '__main__':
    unittest.main()
