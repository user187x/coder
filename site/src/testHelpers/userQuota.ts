import type {
	PlatformAPI,
	QuotaMeResources,
	QuotaReport,
	WorkspaceResourceHistory,
} from "#/api/platform";
import { MockUserMember } from "./entities";

export const MockQuotaReport: QuotaReport = {
	settings: {
		resourceModes: {
			cpu: "cumulative",
			memory: "cumulative",
			disk: "cumulative",
		},
		default: { workspaces: 3, cpu: 4, memory: 8, disk: 100 },
		users: {},
		exemptAdmins: false,
		excludedUsers: [],
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
			limits: { workspaces: 4, cpu: 6, memory: 10, disk: 100 },
			baseLimits: { workspaces: 3, cpu: 4, memory: 8, disk: 100 },
			bonus: { workspaces: 1, cpu: 2, memory: 2, disk: 0 },
			effectiveLimits: { workspaces: 4, cpu: 6, memory: 10, disk: 100 },
			bonusScope: "global",
			activeGrantCount: 1,
			usage: {
				disk: 10,
				runningDisk: 10,
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
	parameters: { cpu: "cpu", memory: "memory", disk: "home_disk_size" },
	generatedAt: "2026-10-24T12:00:00Z",
};

export const MockSchedulerReport: Awaited<
	ReturnType<typeof PlatformAPI.getSchedulerReport>
> = {
	settings: {
		enabled: true,
		mode: "user",
		fixed: {
			start: "09:00",
			stop: "17:00",
			days: [1, 2, 3, 4, 5],
			timezone: "America/New_York",
		},
		maxActiveHours: 2,
		ignoreAdmins: true,
		excludedUsers: [],
		enforcedDays: [0, 1, 2, 3, 4, 5, 6],
	},
	workspaces: 1,
	exempt: 0,
	noncompliant: [],
	users: [MockUserMember.username],
	generatedAt: "2026-10-31T12:00:00Z",
};

export const MockQuotaMeResources: QuotaMeResources = {
	resourceModes: {
		cpu: "cumulative",
		memory: "cumulative",
		disk: "cumulative",
	},
	exempt: false,
	limits: { workspaces: 3, cpu: 8, memory: 16, disk: 50 },
	usage: { workspaces: 2, cpu: 6, memory: 12, disk: 30 },
	workspaces: [
		{
			id: "ws-dev",
			name: "dev",
			template: "Docker",
			status: "running",
			running: true,
			cpu: 4,
			memory: 8,
			disk: 20,
			gpus: 0,
		},
		{
			id: "ws-data",
			name: "data",
			template: "Kubernetes",
			status: "stopped",
			running: false,
			cpu: 2,
			memory: 4,
			disk: 10,
			gpus: 0,
		},
	],
};

const resourceSamples = (key: string, text: string) =>
	Array.from({ length: 60 }, (_, i) => ({
		t: 1793311200000 + i * 5000,
		share: 40,
		value: 40,
		text,
		key,
	}));

/** The running "dev" workspace's last five minutes: about 1.5 cores, 4 GiB and 8 of 20 GB of disk. */
export const MockDashboardResourceHistory: WorkspaceResourceHistory = {
	asOf: 1793311500000,
	windowSeconds: 300,
	agents: {
		"dev-agent": {
			cpu: resourceSamples("0_cpu_usage", "1.5/4 cores (37%)"),
			ram: resourceSamples("1_ram_usage", "4.29/8.59 GB (50%)"),
			disk: resourceSamples("2_home_disk", "8.0/20.0 GB (40%)"),
			load: [],
		},
	},
};

/** The running "dev" workspace's traffic over the same five minutes. */
export const MockDashboardNetwork: Awaited<
	ReturnType<typeof PlatformAPI.getWorkspaceNetwork>
> = {
	windowSeconds: 300,
	agents: {
		"dev-agent": {
			samples: Array.from({ length: 60 }, (_, i) => ({
				from: MockDashboardResourceHistory.asOf - (61 - i) * 5000,
				t: MockDashboardResourceHistory.asOf - (60 - i) * 5000,
				rx: 2000 + 1500 * Math.sin(i / 5) ** 2,
				tx: 800 + 600 * Math.cos(i / 7) ** 2,
			})),
			last: null,
		},
	},
};
