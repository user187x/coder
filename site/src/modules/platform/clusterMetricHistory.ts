import type { ClusterNetwork } from "#/api/platform";
import { networkMeasurement } from "./ClusterGauge";

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
