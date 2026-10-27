import type { Point } from "../cloudDrive/cables";

export type TunnelRoute = {
	points: (Point & { id: string })[];
	orthogonal: boolean;
	straight?: boolean;
};

/** Draws a cable through editable waypoints relative to its starting connector. */
export const routedTunnelPath = (
	from: Point,
	to: Point,
	route: TunnelRoute,
	reverse = false,
) => {
	if (route.straight)
		return reverse
			? `M ${to.x} ${to.y} L ${from.x} ${from.y}`
			: `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
	const points = [
		from,
		...route.points.map((p) => ({ x: from.x + p.x, y: from.y + p.y })),
		to,
	];
	if (reverse) points.reverse();
	let d = `M ${points[0].x} ${points[0].y}`;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (route.orthogonal) {
			d += reverse ? ` V ${b.y} H ${b.x}` : ` H ${b.x} V ${b.y}`;
			continue;
		}
		const before = points[Math.max(0, i - 2)];
		const after = points[Math.min(points.length - 1, i + 1)];
		d += ` C ${a.x + (b.x - before.x) / 6} ${a.y + (b.y - before.y) / 6}, ${b.x - (after.x - a.x) / 6} ${b.y - (after.y - a.y) / 6}, ${b.x} ${b.y}`;
	}
	return d;
};

const distance = (p: Point, a: Point, b: Point) => {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t = Math.max(
		0,
		Math.min(
			1,
			((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
		),
	);
	return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

/** Inserts a waypoint into the segment nearest the selected position. */
export const insertTunnelBend = (
	from: Point,
	to: Point,
	route: TunnelRoute,
	point: Point,
): TunnelRoute => {
	const anchors = [
		from,
		...route.points.map((p) => ({ x: from.x + p.x, y: from.y + p.y })),
		to,
	];
	let index = 0;
	let nearest = Number.POSITIVE_INFINITY;
	for (let i = 1; i < anchors.length; i++) {
		const a = anchors[i - 1];
		const b = anchors[i];
		const corner = { x: b.x, y: a.y };
		const d = route.orthogonal
			? Math.min(distance(point, a, corner), distance(point, corner, b))
			: distance(point, a, b);
		if (d < nearest) {
			nearest = d;
			index = i - 1;
		}
	}
	const points = [...route.points];
	points.splice(index, 0, {
		id: crypto.randomUUID(),
		x: point.x - from.x,
		y: point.y - from.y,
	});
	return { ...route, ...(route.straight ? { straight: false } : {}), points };
};
