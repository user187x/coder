import {
	makeRope,
	outsideCorner,
	pathLength,
	ropePath,
	SLACK,
	settle,
	stepRope,
} from "./ropes";

const length = (points: { x: number; y: number }[]) =>
	points
		.slice(1)
		.reduce(
			(s, p, i) => s + Math.hypot(p.x - points[i].x, p.y - points[i].y),
			0,
		);

describe("ropes", () => {
	const a = { x: 100, y: 0 };
	const b = { x: 140, y: 300 };

	it("hangs between its ends, sagging below the straight line, at its length", () => {
		const rope = settle(makeRope(a, b), a, b);
		expect(rope.points[0]).toEqual(a);
		expect(rope.points.at(-1)).toEqual(b);
		const mid = rope.points[Math.floor(rope.points.length / 2)];
		// gravity pulls the middle down past the straight line between the ends
		expect(mid.y).toBeGreaterThan((a.y + b.y) / 2);
		const want = Math.hypot(b.x - a.x, b.y - a.y) * SLACK + 24;
		expect(length(rope.points)).toBeCloseTo(want, -1);
	});

	it("follows a moved end, swings, and comes to rest", () => {
		const rope = settle(makeRope(a, b), a, b);
		const moved = { x: 140, y: 372 }; // the row moved down a row
		const first = stepRope(rope, a, moved, 1 / 60);
		expect(rope.points.at(-1)).toEqual(moved);
		let last = first;
		for (let i = 0; i < 900; i++) {
			last = stepRope(rope, a, moved, 1 / 60);
		}
		expect(last).toBeLessThan(0.05);
	});

	it("hangs round a corner and never past a wall: a cable over a table's edge", () => {
		// The Cloud Drive above the table at (100, 0); the table's top-right corner at (300, 40); a row's plug at
		// (316, 240). Below the table's top the cable keeps to the right of its edge (x >= 302).
		const from = { x: 100, y: 0 };
		const to = { x: 316, y: 240 };
		const corner = { x: 302, y: 40 };
		const length = pathLength([from, corner, to]) * 1.05;
		const constrain = outsideCorner(corner);
		const rope = settle(
			makeRope(from, to, 24, length, [corner]),
			from,
			to,
			900,
			{
				length,
				constrain,
			},
		);
		for (const p of rope.points.slice(1, -1)) {
			expect(p.y <= corner.y || p.x >= corner.x - 0.01).toBe(true);
		}
		expect(rope.points.at(-1)).toEqual(to);
		// taut, not stretched: within a few percent of its length
		expect(pathLength(rope.points)).toBeLessThan(length * 1.03);
	});

	it("draws a smooth path from end to end", () => {
		const rope = makeRope({ x: 0, y: 0 }, { x: 0, y: 90 }, 3);
		const d = ropePath(rope.points);
		expect(d.startsWith("M0,0")).toBe(true);
		expect(d.endsWith("L0,90")).toBe(true);
		expect(d).toContain(" Q");
	});
});
