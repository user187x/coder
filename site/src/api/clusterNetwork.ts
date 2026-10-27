/**
 * @file The Cluster Network view in depth (Settings > Network), served by the
 * platform service (clusternet.py): what each pod and Service on the map is
 * (its kind, one colour per kind), one entity's details on demand,
 * code-server HA and the storage behind the workspaces, and the mesh of the
 * platform's connections with their measured latency.
 */
import type { CoderPod, NetworkReport, NetworkWorkspace } from "./platform";
import { platformRequest } from "./platform";

const { get, base } = platformRequest;

/** What a pod (or the pods a Service selects) is: one colour per kind. */
export type ComponentKind =
	| "coder"
	| "database"
	| "workspace"
	| "storage"
	| "gateway"
	| "code-server"
	| "platform"
	| "replicator"
	| "other";

type Requests = { cpu: number; memory: number };

/** What the map's report adds to a pod (missing from an older platform service). */
type PodExtras = {
	kind?: ComponentKind;
	/** A Coder server's active / standby, a database instance's primary / replica. */
	haRole?: string;
	requests?: Requests;
};

export type MapPod = CoderPod & PodExtras;

export type MapWorkspace = Omit<NetworkWorkspace, "pod"> & {
	pod: NetworkWorkspace["pod"] & PodExtras;
};

export type MapService = {
	name: string;
	namespace: string;
	kind: ComponentKind;
	type: string;
	clusterIP: string | null;
	external: string[];
	ports: string[];
	/** null: its endpoints could not be read. */
	endpoints: number | null;
	ready: number | null;
};

/** /api/network as the map reads it: the report plus kinds, roles, requests and Services. */
export type ClusterNetworkReport = Omit<
	NetworkReport,
	"coder" | "workspaces"
> & {
	coder: MapPod[];
	workspaces: MapWorkspace[];
	services?: MapService[];
	servicesError?: string | null;
};

/** What a click on the map, the mesh or the nodes view opens. */
export type EntityRef =
	| { type: "pod" | "service"; namespace: string; name: string }
	| { type: "node"; name: string }
	| { type: "link"; id: string };

type ContainerState = {
	state: "running" | "waiting" | "terminated";
	since?: string | null;
	reason?: string | null;
	message?: string | null;
	exitCode?: number | null;
} | null;

export type ContainerDetails = {
	name: string;
	image: string;
	ready: boolean;
	restarts: number;
	state: ContainerState;
	lastState: ContainerState;
	ports: string[];
	requests: Record<string, string>;
	limits: Record<string, string>;
};

export type ClusterEvent = {
	type: string | null;
	reason: string | null;
	message: string;
	count: number;
	at: string | null;
};

export type ClusterCondition = {
	type: string;
	status: string;
	reason: string | null;
	message: string;
	since: string | null;
	heartbeat?: string | null;
};

export type PodBrief = {
	name: string;
	namespace: string;
	node: string | null;
	podIP: string | null;
	ready: boolean;
	restarts: number;
	started: string | null;
	phase: string | null;
	deleting: boolean;
};

export type PodDetails = {
	type: "pod";
	name: string;
	namespace: string;
	kind: ComponentKind;
	role: string | null;
	phase: string | null;
	reason: string | null;
	message: string;
	ready: boolean;
	restarts: number;
	conditions: ClusterCondition[];
	node: string | null;
	podIP: string | null;
	podIPs: string[];
	hostIP: string | null;
	qosClass: string | null;
	created: string | null;
	started: string | null;
	deleting: boolean;
	owner: { kind: string; name: string; via?: string } | null;
	serviceAccount: string | null;
	containers: ContainerDetails[];
	initContainers: ContainerDetails[];
	volumes: { name: string; type: string; source: string | null }[];
	/** The Services that select it; null when they could not be read. */
	services: string[] | null;
	usage: Requests | null;
	requests: Requests;
	labels: Record<string, string>;
	extra: {
		workspace?: string;
		owner?: string;
		workspaceId?: string;
		generation?: string;
		codeServerRelay?: { ready: boolean; restarts: number } | null;
	};
	/** null: the service may not read events. */
	events: ClusterEvent[] | null;
};

export type ServiceDetails = {
	type: "service";
	name: string;
	namespace: string;
	kind: ComponentKind;
	serviceType: string;
	clusterIPs: string[];
	external: string[];
	ports: {
		name: string | null;
		port: number;
		targetPort: number | string | null;
		protocol: string;
		nodePort: number | null;
	}[];
	selector: Record<string, string>;
	sessionAffinity: string | null;
	trafficPolicy: string | null;
	created: string | null;
	dns: string;
	endpoints:
		| {
				address: string;
				ready: boolean;
				serving: boolean;
				terminating: boolean;
				pod: string | null;
				node: string | null;
				zone: string | null;
		  }[]
		| null;
	events: ClusterEvent[] | null;
};

export type NodeDetails = {
	type: "node";
	name: string;
	created: string | null;
	unschedulable: boolean;
	conditions: ClusterCondition[];
	capacity: Record<string, string>;
	allocatable: Record<string, string>;
	allocatableValues: {
		cpu: number | null;
		memory: number | null;
		pods: number | null;
	};
	usage: { cpu: number | null; memory: number | null } | null;
	requests: Requests;
	limits: Requests;
	podCount: number;
	pods: {
		name: string;
		namespace: string;
		kind: ComponentKind;
		ready: boolean;
	}[];
	taints: string[];
	labels: Record<string, string>;
	addresses: { type: string; address: string }[];
	info: Record<string, string | null>;
	images: number;
	volumesInUse: number;
	events: ClusterEvent[] | null;
};

export type MeshNodeId =
	| "gateway"
	| "coder"
	| "workspaces"
	| "code-server"
	| "replicator"
	| "database"
	| "replicas"
	| "storage"
	| "registry"
	| "platform";

export type MeshNode = {
	id: MeshNodeId;
	label: string;
	sub: string | null;
	kind: ComponentKind;
	pods: PodBrief[];
	ready: number;
	/** The Service (or single pod) a click opens. */
	entity: EntityRef | null;
};

export type MeshSample = {
	target: string;
	ms: number | null;
	error: string | null;
	method: string;
};

/**
 * One connection. traffic: between two components (a number only where one
 * of them measures it); probe: the platform service's own measurement;
 * control: not traffic (nothing to time).
 */
export type MeshEdge = {
	id: string;
	from: MeshNodeId;
	to: MeshNodeId;
	kind: "traffic" | "probe" | "control";
	ms: number | null;
	error: string | null;
	method: string;
	/** Why there is no number (or what else to know). */
	note: string | null;
	/** Who measured it; null: it cannot be measured from where the service runs. */
	measuredBy: string | null;
	measuredAt: string | null;
	samples: MeshSample[];
};

export type MeshReport = {
	generatedAt: string;
	ttlSeconds: number;
	/** The platform service's pod that measured. */
	vantage: string | null;
	nodes: MeshNode[];
	edges: MeshEdge[];
};

type LinkEnd = { id: string; kind: ComponentKind; label: string };

export type MeshLinkDetails = Omit<MeshEdge, "from" | "to"> & {
	type: "link";
	from: LinkEnd;
	to: LinkEnd;
	/** [measured at, ms or null for a failed measurement], oldest first. */
	history: [string, number | null][];
};

export type AgentLinkDetails = {
	type: "link";
	id: string;
	from: LinkEnd;
	to: LinkEnd;
	method: string;
	agents: {
		name: string;
		status: string;
		lifecycle: string | null;
		version: string | null;
		apiVersion: string | null;
		os: string | null;
		arch: string | null;
		latency: { region: string; ms: number | null; preferred: boolean }[];
		firstConnectedAt: string | null;
		lastConnectedAt: string | null;
		disconnectedAt: string | null;
		startedAt: string | null;
		readyAt: string | null;
		connectionTimeoutSeconds: number | null;
	}[];
};

export type EntityDetails =
	| PodDetails
	| ServiceDetails
	| NodeDetails
	| MeshLinkDetails
	| AgentLinkDetails;

type InstancePod = PodBrief & { generation: number };

export type CodeServerInstance = {
	workspaceId: string;
	owner: string | null;
	homeCluster: string;
	homeNamespace: string;
	homeNode: string | null;
	activeCluster: string | null;
	pod: string | null;
	generation: number;
	state: string;
	/** Seconds the lease still runs (negative: lapsed). */
	leaseLeft: number | null;
	message: string | null;
	updatedAgo: number | null;
	seenAgo: number | null;
	endpoint: string | null;
	/** code-server's user state kept in Postgres (settings, keybindings, ...). */
	stateFiles: number;
	stateUpdatedAt: string | null;
	activePod: InstancePod | null;
	/** Older generations not fenced yet: they pass connections on to the active one. */
	superseded: InstancePod[];
	workspacePod:
		| (PodBrief & {
				relay: boolean;
				relayReady: boolean;
				relayRestarts: number;
				workspace: string | null;
		  })
		| null;
};

export type CodeServerHA = {
	installed: boolean;
	cluster: string | null;
	leaseSeconds: number | null;
	endpointExternal: string | null;
	replicas: number | null;
	replicators: (PodBrief & {
		lock: "holds" | "waits" | "not connected" | "unknown";
	})[];
	lockHolder: string | null;
	lockSince: string | null;
	clusters: {
		name: string;
		heartbeatAgo: number;
		since: string | null;
		external: boolean;
		version: string | null;
		healthy: boolean;
		lockAddress: string | null;
		lockSince: string | null;
	}[];
	instances: CodeServerInstance[];
	/** Instance pods whose workspace has no row (being removed). */
	unregistered: (InstancePod & { workspaceId: string })[];
	events: {
		at: string;
		workspaceId: string | null;
		cluster: string | null;
		event: string;
		detail: string | null;
	}[];
	schema: boolean;
	error: string | null;
};

export type StorageVolume = {
	name: string;
	claim: string | null;
	phase: string | null;
	capacity: string | null;
	capacityBytes: number | null;
	accessModes: string[];
	reclaimPolicy: string | null;
	driver: string | null;
	usedBy: string[];
	user: string | null;
};

export type StorageReport = {
	classes: {
		name: string;
		provisioner: string;
		default: boolean;
		reclaimPolicy: string;
		bindingMode: string;
		expansion: boolean;
		volumes: number;
		bound: number;
		capacityBytes: number;
		claims: string[];
		pending: string[];
	}[];
	/** Volumes of no storage class (made by hand: the Cloud Drive's). */
	static: { volumes: number; bound: number; drivers: string[] };
	volumesReadable: boolean;
	csiDrivers:
		| {
				name: string;
				attachRequired: boolean | null;
				podInfoOnMount: boolean | null;
				modes: string[];
		  }[]
		| null;
	cloudDrive: {
		enabled: boolean;
		backend: {
			source?: string;
			kind?: string;
			endpoint?: string;
			bucket?: string;
			region?: string;
			error?: string;
		};
		status: {
			connected: boolean | null;
			error: string | null;
			latencyMs: number | null;
			checkedAt: number | null;
		};
		quotaGiB: number | null;
		csiDriver: string;
		driverInstalled: boolean | null;
		plugin: PodBrief[];
		minio: PodBrief[];
		volumes: {
			total: number;
			byPhase: Record<string, number>;
			inUse: number;
			items: StorageVolume[];
		};
		libraries: StorageVolume[];
	} | null;
};

export type HAStorageReport = {
	generatedAt: string;
	codeServerHA: CodeServerHA;
	storage: StorageReport | null;
	storageError?: string;
};

const entityQuery = (ref: EntityRef) => {
	const q = new URLSearchParams({ type: ref.type });
	if (ref.type === "link") {
		q.set("id", ref.id);
	} else {
		q.set("name", ref.name);
		if (ref.type !== "node") {
			q.set("namespace", ref.namespace);
		}
	}
	return q.toString();
};

export const ClusterNetworkAPI = {
	entity: (ref: EntityRef) =>
		get<EntityDetails>(`${base}/api/network/entity?${entityQuery(ref)}`),
	haAndStorage: () => get<HAStorageReport>(`${base}/api/network/ha`),
	mesh: () => get<MeshReport>(`${base}/api/network/mesh`),
};

const clusterNetworkKey = ["platform", "cluster-network"] as const;
export const clusterEntityKey = (ref: EntityRef) =>
	[...clusterNetworkKey, "entity", entityQuery(ref)] as const;
export const clusterMeshKey = [...clusterNetworkKey, "mesh"] as const;
export const clusterHAKey = [...clusterNetworkKey, "ha"] as const;

/** One entity's state, re-read every 5 seconds while its panel is open. */
export const clusterEntity = (ref: EntityRef) => ({
	queryKey: clusterEntityKey(ref),
	queryFn: () => ClusterNetworkAPI.entity(ref),
	refetchInterval: 5_000,
	retry: false,
});

/** The mesh is measured at most every 8 seconds on the service, whoever asks: read it every 10. */
export const clusterMesh = (paused: boolean) => ({
	queryKey: clusterMeshKey,
	queryFn: ClusterNetworkAPI.mesh,
	refetchInterval: paused ? (false as const) : 10_000,
	retry: false,
});

export const clusterHA = (paused: boolean) => ({
	queryKey: clusterHAKey,
	queryFn: ClusterNetworkAPI.haAndStorage,
	refetchInterval: paused ? (false as const) : 10_000,
	retry: false,
});

export type CoderScale = {
	desired: number;
	ready: number;
	resourceVersion: string;
	automated: boolean;
};
export const coderScaleKey = [...clusterNetworkKey, "coder-scale"] as const;
export const coderScale = () => ({
	queryKey: coderScaleKey,
	queryFn: () =>
		platformRequest.get<CoderScale>(`${base}/api/network/coder-scale`),
	refetchInterval: 5000,
	retry: false,
});
export const updateCoderScale = () => ({
	mutationFn: (body: { replicas: number; resourceVersion: string }) =>
		platformRequest.post<CoderScale>(`${base}/api/network/coder-scale`, body),
});
