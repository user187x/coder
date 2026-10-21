import type { MeshReport } from "#/api/clusterNetwork";
import { MockMeshReport } from "#/testHelpers/clusterNetwork";
import { edgeLabel } from "./MeshCard";
import { layoutMesh, NODE_H, NODE_W, ROW_ORDER } from "./meshLayout";

type P = [number, number];

/** A drawn path as points: a line's two ends, a cubic arc sampled. */
const points = (d: string): P[] => {
	const n = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
	if (d.includes("L")) {
		return [
			[n[0], n[1]],
			[n[2], n[3]],
		];
	}
	const [x0, y0, x1, y1, x2, y2, x3, y3] = n;
	return Array.from({ length: 41 }, (_, i) => {
		const t = i / 40;
		const u = 1 - t;
		return [
			u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
			u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3,
		];
	});
};

const crosses = ([a, b]: [P, P], [c, d]: [P, P]) => {
	const o = (p: P, q: P, r: P) =>
		Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
	return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

const segments = (pts: P[]) =>
	pts.slice(1).map((p, i) => [pts[i], p] as [P, P]);

describe("layoutMesh", () => {
	const layout = layoutMesh(MockMeshReport);

	it("puts the components in one row in traffic order and the platform service under it", () => {
		const row = layout.nodes.filter((n) => n.node.id !== "platform");
		expect(row.map((n) => n.node.id)).toEqual([...ROW_ORDER]);
		expect(row.every((n) => n.y === row[0].y)).toBe(true);
		const platform = layout.nodes.find((n) => n.node.id === "platform");
		expect(platform?.y).toBeGreaterThan(row[0].y + NODE_H);
		expect(platform?.x).toBe(layout.width / 2);
	});

	it("draws every connection: arcs between components, spokes from the platform service", () => {
		expect(layout.edges).toHaveLength(MockMeshReport.edges.length);
		for (const e of layout.edges) {
			expect(e.shape).toBe(
				e.edge.from === "platform" || e.edge.to === "platform"
					? "spoke"
					: "arc",
			);
		}
	});

	it("crosses no two lines", () => {
		const drawn = layout.edges.map((e) => ({
			id: e.edge.id,
			spoke: e.shape === "spoke",
			segs: segments(points(e.d)),
		}));
		for (const a of drawn) {
			for (const b of drawn) {
				if (a.id >= b.id || (a.spoke && b.spoke)) {
					continue; // spokes share their start, and only that
				}
				const hit = a.segs.some((s) => b.segs.some((t) => crosses(s, t)));
				expect(hit, `${a.id} × ${b.id}`).toBe(false);
			}
		}
	});

	it("lets no label cover another, or a component", () => {
		const boxes = layout.edges.map((e) => {
			const w = Math.max(28, edgeLabel(e.edge).length * 6.4 + 12);
			return {
				id: e.edge.id,
				x0: e.label.x - w / 2,
				x1: e.label.x + w / 2,
				y0: e.label.y - 9,
				y1: e.label.y + 9,
			};
		});
		const nodes = layout.nodes.map((n) => ({
			id: n.node.id,
			x0: n.x - NODE_W / 2,
			x1: n.x + NODE_W / 2,
			y0: n.y - NODE_H / 2,
			y1: n.y + NODE_H / 2,
		}));
		const overlap = (a: (typeof boxes)[0], b: (typeof boxes)[0]) =>
			a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
		for (const a of boxes) {
			for (const b of [...boxes, ...nodes]) {
				if (a.id !== b.id) {
					expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
				}
			}
		}
	});

	it("closes the row up when components are missing (no code-server HA, no replicas)", () => {
		const keep = new Set([
			"gateway",
			"coder",
			"workspaces",
			"database",
			"platform",
		]);
		const small: MeshReport = {
			...MockMeshReport,
			nodes: MockMeshReport.nodes.filter((n) => keep.has(n.id)),
			edges: MockMeshReport.edges.filter(
				(e) => keep.has(e.from) && keep.has(e.to),
			),
		};
		const l = layoutMesh(small);
		expect(l.nodes.map((n) => n.node.id)).toEqual([
			"gateway",
			"coder",
			"workspaces",
			"database",
			"platform",
		]);
		expect(l.edges.map((e) => e.edge.id).sort()).toEqual(
			small.edges.map((e) => e.id).sort(),
		);
		expect(l.height).toBeLessThan(layout.height); // the longest arc spans fewer slots
	});
});

describe("edgeLabel", () => {
	it("shows a number only for a measurement, failed for a failed one and a dash for none possible", () => {
		const byId = Object.fromEntries(MockMeshReport.edges.map((e) => [e.id, e]));
		expect(edgeLabel(byId["gateway-coder"])).toBe("0.44 ms");
		expect(edgeLabel(byId["platform-replicas"])).toBe("failed");
		expect(edgeLabel(byId["workspaces-code-server"])).toBe("—");
	});
});
