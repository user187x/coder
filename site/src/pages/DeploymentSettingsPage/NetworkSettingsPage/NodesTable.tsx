import { cn } from "cn";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	MaximizeIcon,
	NetworkIcon,
	ServerIcon,
	XIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { useQuery } from "react-query";
import {
	type ClusterNetworkReport,
	type NodePod,
	networkNodePods,
} from "#/api/clusterNetwork";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Loader } from "#/components/Loader/Loader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import {
	ago,
	bytes,
	LiveStatus,
	StatusDot,
	useNow,
} from "#/modules/platform/ClusterVisuals";
import { cores, nodeBadgeStyle, nodeStatus } from "./clusterFormat";
import { componentIcon, KINDS, KindLegend } from "./componentKinds";
import { EntityContextMenu } from "./EntityActions";
import { EntityProvider, useOpenEntity } from "./EntityDetails";

export const NodesTable: React.FC<{ report: ClusterNetworkReport }> = ({
	report,
}) => {
	const [view, setView] = useState<"table" | "live" | null>(null);
	const [expanded, setExpanded] = useState<string[]>([]);
	const pods = useQuery({
		...networkNodePods(),
		enabled: expanded.length > 0 || view === "live",
	});
	const now = useNow();
	const toggle = (name: string) =>
		setExpanded((items) =>
			items.includes(name) ? items.filter((n) => n !== name) : [...items, name],
		);
	const table = (
		<Table aria-label="Nodes">
			<TableHeader>
				<TableRow>
					{[
						"Node",
						"Status",
						"Roles",
						"Internal IP",
						"External IP",
						"Pod CIDR",
						"CPU",
						"MEM",
						"Pods",
						"Kubelet",
						"OS / kernel",
						"Runtime",
						"Taints",
						"Age",
					].map((label) => (
						<TableHead key={label}>{label}</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{report.nodes.length === 0 && (
					<TableRow>
						<TableCell colSpan={14}>No nodes reported.</TableCell>
					</TableRow>
				)}
				{report.nodes.map((node) => {
					const [status, label] = nodeStatus(node);
					const open = expanded.includes(node.name);
					return (
						<Fragment key={node.name}>
							<EntityContextMenu target={{ type: "node", name: node.name }}>
								<TableRow
									className="cursor-pointer whitespace-nowrap"
									onClick={() => toggle(node.name)}
								>
									<TableCell>
										<button
											type="button"
											className="flex items-center gap-2 border-0 bg-transparent p-0 text-inherit"
											aria-expanded={open}
											aria-label={`Pods on ${node.name}`}
										>
											{open ? (
												<ChevronDownIcon className="size-3" />
											) : (
												<ChevronRightIcon className="size-3" />
											)}
											<ServerIcon className="size-3" />
											{node.name}
										</button>
									</TableCell>
									<TableCell>
										<StatusDot status={status}>{label}</StatusDot>
									</TableCell>
									<TableCell>{node.roles.join(", ") || "worker"}</TableCell>
									<TableCell className="font-mono text-xs">
										{(node.addresses.InternalIP ?? []).join(", ") || "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{(node.addresses.ExternalIP ?? []).join(", ") || "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{node.podCIDRs.join(", ") || "N/A"}
									</TableCell>
									<TableCell className="tabular-nums">
										{node.usage ? `${cores(node.usage.cpu)} / ` : ""}
										{cores(node.allocatable.cpu)}
									</TableCell>
									<TableCell className="tabular-nums">
										{node.usage ? `${bytes(node.usage.memory)} / ` : ""}
										{bytes(node.allocatable.memory)}
									</TableCell>
									<TableCell>
										{node.podCount} / {node.allocatable.pods ?? "N/A"}
									</TableCell>
									<TableCell className="text-xs">
										{node.kubelet ?? "N/A"}
									</TableCell>
									<TableCell>
										{node.os ?? "N/A"} · {node.kernel ?? ""}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{node.runtime ?? "N/A"}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{node.taints.join(", ") || "N/A"}
									</TableCell>
									<TableCell className="text-xs">
										{ago(node.created, now)}
									</TableCell>
								</TableRow>
							</EntityContextMenu>
							{open && (
								<TableRow>
									<TableCell colSpan={14} className="bg-surface-secondary p-3">
										{pods.error && <ErrorAlert error={pods.error} />}
										{pods.isLoading ? (
											<Loader />
										) : (
											<NodePods
												pods={
													pods.data?.pods.filter((p) => p.node === node.name) ??
													[]
												}
												node={node.name}
											/>
										)}
									</TableCell>
								</TableRow>
							)}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
	return (
		<section
			aria-labelledby="cluster-nodes"
			className="flex flex-col gap-3 rounded-lg border border-solid border-border p-6 bg-surface-primary"
		>
			<div className="flex items-center justify-between gap-3">
				<h2 id="cluster-nodes" className="m-0 text-base font-semibold">
					Nodes{" "}
					<span className="text-xs font-normal text-content-secondary">
						{report.nodes.length}
					</span>
				</h2>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="outline" onClick={() => setView("table")}>
						<MaximizeIcon />
						Table view
					</Button>
					<Button size="sm" variant="outline" onClick={() => setView("live")}>
						<NetworkIcon />
						Live view
					</Button>
				</div>
			</div>
			<p className="m-0 text-xs text-content-secondary">
				Expand a node for pods in every namespace. Right-click a node or pod for
				its actions.
				{!report.metrics && " Usage needs metrics-server. Showing requests."}
			</p>
			{view === null && <div className="overflow-x-auto">{table}</div>}
			<Dialog
				open={view !== null}
				onOpenChange={(open) => {
					if (!open) setView(null);
				}}
			>
				<DialogContent className="flex max-h-none h-[calc(calc(100dvh/var(--app-zoom,1))-4rem)] w-[calc(calc(100vw/var(--app-zoom,1))-3rem)] max-w-none! flex-col gap-4 overflow-hidden bg-surface-primary">
					<EntityProvider>
						<div className="flex shrink-0 items-center justify-between gap-4">
							<div>
								<DialogTitle>
									{view === "live" ? "Live cluster" : "Cluster nodes"}
								</DialogTitle>
								<DialogDescription>
									All {report.nodes.length} nodes. Changes refresh every five
									seconds.
								</DialogDescription>
							</div>
							<div className="flex items-center gap-2">
								{pods.data && (
									<LiveStatus paused={false} updatedAt={pods.dataUpdatedAt} />
								)}
								<Button
									size="sm"
									variant="outline"
									onClick={() => setView(view === "live" ? "table" : "live")}
								>
									{view === "live" ? <MaximizeIcon /> : <NetworkIcon />}
									{view === "live" ? "Table view" : "Live view"}
								</Button>
								<DialogClose asChild>
									<Button
										size="icon"
										variant="subtle"
										aria-label="Close cluster view"
									>
										<XIcon />
									</Button>
								</DialogClose>
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							{view === "table" ? (
								table
							) : (
								<>
									{pods.error && <ErrorAlert error={pods.error} />}
									{pods.isLoading && <Loader />}
									<KindLegend
										kinds={pods.data?.pods.map((p) => p.kind) ?? []}
									/>
									<div className="mx-auto mt-4 flex max-w-5xl flex-col gap-5">
										{report.nodes.map((node) => (
											<LiveNode
												key={node.name}
												node={node}
												members={
													pods.data?.pods.filter((p) => p.node === node.name) ??
													[]
												}
												loading={pods.isLoading}
											/>
										))}
									</div>
								</>
							)}
						</div>
					</EntityProvider>
				</DialogContent>
			</Dialog>
		</section>
	);
};

const NodePods: React.FC<{ pods: NodePod[]; node: string }> = ({
	pods,
	node,
}) => {
	const open = useOpenEntity();
	const now = useNow();
	return (
		<Table aria-label={`Pods on ${node}`}>
			<TableHeader>
				<TableRow>
					{[
						"Namespace",
						"Name",
						"Ready",
						"Status",
						"Restarts",
						"Age",
						"IP",
						"Node",
					].map((label) => (
						<TableHead key={label}>{label}</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{pods.map((pod) => (
					<EntityContextMenu
						key={pod.uid}
						target={{ type: "pod", namespace: pod.namespace, name: pod.name }}
					>
						<TableRow>
							<TableCell className="text-xs">{pod.namespace}</TableCell>
							<TableCell>
								<button
									type="button"
									onClick={() =>
										open({
											type: "pod",
											namespace: pod.namespace,
											name: pod.name,
										})
									}
									className="border-0 bg-transparent p-0 text-left text-xs text-content-link"
								>
									{pod.name}
								</button>
							</TableCell>
							<TableCell>
								{pod.readyContainers}/{pod.containers}
							</TableCell>
							<TableCell>{pod.status}</TableCell>
							<TableCell>{pod.restarts}</TableCell>
							<TableCell>{ago(pod.created, now)}</TableCell>
							<TableCell>{pod.podIP ?? "N/A"}</TableCell>
							<TableCell className="text-xs">{pod.node}</TableCell>
						</TableRow>
					</EntityContextMenu>
				))}
				{pods.length === 0 && (
					<TableRow>
						<TableCell colSpan={8}>No pods on this node.</TableCell>
					</TableRow>
				)}
			</TableBody>
		</Table>
	);
};

const LivePod: React.FC<{ pod: NodePod }> = ({ pod }) => {
	const open = useOpenEntity();
	const Icon = componentIcon(pod.kind, pod.name);
	return (
		<EntityContextMenu
			target={{ type: "pod", namespace: pod.namespace, name: pod.name }}
		>
			<button
				type="button"
				onClick={() =>
					open({ type: "pod", namespace: pod.namespace, name: pod.name })
				}
				className="flex min-w-0 items-start gap-2 rounded-lg border border-solid border-border bg-surface-primary p-3 text-left text-inherit"
			>
				<Icon
					aria-hidden
					className={cn(
						"mt-0.5 size-4 shrink-0 text-(--kind)",
						KINDS[pod.kind].color,
					)}
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-xs font-medium" title={pod.name}>
						{pod.name}
					</span>
					<span className="block truncate text-2xs text-content-secondary">
						{pod.namespace} · {pod.status} · {pod.readyContainers}/
						{pod.containers}
					</span>
				</span>
			</button>
		</EntityContextMenu>
	);
};

const LiveNode: React.FC<{
	node: ClusterNetworkReport["nodes"][number];
	members: NodePod[];
	loading: boolean;
}> = ({ node, members, loading }) => {
	const openEntity = useOpenEntity();
	const [status, label] = nodeStatus(node);
	return (
		<section
			aria-label={node.name}
			className="rounded-2xl border border-solid border-border bg-surface-secondary p-5"
		>
			<EntityContextMenu target={{ type: "node", name: node.name }}>
				<button
					type="button"
					onClick={() => openEntity({ type: "node", name: node.name })}
					className="flex w-full items-center justify-between gap-3 border-0 bg-transparent p-0 text-left text-inherit"
				>
					<span className="flex items-center gap-2">
						<ServerIcon className="size-4" />
						<span
							className="rounded-full px-3 py-1 text-sm"
							style={nodeBadgeStyle(node.name)}
						>
							{node.name}
						</span>
					</span>
					<StatusDot status={status}>{label}</StatusDot>
				</button>
			</EntityContextMenu>
			<div className="my-3 flex gap-4 text-xs text-content-secondary">
				<span>
					{members.length} {members.length === 1 ? "pod" : "pods"}
				</span>
				<span>{(node.addresses.InternalIP ?? []).join(", ")}</span>
			</div>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
				{members.map((pod) => (
					<LivePod key={pod.uid} pod={pod} />
				))}
			</div>
			{!loading && members.length === 0 && (
				<p className="text-xs text-content-secondary">No pods on this node.</p>
			)}
		</section>
	);
};
