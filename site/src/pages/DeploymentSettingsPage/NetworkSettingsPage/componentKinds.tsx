import { cn } from "cn";
import {
	ArrowLeftRightIcon,
	BoxIcon,
	CloudIcon,
	CodeXmlIcon,
	CogIcon,
	ContainerIcon,
	CopyIcon,
	DatabaseIcon,
	GaugeIcon,
	HardDriveIcon,
	KeyRoundIcon,
	LayoutDashboardIcon,
	type LucideIcon,
	MonitorIcon,
	NetworkIcon,
	ServerIcon,
	WebhookIcon,
} from "lucide-react";
import type { ComponentKind } from "#/api/clusterNetwork";

/**
 * Settings > Network: one colour per kind of pod, the same in the cluster
 * map, the mesh and the nodes view - the data-viz palette's eight
 * categorical hues, each with its own step for dark mode, and a neutral grey
 * for the rest. A kind's class sets `--kind`; the marks read it
 * (`bg-(--kind)`, `stroke-(--kind)`).
 *
 * Eight hues cannot all be told apart side by side (by everyone, or under
 * colour blindness), so colour is never the only cue: every mark carries its
 * name, the map and the nodes view group pods by kind under the kind's
 * label, and the legend names each colour.
 */
export const KIND_ORDER: readonly ComponentKind[] = [
	"gateway",
	"coder",
	"database",
	"workspace",
	"code-server",
	"replicator",
	"platform",
	"storage",
	"other",
];

type KindStyle = { label: string; plural: string; color: string };

export const KINDS: Record<ComponentKind, KindStyle> = {
	coder: {
		label: "Coder server",
		plural: "Coder servers",
		color: "[--kind:#2a78d6] dark:[--kind:#3987e5]",
	},
	database: {
		label: "Database",
		plural: "Database",
		color: "[--kind:#eb6834] dark:[--kind:#d95926]",
	},
	workspace: {
		label: "Workspace",
		plural: "Workspaces",
		color: "[--kind:#1baf7a] dark:[--kind:#199e70]",
	},
	storage: {
		label: "Cloud Drive storage",
		plural: "Cloud Drive storage",
		color: "[--kind:#eda100] dark:[--kind:#c98500]",
	},
	gateway: {
		label: "Gateway (Traefik)",
		plural: "Gateway",
		color: "[--kind:#e87ba4] dark:[--kind:#d55181]",
	},
	"code-server": {
		label: "code-server instance",
		plural: "code-server instances",
		color: "[--kind:#008300] dark:[--kind:#008300]",
	},
	platform: {
		label: "Platform service",
		plural: "Platform service",
		color: "[--kind:#6250d6] dark:[--kind:#9085e9]",
	},
	replicator: {
		label: "code-server replicator",
		plural: "code-server replicator",
		color: "[--kind:#e34948] dark:[--kind:#e66767]",
	},
	other: {
		label: "Other",
		plural: "Other",
		color: "[--kind:#898781] dark:[--kind:#898781]",
	},
};

const isKind = (k: unknown): k is ComponentKind =>
	typeof k === "string" && k in KINDS;

/** A pod's kind from its name, as the platform service guesses a Service's (an older service sends no kind). */
export const kindFromName = (name: string): ComponentKind => {
	const prefixes: [string, ComponentKind][] = [
		["coder-cs-", "code-server"],
		["coder-code-server-replicator", "replicator"],
		["coder-db", "database"],
		["coder-ui-", "platform"],
		["coder-platform-", "platform"],
		["coder-image-", "platform"],
		["coder-user-storage", "storage"],
		["traefik", "gateway"],
	];
	return prefixes.find(([p]) => name.startsWith(p))?.[1] ?? "other";
};

// What a component is by its name, where a kind holds several things (the platform service's parts, the Cloud
// Drive's, the other pods'): the first that matches.
const NAMED_ICONS: [RegExp, LucideIcon][] = [
	[/registry-proxy/, ArrowLeftRightIcon],
	[/registry/, ContainerIcon],
	[/webhook/, WebhookIcon],
	[/minio|s3/, CloudIcon],
	[/csi/, HardDriveIcon],
	[/keycloak/, KeyRoundIcon],
	[/metrics-server/, GaugeIcon],
	[/cloudnative-pg|cnpg/, CogIcon],
	[/logs-db|postgres|pgbouncer|pooler/, DatabaseIcon],
];

const KIND_ICONS: Record<ComponentKind, LucideIcon> = {
	gateway: NetworkIcon,
	coder: ServerIcon,
	database: DatabaseIcon,
	workspace: MonitorIcon,
	"code-server": CodeXmlIcon,
	replicator: CopyIcon,
	platform: LayoutDashboardIcon,
	storage: HardDriveIcon,
	other: BoxIcon,
};

/**
 * The icon that says what a component is, beside its colour mark: a database's a database, Traefik's a network, the
 * image registry's a container... - by its name where its kind holds several things, else by its kind.
 */
export const componentIcon = (kind: ComponentKind, name: string): LucideIcon =>
	NAMED_ICONS.find(([re]) => re.test(name.toLowerCase()))?.[1] ??
	KIND_ICONS[kind] ??
	BoxIcon;

/** What a pod on the map is: its kind from the service, else from its role and name. */
export const kindOf = (pod: {
	kind?: string;
	role?: string;
	name: string;
}): ComponentKind => {
	if (isKind(pod.kind)) {
		return pod.kind;
	}
	if (pod.role === "coder" || pod.role === "database") {
		return pod.role;
	}
	if (pod.role === "workspace") {
		return "workspace";
	}
	return kindFromName(pod.name);
};

/** Items grouped by kind, in the legend's order (the facets of the map and the nodes view). */
export const groupByKind = <T,>(
	items: readonly T[],
	kind: (item: T) => ComponentKind,
): [ComponentKind, T[]][] => {
	const groups = new Map<ComponentKind, T[]>();
	for (const item of items) {
		const k = kind(item);
		groups.set(k, [...(groups.get(k) ?? []), item]);
	}
	return KIND_ORDER.filter((k) => groups.has(k)).map((k) => [
		k,
		groups.get(k) ?? [],
	]);
};

/** A small square in a kind's colour. */
export const KindSwatch: React.FC<{
	kind: ComponentKind;
	className?: string;
}> = ({ kind, className }) => (
	<i
		aria-hidden
		className={cn(
			"inline-block size-2.5 shrink-0 rounded-[3px] bg-(--kind)",
			KINDS[kind].color,
			className,
		)}
	/>
);

/** The colours in use, each named. */
export const KindLegend: React.FC<{
	kinds: readonly ComponentKind[];
	className?: string;
}> = ({ kinds, className }) => (
	<ul
		aria-label="Colours by kind"
		className={cn(
			"m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-xs text-content-secondary",
			className,
		)}
	>
		{KIND_ORDER.filter((k) => kinds.includes(k)).map((k) => (
			<li
				key={k}
				className="inline-flex items-center gap-1.5"
				data-testid={`kind-legend-${k}`}
			>
				<KindSwatch kind={k} />
				{KINDS[k].label}
			</li>
		))}
	</ul>
);
