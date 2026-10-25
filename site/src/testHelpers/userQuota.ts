import type { QuotaReport } from "#/api/platform";
import { MockUserMember } from "./entities";

export const MockQuotaReport: QuotaReport = {
	settings: {
		default: { workspaces: 3, cpu: 4, memory: 8 },
		users: {},
		exemptAdmins: false,
	},
	users: [
		{
			id: MockUserMember.id,
			username: MockUserMember.username,
			name: MockUserMember.name ?? MockUserMember.username,
			avatar: "",
			admin: false,
			exempt: false,
			override: null,
			limits: { workspaces: 4, cpu: 6, memory: 10 },
			baseLimits: { workspaces: 3, cpu: 4, memory: 8 },
			bonus: { workspaces: 1, cpu: 2, memory: 2 },
			effectiveLimits: { workspaces: 4, cpu: 6, memory: 10 },
			bonusScope: "global",
			activeGrantCount: 1,
			usage: {
				workspaces: 1,
				cpu: 2,
				memory: 4,
				running: 1,
				runningCpu: 2,
				runningMemory: 4,
				liveCpu: 0.5,
				liveMemory: 1,
			},
			atLimit: false,
			workspaces: [],
		},
	],
	cluster: {
		cpu: 8,
		memory: 16,
		usedCpu: 2,
		usedMemory: 4,
		requestedCpu: 3,
		requestedMemory: 6,
		nodes: 1,
		live: true,
	},
	liveUsage: true,
	parameters: { cpu: "cpu", memory: "memory" },
	generatedAt: "2026-10-24T12:00:00Z",
};
