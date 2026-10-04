import type {
	AnnouncementReport,
	Banner,
	BannerState,
	ClassificationSettings,
	ClusterUsage,
	KeycloakReport,
	LogoState,
	MonitoringOverview,
	NetworkReport,
} from "#/api/platform";
import { MockUserMember, MockUserOwner } from "./entities";

export const MockClassification: ClassificationSettings = {
	enabled: true,
	text: "UNCLASSIFIED",
	height: 24,
	background: "#007a33",
	color: "#ffffff",
	updatedBy: MockUserOwner.username,
	updatedAt: "2026-09-30T10:00:00Z",
};

export const MockLogo: LogoState = {
	available: true,
	set: false,
	url: null,
	type: null,
	bytes: null,
	updatedBy: null,
	updatedAt: null,
};

export const MockBanner: Banner = {
	id: "9b1c2d3e4f",
	enabled: true,
	level: "warning",
	title: "",
	message:
		'**Scheduled maintenance:** Coder restarts in {{countdown to=2030-01-01T00:00:00Z format=dhms done="now"}}. Save your work.',
	linkText: "",
	linkUrl: "",
	dismissible: true,
	showOnLoginPage: true,
	refreshSeconds: 60,
	effect: "none",
	repeat: false,
};

export const MockBannerState: BannerState = {
	user: { username: MockUserOwner.username },
	banner: MockBanner,
	overrideActive: true,
	revision: 2,
	updatedBy: MockUserOwner.username,
	updatedAt: "2026-09-30T10:00:00Z",
	subscribers: 12,
};

export const MockAnnouncementReport: AnnouncementReport = {
	current: MockBanner.id,
	totalUsers: 3,
	generatedAt: "2026-09-30T10:05:00Z",
	events: [
		{
			id: MockBanner.id,
			level: MockBanner.level,
			title: MockBanner.title,
			message: MockBanner.message,
			firstSeen: "2026-09-30T10:00:00Z",
			current: true,
			viewed: 2,
			acked: 1,
			receipts: [
				{
					username: MockUserOwner.username,
					name: MockUserOwner.name ?? "",
					email: MockUserOwner.email,
					viewedAt: "2026-09-30T10:01:00Z",
					ackedAt: "2026-09-30T10:02:00Z",
				},
				{
					username: MockUserMember.username,
					name: MockUserMember.name ?? "",
					email: MockUserMember.email,
					viewedAt: "2026-09-30T10:03:00Z",
					ackedAt: null,
				},
			],
			pending: [
				{
					id: "c0ffee00-0000-4000-8000-000000000003",
					username: "pending-user",
					name: "Pending User",
					email: "pending@coder.com",
				},
			],
		},
		{
			id: "older-announcement",
			level: "info",
			title: "",
			message: "Welcome to the new platform.",
			firstSeen: "2026-09-01T09:00:00Z",
			current: false,
			viewed: 3,
			acked: 3,
			receipts: [],
			pending: [],
		},
	],
};

export const MockClusterUsage: ClusterUsage = {
	cpu: { total: 16, used: 6.4, requested: 9, free: 7 },
	memory: {
		total: 64 * 1024 ** 3,
		used: 47 * 1024 ** 3,
		requested: 50 * 1024 ** 3,
		free: 14 * 1024 ** 3,
	},
	nodes: 2,
	live: true,
	generatedAt: "2026-09-30T10:05:00Z",
};

const node = (name: string, ip: string) => ({
	name,
	created: "2026-08-01T00:00:00Z",
	roles: ["worker"],
	zone: "zone-a",
	region: "region-1",
	instanceType: "m5.2xlarge",
	ready: true,
	readySince: "2026-08-01T00:05:00Z",
	unschedulable: false,
	pressure: [],
	taints: [],
	addresses: { InternalIP: [ip] },
	podCIDRs: ["10.42.0.0/24"],
	kubelet: "v1.31.2",
	os: "Ubuntu 24.04 LTS",
	kernel: "6.8.0",
	runtime: "containerd://1.7.22",
	arch: "amd64",
	capacity: { cpu: 8, memory: 32 * 1024 ** 3, pods: 110, storage: null },
	allocatable: { cpu: 8, memory: 31 * 1024 ** 3, pods: 110, storage: null },
	usage: { cpu: 3.2, memory: 22 * 1024 ** 3 },
	requests: { cpu: 4.5, memory: 25 * 1024 ** 3 },
	podCount: 24,
	namespaces: { coder: 6, "kube-system": 12 },
});

const pod = (name: string, nodeName: string, podIP: string) => ({
	name,
	namespace: "coder",
	node: nodeName,
	podIP,
	hostIP: null,
	phase: "Running",
	ready: true,
	restarts: 0,
	started: "2026-09-29T08:00:00Z",
});

export const MockNetworkReport: NetworkReport = {
	generatedAt: "2026-09-30T10:05:00Z",
	kubernetesVersion: "v1.31.2",
	accessUrl: "https://coder.example.com",
	metrics: true,
	coderNamespace: "coder",
	nodes: [node("node-a", "10.0.0.11"), node("node-b", "10.0.0.12")],
	coder: [
		{ ...pod("coder-5d9f7c", "node-a", "10.42.0.10"), role: "coder" },
		{ ...pod("coder-db-1", "node-b", "10.42.1.20"), role: "database" },
	],
	workspaces: [
		{
			id: "ws-1",
			name: "dev",
			owner: MockUserMember.username,
			template: "ubuntu-vnc-desktop",
			healthy: true,
			agents: [
				{
					name: "main",
					status: "connected",
					lifecycle: "ready",
					version: "v2.37.3",
					os: "linux",
					arch: "amd64",
					latencyMs: 12,
				},
			],
			pod: pod("coder-ws-dev", "node-b", "10.42.1.33"),
		},
	],
	unplaced: [],
	workspacesApi: true,
};

export const MockMonitoringOverview: MonitoringOverview = {
	namespace: "coder",
	capBytes: 5 * 1024 * 1024,
	users: [
		{
			user: {
				id: MockUserMember.id,
				username: MockUserMember.username,
				name: MockUserMember.name ?? "",
				email: MockUserMember.email,
			},
			instances: [
				{
					workspaceId: "ws-1",
					name: "dev",
					owner: MockUserMember.username,
					template: "ubuntu-vnc-desktop",
					startedAt: "2026-09-30T08:00:00Z",
					agents: [
						{
							name: "main",
							status: "connected",
							lifecycle: "ready",
							health: true,
						},
					],
					healthy: true,
					pod: "coder-ws-dev",
					watching: false,
				},
			],
		},
		{
			user: {
				id: MockUserOwner.id,
				username: MockUserOwner.username,
				name: MockUserOwner.name ?? "",
				email: MockUserOwner.email,
			},
			instances: [],
		},
	],
};

export const MockKeycloakReport: KeycloakReport = {
	checks: [
		{
			id: "kc.reachable",
			group: "Connection",
			title: "Keycloak answers",
			status: "ok",
			current: "https://keycloak.example.com",
			expected: null,
			detail: "",
			fix: null,
		},
		{
			id: "kc.scopes",
			group: "Keycloak",
			title: "Client scopes",
			status: "warn",
			current: "openid",
			expected: "openid, profile, email",
			detail: "Coder needs the profile and email scopes to read usernames.",
			fix: "kc.scopes",
		},
		{
			id: "coder.env",
			group: "Coder",
			title: "Coder's OIDC settings",
			status: "warn",
			current: null,
			expected: null,
			detail: "",
			fix: "coder.values",
		},
	],
	facts: {
		coderUrl: "https://coder.example.com",
		argoApp: "coder",
		canEditCoder: true,
		keycloakConnected: true,
		discoveredKeycloakUrl: "https://keycloak.example.com",
		settings: {
			keycloakUrl: "https://keycloak.example.com",
			realm: "master",
			clientId: "coder",
			scopes: "openid",
		},
		envDiffs: [
			{
				name: "CODER_OIDC_SCOPES",
				current: "openid",
				expected: "openid,profile,email",
			},
		],
		undo: null,
	},
};
