import type {
	AnnouncementReport,
	Banner,
	BannerState,
	ClassificationSettings,
	ClusterUsage,
	DatabaseCluster,
	KeycloakReport,
	LogoState,
	MonitoringOverview,
	NetworkReport,
	PersistenceReport,
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

const dbInstance = (
	name: string,
	role: "primary" | "replica",
	node: string,
	zone: string,
	podIP: string,
) => ({
	name,
	namespace: "coder",
	node,
	podIP,
	hostIP: null,
	phase: "Running",
	ready: true,
	restarts: 0,
	started: "2026-09-20T08:00:00Z",
	role,
	zone,
	pvc: {
		name,
		storageClass: "gp3",
		capacityBytes: 20 * 2 ** 30,
		requestedBytes: 20 * 2 ** 30,
		phase: "Bound",
	},
	walPvc: null,
	lagBytes: role === "primary" ? null : 0,
	replicationState: role === "primary" ? null : "streaming",
	syncState: role === "primary" ? null : "async",
});

const MockDatabaseCluster: DatabaseCluster = {
	name: "coder-db",
	namespace: "coder",
	phase: "Cluster in healthy state",
	instances: 3,
	readyInstances: 3,
	primary: "coder-db-1",
	image: "ghcr.io/cloudnative-pg/postgresql:18.4-system-trixie",
	storageSize: "20Gi",
	storageClass: "gp3",
	walStorageSize: null,
	managedBy: "Helm release coder-platform",
	created: "2026-09-01T10:00:00Z",
};

const MockDatabaseStats = {
	sizeBytes: 4.3 * 2 ** 30,
	connections: 27,
	maxConnections: 100,
	version: "18.4",
	startedAt: "2026-09-20T08:00:00Z",
};

/** A highly available CloudNativePG cluster with daily snapshot backups. */
export const MockPersistenceReport: PersistenceReport = {
	generatedAt: "2026-10-04T12:00:00Z",
	mode: "cloudnative-pg",
	checks: [
		{
			id: "db.connection",
			group: "Database",
			title: "Coder's database",
			status: "ok",
			current: "coder-db-rw.coder.svc:5432/app",
			expected: null,
			detail:
				"Coder connects as app, TLS require. Read from Secret coder-db-app (key uri).",
			fix: null,
		},
		{
			id: "cnpg.operator",
			group: "Operator",
			title: "CloudNativePG operator",
			status: "ok",
			current: "CloudNativePG 1.27.0 in cnpg-system",
			expected: null,
			detail: "",
			fix: null,
		},
		{
			id: "cnpg.instances",
			group: "High availability",
			title: "Replicas for automatic fail-over",
			status: "ok",
			current: "3 instances (1 primary, 2 replicas)",
			expected: null,
			detail: "",
			fix: null,
		},
		{
			id: "cnpg.storage",
			group: "Storage",
			title: "Room on the database volume",
			status: "ok",
			current: "21% used (20Gi)",
			expected: null,
			detail: "",
			fix: null,
		},
		{
			id: "cnpg.backup",
			group: "Backups",
			title: "Scheduled backups",
			status: "ok",
			current: "volume snapshots, schedule 0 0 2 * * *",
			expected: null,
			detail: "",
			fix: null,
		},
	],
	facts: {
		provider: "CloudNativePG",
		coderDatabase: {
			host: "coder-db-rw.coder.svc",
			port: 5432,
			database: "app",
			user: "app",
			sslMode: "require",
			source: "Secret coder-db-app (key uri)",
			secret: "coder-db-app",
		},
		operator: {
			installed: true,
			crd: true,
			namespace: "cnpg-system",
			version: "1.27.0",
			ready: true,
		},
		cluster: MockDatabaseCluster,
		instances: [
			dbInstance("coder-db-1", "primary", "node-a", "us-east-1a", "10.42.0.15"),
			dbInstance("coder-db-2", "replica", "node-b", "us-east-1b", "10.42.1.9"),
			dbInstance("coder-db-3", "replica", "node-c", "us-east-1c", "10.42.2.11"),
		],
		storageClasses: [
			{
				name: "gp3",
				provisioner: "ebs.csi.aws.com",
				label: "AWS EBS",
				kind: "cloud",
				isDefault: true,
				allowExpansion: true,
				reclaimPolicy: "Delete",
				bindingMode: "WaitForFirstConsumer",
			},
			{
				name: "local-path",
				provisioner: "rancher.io/local-path",
				label: "local-path",
				kind: "local",
				isDefault: false,
				allowExpansion: false,
				reclaimPolicy: "Delete",
				bindingMode: "WaitForFirstConsumer",
			},
		],
		snapshotClasses: ["csi-aws-vsc"],
		database: MockDatabaseStats,
		backups: {
			configured: true,
			method: "volume snapshots",
			schedule: "0 0 2 * * *",
			lastSuccess: "2026-10-04T02:00:40Z",
			lastFailure: null,
			recoverableSince: "2026-09-21T02:00:41Z",
			count: 14,
		},
		otherClusters: [],
		settings: {
			clusterName: "coder-db",
			instances: 3,
			storageSize: "20Gi",
			storageClass: "gp3",
			snapshotClass: "csi-aws-vsc",
			backupSchedule: "0 0 2 * * *",
		},
	},
};

/** One instance, a nearly full volume and no backups: three suggested fixes. */
export const MockPersistenceReportNeedsAttention: PersistenceReport = {
	...MockPersistenceReport,
	checks: [
		MockPersistenceReport.checks[0],
		MockPersistenceReport.checks[1],
		{
			id: "cnpg.instances",
			group: "High availability",
			title: "Replicas for automatic fail-over",
			status: "warn",
			current: "1 instance (no replica)",
			expected: "3 instances (1 primary, 2 replicas)",
			detail:
				"With a single instance, Coder is down whenever that pod or its node is.",
			fix: "cnpg.instances",
		},
		{
			id: "cnpg.storage",
			group: "Storage",
			title: "Room on the database volume",
			status: "warn",
			current: "86% used (10Gi)",
			expected: "20Gi",
			detail: "The volume can be grown in place.",
			fix: "cnpg.storage",
		},
		{
			id: "cnpg.backup",
			group: "Backups",
			title: "Scheduled backups",
			status: "warn",
			current: "none",
			expected: "daily volume snapshots (csi-aws-vsc)",
			detail:
				"Replicas protect against a lost node, not against deleted or corrupted data.",
			fix: "cnpg.backup",
		},
	],
	facts: {
		...MockPersistenceReport.facts,
		cluster: {
			...MockDatabaseCluster,
			instances: 1,
			readyInstances: 1,
			storageSize: "10Gi",
		},
		instances: [
			{
				...dbInstance(
					"coder-db-1",
					"primary",
					"node-a",
					"us-east-1a",
					"10.42.0.15",
				),
				pvc: {
					name: "coder-db-1",
					storageClass: "gp3",
					capacityBytes: 10 * 2 ** 30,
					requestedBytes: 10 * 2 ** 30,
					phase: "Bound",
				},
			},
		],
		database: {
			...MockDatabaseStats,
			sizeBytes: 8.6 * 2 ** 30,
		},
		backups: {
			configured: false,
			method: null,
			schedule: null,
			lastSuccess: null,
			lastFailure: null,
			recoverableSince: null,
			count: 0,
		},
		settings: {
			...MockPersistenceReport.facts.settings,
			instances: 3,
			storageSize: "20Gi",
		},
	},
};

/** Coder on its built-in database and no operator yet: the guided setup. */
export const MockPersistenceReportNoOperator: PersistenceReport = {
	generatedAt: "2026-10-04T12:00:00Z",
	mode: "unknown",
	checks: [
		{
			id: "db.connection",
			group: "Database",
			title: "Coder's database",
			status: "error",
			current: "Coder's built-in PostgreSQL",
			expected: "a PostgreSQL cluster",
			detail:
				"The built-in database lives inside the Coder pod and has no replicas or backups.",
			fix: null,
		},
		{
			id: "cnpg.operator",
			group: "Operator",
			title: "CloudNativePG operator",
			status: "error",
			current: "not installed",
			expected: "CloudNativePG in cnpg-system",
			detail: "Install it once, then create Coder's cluster here.",
			fix: "cnpg.operator",
		},
	],
	facts: {
		...MockPersistenceReport.facts,
		provider: null,
		coderDatabase: {
			host: null,
			port: null,
			database: null,
			user: null,
			sslMode: null,
			source: "Coder's built-in PostgreSQL",
			secret: null,
		},
		operator: {
			installed: false,
			crd: false,
			namespace: null,
			version: null,
			ready: null,
		},
		cluster: null,
		instances: [],
		database: null,
		backups: null,
		settings: {
			clusterName: "coder-db",
			instances: 3,
			storageSize: "10Gi",
			storageClass: "gp3",
			snapshotClass: "csi-aws-vsc",
			backupSchedule: "0 0 2 * * *",
		},
	},
};

/** Coder on Amazon RDS: the provider runs high availability and backups. */
export const MockPersistenceReportCloud: PersistenceReport = {
	generatedAt: "2026-10-04T12:00:00Z",
	mode: "external",
	checks: [
		{
			id: "db.connection",
			group: "Database",
			title: "Coder's database",
			status: "ok",
			current: "coder.c9akciq32.us-east-1.rds.amazonaws.com:5432/coder",
			expected: null,
			detail: "Coder connects as coder, TLS verify-full.",
			fix: null,
		},
		{
			id: "db.provider",
			group: "Database",
			title: "Managed by a cloud provider",
			status: "info",
			current: "Amazon RDS",
			expected: null,
			detail:
				"High availability, storage and backups are configured with Amazon RDS, not in this cluster.",
			fix: null,
		},
	],
	facts: {
		...MockPersistenceReportNoOperator.facts,
		provider: "Amazon RDS",
		coderDatabase: {
			host: "coder.c9akciq32.us-east-1.rds.amazonaws.com",
			port: 5432,
			database: "coder",
			user: "coder",
			sslMode: "verify-full",
			source: "Secret coder-db-url (key url)",
			secret: "coder-db-url",
		},
		database: MockPersistenceReport.facts.database,
	},
};
