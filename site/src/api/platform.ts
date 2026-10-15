/**
 * @file Client for the platform services that run next to Coder on the same
 * host: the coder-ui-updates service (under /__coder-ui/) and the coder-banner
 * service (under /__banner/). Both authenticate the browser with its Coder
 * session cookie and reject state-changing requests that lack their
 * `X-Requested-With` value, so every POST here sends it.
 */
import globalAxios, { type AxiosRequestConfig, isAxiosError } from "axios";
import { API } from "./api";

const PLATFORM_BASE = "/__coder-ui";
const BANNER_BASE = "/__banner";

const PLATFORM_REQUESTED_WITH = "coder-ui";
const BANNER_REQUESTED_WITH = "coder-banner-admin";

/**
 * An error answered by one of the platform services. They reply with
 * `{"error": "..."}`, which is surfaced as the message.
 */
export class PlatformError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "PlatformError";
		this.status = status;
	}
}

const errorMessageFrom = (data: unknown): string | undefined => {
	if (typeof data === "object" && data !== null && "error" in data) {
		const message = data.error;
		return typeof message === "string" ? message : undefined;
	}
	return undefined;
};

const toPlatformError = (error: unknown): PlatformError => {
	if (isAxiosError(error)) {
		const status = error.response?.status ?? 0;
		const message =
			errorMessageFrom(error.response?.data) ??
			(status ? `Request failed (HTTP ${status})` : error.message);
		return new PlatformError(message, status);
	}
	if (error instanceof Error) {
		return new PlatformError(error.message, 0);
	}
	return new PlatformError("Request failed", 0);
};

// A client of its own, without the dashboard's interceptors: a 401 from one of
// these services means "not signed in there", never "sign out of Coder".
const platformAxios = globalAxios.create();

// The browser's session cookie authenticates most requests; a session token
// set on the dashboard's client (e.g. in development) is passed on too.
const withSession = (config: AxiosRequestConfig): AxiosRequestConfig => {
	const token = API.getSessionToken();
	return token
		? {
				...config,
				headers: { ...config.headers, "Coder-Session-Token": token },
			}
		: config;
};

const get = async <T>(url: string): Promise<T> => {
	try {
		const response = await platformAxios.get<T>(
			url,
			withSession({ headers: { "Cache-Control": "no-store" } }),
		);
		return response.data;
	} catch (error) {
		throw toPlatformError(error);
	}
};

const post = async <T>(
	url: string,
	body: unknown,
	requestedWith = PLATFORM_REQUESTED_WITH,
): Promise<T> => {
	try {
		const response = await platformAxios.post<T>(
			url,
			body,
			withSession({
				headers: {
					"Content-Type": "application/json",
					"X-Requested-With": requestedWith,
				},
			}),
		);
		return response.data;
	} catch (error) {
		throw toPlatformError(error);
	}
};

/**
 * A file sent as the request body (PUT), with upload progress (0-1). The
 * service's cross-site check for uploads wants the same X-Requested-With.
 */
const upload = async <T>(
	url: string,
	file: Blob,
	onProgress?: (fraction: number) => void,
): Promise<T> => {
	try {
		const response = await platformAxios.put<T>(
			url,
			file,
			withSession({
				headers: {
					"Content-Type": "application/octet-stream",
					"X-Requested-With": PLATFORM_REQUESTED_WITH,
				},
				onUploadProgress: (event) => {
					if (onProgress && event.total) {
						onProgress(event.loaded / event.total);
					}
				},
			}),
		);
		return response.data;
	} catch (error) {
		throw toPlatformError(error);
	}
};

/** The request helpers, for the platform's other API modules (api/images.ts). */
export const platformRequest = { get, post, upload, base: PLATFORM_BASE };

// ---------------------------------------------------------------- types

/** The sign-in page (where signing out lands too): its title's text and effect, and a message for each. */
export const LOGIN_EFFECTS = ["wireframe", "neon", "plain"] as const;
export type LoginEffect = (typeof LOGIN_EFFECTS)[number];
export type LoginPageSettings = {
	/** "": the deployment's name (Coder, or the one set in Appearance). */
	title: string;
	effect: LoginEffect;
	/** The effect's colour (#rrggbb): the traced outline, the neon's glow, the plain title. */
	color: string;
	/** Seconds for one trace (wireframe) or one pulse (neon). */
	speed: number;
	/** Under the title on the sign-in page ("": none). */
	message: string;
	/** Under the title right after signing out ("": none). */
	signedOutMessage: string;
	updatedBy?: string;
	updatedAt?: string;
};
export const LOGIN_PAGE_DEFAULT: LoginPageSettings = {
	title: "",
	effect: "wireframe",
	color: "#4ff8ff",
	speed: 3.2,
	message: "",
	signedOutMessage: "",
};

export type ClassificationSettings = {
	enabled: boolean;
	text: string;
	height: number;
	background: string;
	color: string;
	updatedBy?: string;
	updatedAt?: string;
};

export type LogoState = {
	available: boolean;
	set: boolean;
	url: string | null;
	type: string | null;
	bytes: number | null;
	updatedBy: string | null;
	updatedAt: string | null;
};

export const BACKGROUND_SLOTS = ["login", "dashboard"] as const;
export type BackgroundSlot = (typeof BACKGROUND_SLOTS)[number];
export type BackgroundFit = "cover" | "contain" | "tile";
/** Behind the page's content (an underlay), or a faint watermark over it. */
export type BackgroundLayer = "under" | "over";

/** The dials of an HTML background: its animations' speed, then CSS filters. */
export type BackgroundDials = {
	speed?: number;
	hue?: number;
	saturation?: number;
	brightness?: number;
	blur?: number;
};
export type BackgroundParams = BackgroundDials & {
	/** A built-in animated background's own settings (e.g. the Particles colours). */
	preset?: { name: string } & Record<string, unknown>;
};

/** What a page needs to draw a background image (boot.js hands it to every page). */
export type BackgroundImage = {
	url: string;
	opacity: number;
	fit: BackgroundFit;
	layer: BackgroundLayer;
	/** A picture, or an HTML / CSS page shown in a sandboxed frame. */
	kind?: "image" | "html";
	params?: BackgroundParams;
};

export type BackgroundsState = {
	available: boolean;
	limits: {
		opacity: { min: number; max: number; default: number };
		maxBytes: number;
		htmlMaxBytes?: number;
	};
} & Record<
	BackgroundSlot,
	| (BackgroundImage & {
			type: string;
			bytes: number;
			updatedBy: string | null;
			updatedAt: string | null;
	  })
	| null
>;

type MyAvatar = {
	available: boolean;
	set: boolean;
	url: string | null;
	defaultUrl: string | null;
	username: string;
};

type AvatarDefaults = {
	url: string | null;
	users: string[];
};

export type AnnouncementReceiptStatus =
	| { signedIn: false }
	| {
			signedIn: true;
			username: string;
			acked: boolean;
			/** When this user first saw the announcement (on record for the admins), if they have. */
			viewedAt?: string | null;
			ackedAt?: string | null;
	  };

export type PlatformUser = {
	id: string;
	username: string;
	name: string;
	email: string;
	loginType?: string;
};

type AnnouncementReceipt = {
	username: string;
	name: string;
	email: string;
	viewedAt: string;
	ackedAt: string | null;
};

export type AnnouncementEvent = {
	id: string;
	level: BannerLevel;
	title: string;
	message: string;
	firstSeen: string;
	current: boolean;
	viewed: number;
	acked: number;
	receipts: AnnouncementReceipt[];
	pending: PlatformUser[] | null;
};

export type AnnouncementReport = {
	current: string | null;
	totalUsers: number | null;
	events: AnnouncementEvent[];
	generatedAt: string;
};

export type ResourceUsage = {
	total: number;
	used: number;
	requested: number;
	free: number;
};

/** The cluster's network traffic: bytes per second the nodes received (rx) and sent (tx). */
export type NetworkPoint = { t: number; rx: number; tx: number };

export type ClusterNetwork = {
	/** The latest round's rates. */
	rx: number;
	tx: number;
	/** The last 15 minutes, one point a round. */
	points: NetworkPoint[];
	/** Seconds between rounds. */
	every: number;
};

export type ClusterUsage = {
	cpu: ResourceUsage;
	memory: ResourceUsage;
	nodes: number;
	live: boolean;
	generatedAt: string;
	/** Missing before the first samples, or when no kubelet answers. */
	network?: ClusterNetwork | null;
};

type NodeResources = {
	cpu: number | null;
	memory: number | null;
	pods: number | null;
	storage: number | null;
};

export type ClusterNode = {
	name: string;
	created: string | null;
	roles: string[];
	zone: string | null;
	region: string | null;
	instanceType: string | null;
	ready: boolean;
	readySince: string | null;
	unschedulable: boolean;
	pressure: string[];
	taints: string[];
	addresses: Record<string, string[]>;
	podCIDRs: string[];
	kubelet: string | null;
	os: string | null;
	kernel: string | null;
	runtime: string | null;
	arch: string | null;
	capacity: NodeResources;
	allocatable: NodeResources;
	usage: { cpu: number | null; memory: number | null } | null;
	requests: { cpu: number; memory: number };
	podCount: number;
	namespaces: Record<string, number>;
};

type PodBrief = {
	name: string;
	namespace: string;
	node: string | null;
	podIP: string | null;
	hostIP: string | null;
	phase: string | null;
	ready: boolean;
	restarts: number;
	started: string | null;
};

type CoderPodRole = "coder" | "database" | "add-on" | "workspace";

export type CoderPod = PodBrief & { role: CoderPodRole };

type NetworkAgent = {
	name: string;
	status: string;
	lifecycle: string;
	version: string;
	os: string;
	arch: string;
	latencyMs: number | null;
};

export type NetworkWorkspace = {
	id: string;
	name: string;
	owner: string;
	template: string | null;
	healthy: boolean | null;
	agents: NetworkAgent[];
	orphan?: boolean;
	pod: PodBrief;
};

export type NetworkReport = {
	generatedAt: string;
	kubernetesVersion: string | null;
	accessUrl: string;
	metrics: boolean;
	coderNamespace: string;
	nodes: ClusterNode[];
	coder: CoderPod[];
	workspaces: NetworkWorkspace[];
	unplaced: Omit<NetworkWorkspace, "pod">[];
	workspacesApi: boolean;
};

type MonitoredAgent = {
	name: string;
	status: string;
	lifecycle: string;
	health: boolean | null;
};

export type MonitoredWorkspace = {
	workspaceId: string;
	name: string;
	owner: string;
	template: string | null;
	startedAt: string | null;
	agents: MonitoredAgent[];
	healthy: boolean;
	pod: string | null;
	watching: boolean;
};

export type MonitoringOverview = {
	namespace: string;
	capBytes: number;
	users: { user: PlatformUser; instances: MonitoredWorkspace[] }[];
};

/** One log line: sequence number, timestamp, text. */
export type WorkspaceLogLine = [number, string, string];

export type WorkspaceLogs = {
	pod: string;
	container: string;
	state: string;
	error: string | null;
	lines: WorkspaceLogLine[];
	stored: { lines: number; bytes: number; capBytes: number };
};

export type KeycloakCheckStatus = "ok" | "warn" | "error" | "info" | "unknown";

export type KeycloakFix =
	| "kc.client"
	| "kc.scopes"
	| "coder.secret"
	| "coder.ca"
	| "coder.values";

export type KeycloakCheck = {
	id: string;
	group: string;
	title: string;
	status: KeycloakCheckStatus;
	current: string | null;
	expected: string | null;
	detail: string;
	fix: KeycloakFix | "kc.connect" | null;
};

export type KeycloakSettings = {
	keycloakUrl: string;
	realm: string;
	clientId: string;
	scopes: string;
	usernameField: string;
	emailField: string;
	signInText: string;
	iconUrl: string;
	flowAlias: string;
	tokenLifespan: number;
	allowSignups: boolean;
	ignoreEmailVerified: boolean;
};

type KeycloakEnvDiff = {
	name: string;
	current: string | null;
	expected: string;
};

type KeycloakFacts = {
	coderUrl?: string;
	argoApp?: string | null;
	canEditCoder?: boolean;
	settings?: Partial<KeycloakSettings>;
	discoveredKeycloakUrl?: string | null;
	keycloakConnected?: boolean;
	envDiffs?: KeycloakEnvDiff[];
	oidcSecret?: string;
	undo?: { savedAt: string; savedBy: string } | null;
};

export type KeycloakReport = {
	checks: KeycloakCheck[];
	facts: KeycloakFacts;
};

type KeycloakResult = { ok: true; done: string[] };

/** Whether the add-on service can use Keycloak's admin API (General's sidebar marks Authentication with it). */
type KeycloakStatus = {
	connected: boolean;
	keycloakUrl: string | null;
	via?: string | null;
	reason: string | null;
};

// ----------------------------------------------------------------------- HUD

type HudGroup = "totals" | "leaders" | "health";

/** One HUD figure: a number (or null when unknown), its unit, and who / what it is about. */
export type HudMetric = {
	id: string;
	label: string;
	group: HudGroup;
	value: number | null;
	unit: string;
	detail: string;
	hint: string;
	/** Where clicking it goes: the dashboard page behind the figure (e.g. the top account's workspace), or "". */
	href: string;
};

/** One bucket of the HUD's graphs (cores, GiB, milliseconds; null where nothing was measured). */
export type HudHistoryPoint = {
	t: number;
	live: boolean;
	cpu: number | null;
	cpuPeak: number | null;
	cpuWorkspaces: number | null;
	cpuTotal: number | null;
	memory: number | null;
	memoryPeak: number | null;
	memoryWorkspaces: number | null;
	memoryTotal: number | null;
	latency: number | null;
	latencyP95: number | null;
	latencyMax: number | null;
	connections: number;
};

export type HudRange = "15m" | "1h" | "6h" | "24h" | "7d";

export type HudHistory = {
	range: HudRange;
	start: number;
	end: number;
	step: number;
	points: HudHistoryPoint[];
};

/** Lock Down: what an admin jailed in a workspace (lockdown.py in the platform service). */
export type LockdownMode = "network" | "sudo" | "complete" | "freeze" | "off";
/** Lock Down > Freeze: the workspace's disk as it was when it was frozen (admins only). */
export type LockdownSnapshot = {
	/** A VolumeSnapshot where the cluster can make one, else a copy in a new volume (a PVC). */
	kind: "VolumeSnapshot" | "PersistentVolumeClaim" | null;
	name: string | null;
	at: string;
	/** The workspace's home volume it is of. */
	claim: string | null;
	/** It could not be taken. */
	error: string | null;
	status: "copying" | "ready" | "failed" | "gone" | null;
	/** How many processes were paused. */
	processes: number;
};
export type WorkspaceLockdown = {
	locked: boolean;
	modes: ("network" | "sudo" | "freeze")[];
	/** Admins: the snapshot of the last freeze (kept after it is lifted, until deleted or replaced). */
	snapshot?: LockdownSnapshot | null;
	by: string | null;
	at: string | null;
	/** The workspace runs now. */
	running: boolean;
	/** In force in the running workspace (null: not running). */
	inForce: boolean | null;
	/** The viewer may change it (admins). */
	canChange: boolean;
};

type HudReport = {
	metrics: HudMetric[];
	generatedAt: string;
	/** Live usage (metrics-server) is available. */
	live: boolean;
	/** How long Coder has been up: since its oldest ready replica started (null: Kubernetes not asked). */
	uptime?: { since: string | null; replicas: number } | null;
};

// ---------------------------------------------------------- security posture

export type PostureSeverity =
	| "critical"
	| "warning"
	| "info"
	| "ok"
	| "unknown";

/** One zero-trust check or runtime signal (General > Monitoring). */
export type PostureCheck = {
	id: string;
	category: "Identity" | "Exposure" | "Runtime" | "Signals";
	title: string;
	severity: PostureSeverity;
	summary: string;
	items: { label: string; note: string }[];
	count: number;
	fix: string;
};

type MonitoringPosture = {
	checks: PostureCheck[];
	summary: Record<PostureSeverity, number>;
	workspaces: number;
	pods: number;
	users: number;
	generatedAt: string;
};

// ---------------------------------------------------- global workspace scheduler

/** "user": each user sets their workspaces' start and stop times; "fixed": the admin's schedule applies to all. */
type SchedulerMode = "user" | "fixed";

export type SchedulerSettings = {
	enabled: boolean;
	mode: SchedulerMode;
	/** The schedule for everyone (mode "fixed"): HH:MM, cron weekdays (0 = Sunday), an IANA time zone. */
	fixed: { start: string; stop: string; days: number[]; timezone: string };
	/** How long a workspace may stay up after it starts; null = no limit. */
	maxActiveHours: number | null;
	ignoreAdmins: boolean;
	excludedUsers: string[];
};

/** A workspace's schedule as Coder stores it. */
export type CoderSchedule = { autostart_schedule: string; ttl_ms: number };

type ScheduledWorkspace = {
	id: string;
	name: string;
	owner: string;
	autostart_schedule: string | null;
	ttl_ms: number | null;
};

type SchedulerReport = {
	settings: SchedulerSettings;
	workspaces: number;
	exempt: number;
	noncompliant: (ScheduledWorkspace & { problem: string })[];
	users: string[];
	fixedSchedule?: CoderSchedule;
	generatedAt: string;
};

/** The rules for the signed-in user, and their workspaces against them. */
export type SchedulerMe = {
	enforced: boolean;
	reason: string;
	mode: SchedulerMode;
	maxActiveHours: number | null;
	fixed?: SchedulerSettings["fixed"] & CoderSchedule;
	workspaces: (ScheduledWorkspace & { compliant: boolean; problem: string })[];
};

// ---------------------------------------------------------------- user quota

export type QuotaKey = "workspaces" | "cpu" | "memory";

/** One set of limits; null = no limit. CPU in cores, memory in GiB. */
export type QuotaLimits = Record<QuotaKey, number | null>;

export type QuotaSettings = {
	default: QuotaLimits;
	/** Per-user overrides: only the keys set there replace the default. */
	users: Record<string, Partial<QuotaLimits>>;
	exemptAdmins: boolean;
};

type QuotaWorkspace = {
	id: string;
	name: string;
	owner: string;
	ownerId: string;
	template: string;
	cpu: number;
	memory: number;
	status: string;
	running: boolean;
};

type QuotaUsage = {
	workspaces: number;
	cpu: number;
	memory: number;
	running: number;
	runningCpu: number;
	runningMemory: number;
	liveCpu: number | null;
	liveMemory: number | null;
};

export type QuotaUser = {
	id: string;
	username: string;
	name: string;
	avatar: string;
	admin: boolean;
	exempt: boolean;
	override: Partial<QuotaLimits> | null;
	limits: QuotaLimits;
	usage: QuotaUsage;
	atLimit: boolean;
	workspaces: QuotaWorkspace[];
};

type QuotaCluster =
	| {
			cpu: number;
			memory: number;
			usedCpu: number;
			usedMemory: number;
			requestedCpu: number;
			requestedMemory: number;
			nodes: number;
			live: boolean;
			error?: undefined;
	  }
	| { error: string };

export type QuotaReport = {
	settings: QuotaSettings;
	users: QuotaUser[];
	cluster: QuotaCluster;
	liveUsage: boolean;
	/** The template parameters read as cores and GiB. */
	parameters: Record<"cpu" | "memory", string>;
	generatedAt: string;
};

// ---------------------------------------------------------------- certificates

export type CertificateInfo = {
	kind: "certificate";
	subject: string;
	commonName: string;
	issuer: string;
	issuerCommonName: string;
	serial: string;
	notBefore: string;
	notAfter: string;
	signature: string;
	keyAlgorithm: string;
	keySize: number | string | null;
	sans: string[];
	isCA: boolean;
	keyUsage: string[];
	extendedKeyUsage: string[];
	selfSigned: boolean;
	sha256: string;
	error?: string;
};

type PrivateKeyInfo = {
	kind: "key";
	keyAlgorithm: string;
	keySize: number | string | null;
	/** The certificate (common name) with this key's public key, if any. */
	matches?: string | null;
};

type Pkcs12Info = { kind: "pkcs12"; bytes: number };

type CertificateFileItem = CertificateInfo | PrivateKeyInfo | Pkcs12Info;

export type CertificateFile = {
	source: string;
	key?: string;
	mountPath?: string;
	items?: CertificateFileItem[];
	error?: string;
};

export type TlsEndpoint = {
	name: string;
	host: string;
	port: number;
	versions?: { version: string; cipher: string }[];
	ciphers12?: string[];
	negotiated?: { version: string; cipher: string; bits: number } | null;
	chain?: (CertificateInfo | { error: string })[];
	trusted?: boolean | null;
	trustError?: string;
	error?: string;
};

export type CertificatesOverview = {
	endpoints: TlsEndpoint[];
	files: CertificateFile[];
	generatedAt: string;
};

export type PersistenceFix =
	| "cnpg.cluster"
	| "cnpg.instances"
	| "cnpg.storage"
	| "cnpg.backup";

export type PersistenceCheck = {
	id: string;
	group: string;
	title: string;
	status: KeycloakCheckStatus;
	current: string | null;
	expected: string | null;
	detail: string;
	/** "cnpg.operator" is guided (installed by an administrator), not applied. */
	fix: PersistenceFix | "cnpg.operator" | null;
};

/** What a Cluster created or changed from General > Persistence looks like. */
export type PersistenceSettings = {
	clusterName: string;
	instances: number;
	storageSize: string;
	storageClass: string;
	snapshotClass: string;
	/** Six cron fields, seconds first (CloudNativePG's format). */
	backupSchedule: string;
};

export type StorageClassInfo = {
	name: string;
	provisioner: string;
	/** What the provisioner is, e.g. "AWS EBS" or "Longhorn". */
	label: string;
	kind: "cloud" | "network" | "local" | "unknown";
	isDefault: boolean;
	allowExpansion: boolean;
	reclaimPolicy: string | null;
	bindingMode: string | null;
};

type InstanceVolume = {
	name: string;
	storageClass: string | null;
	capacityBytes: number | null;
	requestedBytes: number | null;
	phase: string | null;
};

export type DatabaseInstance = PodBrief & {
	role: "primary" | "replica";
	zone: string | null;
	pvc: InstanceVolume | null;
	walPvc: InstanceVolume | null;
	/** How far a replica's replay is behind the primary; null when unknown. */
	lagBytes: number | null;
	replicationState: string | null;
	syncState: string | null;
};

type CoderDatabaseConnection = {
	host: string | null;
	port: number | null;
	database: string | null;
	user: string | null;
	sslMode: string | null;
	source: string | null;
	secret: string | null;
};

type CnpgOperator = {
	installed: boolean;
	crd: boolean;
	namespace: string | null;
	version: string | null;
	/** null when the CRD answers but the operator's Deployment is not visible. */
	ready: boolean | null;
};

export type DatabaseCluster = {
	name: string;
	namespace: string;
	phase: string | null;
	instances: number;
	readyInstances: number;
	primary: string | null;
	image: string | null;
	storageSize: string | null;
	storageClass: string | null;
	walStorageSize: string | null;
	managedBy: string | null;
	created: string | null;
};

type DatabaseStats = {
	sizeBytes: number | null;
	connections: number | null;
	maxConnections: number | null;
	version: string | null;
	startedAt: string | null;
};

type BackupState = {
	configured: boolean;
	method: string | null;
	schedule: string | null;
	lastSuccess: string | null;
	lastFailure: string | null;
	recoverableSince: string | null;
	count: number;
};

export type PersistenceReport = {
	generatedAt: string;
	/** "external": a database outside this Kubernetes cluster or not run by CloudNativePG. */
	mode: "cloudnative-pg" | "external" | "unknown";
	checks: PersistenceCheck[];
	facts: {
		/** "CloudNativePG", a cloud service such as "Amazon RDS", or "PostgreSQL". */
		provider: string | null;
		coderDatabase: CoderDatabaseConnection;
		operator: CnpgOperator;
		cluster: DatabaseCluster | null;
		instances: DatabaseInstance[];
		storageClasses: StorageClassInfo[];
		snapshotClasses: string[];
		database: DatabaseStats | null;
		backups: BackupState | null;
		/** CloudNativePG clusters in Coder's namespace that Coder does not use. */
		otherClusters: string[];
		settings: PersistenceSettings;
	};
};

type PersistenceResult = { ok: true; done: string[] };

/** An icon uploaded in Templates > Icons, usable in templates like Coder's /icon/ files. */
export type TemplateIcon = {
	name: string;
	type: string;
	/** Versioned URL (changes when the icon is replaced). */
	url: string;
	bytes: number;
	uploadedBy: string | null;
	uploadedAt: string | null;
};

export type TemplateIconList = {
	icons: TemplateIcon[];
	/** Owners and template admins may add and remove icons. */
	canManage: boolean;
};

/** Where a template refers to an icon: stable across replacements. */
export const templateIconPath = (name: string) =>
	`${PLATFORM_BASE}/icons/${name}`;

export type ChatPeer = {
	id: string;
	username: string;
	name: string;
	admin?: boolean;
};

export type ChatMessage = {
	id: number;
	from: string;
	fromName: string;
	fromDisplay: string;
	to: string;
	toName: string;
	toDisplay: string;
	text: string;
	at: string;
	fromAdmin: boolean;
	toAdmin: boolean;
	image: string | null;
	page: string | null;
};

export type ChatConversation = {
	peer: ChatPeer;
	last: ChatMessage;
	unread: number;
};

export type ChatAvailability = {
	available: string[];
	off: string[];
	availVersion: number;
};

export type ChatState = ChatAvailability & {
	me: {
		id: string;
		username: string;
		name: string;
		admin: boolean;
		chatOn: boolean;
	};
	conversations: ChatConversation[];
	cursor: number;
	typing: string[];
	clearVersion: number;
};

type ChatPoll = ChatAvailability & {
	messages: ChatMessage[];
	typing: string[];
	cleared: string[];
	clearVersion: number;
};

type ChatPollRequest = {
	after: number;
	typing: readonly string[];
	cleared: number;
	availVersion: number;
};

type ChatSendRequest = {
	to: string;
	text: string;
	image?: string;
	page?: string;
	/** The sender's id for this message: sending it again returns the first one. */
	clientId?: string;
};

export const BANNER_LEVELS = [
	"info",
	"success",
	"warning",
	"critical",
] as const;
export type BannerLevel = (typeof BANNER_LEVELS)[number];

export const BANNER_EFFECTS = [
	"none",
	"typewriter",
	"fade",
	"rise",
	"wave",
	"bounce",
	"flip",
	"shake",
	"pulse",
	"rainbow",
	"starwars",
	"pewpew",
	"flap",
	"shimmer",
] as const;
export type BannerEffect = (typeof BANNER_EFFECTS)[number];

/** How the banner goes away when someone dismisses it (the banner service checks the same list). */
export const BANNER_CLOSE_EFFECTS = [
	"none",
	"pixelate",
	"rollup",
	"fade",
	"wipe",
	"matrix",
	"gaussian",
	"evaporate",
] as const;
export type BannerCloseEffect = (typeof BANNER_CLOSE_EFFECTS)[number];

/**
 * How a picture fills the banner's screen: the background picture's
 * pictureFit, or, in a Markdown message, written in the picture's address
 * (`![flag](/__coder-ui/banner-picture/<id>#fit=tile)`); none: span.
 */
export const PICTURE_FITS = [
	"center",
	"span",
	"tile",
	"fill",
	"stretch",
] as const;
export type PictureFit = (typeof PICTURE_FITS)[number];

/** How the message lines up on the banner's screen. */
export const BANNER_ALIGNS = ["left", "center", "right"] as const;
export type BannerAlign = (typeof BANNER_ALIGNS)[number];

/** The crawl's pace (effect "starwars"). */
export const BANNER_SPEEDS = ["slow", "normal", "fast"] as const;
export type BannerSpeed = (typeof BANNER_SPEEDS)[number];

/** The banner's font (bannerFonts.ts; the banner service checks the same list). */
export const BANNER_FONTS = [
	"default",
	"sans",
	"serif",
	"condensed",
	"geist-mono",
	"ibm-plex-mono",
	"jetbrains-mono",
	"fira-code",
	"source-code-pro",
] as const;
export type BannerFont = (typeof BANNER_FONTS)[number];

/** The announcement as every page gets it (coder-banner's banner.json). */
export type Banner = {
	id: string;
	enabled: boolean;
	level: BannerLevel;
	title: string;
	message: string;
	linkText: string;
	linkUrl: string;
	dismissible: boolean;
	showOnLoginPage: boolean;
	refreshSeconds: number;
	effect: BannerEffect;
	repeat: boolean;
	/** Missing in announcements saved before it existed: "normal". */
	speed?: BannerSpeed;
	/** Missing in announcements saved before it existed: "default". */
	font?: BannerFont;
	/**
	 * Who viewed it is recorded, and they can confirm it (the Viewed box and
	 * Confirm). Off for a greeting nobody needs to account for. Missing in
	 * announcements saved before it existed: on.
	 */
	receipts?: boolean;
	/** Missing in announcements saved before it existed: "fade". */
	closeEffect?: BannerCloseEffect;
	/**
	 * The message is Markdown (with {{countdown}} tokens and pictures in it):
	 * announcements written before the plain editor (missing: true). The
	 * editor writes plain text (false), its picture and countdown in the
	 * fields below.
	 */
	markdown?: boolean;
	/** Missing: "center". */
	align?: BannerAlign;
	/**
	 * The message outlined in a contrasting colour (around whatever its font
	 * and effect draw), to stay legible over any background picture. Missing:
	 * off.
	 */
	outline?: boolean;
	/** The banner's background picture (a same-site path or an http(s) URL); "" or missing: none. */
	picture?: string;
	/** How the background picture fills the banner's screen; missing: "span". */
	pictureFit?: PictureFit;
	/** The moment the watch at the banner's left counts down to (UTC, ISO 8601); "" or missing: no countdown. */
	countdown?: string;
};

export type BannerFields = Omit<Banner, "id">;

export const NOTE_COLORS = [
	"yellow",
	"pink",
	"green",
	"blue",
	"orange",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

/** A post-it note an admin stuck on a workspace's page (position: fractions of the window). */
export type WorkspaceNote = {
	id: string;
	workspaceId: string;
	text: string;
	color: NoteColor;
	x: number;
	y: number;
	/** Degrees: how crooked it hangs. */
	tilt: number;
	author: string | null;
	createdAt: string;
	updatedAt: string;
	/** When the workspace's owner dismissed it (admins still see it). */
	dismissedAt: string | null;
	/** The workspace's owner and name (notes made before 1.22.0: filled in once an admin lists them). */
	ownerId?: string | null;
	ownerName?: string | null;
	workspaceName?: string | null;
};

/** A picture installed with the platform to choose as logo or avatar. */
/** A picture uploaded for the announcement, at its own (never-changing) address. */
export type BannerPicture = {
	id: string;
	url: string;
	name: string;
	type: string;
	bytes: number;
};

export type GalleryImage = {
	name: string;
	type: string;
	bytes: number;
	url: string;
};

/** What the coder-banner admin API answers. */
export type BannerState = {
	user: { username: string };
	banner: Banner;
	overrideActive: boolean;
	revision: number;
	updatedBy: string | null;
	updatedAt: string | null;
	subscribers?: number;
	delivered?: number;
};

// ---------------------------------------------------------------- methods

const chat = (path: string) => `${PLATFORM_BASE}/api/chat/${path}`;

export const PlatformAPI = {
	getClassification: () =>
		get<ClassificationSettings>(`${PLATFORM_BASE}/api/classification`),
	updateClassification: (settings: ClassificationSettings) =>
		post<ClassificationSettings>(`${PLATFORM_BASE}/api/classification`, {
			enabled: settings.enabled,
			text: settings.text.trim(),
			height: settings.height,
			background: settings.background,
			color: settings.color,
		}),

	getLoginPage: () => get<LoginPageSettings>(`${PLATFORM_BASE}/api/login-page`),
	updateLoginPage: (settings: LoginPageSettings) =>
		post<LoginPageSettings>(`${PLATFORM_BASE}/api/login-page`, {
			title: settings.title.trim(),
			effect: settings.effect,
			color: settings.color,
			speed: settings.speed,
			message: settings.message.trim(),
			signedOutMessage: settings.signedOutMessage.trim(),
		}),

	getLogo: () => get<LogoState>(`${PLATFORM_BASE}/api/logo`),
	uploadLogo: (dataUrl: string) =>
		post<{ ok: true; set: true; url: string }>(`${PLATFORM_BASE}/api/logo`, {
			dataUrl,
		}),
	resetLogo: () =>
		post<{ ok: true; set: false }>(`${PLATFORM_BASE}/api/logo/reset`, {}),

	getMyAvatar: () => get<MyAvatar>(`${PLATFORM_BASE}/api/avatar`),
	getAvatarDefaults: () =>
		get<AvatarDefaults>(`${PLATFORM_BASE}/api/avatar/defaults`),
	uploadAvatar: (dataUrl: string) =>
		post<{ ok: true; set: true; url: string }>(`${PLATFORM_BASE}/api/avatar`, {
			dataUrl,
		}),
	resetAvatar: () =>
		post<{ ok: true; set: false }>(`${PLATFORM_BASE}/api/avatar/reset`, {}),
	getBackgrounds: () =>
		get<BackgroundsState>(`${PLATFORM_BASE}/api/backgrounds`),
	/** A new image (dataUrl) and/or new settings for one background. */
	saveBackground: (
		slot: BackgroundSlot,
		change: Partial<Omit<BackgroundImage, "url" | "kind">> & {
			dataUrl?: string;
			html?: string;
		},
	) =>
		post<
			{ ok: true; set: true } & Partial<Record<BackgroundSlot, BackgroundImage>>
		>(`${PLATFORM_BASE}/api/backgrounds`, { slot, ...change }),
	resetBackground: (slot: BackgroundSlot) =>
		post<{ ok: true; set: false }>(`${PLATFORM_BASE}/api/backgrounds/reset`, {
			slot,
		}),
	getGallery: () =>
		get<{ images: GalleryImage[] }>(`${PLATFORM_BASE}/api/gallery`),
	/** Admins: a picture for the announcement (stored as it is: an animated GIF keeps its frames). */
	uploadBannerPicture: (name: string, dataUrl: string) =>
		post<BannerPicture>(`${PLATFORM_BASE}/api/banner-pictures`, {
			name,
			dataUrl,
		}),

	getAnnouncementStatus: (id: string) =>
		get<AnnouncementReceiptStatus>(
			`${PLATFORM_BASE}/api/me?id=${encodeURIComponent(id)}`,
		),
	markAnnouncementViewed: (id: string) =>
		post<{ ok: true }>(`${PLATFORM_BASE}/api/view`, { id }),
	confirmAnnouncement: (id: string) =>
		post<{ ok: true }>(`${PLATFORM_BASE}/api/ack`, { id }),

	getWorkspaceNotes: (workspaceId: string) =>
		get<{ notes: WorkspaceNote[]; canEdit: boolean }>(
			`${PLATFORM_BASE}/api/notes?workspace=${encodeURIComponent(workspaceId)}`,
		),
	createWorkspaceNote: (
		workspaceId: string,
		note: Pick<WorkspaceNote, "text" | "color" | "x" | "y">,
	) =>
		post<{ note: WorkspaceNote }>(`${PLATFORM_BASE}/api/notes`, {
			workspace: workspaceId,
			...note,
		}),
	updateWorkspaceNote: (
		id: string,
		change: Partial<Pick<WorkspaceNote, "text" | "color" | "x" | "y">>,
	) =>
		post<{ note: WorkspaceNote }>(`${PLATFORM_BASE}/api/notes/update`, {
			id,
			...change,
		}),
	deleteWorkspaceNote: (id: string) =>
		post<{ ok: true }>(`${PLATFORM_BASE}/api/notes/delete`, { id }),
	dismissWorkspaceNote: (id: string) =>
		post<{ note: WorkspaceNote }>(`${PLATFORM_BASE}/api/notes/dismiss`, { id }),
	/** Lock Down: whether the workspace is jailed (its owner and admins). */
	getLockdown: (workspaceId: string) =>
		get<WorkspaceLockdown>(
			`${PLATFORM_BASE}/api/lockdown/${encodeURIComponent(workspaceId)}`,
		),
	/** Admins: lock a workspace down (network, sudo, both, or frozen) or lift it; a running workspace at once. */
	setLockdown: (workspaceId: string, mode: LockdownMode) =>
		post<
			WorkspaceLockdown & {
				applied: "now" | "next start";
				error: string | null;
			}
		>(`${PLATFORM_BASE}/api/lockdown/${encodeURIComponent(workspaceId)}`, {
			mode,
		}),
	/** Admins: the workspace's Freeze snapshot deleted. */
	deleteLockdownSnapshot: (workspaceId: string) =>
		post<WorkspaceLockdown>(
			`${PLATFORM_BASE}/api/lockdown/${encodeURIComponent(workspaceId)}/snapshot/delete`,
			{},
		),
	/** The signed-in user's Inbox (the bell) emptied: every notification deleted (Coder can only mark them read). */
	clearInbox: () =>
		post<{ cleared: number }>(`${PLATFORM_BASE}/api/inbox/clear`, {}),
	/** Admins: every note not dismissed yet, by the workspace owner's user id. */
	getNotesByUser: () =>
		get<{ users: Record<string, WorkspaceNote[]> }>(
			`${PLATFORM_BASE}/api/notes/users`,
		),
	getAnnouncementReport: () =>
		get<AnnouncementReport>(`${PLATFORM_BASE}/api/acks`),
	deleteAnnouncementEvent: (id: string) =>
		post<{ ok: true; removed: number }>(`${PLATFORM_BASE}/api/events/delete`, {
			id,
		}),
	/** Admins: every announcement's record and confirmations (the live one's start again from nobody). */
	clearAnnouncementEvents: () =>
		post<{ ok: true; removed: number }>(
			`${PLATFORM_BASE}/api/events/clear`,
			{},
		),

	getClusterUsage: () =>
		get<ClusterUsage>(`${PLATFORM_BASE}/api/cluster/usage`),
	getNetworkReport: () => get<NetworkReport>(`${PLATFORM_BASE}/api/network`),

	getMonitoring: () =>
		get<MonitoringOverview>(`${PLATFORM_BASE}/api/monitoring`),
	getWorkspaceLogs: (workspaceId: string, after: number) =>
		get<WorkspaceLogs>(
			`${PLATFORM_BASE}/api/monitoring/logs?workspace=${encodeURIComponent(workspaceId)}&after=${after}`,
		),

	getKeycloakReport: () => get<KeycloakReport>(`${PLATFORM_BASE}/api/keycloak`),
	applyKeycloakFixes: (
		fixes: readonly KeycloakFix[],
		settings: KeycloakSettings,
	) =>
		post<KeycloakResult>(`${PLATFORM_BASE}/api/keycloak/apply`, {
			fixes,
			settings,
		}),
	connectKeycloak: (req: {
		username: string;
		password: string;
		settings: KeycloakSettings;
	}) => post<KeycloakResult>(`${PLATFORM_BASE}/api/keycloak/connect`, req),
	undoKeycloakChange: () =>
		post<KeycloakResult>(`${PLATFORM_BASE}/api/keycloak/undo`, {}),
	getKeycloakStatus: () =>
		get<KeycloakStatus>(`${PLATFORM_BASE}/api/keycloak/status`),

	getQuotaReport: () => get<QuotaReport>(`${PLATFORM_BASE}/api/quota`),
	getSchedulerReport: () =>
		get<SchedulerReport>(`${PLATFORM_BASE}/api/scheduler`),
	updateScheduler: (settings: SchedulerSettings) =>
		post<{ ok: true; settings: SchedulerSettings }>(
			`${PLATFORM_BASE}/api/scheduler`,
			settings,
		),
	getSchedulerMe: () => get<SchedulerMe>(`${PLATFORM_BASE}/api/scheduler/me`),
	getHud: () => get<HudReport>(`${PLATFORM_BASE}/api/hud`),
	getHudHistory: (range: HudRange) =>
		get<HudHistory>(`${PLATFORM_BASE}/api/hud/history?range=${range}`),
	getMonitoringPosture: () =>
		get<MonitoringPosture>(`${PLATFORM_BASE}/api/monitoring/posture`),
	updateQuota: (settings: QuotaSettings) =>
		post<{ ok: true; settings: QuotaSettings }>(
			`${PLATFORM_BASE}/api/quota`,
			settings,
		),

	getCertificates: (refresh = false) =>
		get<CertificatesOverview>(
			`${PLATFORM_BASE}/api/certificates${refresh ? "?refresh=1" : ""}`,
		),

	getTemplateIcons: () => get<TemplateIconList>(`${PLATFORM_BASE}/api/icons`),
	uploadTemplateIcon: (req: { name: string; dataUrl: string }) =>
		post<{ ok: true; url: string }>(`${PLATFORM_BASE}/api/icons`, req),
	deleteTemplateIcon: (name: string) =>
		post<{ ok: true; removed: boolean }>(`${PLATFORM_BASE}/api/icons/delete`, {
			name,
		}),

	getPersistenceReport: () =>
		get<PersistenceReport>(`${PLATFORM_BASE}/api/persistence`),
	applyPersistenceFixes: (
		fixes: readonly PersistenceFix[],
		settings: PersistenceSettings,
	) =>
		post<PersistenceResult>(`${PLATFORM_BASE}/api/persistence/apply`, {
			fixes,
			settings,
		}),

	getChatState: () => get<ChatState>(chat("state")),
	getChatAdmins: () => get<{ admins: ChatPeer[] }>(chat("admins")),
	getChatMessages: (peerId: string, before?: number) =>
		get<{ messages: ChatMessage[]; readUpTo: number }>(
			chat(
				`messages?peer=${encodeURIComponent(peerId)}${before ? `&before=${before}` : ""}`,
			),
		),
	pollChat: (req: ChatPollRequest) => {
		const query = new URLSearchParams({
			after: String(req.after),
			typing: [...req.typing].sort().join(","),
			cleared: String(req.cleared),
			av: String(req.availVersion),
		});
		return get<ChatPoll>(chat(`poll?${query}`));
	},
	sendChatMessage: (req: ChatSendRequest) =>
		post<{ message: ChatMessage }>(chat("send"), req),
	sendChatTyping: (to: string) => post<{ ok: true }>(chat("typing"), { to }),
	markChatRead: (to: string, last: number) =>
		post<{ ok: true }>(chat("read"), { to, last }),
	deleteChatConversation: (to: string) =>
		post<{ ok: true; deleted: number }>(chat("delete"), { to }),
	setChatAvailability: (enabled: boolean) =>
		post<ChatAvailability & { enabled: boolean }>(chat("availability"), {
			enabled,
		}),

	getBanner: () => get<Banner>(`${BANNER_BASE}/banner.json`),
	getBannerState: () => get<BannerState>(`${BANNER_BASE}/api/state`),
	publishBanner: (fields: BannerFields) =>
		post<BannerState>(
			`${BANNER_BASE}/api/banner`,
			fields,
			BANNER_REQUESTED_WITH,
		),
	reshowBanner: () =>
		post<BannerState>(`${BANNER_BASE}/api/reappear`, {}, BANNER_REQUESTED_WITH),
	resetBanner: () =>
		post<BannerState>(`${BANNER_BASE}/api/reset`, {}, BANNER_REQUESTED_WITH),
};

/** The banner service's live channel: every change is pushed the moment an admin publishes it. */
export const bannerLiveURL = (): string =>
	`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${BANNER_BASE}/live`;
