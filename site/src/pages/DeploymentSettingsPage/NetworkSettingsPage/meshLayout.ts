import type {
	MeshEdge,
	MeshNode,
	MeshNodeId,
	MeshReport,
} from "#/api/clusterNetwork";

/**
 * The Mesh card's drawing: the components in one row, in the order traffic
 * flows (the way in, Coder, the workspaces, code-server, its replicator, the
 * database and its replicas, then storage and the registry), the connections
 * between them as arcs above the row, and the platform service below with its
 * own measurements as straight spokes up to what it measured. Arcs above
 * never cross spokes below; spokes from one point never cross each other; and
 * the row's order nests the arcs (a longer one spans the shorter ones, ending
 * further out on both nodes), so no two lines cross and no labels collide.
 */
export const ROW_ORDER: readonly MeshNodeId[] = [
	"gateway",
	"coder",
	"workspaces",
	"code-server",
	"replicator",
	"database",
	"replicas",
	"storage",
	"registry",
];

export const NODE_W = 104;
/** The platform service's box, wider: its name is longer, and nothing sits beside it. */
export const PLATFORM_W = 148;
export const NODE_H = 46;
const SLOT = 118;
const PAD = 16;
const LABEL_H = 18;
const SPOKE_DROP = 150;
/** Where along a spoke (from the platform service) its label sits: near the row, where spokes are far apart. */
const SPOKE_LABEL_AT = 0.7;

export type LaidNode = { node: MeshNode; x: number; y: number };

export type LaidEdge = {
	edge: MeshEdge;
	/** SVG path data. */
	d: string;
	label: { x: number; y: number };
	shape: "arc" | "spoke";
};

export type MeshLayout = {
	width: number;
	height: number;
	nodes: LaidNode[];
	edges: LaidEdge[];
};

/** How high an arc spanning this many slots rises above the row's top. */
export const arcHeight = (span: number) => 24 + 28 * (span - 1);

export const layoutMesh = (report: MeshReport): MeshLayout => {
	const byId = new Map(report.nodes.map((n) => [n.id, n]));
	const row = ROW_ORDER.filter((id) => byId.has(id));
	const index = new Map(row.map((id, i) => [id, i]));
	const platform = byId.get("platform");

	const arcs = report.edges.filter(
		(e) => index.has(e.from) && index.has(e.to) && e.from !== e.to,
	);
	const spokes = platform
		? report.edges.filter(
				(e) =>
					(e.from === "platform" && index.has(e.to)) ||
					(e.to === "platform" && index.has(e.from)),
			)
		: [];
	const span = (e: MeshEdge) =>
		Math.abs((index.get(e.from) ?? 0) - (index.get(e.to) ?? 0));
	const maxSpan = Math.max(1, ...arcs.map(span));

	const width = Math.max(row.length, 3) * SLOT + PAD * 2;
	const rowY = PAD + LABEL_H / 2 + arcHeight(maxSpan) + NODE_H / 2;
	const top = rowY - NODE_H / 2;
	const platformY = rowY + NODE_H + SPOKE_DROP;
	const height = platformY + NODE_H / 2 + PAD;
	const xOf = (i: number) =>
		PAD +
		SLOT / 2 +
		i * SLOT +
		((Math.max(row.length, 3) - row.length) * SLOT) / 2;

	const nodes: LaidNode[] = row.map((id, i) => ({
		node: byId.get(id) as MeshNode,
		x: xOf(i),
		y: rowY,
	}));
	if (platform) {
		nodes.push({ node: platform, x: width / 2, y: platformY });
	}

	// Where each arc meets its nodes: arcs leaving to the right start right of
	// the centre, arcs arriving from the left end left of it; the longest
	// closest to the centre, so that it encloses the shorter ones.
	const ends = new Map<string, { left: number; right: number }>();
	for (const id of row) {
		const i = index.get(id) as number;
		const out = arcs
			.filter(
				(e) => Math.min(index.get(e.from) ?? 0, index.get(e.to) ?? 0) === i,
			)
			.sort((a, b) => span(b) - span(a) || a.id.localeCompare(b.id));
		const inc = arcs
			.filter(
				(e) => Math.max(index.get(e.from) ?? 0, index.get(e.to) ?? 0) === i,
			)
			.sort((a, b) => span(b) - span(a) || a.id.localeCompare(b.id));
		out.forEach((e, k) => {
			ends.set(`${e.id}:${id}`, { left: 0, right: 6 + k * 10 });
		});
		inc.forEach((e, k) => {
			ends.set(`${e.id}:${id}`, { left: -(6 + k * 10), right: 0 });
		});
	}

	const edges: LaidEdge[] = arcs.map((e) => {
		const [a, b] = [e.from, e.to].sort(
			(p, q) => (index.get(p) ?? 0) - (index.get(q) ?? 0),
		);
		const x1 = xOf(index.get(a) ?? 0) + (ends.get(`${e.id}:${a}`)?.right ?? 0);
		const x2 = xOf(index.get(b) ?? 0) + (ends.get(`${e.id}:${b}`)?.left ?? 0);
		const h = arcHeight(span(e));
		// Both control points at 4/3 of the height: the curve's apex is the height.
		const c = top - (h * 4) / 3;
		return {
			edge: e,
			d: `M${x1},${top} C${x1},${c} ${x2},${c} ${x2},${top}`,
			label: { x: (x1 + x2) / 2, y: top - h },
			shape: "arc",
		};
	});

	for (const e of spokes) {
		const target = e.from === "platform" ? e.to : e.from;
		const x2 = xOf(index.get(target) ?? 0);
		const y2 = rowY + NODE_H / 2;
		const x1 = width / 2;
		const y1 = platformY - NODE_H / 2;
		edges.push({
			edge: e,
			d: `M${x1},${y1} L${x2},${y2}`,
			label: {
				x: x1 + (x2 - x1) * SPOKE_LABEL_AT,
				y: y1 + (y2 - y1) * SPOKE_LABEL_AT,
			},
			shape: "spoke",
		});
	}

	return { width, height, nodes, edges };
};
