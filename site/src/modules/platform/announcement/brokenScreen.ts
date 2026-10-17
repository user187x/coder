/**
 * The geometry of a broken screen (BrokenScreenOverlay): cracks running out from an impact point to the screen's
 * edges, with branches and jagged rings around the impact, the dead pixel columns a cracked LCD panel shows, and the
 * ink that bleeds from the impact. Seeded, so a test (and every render of one break) draws the same screen.
 */
export type Point = { x: number; y: number };

export type BrokenScreen = {
	impact: Point;
	/** SVG paths: the main cracks to the edges, then their branches. */
	cracks: string[];
	/** SVG paths: the jagged rings around the impact. */
	rings: string[];
	/** Dead pixel columns: where (px), how wide, what colour. */
	lines: { x: number; width: number; color: string }[];
	/** Ink blots: centre and radius (px). */
	blots: { x: number; y: number; r: number }[];
};

/** Mulberry32: a small seeded random number generator, [0, 1). */
export const seeded = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const f = (n: number) => Math.round(n * 10) / 10;
const path = (points: Point[]) =>
	points.map((p, i) => `${i ? "L" : "M"}${f(p.x)},${f(p.y)}`).join(" ");

const LINE_COLORS = ["#ff2bd6", "#00f0ff", "#39ff14", "#ffffff", "#ffe600"];

export const breakScreen = (
	width: number,
	height: number,
	seed = Date.now(),
): BrokenScreen => {
	const rand = seeded(seed);
	const between = (a: number, b: number) => a + (b - a) * rand();
	// The blow lands somewhere around the middle of the screen.
	const impact = {
		x: width * between(0.35, 0.65),
		y: height * between(0.3, 0.6),
	};
	const inside = (p: Point) =>
		p.x >= -20 && p.x <= width + 20 && p.y >= -20 && p.y <= height + 20;
	const reach = Math.hypot(width, height);

	const cracks: string[] = [];
	const branches: string[] = [];
	const spokes: Point[][] = [];
	const count = 13 + Math.floor(rand() * 5);
	for (let k = 0; k < count; k++) {
		let angle = (2 * Math.PI * k) / count + between(-0.18, 0.18);
		const points: Point[] = [impact];
		let p = impact;
		while (inside(p) && points.length < 80) {
			const step = between(26, 70);
			angle += between(-0.22, 0.22);
			p = { x: p.x + Math.cos(angle) * step, y: p.y + Math.sin(angle) * step };
			points.push(p);
			// A branch now and then, short, off to one side.
			if (
				rand() < 0.16 &&
				Math.hypot(p.x - impact.x, p.y - impact.y) < reach * 0.6
			) {
				let b = p;
				let ba = angle + (rand() < 0.5 ? -1 : 1) * between(0.4, 0.9);
				const branch: Point[] = [b];
				for (let j = 0, n = 2 + Math.floor(rand() * 4); j < n; j++) {
					ba += between(-0.25, 0.25);
					b = {
						x: b.x + Math.cos(ba) * between(18, 46),
						y: b.y + Math.sin(ba) * between(18, 46),
					};
					branch.push(b);
				}
				branches.push(path(branch));
			}
		}
		spokes.push(points);
		cracks.push(path(points));
	}

	// Rings: from each crack to the next, at a few distances from the impact, jagged.
	const rings: string[] = [];
	for (const radius of [between(22, 34), between(52, 80), between(110, 160)]) {
		const at = spokes.map((points) => {
			let walked = 0;
			for (let i = 1; i < points.length; i++) {
				const seg = Math.hypot(
					points[i].x - points[i - 1].x,
					points[i].y - points[i - 1].y,
				);
				if (walked + seg >= radius) {
					const t = (radius - walked) / seg;
					return {
						x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
						y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
					};
				}
				walked += seg;
			}
			return points[points.length - 1];
		});
		for (let k = 0; k < at.length; k++) {
			// Not every ring segment cracks.
			if (rand() < 0.3) {
				continue;
			}
			const a = at[k];
			const b = at[(k + 1) % at.length];
			const mid = {
				x: (a.x + b.x) / 2 + between(-6, 6),
				y: (a.y + b.y) / 2 + between(-6, 6),
			};
			rings.push(path([a, mid, b]));
		}
	}

	const lines = Array.from({ length: 5 + Math.floor(rand() * 5) }, () => ({
		x: Math.round(between(0.04, 0.96) * width),
		width: rand() < 0.7 ? 1 : 2 + Math.floor(rand() * 3),
		color: LINE_COLORS[Math.floor(rand() * LINE_COLORS.length)],
	}));
	const blots = [
		{ x: impact.x, y: impact.y, r: between(90, 150) },
		{
			x: impact.x + between(-80, 80),
			y: impact.y + between(40, 140),
			r: between(40, 80),
		},
		{
			x: impact.x + between(-160, 160),
			y: impact.y + between(-120, -40),
			r: between(26, 54),
		},
	];
	return { impact, cracks: [...cracks, ...branches], rings, lines, blots };
};
