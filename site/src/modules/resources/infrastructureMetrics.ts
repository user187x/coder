import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import type {
	InfrastructureMetrics,
	WorkspaceInfrastructureMetrics,
} from "#/api/workspaceMetrics";
import { metricRank } from "./metadataGroups";

export type InfrastructureScope = "node" | "cluster";

/** Load has no assigned maximum; its badge shows the observed one-minute average. */
export const loadReading = (item: WorkspaceAgentMetadata) => {
	const collected = new Date(item.result.collected_at);
	if (
		item.result.error ||
		!Number.isFinite(collected.getTime()) ||
		collected.getUTCFullYear() <= 1970
	)
		return null;
	const match = item.result.value.match(/^\s*(\d+(?:\.\d+)?)/);
	if (!match) return null;
	const value = Number(match[1]);
	if (!Number.isFinite(value)) return null;
	return {
		text: value.toLocaleString("en-US", { maximumFractionDigits: 1 }),
		label: `One-minute load average: ${value}${item.result.age > Math.max(item.description.interval + item.description.timeout * 2, 5) ? " (stale)" : ""}`,
	};
};
const labels = {
	cpu: "CPU",
	memory: "RAM",
	disk: "Disk",
	load: "Ø Load",
} as const;
const number = (value: number) => Number(value.toFixed(3)).toString();

/** Adapts only actual infrastructure observations to the existing metric graphs. */
export const infrastructureMetadata = (
	metrics: InfrastructureMetrics,
	scope: InfrastructureScope,
	nodeName: string | null,
	now = Date.now(),
): WorkspaceAgentMetadata[] =>
	Object.entries(labels).map(([kind, label]) => {
		const metric =
			kind === "cpu"
				? metrics.cpu
				: kind === "memory"
					? metrics.memory
					: kind === "disk"
						? metrics.disk
						: metrics.load;
		const total =
			metric.total !== null && Number.isFinite(metric.total) && metric.total > 0
				? metric.total
				: null;
		const used =
			metric.used !== null && Number.isFinite(metric.used) && metric.used >= 0
				? metric.used
				: null;
		const factor = metric.unit === "bytes" ? 1024 ** 3 : 1;
		const unit =
			metric.unit === "bytes"
				? "GiB"
				: metric.unit === "cores" || metric.unit === "load"
					? "cores"
					: "load";
		const error =
			metric.error ?? (used === null ? "No usage observation available" : null);
		const value = `${used === null ? "Unavailable" : number(used / factor)}${total === null ? "" : ` / ${number(total / factor)} ${unit}`}${used !== null && total !== null ? ` (${number((used / total) * 100)}%)` : ""}`;
		return {
			description: {
				key: `${scope}:${scope === "node" ? (nodeName ?? "unknown") : "all"}:${kind}_host`,
				display_name: label,
				interval: 5,
				// Match the backend's 90-second observation freshness window, not its polling cadence.
				timeout: 42.5,
				script: "",
			},
			result: {
				value,
				error: error ?? "",
				collected_at: metric.collectedAt ?? "1970-01-01T00:00:00Z",
				age: metric.collectedAt
					? Math.max(0, (now - new Date(metric.collectedAt).getTime()) / 1000)
					: 0,
			},
		};
	});

/** The reported assigned maximum, kept separate from the current reading. */
export const metricCapacity = (
	value: string,
): { text: string; label: string } | null => {
	const match = value.match(/\/\s*(\d+(?:\.\d+)?)\s*([^()]*?)(?:\s*\(|$)/);
	if (!match) return null;
	const capacity = Number(match[1]);
	if (!Number.isFinite(capacity)) return null;
	const amount = capacity.toLocaleString("en-US", {
		maximumFractionDigits: 1,
	});
	const exact = capacity.toLocaleString("en-US", { maximumFractionDigits: 20 });
	const unit = match[2].trim();
	return {
		text: amount,
		label: `Assigned maximum: ${exact}${unit ? ` ${unit}` : ""}`,
	};
};

/** Compact capacity labels retain exact source quantities in their tooltip. */
export const infrastructureMaximum = (
	total: number | null,
	unit: "cores" | "bytes" | "load",
	label = "Capacity",
	kind: "cpu" | "memory" | "disk" | "load" = unit === "bytes"
		? "memory"
		: unit === "cores"
			? "cpu"
			: "load",
) => {
	if (total === null || !Number.isFinite(total) || total < 0) return null;
	let text: string;
	if (kind === "disk") {
		const scales = [
			{ size: 1e12, label: "TB" },
			{ size: 1e9, label: "GB" },
			{ size: 1e6, label: "MB" },
			{ size: 1e3, label: "KB" },
			{ size: 1, label: "B" },
		];
		const scale =
			scales.find((s) => total >= s.size) ?? scales[scales.length - 1];
		text = `${(total / scale.size).toLocaleString("en-US", { maximumFractionDigits: 1 })}${scale.label}`;
	} else if (unit === "bytes") {
		text = (total / 1024 ** 3).toLocaleString("en-US", {
			maximumFractionDigits: 1,
		});
	} else {
		text =
			total > 0 && total < 0.05
				? "<0.1"
				: total.toLocaleString("en-US", { maximumFractionDigits: 1 });
	}
	const exact =
		unit === "bytes"
			? `${(total / 1024 ** 3).toLocaleString("en-US", { maximumFractionDigits: 20 })} GiB (${total.toLocaleString("en-US")} bytes)`
			: `${total.toLocaleString("en-US", { maximumFractionDigits: 20 })} ${unit}`;
	return { text, label: `${label}: ${exact}` };
};

/** Assigned capacity comes from current VM hardware or container limits and the owned home volume. */
export const workspaceMaximum = (
	item: WorkspaceAgentMetadata,
	allocation: WorkspaceInfrastructureMetrics["allocation"],
) => {
	const rank = metricRank(item);
	if (rank === 3)
		return {
			text: "n/a",
			label:
				"No fixed assigned maximum for normalized load; load can exceed CPU capacity",
		};
	if (rank === 0)
		return infrastructureMaximum(
			allocation?.cpu ?? null,
			"cores",
			"Assigned maximum",
		);
	if (rank === 1) {
		const maximum = infrastructureMaximum(
			allocation?.memory ?? null,
			"bytes",
			allocation?.source.memory === "vm-memory"
				? "Assigned VM memory"
				: "Assigned maximum",
		);
		if (
			maximum &&
			allocation?.memoryReserved !== undefined &&
			allocation.memoryUsable !== undefined
		) {
			maximum.label += `; guest OS reserve: ${allocation.memoryReserved.toLocaleString("en-US")} bytes; workspace application maximum: ${allocation.memoryUsable.toLocaleString("en-US")} bytes`;
		}
		return maximum;
	}
	if (rank === 2)
		return infrastructureMaximum(
			allocation?.disk ?? null,
			"bytes",
			allocation?.diskEnforced === false
				? "Assigned PVC allocation (not filesystem-enforced)"
				: allocation?.diskEnforced === true
					? "Assigned maximum"
					: "Assigned PVC allocation (enforcement unverified)",
			"disk",
		);
	return metricCapacity(item.result.value);
};
