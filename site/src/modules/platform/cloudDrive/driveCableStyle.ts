import type { ArrowMode } from "../workspaceTunnels/cableArrows";
import type { TunnelRoute } from "../workspaceTunnels/tunnelRouting";

/** How a Cloud Drive connector is drawn: the Cloud Drive's rope, or the workspace tunnels' cable. */
export type DriveCableStyle = {
	style: "rope" | "cable";
	arrows: ArrowMode;
	dashed: boolean;
	route: TunnelRoute;
};

export const DEFAULT_DRIVE_CABLE_STYLE: DriveCableStyle = {
	style: "rope",
	arrows: "none",
	dashed: false,
	route: { points: [], orthogonal: false },
};

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const valid = (value: unknown): value is DriveCableStyle =>
	record(value) &&
	(value.style === "rope" || value.style === "cable") &&
	(value.arrows === "none" ||
		value.arrows === "start" ||
		value.arrows === "end" ||
		value.arrows === "both") &&
	typeof value.dashed === "boolean" &&
	record(value.route) &&
	typeof value.route.orthogonal === "boolean" &&
	(value.route.straight === undefined ||
		typeof value.route.straight === "boolean") &&
	Array.isArray(value.route.points) &&
	value.route.points.every(
		(p) => record(p) && finite(p.x) && finite(p.y) && typeof p.id === "string",
	);

/** Browser-local connector styles keyed by stable connector ID (a share or workspace ID), like the tunnel layouts. */
export type DriveCableStyles = Record<string, DriveCableStyle>;

/** Restores valid styles; unavailable or malformed storage falls back to the default rope. */
export const readDriveCableStyles = (key: string): DriveCableStyles => {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
		if (!record(value)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(value).filter(
				(entry): entry is [string, DriveCableStyle] => valid(entry[1]),
			),
		);
	} catch {
		return {};
	}
};

/** Saves styles without making the connectors depend on storage. */
export const saveDriveCableStyles = (key: string, styles: DriveCableStyles) => {
	try {
		localStorage.setItem(key, JSON.stringify(styles));
	} catch {
		/* Storage may be disabled or full; the choice still applies to this view. */
	}
};
