import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

import imagebuilder


class TestDependencyLibrary(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = pathlib.Path(directory.name) / "images.tar"

    def archive(self, entries):
        with tarfile.open(self.path, "w") as out:
            for name, value in entries.items():
                data = json.dumps(value).encode()
                member = tarfile.TarInfo(name)
                member.size = len(data)
                out.addfile(member, io.BytesIO(data))

    def test_docker_archive_selects_the_requested_repository_and_tag(self):
        self.archive({"manifest.json": [
            {"RepoTags": ["other/python:3.13-alpine"]},
            {"RepoTags": ["python:3.13-alpine"]},
        ]})
        self.assertEqual(
            imagebuilder.dependency_archive_name(self.path, "docker.io/library/python:3.13-alpine"),
            "python:3.13-alpine",
        )

    def test_oci_archive_selects_the_index_tag(self):
        self.archive({
            "oci-layout": {"imageLayoutVersion": "1.0.0"},
            "index.json": {"manifests": [
                {"annotations": {
                    "org.opencontainers.image.ref.name": "1.25.1",
                    "io.containerd.image.name": "ghcr.io/cloudnative-pg/pgbouncer:1.25.1",
                }},
                {"annotations": {"io.containerd.manifest.subject": "sha256:example"}},
            ]},
        })
        self.assertEqual(
            imagebuilder.dependency_archive_name(self.path, "ghcr.io/cloudnative-pg/pgbouncer:1.25.1"),
            "1.25.1",
        )
        with self.assertRaisesRegex(ValueError, "matching image tag"):
            imagebuilder.dependency_archive_name(self.path, "ghcr.io/someone/pgbouncer:1.25.1")

    def test_an_existing_tag_is_rejected_before_reading_the_archive(self):
        handler = Mock()
        with patch.object(imagebuilder, "registry") as registry:
            with self.assertRaisesRegex(ValueError, "already exists"):
                imagebuilder.upload_dependency(handler, "ghcr.io/cloudnative-pg/pgbouncer:1.25.1", "admin")
        registry.assert_called_once_with(
            "HEAD", "coder-dependencies/cloudnative-pg/pgbouncer/manifests/1.25.1", timeout=15,
        )
        handler.rfile.read.assert_not_called()

    def test_member_cannot_upload_a_dependency(self):
        handler = Mock(headers={"X-Requested-With": "coder-ui"})
        handler.user.return_value = {"username": "member", "roles": ["member", "template-admin"]}, None
        with patch.multiple(imagebuilder, ENABLED=True, STORE=object()):
            self.assertTrue(imagebuilder.handle(
                handler, "PUT", imagebuilder.BASE + "/api/images/dependencies", "ref=python:3.13", {"owner"},
            ))
        handler.send_json.assert_called_once_with(403, {"error": "Images is for admins only."})
        handler.rfile.read.assert_not_called()
