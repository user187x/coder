/**
 * Cables for the Cloud Drive's connections (CloudDriveRopes): each a curve
 * from a socket on the Cloud Drive's right side to a plug in a workspace row's
 * right end, leaving the one and entering the other straight from the right,
 * so it loops out to the right of both - a "⊃". Its two handles (a cubic
 * Bézier's control points) are weights on damped springs, held where the loop
 * rests. When an end moves (a row moves), its handle lags, the cable flexes,
 * swings and comes to rest. Unplugged, the plug is a weight of its own: it
 * flies to a row and latches (seat), or hangs from the socket and falls under
 * gravity, the cable never longer than it is (fall), as it reels in (reel).
 */
export type Point = { x: number; y: number };

export type Cable = {
	/** The handles: out of the socket, into the plug. */
	handles: [Point, Point];
	/** Their velocities (px a second). */
	velocity: [Point, Point];
};

/** The handles' springs (a second squared) and damping (a second): a swing or two, then still. */
export const STIFFNESS = 140;
export const DAMPING = 11;
/** How far out (px) a cable's handles reach at most, and how much further each deeper row's: they nest. */
export const REACH = 72;
export const NEST = 10;
const NEST_MAX = 8;
/** How much lower than its ends a cable's handles rest (px): it is heavy, a little. */
export const SAG = 4;
/** A falling plug's gravity (px a second squared), and the spring pulling a plug to its row (and its damping). */
export const GRAVITY = 2400;
export const SEAT_STIFFNESS = 260;
export const SEAT_DAMPING = 22;

/**
 * How far to the right of its ends a cable's handles reach: about its drop (a round loop, as wide as it is tall, for
 * the first rows), at most REACH; each deeper row's (rank) NEST further, so the loops lie one round the other.
 */
export const cableReach = (drop: number, rank: number) =>
	Math.min(Math.abs(drop) * 1.3, REACH) + Math.min(rank, NEST_MAX) * NEST;

/** Where a cable's handles rest: straight out to the right of its two ends (sagging a little out of the socket). */
export const restHandles = (
	from: Point,
	to: Point,
	reach: number,
): [Point, Point] => [
	{ x: from.x + reach, y: from.y + SAG },
	{ x: to.x + reach, y: to.y },
];

/** Where a hanging cable's handles rest: out of the socket a little, and above the plug (it hangs from the cable). */
export const hangingRest = (from: Point, plug: Point): [Point, Point] => {
	const d = Math.hypot(plug.x - from.x, plug.y - from.y);
	return [
		{ x: from.x + Math.min(28, d * 0.3), y: from.y + SAG },
		{ x: plug.x, y: plug.y - Math.min(70, d * 0.45) },
	];
};

/** A new cable, straight from end to end: its handles spring out into the loop (it falls into place). */
export const makeCable = (from: Point, to: Point): Cable => {
	const at = (t: number) => ({
		x: from.x + (to.x - from.x) * t,
		y: from.y + (to.y - from.y) * t,
	});
	return {
		handles: [at(1 / 3), at(2 / 3)],
		velocity: [
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
		],
	};
};

/** A cable at rest: its handles where they rest. */
export const restingCable = (rest: [Point, Point]): Cable => ({
	handles: [{ ...rest[0] }, { ...rest[1] }],
	velocity: [
		{ x: 0, y: 0 },
		{ x: 0, y: 0 },
	],
});

/**
 * One step of dt seconds towards its handles' rest: each pulled by its spring, slowed by its damping, and kept at
 * `minX` or right of it (no cable over the table). Returns how far a handle moved (how far from rest it is).
 */
export const stepCable = (
	cable: Cable,
	rest: [Point, Point],
	dt: number,
	minX = Number.NEGATIVE_INFINITY,
): number => {
	let moved = 0;
	for (const i of [0, 1] as const) {
		const p = cable.handles[i];
		const v = cable.velocity[i];
		v.x += (-STIFFNESS * (p.x - rest[i].x) - DAMPING * v.x) * dt;
		v.y += (-STIFFNESS * (p.y - rest[i].y) - DAMPING * v.y) * dt;
		p.x += v.x * dt;
		p.y += v.y * dt;
		if (p.x < minX) {
			p.x = minX;
			v.x = 0;
		}
		moved = Math.max(moved, Math.hypot(v.x, v.y) * dt);
	}
	return moved;
};

/** The cable at rest: stepped until it stops moving (for tests). */
export const settle = (
	cable: Cable,
	rest: [Point, Point],
	steps = 600,
	minX?: number,
) => {
	for (let i = 0; i < steps; i++) {
		if (stepCable(cable, rest, 1 / 60, minX) < 0.01 && i > 30) {
			break;
		}
	}
	return cable;
};

const f = (n: number) => Math.round(n * 10) / 10;

/**
 * The cable's SVG path: from its end at the socket (straight along the table's top to `start` first, when the Cloud
 * Drive is left of the table's corner), the curve through its handles to the plug.
 */
export const cablePath = (
	from: Point,
	cable: Cable,
	to: Point,
	start: Point = from,
): string => {
	const [a, b] = cable.handles;
	const lead =
		start.x !== from.x || start.y !== from.y
			? ` L${f(start.x)},${f(start.y)}`
			: "";
	return `M${f(from.x)},${f(from.y)}${lead} C${f(a.x)},${f(a.y)} ${f(b.x)},${f(b.y)} ${f(to.x)},${f(to.y)}`;
};

/**
 * A plug flying to its row's socket (`to`), pulled by a spring: one step of dt seconds. True when it is there and
 * still: it latches.
 */
export const seat = (end: Point, v: Point, to: Point, dt: number): boolean => {
	v.x += (-SEAT_STIFFNESS * (end.x - to.x) - SEAT_DAMPING * v.x) * dt;
	v.y += (-SEAT_STIFFNESS * (end.y - to.y) - SEAT_DAMPING * v.y) * dt;
	end.x += v.x * dt;
	end.y += v.y * dt;
	return (
		Math.hypot(end.x - to.x, end.y - to.y) < 1.5 && Math.hypot(v.x, v.y) < 40
	);
};

/**
 * A loose plug, one step of dt seconds: it falls, the cable (`length` from the socket at `from`) holding it - it
 * swings - and never left of `minX` (the table's edge). Returns how far it moved.
 */
export const fall = (
	end: Point,
	v: Point,
	from: Point,
	length: number,
	dt: number,
	minX = Number.NEGATIVE_INFINITY,
): number => {
	v.y += GRAVITY * dt;
	v.x *= 0.995;
	v.y *= 0.995;
	const before = { ...end };
	end.x += v.x * dt;
	end.y += v.y * dt;
	const dx = end.x - from.x;
	const dy = end.y - from.y;
	const d = Math.hypot(dx, dy);
	if (d > length) {
		// taut: back on the circle the cable allows, its speed along the cable gone
		const ux = dx / d;
		const uy = dy / d;
		end.x = from.x + ux * length;
		end.y = from.y + uy * length;
		const along = v.x * ux + v.y * uy;
		if (along > 0) {
			v.x -= along * ux;
			v.y -= along * uy;
		}
	}
	if (end.x < minX) {
		end.x = minX;
		v.x = Math.max(0, v.x);
	}
	return Math.hypot(end.x - before.x, end.y - before.y);
};

/** How fast a cable reels in (px a second), `t` seconds after it began: slow, then fast - a vacuum cleaner's cord. */
export const reelSpeed = (t: number) => Math.min(3200, 300 + 9000 * t * t);

/** About how long the cable from `start` through its handles to `to` is (px). */
export const cableLength = (start: Point, cable: Cable, to: Point) => {
	let length = 0;
	let last = start;
	for (let i = 1; i <= 16; i++) {
		const p = cablePoint(start, cable, to, i / 16);
		length += Math.hypot(p.x - last.x, p.y - last.y);
		last = p;
	}
	return length;
};

/** The plug's angle (radians): its prongs on along the cable's last stretch, from the second handle to the plug. */
export const plugAngle = (cable: Cable, end: Point) => {
	const h = cable.handles[1];
	const dx = end.x - h.x;
	const dy = end.y - h.y;
	return Math.hypot(dx, dy) < 0.5 ? Math.PI : Math.atan2(dy, dx);
};

/** A point along the cubic from `start` through the handles to `to` (t from 0 to 1). */
export const cablePoint = (
	start: Point,
	cable: Cable,
	to: Point,
	t: number,
): Point => {
	const [a, b] = cable.handles;
	const u = 1 - t;
	const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
	return {
		x: w[0] * start.x + w[1] * a.x + w[2] * b.x + w[3] * to.x,
		y: w[0] * start.y + w[1] * a.y + w[2] * b.y + w[3] * to.y,
	};
};
