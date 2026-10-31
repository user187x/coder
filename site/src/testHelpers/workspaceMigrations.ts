import type { WorkspaceMigrationPlan } from "#/api/workspaceMigrations";
import { MockWorkspace } from "./entities";

export const MockWorkspaceMigrationPlan: WorkspaceMigrationPlan = {
	workspaceId: MockWorkspace.id,
	workspaceName: MockWorkspace.name,
	sourceNode: "worker-01",
	diskBytes: 10 * 1024 ** 3,
	homeUsedBytes: 3.2 * 1024 ** 3,
	generatedAt: "2026-10-30T04:30:00Z",
	operation: null,
	nodes: [
		{
			name: "worker-01",
			ips: ["10.0.0.11"],
			cpu: { total: 24, used: 4.2, requested: 8 },
			memory: {
				total: 64 * 1024 ** 3,
				used: 24 * 1024 ** 3,
				requested: 32 * 1024 ** 3,
			},
			disk: { total: 1024 ** 4, used: 400 * 1024 ** 3, free: 624 * 1024 ** 3 },
			eligible: false,
			reasons: ["Current node"],
		},
		{
			name: "worker-02",
			ips: ["10.0.0.12"],
			cpu: { total: 24, used: 2.1, requested: 6 },
			memory: {
				total: 64 * 1024 ** 3,
				used: 12 * 1024 ** 3,
				requested: 24 * 1024 ** 3,
			},
			disk: { total: 1024 ** 4, used: 200 * 1024 ** 3, free: 824 * 1024 ** 3 },
			eligible: true,
			reasons: [],
		},
		{
			name: "worker-03",
			ips: ["10.0.0.13"],
			cpu: { total: 24, used: 22, requested: 22 },
			memory: {
				total: 64 * 1024 ** 3,
				used: 60 * 1024 ** 3,
				requested: 60 * 1024 ** 3,
			},
			disk: { total: 1024 ** 4, used: 1020 * 1024 ** 3, free: 4 * 1024 ** 3 },
			eligible: false,
			reasons: [
				"Insufficient CPU headroom",
				"Insufficient disk space including safety reserve",
			],
		},
	],
};
