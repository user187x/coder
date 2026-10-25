import type { WorkspaceInfrastructureMetrics } from "#/api/workspaceMetrics";
import { MockWorkspace } from "./entities";

export const MockWorkspaceInfrastructureMetrics = {
	allocation: {
		cpu: 2,
		memory: 4 * 1024 ** 3,
		disk: 10 * 1024 ** 3,
		diskEnforced: false,
		source: {
			cpu: "container-limit",
			memory: "container-limit",
			disk: "pvc-capacity",
		},
	},
	workspaceId: MockWorkspace.id,
	workspaceName: MockWorkspace.name,
	nodeName: "worker-node-2",
	nodeCount: 3,
	generatedAt: "2026-10-24T12:00:00Z",
	node: {
		cpu: {
			used: 1,
			total: 4,
			unit: "cores",
			collectedAt: "2026-10-24T12:00:00Z",
			error: null,
		},
		memory: {
			used: 2 * 1024 ** 3,
			total: 8 * 1024 ** 3,
			unit: "bytes",
			collectedAt: "2026-10-24T12:00:00Z",
			error: null,
		},
		disk: {
			used: 10 * 1024 ** 3,
			total: 100 * 1024 ** 3,
			unit: "bytes",
			collectedAt: "2026-10-24T12:00:00Z",
			error: null,
		},
		load: {
			used: null,
			total: null,
			unit: "load",
			collectedAt: null,
			error: "Load averages are not exposed by the Kubernetes node API",
		},
	},
	cluster: {
		cpu: {
			used: 4,
			total: 16,
			unit: "cores",
			collectedAt: "2026-10-24T12:00:00Z",
			error: null,
		},
		memory: {
			used: 10 * 1024 ** 3,
			total: 32 * 1024 ** 3,
			unit: "bytes",
			collectedAt: "2026-10-24T12:00:00Z",
			error: null,
		},
		disk: {
			used: 60 * 1024 ** 3,
			total: 300 * 1024 ** 3,
			unit: "bytes",
			collectedAt: "2026-10-24T12:00:00Z",
			error: null,
		},
		load: {
			used: null,
			total: null,
			unit: "load",
			collectedAt: null,
			error: "Load averages are not exposed by the Kubernetes node API",
		},
	},
} satisfies WorkspaceInfrastructureMetrics;

export const MockWorkspaceMetricMetadata = [
	["0_cpu", "CPU", "0.2 / 2 cores (10%)"],
	["1_ram", "RAM", "1 / 4 GiB (25%)"],
	["2_disk", "Disk", "0.3 / 10 GiB (3%)"],
	["3_load", "Ø Load", "0.15 / 2 cores (7.5%)"],
].map(([key, display_name, value]) => ({
	description: { key, display_name, script: "", interval: 10, timeout: 5 },
	result: {
		value,
		error: "",
		collected_at: MockWorkspaceInfrastructureMetrics.generatedAt,
		age: 0,
	},
}));
