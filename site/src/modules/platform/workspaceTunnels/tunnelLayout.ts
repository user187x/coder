import type { Point } from "../cloudDrive/cables";
import type { TunnelRoute } from "./tunnelRouting";

/** Browser-local visual layouts, indexed by stable tunnel IDs. */
export type TunnelLayout = {
	routes: Record<string, TunnelRoute>;
	heads: Record<string, Point>;
	arcs: Record<string, number>;
	stubs: Record<string, { length: number; bend: number }>;
};
const empty = (): TunnelLayout => ({
	routes: {},
	heads: {},
	arcs: {},
	stubs: {},
});
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);
const point = (value: unknown): value is Point =>
	record(value) && finite(value.x) && finite(value.y);
const valid = (value: unknown): value is TunnelLayout =>
	record(value) &&
	record(value.routes) &&
	Object.values(value.routes).every(
		(route) =>
			record(route) &&
			typeof route.orthogonal === "boolean" &&
			Array.isArray(route.points) &&
			route.points.every(
				(p) => point(p) && "id" in p && typeof p.id === "string",
			),
	) &&
	record(value.heads) &&
	Object.values(value.heads).every(point) &&
	record(value.arcs) &&
	Object.values(value.arcs).every(finite) &&
	record(value.stubs) &&
	Object.values(value.stubs).every(
		(stub) => record(stub) && finite(stub.length) && finite(stub.bend),
	);

/** Restores valid layouts; unavailable or malformed storage falls back to defaults. */
export const readTunnelLayout = (key: string): TunnelLayout => {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
		return valid(value) ? value : empty();
	} catch {
		return empty();
	}
};

/** Saves routing preferences without making connection availability depend on storage. */
export const saveTunnelLayout = (key: string, layout: TunnelLayout) => {
	try {
		localStorage.setItem(key, JSON.stringify(layout));
	} catch {
		/* Storage may be disabled or full; editing remains available for this view. */
	}
};
