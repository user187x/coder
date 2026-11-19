import unittest

from database_inventory import discover


class FakeKube:
    def __init__(self, objects):
        self.objects = objects
        self.requests = []

    def call(self, method, path):
        self.requests.append((method, path))
        return self.objects.get(path, (404, {}))


class DatabaseInventoryTest(unittest.TestCase):
    def test_projects_owned_configuration_and_excludes_raw_secrets(self):
        metadata = {"name": "db", "namespace": "coder", "annotations": {
            "meta.helm.sh/release-name": "coder",
            "meta.helm.sh/release-namespace": "coder",
            "kubectl.kubernetes.io/last-applied-configuration": "sensitive-marker",
        }}
        cluster = {"metadata": metadata, "spec": {
            "instances": 1, "enableSuperuserAccess": False,
            "storage": {"size": "10Gi", "storageClass": "local-path"},
            "postgresql": {"parameters": {
                "max_connections": "100", "archive_command": "sensitive-marker",
            }},
            "bootstrap": {"initdb": {
                "database": "app", "password": "sensitive-marker",
                "secret": {"name": "db-app"},
            }},
            "backup": {"barmanObjectStore": {"s3Credentials": {"accessKeyId": "sensitive-marker"}}},
        }}
        service = {"metadata": {"name": "db-rw", "namespace": "coder"}, "spec": {
            "clusterIP": "10.0.0.5", "ports": [{"port": 5432, "targetPort": "postgres"}],
        }}
        kube = FakeKube({
            "/api/v1/namespaces/coder/services/db-rw": (200, service),
            "/apis/postgresql.cnpg.io/v1/namespaces/coder/scheduledbackups": (200, {"items": []}),
            "/apis/storage.k8s.io/v1/storageclasses/local-path": (403, {}),
        })
        report = discover(kube, {"metadata": {"name": "coder", "namespace": "coder"},
                                 "spec": {"template": {"spec": {"containers": [{"env": [
                                     {"name": "CODER_PG_CONNECTION_URL", "value": "sensitive-marker"},
                                 ]}]}}}},
                          {"host": "db-rw.coder", "port": 5432, "password": "sensitive-marker"},
                          cluster, [], "coder", "coder")
        resources = {resource["kind"]: resource for resource in report["resources"]}
        self.assertEqual(resources["Cluster"]["managedBy"], "Helm release coder (coder)")
        self.assertEqual(resources["Cluster"]["values"]["spec.storage.size"], "10Gi")
        self.assertIs(resources["Cluster"]["values"]["spec.enableSuperuserAccess"], False)
        self.assertEqual(resources["Cluster"]["values"]["spec.postgresql.parameters.max_connections"], "100")
        self.assertEqual(resources["Service"]["values"]["spec.clusterIP"], "10.0.0.5")
        self.assertEqual(report["unavailable"], [{"resource": "StorageClass local-path", "status": 403}])
        self.assertNotIn("sensitive-marker", repr(report))
        self.assertTrue(all(method == "GET" and "/secrets" not in path for method, path in kube.requests))

    def test_external_endpoint_does_not_discover_unrelated_cluster_resources(self):
        kube = FakeKube({})
        report = discover(kube, {"metadata": {"name": "coder", "namespace": "coder"}},
                          {"host": "db.example.com"}, None, [], "coder", "coder")
        self.assertEqual(kube.requests, [])
        self.assertEqual(report["resources"][0]["values"], {"connection.host": "db.example.com"})


if __name__ == "__main__":
    unittest.main()
