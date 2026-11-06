import { cn } from "cn";
import { NetworkIcon } from "lucide-react";
import { Link } from "react-router";
import type { HudNode } from "#/api/platform";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

const HEALTH: Record<HudNode["health"], { label: string; orb: string }> = {
	ok: {
		label: "Healthy",
		orb: "bg-content-success shadow-[0_0_8px_hsl(var(--content-success))]",
	},
	warning: {
		label: "Degraded",
		orb: "bg-content-warning shadow-[0_0_8px_hsl(var(--content-warning))]",
	},
	down: {
		label: "Not ready",
		orb: "bg-content-destructive shadow-[0_0_8px_hsl(var(--content-destructive))]",
	},
};

/** How many labels and annotations the hover card lists before pointing to the details. */
const HOVER_ENTRIES = 8;

/**
 * One translucent row with an orb per node, colored by its health. Every node gets an equal share of the row, so any
 * number of nodes fits left to right; hovering shows its address and metadata, clicking opens its details.
 */
export const HudNodeStrip: React.FC<{ nodes: readonly HudNode[] }> = ({
	nodes,
}) => {
	if (nodes.length === 0) {
		return null;
	}
	return (
		<ul
			aria-label="Kubernetes nodes"
			className="m-0 flex list-none flex-nowrap items-center border-0 border-t border-solid border-border bg-surface-primary/30 px-2 py-2.5 backdrop-blur-sm"
		>
			{nodes.map((node) => (
				<li key={node.name} className="flex min-w-0 flex-1 justify-center">
					<NodeOrb node={node} />
				</li>
			))}
		</ul>
	);
};

const NodeOrb: React.FC<{ node: HudNode }> = ({ node }) => {
	const health = HEALTH[node.health];
	const metadata = [
		...Object.entries(node.labels),
		...Object.entries(node.annotations),
	];
	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={`${node.name}: ${health.label}`}
							className={cn(
								"aspect-square w-full max-w-3.5 cursor-pointer rounded-full border-0 p-0 transition-transform hover:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link",
								health.orb,
							)}
						/>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent className="max-w-sm">
					<p className="m-0 font-semibold">{node.name}</p>
					<p className="m-0 font-mono text-xs">
						{node.ip ?? "No address"} · {health.label}
					</p>
					<ul className="m-0 mt-1 list-none p-0 font-mono text-[11px] text-content-secondary">
						{metadata.slice(0, HOVER_ENTRIES).map(([key, value]) => (
							<li key={key} className="truncate">
								{key}={value}
							</li>
						))}
						{metadata.length > HOVER_ENTRIES && (
							<li>{metadata.length - HOVER_ENTRIES} more: click for details</li>
						)}
					</ul>
				</TooltipContent>
			</Tooltip>
			<PopoverContent className="w-[420px] max-w-[90vw] p-0">
				<NodeDetails node={node} />
			</PopoverContent>
		</Popover>
	);
};

const NodeDetails: React.FC<{ node: HudNode }> = ({ node }) => {
	const health = HEALTH[node.health];
	const facts: [string, string][] = [
		["Health", health.label],
		["Address", node.ip ?? "Unknown"],
		["Roles", node.roles.join(", ")],
		["Kubelet", node.kubelet ?? "Unknown"],
		[
			"Created",
			node.created ? new Date(node.created).toLocaleString("en-US") : "Unknown",
		],
		["Conditions", node.pressure.length ? node.pressure.join(", ") : "None"],
		["Scheduling", node.unschedulable ? "Cordoned" : "Schedulable"],
	];
	return (
		<div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4 text-sm">
			<div className="flex items-center gap-2">
				<span
					aria-hidden
					className={cn("size-3 shrink-0 rounded-full", health.orb)}
				/>
				<strong className="truncate">{node.name}</strong>
			</div>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{facts.map(([term, value]) => (
					<div key={term} className="contents">
						<dt className="text-content-secondary">{term}</dt>
						<dd className="m-0 break-words font-mono text-xs leading-5">
							{value}
						</dd>
					</div>
				))}
			</dl>
			<MetadataList title="Labels" entries={node.labels} />
			<MetadataList title="Annotations" entries={node.annotations} />
			<Link
				to={`/deployment/network?node=${encodeURIComponent(node.name)}`}
				className="flex items-center gap-1.5 self-start text-xs text-content-link"
			>
				<NetworkIcon className="size-3.5" />
				Open in Network
			</Link>
		</div>
	);
};

const MetadataList: React.FC<{
	title: string;
	entries: Record<string, string>;
}> = ({ title, entries }) => {
	const rows = Object.entries(entries);
	return (
		<section className="flex flex-col gap-1">
			<h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-content-secondary">
				{title}
			</h3>
			{rows.length === 0 ? (
				<p className="m-0 text-xs text-content-secondary">None</p>
			) : (
				<ul className="m-0 list-none p-0 font-mono text-[11px] leading-4">
					{rows.map(([key, value]) => (
						<li key={key} className="break-all">
							<span className="text-content-secondary">{key}</span>={value}
						</li>
					))}
				</ul>
			)}
		</section>
	);
};
