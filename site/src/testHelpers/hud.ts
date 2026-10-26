import type { HudHistory, HudStorage } from "#/api/platform";

export const MockHudStorage: HudStorage = {
	used: 30,
	total: 100,
	free: 65,
	claimed: 40,
	volumeUsed: 20,
	measuredNodes: 2,
	readyNodes: 2,
	inventoryAvailable: true,
	classes: [
		{
			name: "local-path",
			claims: 4,
			claimed: 40,
			volumes: 4,
			capacity: 40,
			used: 20,
			measuredClaims: 3,
		},
	],
};
export const MockHudHistory: HudHistory = {
	range: "1h",
	start: 1700000000,
	end: 1700003600,
	step: 30,
	points: Array.from({ length: 120 }, (_, i) => ({
		t: 1700000000 + i * 30,
		live: true,
		cpu: 2,
		cpuPeak: 3,
		cpuWorkspaces: 1,
		cpuTotal: 8,
		memory: 6,
		memoryPeak: 7,
		memoryWorkspaces: 4,
		memoryTotal: 16,
		latency: 0.2,
		latencyP95: 0.4,
		latencyMax: 0.5,
		connections: 3,
		diskUsed: 25 + i / 24,
		diskTotal: 100,
		diskClaimed: 40,
		volumeUsed: 15 + i / 24,
	})),
};
