import type { ClusterNetwork } from "#/api/platform";

export const clusterMetrics = {
	cpu: { title: "Total CPU used", unit: "cores" },
	memory: { title: "Total memory used", unit: "GiB" },
	net: { title: "Cluster network", unit: "B/s" },
	disk: { title: "Total disk used", unit: "GiB" },
} as const;

export type ClusterMetric = keyof typeof clusterMetrics;

export type ClusterMetricSample = {
	t: number;
	value: number;
	received?: number;
	measurement: string;
};

export type ClusterMetricSelection = {
	metric: ClusterMetric;
	samples: ClusterMetricSample[];
	every: number;
};

/** Returns the closest recorded sample. On a tie, keep the earlier sample. */
export function nearestSample<T extends { t: number }>(
	samples: readonly T[],
	time: number,
): T | undefined {
	return samples.reduce<T | undefined>(
		(nearest, sample) =>
			!nearest || Math.abs(sample.t - time) < Math.abs(nearest.t - time)
				? sample
				: nearest,
		undefined,
	);
}

export const networkMetricSamples = (network?: ClusterNetwork | null) =>
	(network?.points ?? []).map(({ t, tx, rx }) => ({
		t,
		value: tx,
		received: rx,
		measurement: networkMeasurement(tx, rx),
	}));

export const hudSamplePath = (metric: ClusterMetric, time: number) =>
	`/hud?${new URLSearchParams({ metric, sample: String(time) })}`;

export function readHudSample(
	search: URLSearchParams,
): { metric: ClusterMetric; time: number } | undefined {
	const metric = search.get("metric");
	const time = Number(search.get("sample"));
	if (
		(metric === "cpu" ||
			metric === "memory" ||
			metric === "net" ||
			metric === "disk") &&
		Number.isSafeInteger(time) &&
		time > 0
	) {
		return { metric, time };
	}
	return undefined;
}

/** Bytes per second, as the workspace's network lights show them: B/s to GB/s. */
export const formatRate = (bytesPerSecond: number): string => {
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	let value = Math.max(0, bytesPerSecond);
	let i = 0;
	while (value >= 1000 && i < units.length - 1) {
		value /= 1000;
		i++;
	}
	return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

/** The graph's slots: 15 minutes of rounds (60 at the HUD's 15 seconds). */
export const HISTORY_SLOTS = 60;

/** Rates at one recorded network sample, ordered as they are drawn in the chart. */
export const networkMeasurement = (tx: number, rx: number) =>
	`↑ TX ${formatRate(tx)} · ↓ RX ${formatRate(rx)}`;

/** Place samples by their recorded time so missed rounds remain gaps, not a permanent blank leading margin. */
export const historyX = (time: number, latest: number, every: number): number =>
	Math.max(
		0,
		Math.min(
			100 - 100 / HISTORY_SLOTS,
			100 -
				100 / HISTORY_SLOTS -
				((latest - time) / (HISTORY_SLOTS * every)) * 100,
		),
	);

/**
 * Join the measured bar tips without overshooting them. A fresh subpath after
 * a missing round leaves the gap visible.
 */
export function networkTrace(
	samples: readonly { t: number; x: number; txY: number; rxY: number }[],
	series: "txY" | "rxY",
	every: number,
) {
	return samples
		.map((sample, index) => {
			const y = sample[series];
			const previous = samples[index - 1];
			if (
				!previous ||
				sample.x <= previous.x ||
				sample.t - previous.t >= 2 * every
			) {
				return `M${sample.x},${y}`;
			}
			// Horizontal handles keep each segment between the two measured rates.
			const handle = (sample.x - previous.x) / 3;
			return `C${previous.x + handle},${previous[series]} ${sample.x - handle},${y} ${sample.x},${y}`;
		})
		.join(" ");
}

/** Timestamp window for the horizontal tracks, including the five-unit axis gutter. */
export function horizontalHistoryWindow(latest: number, every: number) {
	const span = HISTORY_SLOTS * every;
	return {
		start: latest - span + every / 2 - 0.05 * span,
		span: 1.05 * span,
	};
}
