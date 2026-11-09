import { InfoIcon, NetworkIcon } from "lucide-react";
import { useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { HudNode } from "#/api/platform";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
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
import { WorkspaceStateOrb } from "#/modules/workspaces/WorkspaceStatusIndicator/WorkspaceStateOrb";

const HEALTH: Record<
	HudNode["health"],
	{
		label: string;
		orb: React.ComponentProps<typeof WorkspaceStateOrb>["state"];
	}
> = {
	ok: { label: "Healthy", orb: "running" },
	warning: { label: "Degraded", orb: "warning" },
	down: { label: "Not ready", orb: "error" },
};

/** The most characters the orb's edge holds; longer names keep both ends around an ellipsis. */
const RING_CHARACTERS = 22;

/**
 * Each node's name for the edge of its orb: the prefix every node shares (k3d-coder-) dropped, and a name still too
 * long for the edge cut in the middle, where node names differ least.
 */
export const ringLabels = (names: readonly string[]) => {
	let shared = names.length > 1 ? names[0] : "";
	for (const name of names) {
		while (!name.startsWith(shared)) shared = shared.slice(0, -1);
	}
	const cut = shared.lastIndexOf("-") + 1;
	return new Map(
		names.map((name) => {
			const rest = name.slice(cut) || name;
			const label =
				rest.length <= RING_CHARACTERS
					? rest
					: `${rest.slice(0, 11)}…${rest.slice(-(RING_CHARACTERS - 12))}`;
			return [name, label];
		}),
	);
};

/** How many labels and annotations the hover card lists before pointing to the details. */
const HOVER_ENTRIES = 8;

/**
 * One translucent row with an orb per node, drawn as the workspace status orb, colored by its health. Every node gets an equal share of the row, so any
 * number of nodes fits left to right; hovering shows its address and metadata, clicking opens its details.
 */
export const HudNodeStrip: React.FC<{ nodes: readonly HudNode[] }> = ({
	nodes,
}) => {
	if (nodes.length === 0) {
		return null;
	}
	const labels = ringLabels(nodes.map((node) => node.name));
	return (
		<div className="relative">
			<ul
				aria-label="Kubernetes nodes"
				className="m-0 flex list-none flex-nowrap items-center border-0 border-t border-solid border-border bg-surface-primary/30 bg-[repeating-linear-gradient(90deg,hsl(var(--content-link)/0.08)_0_1px,transparent_1px_7px)] px-2 pt-1.5 pb-3 backdrop-blur-sm"
			>
				{nodes.map((node) => (
					<li key={node.name} className="flex min-w-0 flex-1 justify-center">
						<NodeOrb node={node} ring={labels.get(node.name) ?? node.name} />
					</li>
				))}
			</ul>
			{/* The strip's count, very small, in its bottom right corner */}
			<span
				data-testid="cluster-node-count"
				className="pointer-events-none absolute right-1.5 bottom-0.5 text-[9px] leading-none tabular-nums text-content-secondary"
			>
				Cluster Nodes {nodes.length}
			</span>
		</div>
	);
};

const NodeOrb: React.FC<{ node: HudNode; ring: string }> = ({ node, ring }) => {
	const navigate = useNavigate();
	const [details, setDetails] = useState(false);
	const health = HEALTH[node.health];
	const edge = useId();
	const metadata = [
		...Object.entries(node.labels),
		...Object.entries(node.annotations),
	];
	return (
		<>
			<ContextMenu>
				<Popover>
					<Tooltip>
						<TooltipTrigger asChild>
							<PopoverTrigger asChild>
								<ContextMenuTrigger asChild>
									<button
										type="button"
										aria-label={`${node.name}: ${health.label}`}
										className="group relative aspect-square w-full max-w-[40px] cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link"
									>
										{/* The orb, its node's name running around its edge from the top. */}
										<svg
											viewBox="0 0 28 28"
											aria-hidden
											className="block size-full overflow-visible"
										>
											<path
												id={edge}
												fill="none"
												d="M 14,24.2 a 10.2,10.2 0 1,1 0,-20.4 a 10.2,10.2 0 1,1 0,20.4"
											/>
											<text className="fill-content-secondary font-mono text-[3.2px]">
												<textPath
													href={`#${edge}`}
													startOffset="50%"
													textAnchor="middle"
												>
													{ring}
												</textPath>
											</text>
										</svg>
										<span
											aria-hidden
											className="pointer-events-none absolute inset-0 m-auto flex size-[57%] items-center justify-center transition-transform group-hover:scale-110"
										>
											<WorkspaceStateOrb state={health.orb} size="100%" />
										</span>
									</button>
								</ContextMenuTrigger>
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
									<li>
										{metadata.length - HOVER_ENTRIES} more: click for details
									</li>
								)}
							</ul>
						</TooltipContent>
					</Tooltip>
					<PopoverContent className="w-[420px] max-w-[90vw] p-0">
						<NodeDetails node={node} />
					</PopoverContent>
				</Popover>
				<ContextMenuContent aria-label={`${node.name} actions`}>
					<ContextMenuItem onSelect={() => navigate(networkHref(node))}>
						<NetworkIcon aria-hidden className="size-4" />
						View
					</ContextMenuItem>
					<ContextMenuItem onSelect={() => setDetails(true)}>
						<InfoIcon aria-hidden className="size-4" />
						Details
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<Dialog open={details} onOpenChange={setDetails}>
				<DialogContent
					overlayClassName="backdrop-blur-md"
					className="flex h-[75vh] w-[75vw] max-w-none flex-col gap-4 p-6"
				>
					<DialogTitle className="flex items-center gap-2">
						<span aria-hidden className="inline-flex shrink-0">
							<WorkspaceStateOrb state={health.orb} size="0.9rem" />
						</span>
						{node.name}
					</DialogTitle>
					<NodeDetailsFull node={node} />
				</DialogContent>
			</Dialog>
		</>
	);
};

/** The Network view, opened at a node. */
const networkHref = (node: HudNode) =>
	`/deployment/network?node=${encodeURIComponent(node.name)}`;

/** A node's details in the Details dialog: its facts, then its labels and annotations side by side, each scrolling. */
const NodeDetailsFull: React.FC<{ node: HudNode }> = ({ node }) => (
	<div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
		<section className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-solid border-border bg-surface-secondary p-4 text-sm">
			<h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-content-secondary">
				Node
			</h3>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
				{nodeFacts(node).map(([term, value]) => (
					<div key={term} className="contents">
						<dt className="text-content-secondary">{term}</dt>
						<dd className="m-0 break-words font-mono text-xs leading-5">
							{value}
						</dd>
					</div>
				))}
			</dl>
			<Link
				to={networkHref(node)}
				className="mt-auto flex items-center gap-1.5 self-start pt-2 text-xs text-content-link"
			>
				<NetworkIcon className="size-3.5" />
				Open in Network
			</Link>
		</section>
		<div className="grid min-h-0 gap-4 md:grid-cols-2">
			{(
				[
					["Labels", node.labels],
					["Annotations", node.annotations],
				] as const
			).map(([title, entries]) => (
				<section
					key={title}
					className="min-h-0 overflow-y-auto rounded-lg border border-solid border-border bg-surface-secondary p-4"
				>
					<MetadataList title={title} entries={entries} />
				</section>
			))}
		</div>
	</div>
);

/** What the details say of a node, in order. */
const nodeFacts = (node: HudNode): [string, string][] => [
	["Health", HEALTH[node.health].label],
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

const NodeDetails: React.FC<{ node: HudNode }> = ({ node }) => {
	const health = HEALTH[node.health];
	const facts = nodeFacts(node);
	return (
		<div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4 text-sm">
			<div className="flex items-center gap-2">
				<span aria-hidden className="inline-flex shrink-0">
					<WorkspaceStateOrb state={health.orb} size="0.75rem" />
				</span>
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
				to={networkHref(node)}
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
