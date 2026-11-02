import type { ClusterNetworkReport } from "#/api/clusterNetwork";
import {
	MockClusterNetworkReport,
	MockHealthyClusterNetworkReport,
	MockHealthyMeshReport,
	MockMeshReport,
} from "#/testHelpers/clusterNetwork";
import { networkHealth } from "./networkHealth";

const report = MockHealthyClusterNetworkReport;
const mesh = MockHealthyMeshReport;

describe("networkHealth", () => {
	it("reports healthy when the available checks pass, including unmeasured links", () => {
		expect(networkHealth(report, mesh)).toEqual({
			severity: "ok",
			label: "Network checks passed",
		});
	});

	it("does not label missing, failed or incomplete reports as healthy", () => {
		expect(networkHealth(undefined, undefined).label).toBe(
			"Checking network status",
		);
		expect(networkHealth(report, mesh, true).label).toBe(
			"Network status unavailable",
		);
		for (const partial of [
			{ nodes: [] },
			{ podsAvailable: false },
			{ workspacesApi: false },
			{ servicesError: "permission denied" },
			{
				services: report.services?.map((service) => ({
					...service,
					ready: null,
				})),
			},
		]) {
			expect(networkHealth({ ...report, ...partial }, mesh)).toEqual({
				severity: null,
				label: "Network status incomplete",
			});
		}
	});

	it("reports failed components, endpoints and probes together", () => {
		expect(networkHealth(MockClusterNetworkReport, MockMeshReport)).toEqual({
			severity: "error",
			label:
				"Network needs attention: platform components not ready; services without ready endpoints; failed network connections",
		});
	});

	it("keeps confirmed failures visible when other checks are unavailable", () => {
		expect(
			networkHealth(
				{
					...report,
					nodes: report.nodes.map((node) => ({ ...node, ready: false })),
					servicesError: "permission denied",
				},
				mesh,
			),
		).toEqual({
			severity: "error",
			label:
				"Network needs attention: nodes not ready; some checks unavailable",
		});
	});

	it("catches a failed individual probe even when the aggregate succeeds", () => {
		expect(
			networkHealth(report, {
				...mesh,
				edges: mesh.edges.map((edge) => ({
					...edge,
					samples: edge.samples.map((sample) => ({
						...sample,
						error: "connection refused",
					})),
				})),
			}).severity,
		).toBe("error");
	});

	it.each<[string, Partial<ClusterNetworkReport>]>([
		[
			"node pressure",
			{
				nodes: report.nodes.map((node) => ({
					...node,
					pressure: ["MemoryPressure"],
				})),
			},
		],
		[
			"cordoned node",
			{ nodes: report.nodes.map((node) => ({ ...node, unschedulable: true })) },
		],
		[
			"disconnected workspace",
			{
				workspaces: report.workspaces.map((workspace) => ({
					...workspace,
					agents: workspace.agents.map((agent) => ({
						...agent,
						status: "disconnected",
					})),
				})),
			},
		],
		["unplaced workspace", { unplaced: report.workspaces }],
		[
			"partially ready service",
			{
				services: report.services?.map((service) => ({
					...service,
					endpoints: 2,
					ready: 1,
				})),
			},
		],
	])("warns about %s", (_name, partial) => {
		expect(networkHealth({ ...report, ...partial }, mesh).severity).toBe(
			"warning",
		);
	});

	it("ignores completed and deleting pods and external service endpoints", () => {
		expect(
			networkHealth(
				{
					...report,
					coder: report.coder.map((pod, index) => ({
						...pod,
						ready: false,
						deleting: index % 2 === 0,
						phase: index % 2 === 0 ? "Running" : "Succeeded",
					})),
					services: report.services?.map((service) => ({
						...service,
						type: "ExternalName",
						ready: null,
					})),
				},
				mesh,
			).severity,
		).toBe("ok");
	});
});
