import { cn } from "cn";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { useQuery } from "react-query";
import {
	type AgentLinkDetails,
	type ClusterCondition,
	type ClusterEvent,
	type ComponentKind,
	type ContainerDetails,
	clusterEntity,
	type EntityDetails,
	type EntityRef,
	type MeshLinkDetails,
	type NodeDetails,
	type PodDetails,
	type ServiceDetails,
} from "#/api/clusterNetwork";
import { Button } from "#/components/Button/Button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "#/components/Drawer/Drawer";
import { Loader } from "#/components/Loader/Loader";
import {
	ago,
	bytes,
	Meter,
	StatusDot,
	useNow,
} from "#/modules/platform/ClusterVisuals";
import { cores, formatMs } from "./clusterFormat";
import { groupByKind, KINDS, KindSwatch } from "./componentKinds";

const OpenEntity = createContext<(ref: EntityRef) => void>(() => {});

/** Opens an entity's panel: any pod, Service, node or connection on the page. */
export const useOpenEntity = () => useContext(OpenEntity);

/**
 * Settings > Network: the panel a click on the map, the mesh or the nodes
 * view opens - one pod, Service, node or connection, read from the platform
 * service when opened and every 5 seconds while it stays open. Links inside
 * it open the next entity; Back returns to the previous one.
 */
export const EntityProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [stack, setStack] = useState<EntityRef[]>([]);
	const open = useCallback(
		(ref: EntityRef) => setStack((s) => [...s, ref].slice(-12)),
		[],
	);
	const current = stack.at(-1);

	return (
		<OpenEntity.Provider value={open}>
			{children}
			<Drawer
				open={current !== undefined}
				onOpenChange={(next) => {
					if (!next) {
						setStack([]);
					}
				}}
			>
				<DrawerContent
					className="w-full overflow-y-auto bg-surface-primary sm:max-w-xl"
					data-testid="entity-details"
				>
					{current && (
						<EntityPanel
							key={JSON.stringify(current)}
							target={current}
							onBack={
								stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : null
							}
						/>
					)}
				</DrawerContent>
			</Drawer>
		</OpenEntity.Provider>
	);
};

const TYPE_LABEL: Record<EntityRef["type"], string> = {
	pod: "Pod",
	service: "Service",
	node: "Node",
	link: "Connection",
};

const refName = (ref: EntityRef) =>
	ref.type === "link"
		? ref.id
		: ref.type === "node"
			? ref.name
			: `${ref.namespace}/${ref.name}`;

const EntityPanel: React.FC<{
	target: EntityRef;
	onBack: (() => void) | null;
}> = ({ target, onBack }) => {
	const query = useQuery(clusterEntity(target));
	const data = query.data;
	const kind: ComponentKind | null =
		data && "kind" in data && data.type !== "link" ? data.kind : null;

	return (
		<div className="flex flex-col gap-5 p-5 text-sm">
			<div className="flex items-start gap-2">
				{onBack && (
					<Button
						size="icon"
						variant="subtle"
						onClick={onBack}
						aria-label="Back"
						data-testid="entity-back"
					>
						<ArrowLeftIcon />
					</Button>
				)}
				<div className="min-w-0 flex-1">
					<DrawerDescription className="m-0 flex items-center gap-1.5 text-xs">
						{kind && <KindSwatch kind={kind} />}
						{TYPE_LABEL[target.type]}
						{kind && kind !== "other" ? ` · ${KINDS[kind].label}` : ""}
					</DrawerDescription>
					<DrawerTitle className="mt-1 break-all text-base leading-snug">
						{data?.type === "link" ? linkTitle(data) : refName(target)}
					</DrawerTitle>
				</div>
				<DrawerClose asChild>
					<Button size="icon" variant="subtle" aria-label="Close">
						<XIcon />
					</Button>
				</DrawerClose>
			</div>
			{data ? (
				<div
					className="flex flex-col gap-5"
					data-testid={`entity-details-${data.type}`}
				>
					{query.error ? (
						// The last state stays; the refresh that failed is said.
						<p role="alert" className="m-0 text-xs text-content-warning">
							Not refreshed:{" "}
							{query.error instanceof Error ? query.error.message : "error"}
						</p>
					) : null}
					<Details data={data} />
				</div>
			) : query.error ? (
				<p role="alert" className="m-0 text-content-destructive">
					{query.error instanceof Error
						? query.error.message
						: "It could not be read."}
				</p>
			) : (
				<Loader />
			)}
		</div>
	);
};

const linkTitle = (d: MeshLinkDetails | AgentLinkDetails) =>
	`${d.from.label} → ${d.to.label}`;

const Details: React.FC<{ data: EntityDetails }> = ({ data }) => {
	switch (data.type) {
		case "pod":
			return <PodPanel pod={data} />;
		case "service":
			return <ServicePanel svc={data} />;
		case "node":
			return <NodePanel node={data} />;
		case "link":
			return "agents" in data ? (
				<AgentLinkPanel link={data} />
			) : (
				<MeshLinkPanel link={data} />
			);
	}
};

// ------------------------------------------------------------------ pieces

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
	title,
	children,
}) => (
	<section className="flex flex-col gap-2">
		<h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
			{title}
		</h3>
		{children}
	</section>
);

type Fact = [string, React.ReactNode];

const Facts: React.FC<{ facts: Fact[] }> = ({ facts }) => (
	<dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
		{facts
			.filter(([, v]) => v !== null && v !== undefined && v !== "")
			.map(([k, v]) => (
				<div key={k} className="contents">
					<dt className="text-content-secondary">{k}</dt>
					<dd className="m-0 [overflow-wrap:anywhere]">{v}</dd>
				</div>
			))}
	</dl>
);

const Mono: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<span className="font-mono text-[11px]">{children}</span>
);

/** A link inside the panel to another entity. */
const EntityLink: React.FC<{
	to: EntityRef;
	kind?: ComponentKind;
	children: React.ReactNode;
}> = ({ to, kind, children }) => {
	const open = useOpenEntity();
	return (
		<button
			type="button"
			onClick={() => open(to)}
			className="inline-flex max-w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-mono text-[11px] text-content-link hover:underline"
		>
			{kind && <KindSwatch kind={kind} />}
			<span className="truncate">{children}</span>
		</button>
	);
};

const SmallTable: React.FC<{
	head: string[];
	rows: React.ReactNode[][];
	label: string;
}> = ({ head, rows, label }) => (
	<div className="overflow-x-auto">
		<table aria-label={label} className="w-full border-collapse text-xs">
			<thead>
				<tr>
					{head.map((h) => (
						<th
							key={h}
							className="border-0 border-b border-solid border-border py-1 pr-3 text-left font-medium text-content-secondary"
						>
							{h}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((r, i) => (
					<tr key={i}>
						{r.map((c, j) => (
							<td
								key={j}
								className="border-0 border-b border-solid border-border/60 py-1 pr-3 align-top"
							>
								{c}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

const Events: React.FC<{ events: ClusterEvent[] | null }> = ({ events }) => {
	const now = useNow();
	return (
		<Section title="Recent events">
			{events === null ? (
				<p className="m-0 text-xs text-content-secondary">
					Events are not readable by the platform service (its ClusterRole lacks
					events list).
				</p>
			) : events.length === 0 ? (
				<p className="m-0 text-xs text-content-secondary">
					None in the last hour or so (Kubernetes keeps events briefly).
				</p>
			) : (
				<ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-xs">
					{events.map((e, i) => (
						<li key={i} className="flex flex-col">
							<StatusDot status={e.type === "Warning" ? "warn" : "ok"}>
								<b className="font-semibold">{e.reason}</b>
								<span className="text-content-secondary">
									{e.count > 1 ? `×${e.count} · ` : ""}
									{ago(e.at, now)} ago
								</span>
							</StatusDot>
							<span className="pl-3.5 text-content-secondary [overflow-wrap:anywhere]">
								{e.message}
							</span>
						</li>
					))}
				</ul>
			)}
		</Section>
	);
};

const Conditions: React.FC<{
	conditions: ClusterCondition[];
	/** The condition types where True is good (Ready, ...); the rest: True is trouble (pressure). */
	good: (type: string) => boolean;
}> = ({ conditions, good }) => {
	const now = useNow();
	return (
		<Section title="Conditions">
			<SmallTable
				label="Conditions"
				head={["Condition", "Status", "Since", "Reason"]}
				rows={conditions.map((c) => {
					const fine = (c.status === "True") === good(c.type);
					return [
						c.type,
						<StatusDot key="s" status={fine ? "ok" : "error"}>
							{c.status}
						</StatusDot>,
						c.since ? `${ago(c.since, now)} ago` : "N/A",
						<span key="r" title={c.message}>
							{c.reason ?? ""}
						</span>,
					];
				})}
			/>
		</Section>
	);
};

const containerState = (s: ContainerDetails["state"], now: number) => {
	if (!s) {
		return "not started";
	}
	if (s.state === "running") {
		return `running for ${ago(s.since ?? null, now)}`;
	}
	if (s.state === "waiting") {
		return `waiting: ${s.reason ?? "?"}${s.message ? ` (${s.message})` : ""}`;
	}
	return `terminated: ${s.reason ?? "?"} (exit ${s.exitCode ?? "?"})${s.since ? `, ${ago(s.since, now)} ago` : ""}`;
};

const Containers: React.FC<{ title: string; list: ContainerDetails[] }> = ({
	title,
	list,
}) => {
	const now = useNow();
	if (!list.length) {
		return null;
	}
	return (
		<Section title={title}>
			<ul className="m-0 flex list-none flex-col gap-3 p-0">
				{list.map((c) => (
					<li
						key={c.name}
						className="rounded-md border border-solid border-border p-2.5 text-xs"
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<StatusDot
								status={
									c.ready
										? "ok"
										: c.state?.state === "terminated" &&
												c.state.reason === "Completed"
											? "ok"
											: c.state?.state === "running"
												? "warn"
												: "error"
								}
							>
								<b className="font-semibold">{c.name}</b>
							</StatusDot>
							<span className="text-content-secondary">
								{c.restarts} {c.restarts === 1 ? "restart" : "restarts"}
							</span>
						</div>
						<div className="mt-1 break-all font-mono text-[11px] text-content-secondary">
							{c.image}
						</div>
						<div className="mt-1">{containerState(c.state, now)}</div>
						{c.lastState && (
							<div className="text-content-secondary">
								Last: {containerState(c.lastState, now)}
							</div>
						)}
						<Facts
							facts={[
								["Ports", c.ports.join(", ")],
								[
									"Requests",
									Object.entries(c.requests)
										.map(([k, v]) => `${k} ${v}`)
										.join(", "),
								],
								[
									"Limits",
									Object.entries(c.limits)
										.map(([k, v]) => `${k} ${v}`)
										.join(", "),
								],
							]}
						/>
					</li>
				))}
			</ul>
		</Section>
	);
};

// ------------------------------------------------------------------ a pod

const PodPanel: React.FC<{ pod: PodDetails }> = ({ pod: p }) => {
	const now = useNow();
	const status = p.deleting
		? "warn"
		: p.ready
			? "ok"
			: p.phase === "Running"
				? "warn"
				: "error";
	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<StatusDot status={status}>
					{p.deleting ? "Terminating" : (p.phase ?? "Unknown")} ·{" "}
					{p.ready ? "ready" : "not ready"}
				</StatusDot>
				<span className="text-xs text-content-secondary">
					{p.restarts} {p.restarts === 1 ? "restart" : "restarts"} · up{" "}
					{ago(p.started, now)}
				</span>
				{p.role && (
					<span className="rounded border border-solid border-border px-1.5 text-xs">
						{p.role}
					</span>
				)}
			</div>
			{p.reason || p.message ? (
				<p className="m-0 text-xs text-content-warning">
					{[p.reason, p.message].filter(Boolean).join(": ")}
				</p>
			) : null}
			<Facts
				facts={[
					["Namespace", p.namespace],
					[
						"Node",
						p.node ? (
							<EntityLink to={{ type: "node", name: p.node }}>
								{p.node}
							</EntityLink>
						) : null,
					],
					["Pod IP", <Mono key="ip">{p.podIPs.join(", ") || p.podIP}</Mono>],
					["Host IP", p.hostIP ? <Mono>{p.hostIP}</Mono> : null],
					[
						"Owner",
						p.owner
							? `${p.owner.kind} ${p.owner.name}${p.owner.via ? ` (${p.owner.via})` : ""}`
							: null,
					],
					["Service account", p.serviceAccount],
					["QoS class", p.qosClass],
					["Created", p.created ? `${ago(p.created, now)} ago` : null],
					[
						"Workspace",
						p.extra.workspace
							? `${p.extra.owner ?? "?"}/${p.extra.workspace}`
							: null,
					],
					[
						"code-server relay",
						p.extra.codeServerRelay
							? `${p.extra.codeServerRelay.ready ? "ready" : "not ready"} · ${p.extra.codeServerRelay.restarts} restarts`
							: null,
					],
					[
						"code-server",
						p.extra.generation
							? `generation ${p.extra.generation} of workspace ${p.extra.workspaceId ?? "?"}${p.extra.owner ? ` (${p.extra.owner})` : ""}`
							: null,
					],
				]}
			/>
			<Section title="Resources">
				{p.usage ? (
					<>
						<Meter
							label="CPU"
							value={p.usage.cpu}
							total={p.requests.cpu || null}
							format={cores}
							title={`CPU: ${cores(p.usage.cpu)} in use, ${cores(p.requests.cpu)} requested`}
						/>
						<Meter
							label="Memory"
							value={p.usage.memory}
							total={p.requests.memory || null}
							format={bytes}
							title={`Memory: ${bytes(p.usage.memory)} in use, ${bytes(p.requests.memory)} requested`}
						/>
						<p className="m-0 text-xs text-content-secondary">
							In use against what it requests (metrics-server).
						</p>
					</>
				) : (
					<p className="m-0 text-xs text-content-secondary">
						Requests {cores(p.requests.cpu)} CPU, {bytes(p.requests.memory)}{" "}
						memory. Live usage needs metrics-server.
					</p>
				)}
			</Section>
			<Containers title="Containers" list={p.containers} />
			<Containers title="Init containers" list={p.initContainers} />
			<Conditions
				conditions={p.conditions}
				good={(t) => t !== "DisruptionTarget"}
			/>
			<Section title="Services selecting it">
				{p.services === null ? (
					<p className="m-0 text-xs text-content-secondary">
						Not readable (the platform service lacks services list).
					</p>
				) : p.services.length ? (
					<div className="flex flex-wrap gap-x-3 gap-y-1">
						{p.services.map((s) => (
							<EntityLink
								key={s}
								to={{ type: "service", namespace: p.namespace, name: s }}
							>
								{s}
							</EntityLink>
						))}
					</div>
				) : (
					<p className="m-0 text-xs text-content-secondary">None.</p>
				)}
			</Section>
			{p.volumes.length > 0 && (
				<Section title="Volumes">
					<SmallTable
						label="Volumes"
						head={["Volume", "Type", "Source"]}
						rows={p.volumes.map((v) => [
							v.name,
							v.type,
							<Mono key="s">{v.source ?? ""}</Mono>,
						])}
					/>
				</Section>
			)}
			<Events events={p.events} />
			<Labels labels={p.labels} />
		</>
	);
};

const Labels: React.FC<{ labels: Record<string, string> }> = ({ labels }) => {
	const entries = Object.entries(labels);
	if (!entries.length) {
		return null;
	}
	return (
		<Section title="Labels">
			<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
				{entries.map(([k, v]) => (
					<li key={k} className="break-all font-mono text-[11px]">
						<span className="text-content-secondary">{k}=</span>
						{v}
					</li>
				))}
			</ul>
		</Section>
	);
};

// ------------------------------------------------------------------ a Service

const ServicePanel: React.FC<{ svc: ServiceDetails }> = ({ svc: s }) => {
	const now = useNow();
	const ready = s.endpoints?.filter((e) => e.ready).length ?? 0;
	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<StatusDot
					status={
						s.endpoints === null
							? "warn"
							: ready > 0 || !Object.keys(s.selector).length
								? "ok"
								: "error"
					}
				>
					{s.endpoints === null
						? "Endpoints not readable"
						: `${ready} of ${s.endpoints.length} endpoints ready`}
				</StatusDot>
			</div>
			<Facts
				facts={[
					["Namespace", s.namespace],
					["Type", s.serviceType],
					["Cluster IP", <Mono key="c">{s.clusterIPs.join(", ")}</Mono>],
					[
						"External",
						s.external.length ? <Mono>{s.external.join(", ")}</Mono> : null,
					],
					["DNS name", <Mono key="d">{s.dns}</Mono>],
					["Session affinity", s.sessionAffinity],
					["Internal traffic", s.trafficPolicy],
					["Created", s.created ? `${ago(s.created, now)} ago` : null],
				]}
			/>
			<Section title="Ports">
				<SmallTable
					label="Ports"
					head={["Name", "Port", "Target", "Protocol", "Node port"]}
					rows={s.ports.map((p) => [
						p.name ?? "",
						p.port,
						String(p.targetPort ?? p.port),
						p.protocol,
						p.nodePort ?? "",
					])}
				/>
			</Section>
			<Section title="Selector">
				{Object.keys(s.selector).length ? (
					<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
						{Object.entries(s.selector).map(([k, v]) => (
							<li key={k} className="break-all font-mono text-[11px]">
								<span className="text-content-secondary">{k}=</span>
								{v}
							</li>
						))}
					</ul>
				) : (
					<p className="m-0 text-xs text-content-secondary">
						None: its endpoints are managed by hand or by another controller.
					</p>
				)}
			</Section>
			{s.endpoints && (
				<Section title="Endpoints">
					{s.endpoints.length ? (
						<SmallTable
							label="Endpoints"
							head={["Address", "Pod", "Node", "State"]}
							rows={s.endpoints.map((e) => [
								<Mono key="a">{e.address}</Mono>,
								e.pod ? (
									<EntityLink
										key="p"
										to={{ type: "pod", namespace: s.namespace, name: e.pod }}
									>
										{e.pod}
									</EntityLink>
								) : (
									""
								),
								e.node ?? "",
								<StatusDot
									key="s"
									status={e.terminating ? "warn" : e.ready ? "ok" : "error"}
								>
									{e.terminating
										? "terminating"
										: e.ready
											? "ready"
											: e.serving
												? "serving"
												: "not ready"}
								</StatusDot>,
							])}
						/>
					) : (
						<p className="m-0 text-xs text-content-destructive">
							No endpoints: nothing answers behind this Service.
						</p>
					)}
				</Section>
			)}
			<Events events={s.events} />
		</>
	);
};

// ------------------------------------------------------------------ a node

const NodePanel: React.FC<{ node: NodeDetails }> = ({ node: n }) => {
	const now = useNow();
	const ready = n.conditions.find((c) => c.type === "Ready");
	const pressure = n.conditions.filter(
		(c) => c.type !== "Ready" && c.status === "True",
	);
	const resources = Array.from(
		new Set([...Object.keys(n.capacity), ...Object.keys(n.allocatable)]),
	).sort();
	return (
		<>
			<div className="flex flex-wrap items-center gap-3">
				<StatusDot status={ready?.status === "True" ? "ok" : "error"}>
					{ready?.status === "True" ? "Ready" : "Not ready"}
				</StatusDot>
				{n.unschedulable && <StatusDot status="warn">Cordoned</StatusDot>}
				{pressure.map((c) => (
					<StatusDot key={c.type} status="warn">
						{c.type}
					</StatusDot>
				))}
				<span className="text-xs text-content-secondary">
					{n.podCount} pods · up {ago(n.created, now)}
				</span>
			</div>
			<Section title="In use and requested">
				<Meter
					label="CPU"
					value={n.usage?.cpu}
					requested={n.requests.cpu}
					total={n.allocatableValues.cpu}
					format={cores}
					title={`CPU: ${cores(n.requests.cpu)} requested (limits ${cores(n.limits.cpu)}), ${cores(n.usage?.cpu)} in use, ${cores(n.allocatableValues.cpu)} allocatable`}
				/>
				<Meter
					label="Memory"
					value={n.usage?.memory}
					requested={n.requests.memory}
					total={n.allocatableValues.memory}
					format={bytes}
					title={`Memory: ${bytes(n.requests.memory)} requested (limits ${bytes(n.limits.memory)}), ${bytes(n.usage?.memory)} in use, ${bytes(n.allocatableValues.memory)} allocatable`}
				/>
				<Meter
					label="Pods"
					value={n.podCount}
					total={n.allocatableValues.pods}
					format={(v) => (v == null ? "N/A" : String(Math.round(v)))}
				/>
				<p className="m-0 text-xs text-content-secondary">
					Requests {cores(n.requests.cpu)} CPU and {bytes(n.requests.memory)} of{" "}
					{cores(n.allocatableValues.cpu)} and{" "}
					{bytes(n.allocatableValues.memory)} allocatable; limits{" "}
					{cores(n.limits.cpu)} CPU, {bytes(n.limits.memory)}.
				</p>
			</Section>
			<Section title="Capacity and allocatable">
				<SmallTable
					label="Capacity and allocatable"
					head={["Resource", "Capacity", "Allocatable"]}
					rows={resources.map((r) => [
						r,
						<Mono key="c">{n.capacity[r] ?? ""}</Mono>,
						<Mono key="a">{n.allocatable[r] ?? ""}</Mono>,
					])}
				/>
			</Section>
			<Facts
				facts={[
					[
						"Addresses",
						<Mono key="a">
							{n.addresses.map((a) => `${a.address} (${a.type})`).join(", ")}
						</Mono>,
					],
					["Kubelet", n.info.kubeletVersion],
					["Runtime", n.info.containerRuntimeVersion],
					["OS", n.info.osImage],
					["Kernel", n.info.kernelVersion],
					["Architecture", n.info.architecture],
					[
						"Taints",
						n.taints.length ? <Mono>{n.taints.join(", ")}</Mono> : "None",
					],
					["Images", String(n.images)],
					["Volumes in use", String(n.volumesInUse)],
				]}
			/>
			<Section title="The platform's pods on it">
				{n.pods.length ? (
					<div className="flex flex-col gap-2">
						{groupByKind(n.pods, (p) => p.kind).map(([kind, pods]) => (
							<div key={kind} className="flex flex-col gap-0.5">
								<span className="text-[11px] text-content-secondary">
									{KINDS[kind].plural}
								</span>
								<div className="flex flex-wrap gap-x-3 gap-y-0.5">
									{pods.map((p) => (
										<EntityLink
											key={`${p.namespace}/${p.name}`}
											kind={kind}
											to={{ type: "pod", namespace: p.namespace, name: p.name }}
										>
											{p.name}
											{p.ready ? "" : " (not ready)"}
										</EntityLink>
									))}
								</div>
							</div>
						))}
					</div>
				) : (
					<p className="m-0 text-xs text-content-secondary">None.</p>
				)}
			</Section>
			<Conditions conditions={n.conditions} good={(t) => t === "Ready"} />
			<Labels labels={n.labels} />
			<Events events={n.events} />
		</>
	);
};

// ------------------------------------------------------------------ a connection

const Sparkline: React.FC<{ history: [string, number | null][] }> = ({
	history,
}) => {
	const values = history.map(([, v]) => v);
	const top = Math.max(...values.map((v) => v ?? 0), 0.001);
	const w = 280;
	const h = 48;
	const step = values.length > 1 ? w / (values.length - 1) : 0;
	const points = values
		.map((v, i) => (v == null ? null : `${i * step},${h - (v / top) * h}`))
		.filter(Boolean)
		.join(" ");
	return (
		<figure className="m-0 flex flex-col gap-1">
			<svg
				viewBox={`0 -2 ${w} ${h + 4}`}
				className="h-12 w-full max-w-[280px] overflow-visible"
				role="img"
				aria-label={`The last ${values.length} measurements, from ${formatMs(Math.min(...values.map((v) => v ?? Number.POSITIVE_INFINITY)))} to ${formatMs(top)}`}
			>
				<polyline
					points={points}
					fill="none"
					strokeWidth={2}
					strokeLinejoin="round"
					className="stroke-content-link"
				/>
				{values.map((v, i) =>
					v == null ? (
						<line
							key={i}
							x1={i * step}
							x2={i * step}
							y1={0}
							y2={h}
							strokeDasharray="2 3"
							className="stroke-content-destructive"
						/>
					) : null,
				)}
			</svg>
			<figcaption className="text-[11px] text-content-secondary">
				Last {values.length} measurements (peak {formatMs(top)})
				{values.some((v) => v == null) ? "; dashed: failed" : ""}
			</figcaption>
		</figure>
	);
};

const Samples: React.FC<{ samples: MeshLinkDetails["samples"] }> = ({
	samples,
}) =>
	samples.length ? (
		<Section title="Each target">
			<SmallTable
				label="Each target"
				head={["Target", "Latency", "How"]}
				rows={samples.map((s) => [
					<Mono key="t">{s.target}</Mono>,
					s.ms != null ? (
						formatMs(s.ms)
					) : (
						<span key="e" className="text-content-destructive">
							{s.error ?? "N/A"}
						</span>
					),
					s.method,
				])}
			/>
		</Section>
	) : null;

const MeshLinkPanel: React.FC<{ link: MeshLinkDetails }> = ({ link: l }) => {
	const now = useNow();
	return (
		<>
			<div className="flex items-center gap-2 text-xs">
				<KindSwatch kind={l.from.kind} />
				{l.from.label}
				<span aria-hidden>→</span>
				<KindSwatch kind={l.to.kind} />
				{l.to.label}
				{l.kind === "control" && (
					<span className="text-content-secondary">(control)</span>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<span
					className={cn(
						"text-[28px] font-semibold leading-none tabular-nums",
						l.ms == null && "text-content-secondary",
					)}
					data-testid="link-latency"
				>
					{l.ms != null ? formatMs(l.ms) : "No number"}
				</span>
				<span className="text-xs text-content-secondary">
					{l.ms != null
						? `Measured by ${l.measuredBy}${l.measuredAt ? `, ${ago(l.measuredAt, now)} ago` : ""}`
						: l.measuredBy
							? `Measured by ${l.measuredBy}: this time it failed`
							: "Not measurable from where the platform service runs"}
				</span>
			</div>
			<Facts
				facts={[
					["How", l.method],
					["Why no number", l.ms == null ? l.note : null],
					["Note", l.ms != null ? l.note : null],
					[
						"Error",
						l.error ? (
							<span className="text-content-destructive">{l.error}</span>
						) : null,
					],
				]}
			/>
			{l.history.some(([, v]) => v != null) && (
				<Section title="History">
					<Sparkline history={l.history} />
				</Section>
			)}
			<Samples samples={l.samples} />
		</>
	);
};

const AgentLinkPanel: React.FC<{ link: AgentLinkDetails }> = ({ link: l }) => {
	const now = useNow();
	return (
		<>
			<p className="m-0 text-xs text-content-secondary">{l.method}.</p>
			{l.agents.length ? (
				l.agents.map((a) => (
					<Section key={a.name} title={`Agent ${a.name}`}>
						<StatusDot status={a.status === "connected" ? "ok" : "warn"}>
							{a.status}
							{a.lifecycle ? ` · ${a.lifecycle}` : ""}
						</StatusDot>
						<Facts
							facts={[
								[
									"Latency",
									a.latency.length
										? a.latency
												.map(
													(r) =>
														`${r.region} ${formatMs(r.ms)}${r.preferred ? " (preferred)" : ""}`,
												)
												.join(", ")
										: "not reported",
								],
								[
									"Last connected",
									a.lastConnectedAt
										? `${ago(a.lastConnectedAt, now)} ago`
										: null,
								],
								[
									"First connected",
									a.firstConnectedAt
										? `${ago(a.firstConnectedAt, now)} ago`
										: null,
								],
								[
									"Disconnected",
									a.disconnectedAt ? `${ago(a.disconnectedAt, now)} ago` : null,
								],
								["Ready", a.readyAt ? `${ago(a.readyAt, now)} ago` : null],
								[
									"Version",
									[a.version, a.apiVersion && `API ${a.apiVersion}`]
										.filter(Boolean)
										.join(" · "),
								],
								["Platform", [a.os, a.arch].filter(Boolean).join("/")],
								[
									"Connection timeout",
									a.connectionTimeoutSeconds
										? `${a.connectionTimeoutSeconds} s`
										: null,
								],
							]}
						/>
					</Section>
				))
			) : (
				<p className="m-0 text-xs text-content-secondary">
					The workspace has no agent in its latest build.
				</p>
			)}
		</>
	);
};
