import type { WorkspaceTunnel } from "#/api/platform";
import type { WorkspaceAgentPortShare } from "#/api/typesGenerated";

/** A workspace as Traffic Control draws it. */
export type TrafficWorkspace = {
	id: string;
	/** Its name, with its owner's in the whole-cluster view. */
	label: string;
	running: boolean;
	/** Its build is running but none of its agents is connected. */
	offline?: boolean;
	/** Its page: /@owner/name. */
	href: string;
	/** Its agents, whose listening ports are its open ports. */
	agentIds: readonly string[];
	/** Its organization, whose tunnels and connectivity tests it has. */
	organizationId: string;
};

/** A port orb: a shared port into a workspace (input), or a port a tunnel opens to its target (output). */
export type PortOrb = {
	key: string;
	kind: "input" | "output";
	/** The orb's first line: ":8080", or "all" for a tunnel open on every port. */
	port: string;
	/** Its second line: who may reach a shared port, or a tunnel port's protocol. */
	tag: string;
	/** What a pointer over it says. */
	title: string;
	/** The tunnel it belongs to (output orbs). */
	tunnelId?: string;
	/** The port share it is (input orbs). */
	share?: WorkspaceAgentPortShare;
	/** The connections the tunnel carries through it now: each one's port on the source and on the target. */
	established?: EstablishedPort[];
	/** False for a tunnel that is not carrying traffic yet (pending, failed, disconnecting). */
	ready: boolean;
};

export type TrafficColumn =
	| { key: string; kind: "workspace"; workspaces: TrafficWorkspace[] }
	| {
			key: string;
			/** input: shared ports only; output: tunnel ports only; ports: both. */
			kind: "input" | "output" | "ports";
			orbs: PortOrb[];
	  };

/** A directed link between two nodes: a workspace id, or an orb's key. */
type TrafficLink = {
	from: string;
	to: string;
	tunnelId?: string;
	ready: boolean;
};

/** One diagram: a set of workspaces joined by tunnels, or every workspace without one. */
export type TrafficTopology = {
	key: string;
	/** "a → b → c" for a chain, or "Standalone workspaces". */
	title: string;
	columns: TrafficColumn[];
	links: TrafficLink[];
	tunnels: WorkspaceTunnel[];
};

const SHARE_LEVEL_TAG: Record<string, string> = {
	owner: "owner",
	authenticated: "signed-in",
	organization: "org",
	public: "public",
};

const shareOrb = (
	workspace: TrafficWorkspace,
	share: WorkspaceAgentPortShare,
): PortOrb => ({
	key: `share:${workspace.id}:${share.agent_name}:${share.port}`,
	kind: "input",
	port: `:${share.port}`,
	tag: SHARE_LEVEL_TAG[share.share_level] ?? share.share_level,
	share,
	title: `${workspace.label} shares port ${share.port} (${share.protocol}) with ${share.share_level === "owner" ? "its owner" : share.share_level === "public" ? "everyone" : share.share_level === "organization" ? "its organization" : "signed-in users"}`,
	ready: workspace.running,
});

/** A connection a tunnel carries: its protocol and its port on each side. */
type EstablishedPort = {
	protocol: "tcp" | "udp";
	source: number;
	target: number;
};

/**
 * The connections both ends of a tunnel observe, as source and target ports: each side reports its own port as
 * local and its peer's as remote.
 */
export const establishedPorts = (
	tunnel: WorkspaceTunnel,
): EstablishedPort[] => {
	const seen = new Map<string, EstablishedPort>();
	const add = (p: EstablishedPort) =>
		seen.set(`${p.protocol}:${p.source}:${p.target}`, p);
	for (const p of tunnel.source_stats?.ports ?? []) {
		add({ protocol: p.protocol, source: p.local_port, target: p.remote_port });
	}
	for (const p of tunnel.target_stats?.ports ?? []) {
		add({ protocol: p.protocol, source: p.remote_port, target: p.local_port });
	}
	return [...seen.values()].sort(
		(a, b) => a.target - b.target || a.source - b.source,
	);
};

const describe = (established: readonly EstablishedPort[]) =>
	established.length
		? `; connected: ${established.map((e) => `${e.protocol} :${e.source} ⇄ :${e.target}`).join(", ")}`
		: "";

const tunnelOrbs = (
	tunnel: WorkspaceTunnel,
	source: TrafficWorkspace,
	target: TrafficWorkspace,
): PortOrb[] => {
	const ready = tunnel.status === "ready";
	const state = ready ? "" : ` (${tunnel.error || tunnel.status})`;
	const rules = tunnel.ports ?? [];
	const established = ready ? establishedPorts(tunnel) : [];
	// A connection belongs to the allowed port it reaches on either side.
	const through = (protocol: string, port: number) =>
		established.filter(
			(e) =>
				e.protocol === protocol && (e.target === port || e.source === port),
		);
	if (rules.length === 0) {
		return [
			{
				key: `tunnel:${tunnel.id}:all`,
				kind: "output",
				port: "all",
				tag: "tcp+udp",
				title: `${source.label} → ${target.label}: every port${state}${describe(established)}`,
				tunnelId: tunnel.id,
				ready,
				established,
			},
		];
	}
	// One orb per port the tunnel establishes: "8080:8000" where it maps the source's port to another on the target.
	return rules.map((rule) => {
		const to = rule.target_port ?? rule.port;
		const own = through(rule.protocol, to);
		return {
			key: `tunnel:${tunnel.id}:${rule.protocol}:${rule.port}`,
			kind: "output",
			port: to === rule.port ? `:${rule.port}` : `${rule.port}:${to}`,
			tag: rule.protocol,
			title: `${source.label} → ${target.label}: ${rule.protocol} port ${rule.port}${to === rule.port ? "" : ` to ${to}`}${state}${describe(own)}`,
			tunnelId: tunnel.id,
			ready,
			established: own,
		};
	});
};

/**
 * Each workspace's hop in its chain: 0 for one no tunnel reaches, else one past the furthest workspace that
 * tunnels into it. Tunnels that loop back keep the hop the first pass gave them.
 */
const hops = (
	ids: readonly string[],
	tunnels: readonly WorkspaceTunnel[],
): Map<string, number> => {
	const hop = new Map(ids.map((id) => [id, 0]));
	for (let pass = 0; pass < ids.length; pass++) {
		let changed = false;
		for (const t of tunnels) {
			const next = (hop.get(t.source_workspace_id) ?? 0) + 1;
			if (next < ids.length && next > (hop.get(t.target_workspace_id) ?? 0)) {
				hop.set(t.target_workspace_id, next);
				changed = true;
			}
		}
		if (!changed) {
			break;
		}
	}
	return hop;
};

const component = (
	key: string,
	title: string,
	members: readonly TrafficWorkspace[],
	tunnels: readonly WorkspaceTunnel[],
	shares: ReadonlyMap<string, readonly WorkspaceAgentPortShare[]>,
): TrafficTopology => {
	const byId = new Map(members.map((w) => [w.id, w]));
	const hop = hops(
		members.map((w) => w.id),
		tunnels,
	);
	const depth = Math.max(0, ...hop.values());
	const columns: TrafficColumn[] = [];
	const links: TrafficLink[] = [];
	for (let d = 0; d <= depth; d++) {
		const layer = members.filter((w) => hop.get(w.id) === d);
		if (layer.length === 0) {
			continue;
		}
		const orbs: PortOrb[] = [];
		for (const t of tunnels.filter(
			(t) => hop.get(t.target_workspace_id) === d,
		)) {
			const source = byId.get(t.source_workspace_id);
			const target = byId.get(t.target_workspace_id);
			if (!source || !target) {
				continue;
			}
			for (const orb of tunnelOrbs(t, source, target)) {
				orbs.push(orb);
				links.push({
					from: source.id,
					to: orb.key,
					tunnelId: t.id,
					ready: orb.ready,
				});
				links.push({
					from: orb.key,
					to: target.id,
					tunnelId: t.id,
					ready: orb.ready,
				});
			}
		}
		for (const w of layer) {
			for (const share of shares.get(w.id) ?? []) {
				const orb = shareOrb(w, share);
				orbs.push(orb);
				links.push({ from: orb.key, to: w.id, ready: orb.ready });
			}
		}
		if (orbs.length > 0) {
			const kinds = new Set(orbs.map((o) => o.kind));
			columns.push({
				key: `ports:${d}`,
				kind: kinds.size > 1 ? "ports" : orbs[0].kind,
				orbs,
			});
		}
		columns.push({
			key: `workspaces:${d}`,
			kind: "workspace",
			workspaces: layer,
		});
	}
	return { key, title, columns, links, tunnels: [...tunnels] };
};

/**
 * The diagrams of Traffic Control: each set of workspaces joined by tunnels, sources left of their targets with the
 * tunnel's ports between them and each workspace's shared ports before it; then one diagram of every workspace
 * without a tunnel. Tunnels with an endpoint out of view are left out.
 */
export const trafficTopologies = (
	workspaces: readonly TrafficWorkspace[],
	tunnels: readonly WorkspaceTunnel[],
	shares: ReadonlyMap<string, readonly WorkspaceAgentPortShare[]>,
): TrafficTopology[] => {
	const ids = new Set(workspaces.map((w) => w.id));
	const visible = tunnels.filter(
		(t) =>
			ids.has(t.source_workspace_id) &&
			ids.has(t.target_workspace_id) &&
			t.source_workspace_id !== t.target_workspace_id,
	);
	// Union the tunnels' endpoints into chains.
	const parent = new Map(workspaces.map((w) => [w.id, w.id]));
	const root = (id: string): string => {
		let r = id;
		while (parent.get(r) !== r) {
			r = parent.get(r) ?? r;
		}
		parent.set(id, r);
		return r;
	};
	for (const t of visible) {
		parent.set(root(t.source_workspace_id), root(t.target_workspace_id));
	}
	const chains = new Map<string, TrafficWorkspace[]>();
	const linked = new Set(
		visible.flatMap((t) => [t.source_workspace_id, t.target_workspace_id]),
	);
	for (const w of workspaces.filter((w) => linked.has(w.id))) {
		const r = root(w.id);
		chains.set(r, [...(chains.get(r) ?? []), w]);
	}
	const result: TrafficTopology[] = [...chains.entries()].map(
		([r, members]) => {
			const own = visible.filter((t) => root(t.source_workspace_id) === r);
			const order = hops(
				members.map((w) => w.id),
				own,
			);
			const title = [...members]
				.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
				.map((w) => w.label)
				.join(" → ");
			return component(`chain:${r}`, title, members, own, shares);
		},
	);
	const standalone = workspaces.filter((w) => !linked.has(w.id));
	if (standalone.length > 0) {
		result.push(
			component("standalone", "Standalone workspaces", standalone, [], shares),
		);
	}
	return result;
};

/** Bytes a second a tunnel carries now: forward (source to target) and back; null where it has no fresh reading. */
export type TunnelRate = { forward: number | null; back: number | null };

export const tunnelRate = (tunnel: WorkspaceTunnel): TunnelRate => {
	const stats = [tunnel.source_stats, tunnel.target_stats].find(
		(s) => s && !s.stale && s.series.length > 0,
	);
	const last = stats?.series.at(-1);
	if (!stats || !last) {
		return { forward: null, back: null };
	}
	// Seen from the source, what it sends goes forward; seen from the target, what it receives does.
	return stats === tunnel.source_stats
		? { forward: last.tx_bytes_per_second, back: last.rx_bytes_per_second }
		: { forward: last.rx_bytes_per_second, back: last.tx_bytes_per_second };
};
