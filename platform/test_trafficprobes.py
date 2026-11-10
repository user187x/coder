import unittest

import trafficprobes


class TrafficProbesTest(unittest.TestCase):
    def test_port(self):
        self.assertEqual(trafficprobes._port(8888), 8888)
        for bad in (0, 65536, "8888", 8.5, True, None):
            with self.subTest(port=bad), self.assertRaises(ValueError):
                trafficprobes._port(bad)

    def test_addresses_stay_on_the_tunnel_network(self):
        self.assertEqual(trafficprobes._addresses(["10.253.0.38"]), ["10.253.0.38"])
        for bad in ([], ["10.42.1.5"], ["example.com"], "10.253.0.38", ["10.253.0.1"] * 17, [5]):
            with self.subTest(addresses=bad), self.assertRaises(ValueError):
                trafficprobes._addresses(bad)

    def test_listing_reports_each_workspace(self):
        trafficprobes.TESTS.clear()
        trafficprobes.TESTS[("w1", "emit")] = {"kind": "emit", "port": 8888, "sent": 3, "failed": 1, "received": 0,
                                               "listening": False, "running": True, "error": None, "pod": "p",
                                               "started": 1.0}
        self.assertEqual(trafficprobes.listing(["w1", "w2"]), {
            "w1": {"emit": {"kind": "emit", "port": 8888, "sent": 3, "failed": 1, "received": 0,
                            "listening": False, "running": True, "error": None}},
            "w2": {}})
        trafficprobes.TESTS.clear()


if __name__ == "__main__":
    unittest.main()
