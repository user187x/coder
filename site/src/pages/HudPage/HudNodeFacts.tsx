import type { HudNode, HudNodeResource } from "#/api/platform";
import { Badge } from "#/components/Badge/Badge";

const GIB = 1024 ** 3;

const finite = (value: number | null | undefined): value is number =>
	typeof value === "number" && Number.isFinite(value);

const amount = (resource: "cpu" | "memory", value: number) =>
	resource === "cpu"
		? `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} cores`
		: `${(value / GIB).toLocaleString("en-US", { maximumFractionDigits: 1 })} GiB`;

const share = (part: number, whole: number) =>
	whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;

/** A node's internal and external addresses, as badges (an address it lacks is left out). */
export const NodeAddressBadges: React.FC<{ node: HudNode }> = ({ node }) => {
	const internal = node.internalIP ?? node.ip;
	const external = node.externalIP;
	if (!internal && !external) {
		return <span className="text-xs text-content-secondary">No address</span>;
	}
	return (
		<span className="flex flex-wrap gap-1">
			{internal && (
				<Badge size="xs" variant="info" className="font-mono">
					Internal {internal}
				</Badge>
			)}
			{external && (
				<Badge size="xs" variant="purple" className="font-mono">
					External {external}
				</Badge>
			)}
		</span>
	);
};

/**
 * A node's CPU and memory as bars over its allocatable total: what its pods request filled in, and the live use (when
 * metrics-server reports it) as the thin line through it.
 */
export const NodeUsageBars: React.FC<{ node: HudNode }> = ({ node }) => {
	const resources = node.resources;
	if (!resources) {
		return null;
	}
	return (
		<dl className="m-0 flex flex-col gap-1.5">
			{(["cpu", "memory"] as const).map((resource) => (
				<UsageBar
					key={resource}
					resource={resource}
					value={resources[resource]}
				/>
			))}
		</dl>
	);
};

const UsageBar: React.FC<{
	resource: "cpu" | "memory";
	value: HudNodeResource;
}> = ({ resource, value }) => {
	const total = finite(value.allocatable) ? value.allocatable : 0;
	const allocated = finite(value.allocated) ? value.allocated : 0;
	const used = finite(value.used) ? value.used : null;
	const allocatedShare = share(allocated, total);
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="flex justify-between gap-3 text-[11px]">
				<span className="font-semibold">
					{resource === "cpu" ? "CPU" : "Memory"}
				</span>
				<span className="tabular-nums text-content-secondary">
					{amount(resource, allocated)} of {amount(resource, total)} allocated (
					{Math.round(allocatedShare)}%)
				</span>
			</dt>
			<dd className="m-0">
				<div
					aria-hidden
					className="relative h-2 w-full overflow-hidden rounded-full bg-surface-tertiary"
				>
					<div
						className="absolute inset-y-0 left-0 rounded-full bg-content-link/60"
						style={{ width: `${allocatedShare}%` }}
					/>
					{used !== null && (
						<div
							className="absolute top-[3px] left-0 h-0.5 rounded-full bg-content-primary"
							style={{ width: `${share(used, total)}%` }}
						/>
					)}
				</div>
				<span className="text-[10px] tabular-nums text-content-secondary">
					{used === null
						? "Live use unavailable"
						: `${amount(resource, used)} in use (${Math.round(share(used, total))}%)`}
				</span>
			</dd>
		</div>
	);
};

/** The pods running on a node, folded under their count. */
export const NodePodList: React.FC<{ node: HudNode }> = ({ node }) => {
	const pods = node.pods ?? [];
	const count = node.podCount ?? pods.length;
	return (
		<details className="group text-xs">
			<summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-content-secondary">
				Pods ({count})
			</summary>
			{pods.length === 0 ? (
				<p className="m-0 mt-1 text-content-secondary">None</p>
			) : (
				<ul
					aria-label="Pods on this node"
					className="m-0 mt-1 max-h-48 list-none overflow-y-auto p-0 font-mono text-[11px] leading-4"
				>
					{pods.map((pod) => (
						<li
							key={`${pod.namespace}/${pod.name}`}
							className="flex justify-between gap-2"
						>
							<span className="break-all">
								<span className="text-content-secondary">{pod.namespace}/</span>
								{pod.name}
							</span>
							<span className="shrink-0 text-content-secondary">
								{pod.phase ?? "Unknown"}
							</span>
						</li>
					))}
					{count > pods.length && (
						<li className="text-content-secondary">
							{count - pods.length} more
						</li>
					)}
				</ul>
			)}
		</details>
	);
};
