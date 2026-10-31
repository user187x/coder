import { MockClusterNetworkReport } from "#/testHelpers/clusterNetwork";
import { MockHealth } from "#/testHelpers/entities";
import { platformHealth } from "./platformHealth";

it("reports component failures and unavailable endpoints separately", () => {
	const checks = platformHealth(
		{
			...MockHealth,
			derp: {
				...MockHealth.derp,
				severity: "error",
				error: "Relay unavailable",
			},
		},
		{
			...MockClusterNetworkReport,
			services: MockClusterNetworkReport.services?.map((service) => ({
				...service,
				ready: null,
			})),
		},
	);
	expect(
		checks.filter((c) => c.severity === "error").map((c) => c.name),
	).toEqual(["DERP relays", "Pod traefik/traefik-6d-x"]);
	expect(checks.filter((c) => c.severity === "unknown")).toHaveLength(3);
});

it("includes failed Coder pods but ignores completed jobs and terminating pods", () => {
	const pod = MockClusterNetworkReport.coder[0];
	const checks = platformHealth(undefined, {
		...MockClusterNetworkReport,
		coder: [
			{ ...pod, name: "failed", ready: false, phase: "Failed" },
			{ ...pod, name: "completed", ready: false, phase: "Succeeded" },
			{ ...pod, name: "terminating", ready: false, deleting: true },
		],
		services: [],
	});
	expect(checks.map((c) => [c.name, c.severity])).toEqual([
		["Pod coder/failed", "error"],
	]);
});

it("does not mistake unavailable pod data or external-name services for failures", () => {
	const checks = platformHealth(undefined, {
		...MockClusterNetworkReport,
		podsAvailable: false,
		services: MockClusterNetworkReport.services?.map((service) => ({
			...service,
			type: "ExternalName",
			ready: 0,
		})),
	});
	expect(checks).toEqual([]);
});
