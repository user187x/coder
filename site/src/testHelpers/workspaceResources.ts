import type {
	ResourceHistorySample,
	WorkspaceResourceHistory,
} from "#/api/platform";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { MockWorkspaceAgent } from "./entities";

export const MockResourceHistorySamples: ResourceHistorySample[] = Array.from(
	{ length: 60 },
	(_, i) => ({
		t: 1793311200000 + i * 5000,
		share: 8 + 24 * Math.sin(i / 6) ** 2,
		value: 0.5,
		text: "0.5 / 2 cores",
		key: "0_cpu_usage",
	}),
);
export const MockWorkspaceResourceHistory: WorkspaceResourceHistory = {
	asOf: 1793311500000,
	windowSeconds: 300,
	agents: {
		[MockWorkspaceAgent.id]: {
			cpu: MockResourceHistorySamples,
			ram: MockResourceHistorySamples,
			disk: MockResourceHistorySamples,
			load: [],
		},
	},
};
export const MockResourceMetadata: WorkspaceAgentMetadata = {
	description: {
		key: "0_cpu_usage",
		display_name: "CPU",
		script: "",
		interval: 1,
		timeout: 1,
	},
	result: {
		value: "0.5 / 2 cores (25%)",
		error: "",
		age: 0,
		collected_at: new Date(MockWorkspaceResourceHistory.asOf).toISOString(),
	},
};
