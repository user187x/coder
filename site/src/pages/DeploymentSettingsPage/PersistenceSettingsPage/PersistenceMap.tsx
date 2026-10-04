import { cn } from "cn";
import { useLayoutEffect, useRef, useState } from "react";
import type { DatabaseInstance, PersistenceReport } from "#/api/platform";
import { Badge } from "#/components/Badge/Badge";
import {
	ago,
	bytes,
	LegendChip,
	Meter,
	Tile,
	useNow,
} from "#/modules/platform/ClusterVisuals";

/** A replica this far behind the primary (or not streaming) is drawn as lagging. */
const LAG_WARN_BYTES = 16 * 2 ** 20;

export const replicaHealthy = (i: DatabaseInstance) =>
	i.ready &&
	(i.replicationState === null || i.replicationState === "streaming") &&
	(i.lagBytes === null || i.lagBytes < LAG_WARN_BYTES);

export const replicationLabel = (i: DatabaseInstance) => {
	if (i.role === "primary") {
		return "accepts writes";
	}
	if (!i.ready) {
		return "not ready";
	}
	const lag =
		i.lagBytes === null
			? null
			: i.lagBytes === 0
				? "in sync"
				: `${bytes(i.lagBytes)} behind`;
	return (
		[i.replicationState, i.syncState, lag].filter(Boolean).join(" · ") ||
		"replicating"
	);
};

const Tiles: React.FC<{ report: PersistenceReport }> = ({ report }) => {
	const now = useNow();
	const { cluster, database, backups, instances, storageClasses, provider } =
		report.facts;
	const replicas = instances.filter((i) => i.role === "replica");
	const lags = replicas.flatMap((i) =>
		i.lagBytes === null ? [] : [i.lagBytes],
	);
	const storageClass = storageClasses.find(
		(c) =>
			c.name === cluster?.storageClass ||
			(!cluster?.storageClass && c.isDefault),
	);

	return (
		<div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
			<Tile
				label="Database size"
				value={bytes(database?.sizeBytes)}
				sub={
					database?.version
						? `PostgreSQL ${database.version}`
						: (provider ?? undefined)
				}
			/>
			<Tile
				label="Instances"
				value={
					cluster
						? `${cluster.readyInstances} / ${cluster.instances} ready`
						: "N/A"
				}
				sub={
					cluster
						? cluster.instances >= 2
							? "automatic fail-over"
							: "single instance: no fail-over"
						: provider
							? `managed by ${provider}`
							: undefined
				}
			/>
			<Tile
				label="Storage"
				value={cluster?.storageSize ? `${cluster.storageSize} each` : "N/A"}
				sub={
					storageClass
						? `${storageClass.name} · ${storageClass.label}`
						: undefined
				}
			/>
			<Tile
				label="Replication"
				value={
					!replicas.length
						? "none"
						: lags.length
							? Math.max(...lags) === 0
								? "in sync"
								: `${bytes(Math.max(...lags))} behind`
							: "streaming"
				}
				sub={
					replicas.length
						? `${replicas.filter(replicaHealthy).length} of ${replicas.length} replicas healthy`
						: undefined
				}
			/>
			<Tile
				label="Last backup"
				value={
					backups?.lastSuccess ? `${ago(backups.lastSuccess, now)} ago` : "none"
				}
				sub={
					backups?.configured
						? `${backups.method} · ${backups.schedule}`
						: "no backups scheduled"
				}
			/>
			<Tile
				label="Connections"
				value={
					database?.connections != null
						? `${database.connections} / ${database.maxConnections ?? "N/A"}`
						: "N/A"
				}
				sub={database ? "in use / allowed" : "database not readable"}
			/>
		</div>
	);
};

type LinkPath = { kind: "entry" | "ok" | "bad" | "backup"; d: string };

/**
 * Curves from Coder to the database Service, from there to the primary, from
 * the primary to each replica (streaming replication) and to the backups,
 * measured from the drawn cards.
 */
const useLinks = (
	container: React.RefObject<HTMLDivElement | null>,
	report: PersistenceReport,
) => {
	const [paths, setPaths] = useState<LinkPath[]>([]);
	const [box, setBox] = useState({ width: 0, height: 0 });

	useLayoutEffect(() => {
		const root = container.current;
		if (!root) {
			return;
		}
		const draw = () => {
			const outer = root.getBoundingClientRect();
			const side = (el: Element, edge: "left" | "right") => {
				const r = el.getBoundingClientRect();
				return [
					(edge === "right" ? r.right : r.left) - outer.left,
					r.top - outer.top + Math.min(r.height / 2, 28),
				];
			};
			const curve = (from: number[], to: number[]) => {
				const dx = Math.max(30, Math.abs(to[0] - from[0]) / 2);
				return `M${from[0]},${from[1]} C${from[0] + dx},${from[1]} ${to[0] - dx},${to[1]} ${to[0]},${to[1]}`;
			};
			const next: LinkPath[] = [];
			const coder = root.querySelector("[data-node=coder]");
			const service = root.querySelector("[data-node=service]");
			const primary = root.querySelector("[data-node=primary]");
			const backup = root.querySelector("[data-node=backup]");
			if (coder && service) {
				next.push({
					kind: "entry",
					d: curve(side(coder, "right"), side(service, "left")),
				});
			}
			if (service && primary) {
				next.push({
					kind: "ok",
					d: curve(side(service, "right"), side(primary, "left")),
				});
			}
			if (primary) {
				const [px, py] = side(primary, "left");
				for (const replica of root.querySelectorAll<HTMLElement>(
					"[data-node=replica]",
				)) {
					const [rx, ry] = side(replica, "left");
					const bulge = Math.min(px, rx) - 26;
					next.push({
						kind: replica.dataset.healthy === "true" ? "ok" : "bad",
						d: `M${px},${py} C${bulge},${py} ${bulge},${ry} ${rx},${ry}`,
					});
				}
				if (backup) {
					next.push({
						kind: "backup",
						d: curve(side(primary, "right"), side(backup, "left")),
					});
				}
			}
			setBox({ width: outer.width, height: outer.height });
			setPaths(next);
		};
		draw();
		const observer = new ResizeObserver(() => requestAnimationFrame(draw));
		observer.observe(root);
		return () => observer.disconnect();
	}, [container, report]);

	return { paths, box };
};

const LINK_CLASSES: Record<LinkPath["kind"], string> = {
	entry: "stroke-content-link/60",
	ok: "stroke-content-success/70",
	bad: "stroke-content-warning/80",
	backup: "stroke-content-secondary/70",
};

const Box: React.FC<
	{
		title: string;
		children: React.ReactNode;
		dashed?: boolean;
	} & React.ComponentProps<"div">
> = ({ title, children, dashed, className, ...attrs }) => (
	<div
		className={cn(
			"relative z-[1] grid content-start gap-1.5 rounded-lg border border-border bg-surface-primary p-3.5",
			dashed ? "border-dashed" : "border-solid",
			className,
		)}
		{...attrs}
	>
		<div className="text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
			{title}
		</div>
		{children}
	</div>
);

/** General > Persistence: tiles, then a map of how Coder's data is stored. */
export const PersistenceMap: React.FC<{ report: PersistenceReport }> = ({
	report,
}) => {
	const container = useRef<HTMLDivElement>(null);
	const { paths, box } = useLinks(container, report);
	const now = useNow();
	const {
		cluster,
		coderDatabase: db,
		instances,
		backups,
		provider,
		database,
	} = report.facts;
	return (
		<>
			<Tiles report={report} />
			<div
				ref={container}
				className="relative grid items-start gap-12 md:grid-cols-[minmax(150px,190px)_minmax(150px,200px)_minmax(0,1fr)_minmax(150px,200px)]"
			>
				<svg
					aria-hidden
					className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
					viewBox={`0 0 ${box.width} ${box.height}`}
				>
					{paths.map((path, i) => (
						<path
							key={i}
							d={path.d}
							fill="none"
							strokeWidth={2}
							strokeDasharray={
								path.kind === "bad" ||
								(path.kind === "backup" && !backups?.configured)
									? "5 5"
									: undefined
							}
							className={LINK_CLASSES[path.kind]}
						/>
					))}
				</svg>
				<Box title="Coder" data-node="coder">
					<div className="font-semibold">Coder servers</div>
					<div className="text-xs text-content-secondary">
						Connect as <code>{db.user ?? "?"}</code> to database{" "}
						<code>{db.database ?? "?"}</code>, TLS {db.sslMode ?? "default"}.
					</div>
					{db.source && (
						<div className="text-xs text-content-secondary">
							From {db.source}
						</div>
					)}
				</Box>
				<Box
					title={cluster ? "Read-write Service" : "Database"}
					data-node="service"
				>
					<div className="font-semibold [overflow-wrap:anywhere]">
						{db.host ?? "Unknown"}
					</div>
					{db.host && (
						<div className="font-mono text-xs">port {db.port ?? 5432}</div>
					)}
					<div className="text-xs text-content-secondary">
						{cluster
							? "Always points at the primary, so fail-over needs no change in Coder."
							: provider && report.mode === "external"
								? `${provider}: high availability and backups are run by the provider.`
								: "Not a CloudNativePG cluster in this Kubernetes cluster."}
					</div>
				</Box>
				<div className="grid gap-4">
					{instances.length ? (
						instances.map((instance) => (
							<InstanceCard
								key={instance.name}
								instance={instance}
								dataBytes={database?.sizeBytes ?? null}
								now={now}
							/>
						))
					) : (
						<Box title="Instances" dashed>
							<div className="text-sm text-content-secondary">
								{report.mode === "external"
									? "The database's servers are outside this Kubernetes cluster."
									: "No CloudNativePG cluster serves Coder yet. Create one below."}
							</div>
						</Box>
					)}
				</div>
				{cluster && (
					<Box title="Backups" dashed={!backups?.configured} data-node="backup">
						<div className="font-semibold">
							{backups?.configured ? backups.method : "None scheduled"}
						</div>
						<div className="text-xs text-content-secondary">
							{backups?.configured
								? `Schedule ${backups.schedule}. ${backups.count} completed; last ${backups.lastSuccess ? `${ago(backups.lastSuccess, now)} ago` : "never"}.`
								: "Replicas don't protect against deleted or corrupted data."}
						</div>
					</Box>
				)}
			</div>
			<div className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-xs text-content-secondary">
				<LegendChip className="bg-content-link" label="Primary" />
				<LegendChip className="bg-content-success" label="Replica" />
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-solid border-content-success/70" />
					Streaming replication
				</span>
				<span className="inline-flex items-center gap-1.5">
					<i className="w-5.5 border-0 border-t-2 border-dashed border-content-warning/80" />
					Replica behind or not ready
				</span>
			</div>
		</>
	);
};

type InstanceCardProps = {
	instance: DatabaseInstance;
	/** The database's size: every instance holds a full copy. */
	dataBytes: number | null;
	now: number;
};

const InstanceCard: React.FC<InstanceCardProps> = ({
	instance: i,
	dataBytes,
	now,
}) => {
	const primary = i.role === "primary";
	const healthy = primary ? i.ready : replicaHealthy(i);
	return (
		<article
			aria-label={`${primary ? "Primary" : "Replica"} ${i.name}`}
			data-node={primary ? "primary" : "replica"}
			data-healthy={String(healthy)}
			className={cn(
				"relative z-[1] grid min-w-0 gap-2.5 rounded-[10px] border border-solid bg-surface-primary px-4 py-3.5",
				"before:absolute before:top-3 before:bottom-3 before:left-0 before:w-[3px] before:rounded-sm before:content-['']",
				primary ? "before:bg-content-link" : "before:bg-content-success",
				i.ready ? "border-border" : "border-content-destructive",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-[15px] font-semibold">{i.name}</span>
				<div className="flex gap-1.5">
					<Badge size="xs" variant={primary ? "info" : "default"}>
						{primary ? "Primary" : "Replica"}
					</Badge>
					<Badge size="xs" variant={healthy ? "green" : "warning"}>
						{i.ready ? (healthy ? "Healthy" : "Lagging") : "Not ready"}
					</Badge>
				</div>
			</div>
			<div className="text-xs text-content-secondary">
				{[i.node, i.zone, i.podIP].filter(Boolean).join(" · ") || "N/A"} · up{" "}
				{ago(i.started, now)}
				{i.restarts ? ` · ${i.restarts} restarts` : ""}
			</div>
			<Meter
				label="Data"
				value={dataBytes}
				total={i.pvc?.capacityBytes ?? null}
				format={bytes}
				title={`Database ${bytes(dataBytes)} on a ${bytes(i.pvc?.capacityBytes)} volume`}
			/>
			<dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
				<dt className="text-content-secondary">Volume</dt>
				<dd className="m-0 font-mono [overflow-wrap:anywhere]">
					{i.pvc
						? `${i.pvc.name} · ${i.pvc.storageClass ?? "default class"}`
						: "N/A"}
				</dd>
				{i.walPvc && (
					<>
						<dt className="text-content-secondary">WAL volume</dt>
						<dd className="m-0 font-mono">
							{i.walPvc.name} · {bytes(i.walPvc.capacityBytes)}
						</dd>
					</>
				)}
				<dt className="text-content-secondary">Replication</dt>
				<dd className="m-0">{replicationLabel(i)}</dd>
			</dl>
		</article>
	);
};
