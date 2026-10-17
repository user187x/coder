/**
 * Ropes for the Cloud Drive's connections (CloudDriveRopes): each a chain of
 * points stepped by Verlet integration under gravity, its two ends pinned
 * (the Cloud Drive, a workspace's row), its links kept to their length. When
 * an end moves (a row moves), the rope follows it, swings and comes to rest.
 */
export type Point = { x: number; y: number };

export type Rope = {
	/** The chain, ends included: [0] at the Cloud Drive, [n - 1] at the workspace. */
	points: Point[];
	/** Where each point was a step ago (its velocity, Verlet-style). */
	previous: Point[];
	/** Each link's length. */
	link: number;
};

/** How much longer than the distance between its ends a rope is: it sags. */
export const SLACK = 1.12;
/** Pixels a second squared. */
export const GRAVITY = 2200;
const DAMPING = 0.985;
const ITERATIONS = 14;

const ropeLength = (a: Point, b: Point) =>
	Math.hypot(b.x - a.x, b.y - a.y) * SLACK + 24;

/** What a rope is held to, beside its ends. */
export type RopeOptions = {
	/** Its whole length (default: the distance between its ends, with SLACK). */
	length?: number;
	/** Moves a point back where it may be (a wall it cannot pass); called on every inner point after each pull. */
	constrain?: (p: Point) => void;
};

/**
 * A box a rope may not enter (a table, to the left of and below its top-right corner): a point inside is moved to the
 * nearer of its edges - up onto its top, or out past its right side - so a rope wraps round the corner.
 */
export const outsideCorner =
	(corner: Point) =>
	(p: Point): void => {
		if (p.x >= corner.x || p.y <= corner.y) {
			return;
		}
		if (p.y - corner.y < corner.x - p.x) {
			p.y = corner.y;
		} else {
			p.x = corner.x;
		}
	};

/** A polyline's length. */
export const pathLength = (points: Point[]) =>
	points.reduce(
		(sum, p, i) =>
			i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0,
		0,
	);

/** A point at distance d along a polyline. */
const along = (points: Point[], d: number): Point => {
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const seg = Math.hypot(b.x - a.x, b.y - a.y);
		if (d <= seg || i === points.length - 1) {
			const t = seg ? Math.min(1, d / seg) : 0;
			return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
		}
		d -= seg;
	}
	return { ...points[points.length - 1] };
};

/**
 * A rope hanging between two points, straight to begin with (it falls into its curve) - or laid along a path
 * through `via` (round a corner) - of `length` (default: the distance between its ends, with SLACK).
 */
export const makeRope = (
	a: Point,
	b: Point,
	segments = 18,
	length?: number,
	via: Point[] = [],
): Rope => {
	const path = [a, ...via, b];
	const total = pathLength(path);
	const points = Array.from({ length: segments + 1 }, (_, i) =>
		along(path, (total * i) / segments),
	);
	return {
		points,
		previous: points.map((p) => ({ ...p })),
		link: (length ?? ropeLength(a, b)) / segments,
	};
};

/**
 * One step of dt seconds with its ends at a and b: the inner points move on by
 * their velocity and gravity, then every link is pulled back to its length.
 * Returns the largest distance a point moved (how far from rest it is).
 */
export const stepRope = (
	rope: Rope,
	a: Point,
	b: Point,
	dt: number,
	options: RopeOptions = {},
): number => {
	const { points, previous } = rope;
	const n = points.length;
	// a moved end lengthens or shortens the rope with it
	rope.link = (options.length ?? ropeLength(a, b)) / (n - 1);
	let moved = 0;
	for (let i = 1; i < n - 1; i++) {
		const p = points[i];
		const vx = (p.x - previous[i].x) * DAMPING;
		const vy = (p.y - previous[i].y) * DAMPING;
		previous[i] = { x: p.x, y: p.y };
		p.x += vx;
		p.y += vy + GRAVITY * dt * dt;
		moved = Math.max(moved, Math.hypot(vx, vy));
	}
	points[0] = { ...a };
	points[n - 1] = { ...b };
	previous[0] = { ...a };
	previous[n - 1] = { ...b };
	for (let k = 0; k < ITERATIONS; k++) {
		for (let i = 0; i < n - 1; i++) {
			const p = points[i];
			const q = points[i + 1];
			const dx = q.x - p.x;
			const dy = q.y - p.y;
			const d = Math.hypot(dx, dy) || 1e-6;
			const diff = (d - rope.link) / d;
			// pinned ends do not move; an inner point takes its share
			const wp = i === 0 ? 0 : i + 1 === n - 1 ? 1 : 0.5;
			const wq = i + 1 === n - 1 ? 0 : i === 0 ? 1 : 0.5;
			p.x += dx * diff * wp;
			p.y += dy * diff * wp;
			q.x -= dx * diff * wq;
			q.y -= dy * diff * wq;
		}
		if (options.constrain) {
			for (let i = 1; i < n - 1; i++) {
				options.constrain(points[i]);
			}
		}
	}
	return moved;
};

/** The rope at rest: stepped until it stops moving (for reduced motion, and tests). */
export const settle = (
	rope: Rope,
	a: Point,
	b: Point,
	steps = 600,
	options: RopeOptions = {},
) => {
	for (let i = 0; i < steps; i++) {
		if (stepRope(rope, a, b, 1 / 60, options) < 0.01 && i > 30) {
			break;
		}
	}
	return rope;
};

/** An SVG path through the points, smoothed (quadratic curves through the midpoints). */
export const ropePath = (points: Point[]): string => {
	if (points.length < 2) {
		return "";
	}
	const f = (n: number) => Math.round(n * 10) / 10;
	let d = `M${f(points[0].x)},${f(points[0].y)}`;
	for (let i = 1; i < points.length - 1; i++) {
		const mx = (points[i].x + points[i + 1].x) / 2;
		const my = (points[i].y + points[i + 1].y) / 2;
		d += ` Q${f(points[i].x)},${f(points[i].y)} ${f(mx)},${f(my)}`;
	}
	const last = points[points.length - 1];
	return `${d} L${f(last.x)},${f(last.y)}`;
};
