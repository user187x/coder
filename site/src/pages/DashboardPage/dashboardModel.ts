import type {
	HudHistoryPoint,
	QuotaMeResources,
	QuotaReport,
	QuotaResourceModes,
	ResourceHistorySample,
	WorkspaceResourceHistory,
} from "#/api/platform";

/** Allocations at or above this share of a limit are near it. */
export const WATERMARK_WARNING = 0.8;

export type WatermarkLevel = "none" | "ok" | "warning" | "danger";

/** How close an allocation is to its limit: none without a limit, danger at or past it. */
export const watermarkLevel = (
	used: number,
	limit: number | null,
): WatermarkLevel => {
	if (limit === null || !Number.isFinite(used) || !Number.isFinite(limit)) {
		return "none";
	}
	if (limit <= 0) {
		return used > 0 ? "danger" : "ok";
	}
	const share = used / limit;
	return share >= 1 ? "danger" : share >= WATERMARK_WARNING ? "warning" : "ok";
};

export const WATERMARK_TEXT: Record<WatermarkLevel, string> = {
	none: "No limit",
	ok: "Within quota",
	warning: "Near quota",
	danger: "At or over quota",
};

export type Resource = "cpu" | "memory" | "disk";
type Amounts = Record<Resource, number>;

export const RESOURCE_UNIT: Record<Resource, string> = {
	cpu: "cores",
	memory: "GB",
	disk: "GB",
};

export type DashboardWorkspace = QuotaMeResources["workspaces"][number] & {
	/** Set in the cluster view, where rows belong to many accounts. */
	owner?: string;
};

/** What the page shows: the caller's workspaces against their quota, or the cluster's against its capacity. */
export type DashboardScope = {
	kind: "mine" | "cluster";
	limits: Record<Resource, number | null>;
	/** What counts against each limit. */
	allocated: Amounts;
	running: Amounts;
	stopped: Amounts;
	modes: QuotaResourceModes;
	exempt: boolean;
	workspaces: DashboardWorkspace[];
};

const CUMULATIVE: QuotaResourceModes = {
	cpu: "cumulative",
	memory: "cumulative",
	disk: "cumulative",
};

const sum = (rows: readonly DashboardWorkspace[], key: Resource) =>
	rows.reduce((total, row) => total + (row[key] || 0), 0);

const amounts = (rows: readonly DashboardWorkspace[]): Amounts => ({
	cpu: sum(rows, "cpu"),
	memory: sum(rows, "memory"),
	disk: sum(rows, "disk"),
});

export const scopeFromMine = (data: QuotaMeResources): DashboardScope => ({
	kind: "mine",
	limits: {
		cpu: data.limits.cpu,
		memory: data.limits.memory,
		disk: data.limits.disk,
	},
	allocated: {
		cpu: data.usage.cpu,
		memory: data.usage.memory,
		disk: data.usage.disk,
	},
	running: amounts(data.workspaces.filter((w) => w.running)),
	stopped: amounts(data.workspaces.filter((w) => !w.running)),
	modes: data.resourceModes,
	exempt: data.exempt,
	workspaces: data.workspaces,
});

/** Every account's workspaces against what the cluster has; disk against the HUD's storage total. */
export const scopeFromCluster = (
	report: QuotaReport,
	diskTotal: number | null,
): DashboardScope => {
	const workspaces: DashboardWorkspace[] = report.users.flatMap((user) =>
		user.workspaces.map((w) => ({
			id: w.id,
			name: w.name,
			template: w.template,
			status: w.status,
			running: w.running,
			cpu: w.cpu,
			memory: w.memory,
			disk: w.disk,
			gpus: null,
			owner: w.owner,
		})),
	);
	const cluster = report.cluster.error === undefined ? report.cluster : null;
	return {
		kind: "cluster",
		limits: {
			cpu: cluster?.cpu ?? null,
			memory: cluster?.memory ?? null,
			disk: diskTotal,
		},
		allocated: amounts(workspaces),
		running: amounts(workspaces.filter((w) => w.running)),
		stopped: amounts(workspaces.filter((w) => !w.running)),
		modes: CUMULATIVE,
		exempt: false,
		workspaces,
	};
};

/** Agent readings say GB (10^9 bytes); quotas count memory in GiB. */
const GIB_PER_GB = 1e9 / 1024 ** 3;

/** The used and total of a reading such as "0.27/6 cores (5%)" or "0.33 / 6.44 GB". */
const parseReading = (text: string): { used: number; total: number } | null => {
	const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
	if (!match) {
		return null;
	}
	const used = Number(match[1]);
	const total = Number(match[2]);
	return Number.isFinite(used) && Number.isFinite(total)
		? { used, total }
		: null;
};

export type Series = {
	/** Oldest first; null where nothing was measured. */
	points: (number | null)[];
	latest: number | null;
};

const SERIES_BUCKETS = 12;
const WINDOW_MS = 300_000;

/** Average each workspace's readings per bucket of the last five minutes, then add the workspaces up. */
const sumBuckets = (
	perWorkspace: readonly (readonly { t: number; value: number }[])[],
	asOf: number,
): Series => {
	const start = asOf - WINDOW_MS;
	const totals: (number | null)[] = Array.from(
		{ length: SERIES_BUCKETS },
		() => null,
	);
	for (const samples of perWorkspace) {
		const buckets = Array.from({ length: SERIES_BUCKETS }, () => ({
			sum: 0,
			count: 0,
		}));
		for (const s of samples) {
			if (!Number.isFinite(s.value) || s.t < start || s.t > asOf) continue;
			const i = Math.min(
				SERIES_BUCKETS - 1,
				Math.floor(((s.t - start) / WINDOW_MS) * SERIES_BUCKETS),
			);
			buckets[i].sum += s.value;
			buckets[i].count++;
		}
		buckets.forEach((b, i) => {
			if (b.count) {
				totals[i] = (totals[i] ?? 0) + b.sum / b.count;
			}
		});
	}
	const latest = [...totals].reverse().find((v) => v !== null) ?? null;
	return { points: totals, latest };
};

const readings = (
	samples: readonly ResourceHistorySample[],
	scale: number,
): { t: number; value: number }[] =>
	samples.flatMap((s) => {
		const reading = parseReading(s.text);
		return reading ? [{ t: s.t, value: reading.used * scale }] : [];
	});

/** Live CPU (cores) and memory (GiB) of every running workspace, summed, from their resource history. */
export const liveFromHistories = (
	histories: readonly (WorkspaceResourceHistory | undefined)[],
): { cpu: Series; memory: Series } | null => {
	const loaded = histories.filter(
		(h): h is WorkspaceResourceHistory => h !== undefined,
	);
	if (loaded.length === 0) {
		return null;
	}
	const asOf = Math.max(...loaded.map((h) => h.asOf));
	const agents = loaded.flatMap((h) => Object.values(h.agents));
	return {
		cpu: sumBuckets(
			agents.map((a) => readings(a.cpu, 1)),
			asOf,
		),
		memory: sumBuckets(
			agents.map((a) => readings(a.ram, GIB_PER_GB)),
			asOf,
		),
	};
};

/** What the workspaces use of the cluster, from the HUD's history (its last five minutes). */
export const liveFromHud = (
	points: readonly HudHistoryPoint[],
	end: number,
): { cpu: Series; memory: Series } => {
	const asOf = end * 1000;
	const pick = (key: "cpuWorkspaces" | "memoryWorkspaces") =>
		sumBuckets(
			[
				points.flatMap((p) => {
					const value = p[key];
					return value === null ? [] : [{ t: p.t * 1000, value }];
				}),
			],
			asOf,
		);
	return { cpu: pick("cpuWorkspaces"), memory: pick("memoryWorkspaces") };
};

/** The newest disk reading of a workspace's agents: used and size in GB. */
export const diskFromHistory = (
	history: WorkspaceResourceHistory | undefined,
): { used: number; total: number } | null => {
	if (!history) {
		return null;
	}
	let newest: ResourceHistorySample | undefined;
	for (const agent of Object.values(history.agents)) {
		const last = agent.disk.at(-1);
		if (last && (!newest || last.t > newest.t)) {
			newest = last;
		}
	}
	return newest ? parseReading(newest.text) : null;
};

type NetworkAgents = Record<
	string,
	{ samples: { from: number; t: number; rx: number; tx: number }[] }
>;

/**
 * Bytes a second received and sent by every running workspace, summed per bucket of the five minutes up to the
 * newest reading.
 */
export const networkSeries = (
	networks: readonly (NetworkAgents | undefined)[],
): { rx: Series; tx: Series } | null => {
	const loaded = networks.filter((n): n is NetworkAgents => n !== undefined);
	if (loaded.length === 0) {
		return null;
	}
	const agents = loaded.flatMap((n) => Object.values(n));
	const asOf = Math.max(0, ...agents.flatMap((a) => a.samples.map((s) => s.t)));
	return {
		rx: sumBuckets(
			agents.map((a) => a.samples.map((s) => ({ t: s.t, value: s.rx }))),
			asOf,
		),
		tx: sumBuckets(
			agents.map((a) => a.samples.map((s) => ({ t: s.t, value: s.tx }))),
			asOf,
		),
	};
};
