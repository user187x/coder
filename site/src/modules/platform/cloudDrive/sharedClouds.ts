/**
 * Where the Workspaces page's clouds sit (SharedDriveClouds): one dotted cloud for each Cloud Drive shared with the
 * user, floating above their Cloud Drive button - the first over the button's own cloud glyph, the next ones to its
 * right (then left of the first, once the button has no more room) - each tethered by a short cable from its underside
 * down to a plug in a socket on the button's top edge: another drive connected to theirs.
 */
import type { CloudDrivePeers } from "#/api/platform";
import type { Point } from "./cables";
import { GAP, PLUG } from "./shareCables";

/** A cloud's size (px), and where its cable leaves it: under its middle, on its flat underside. */
export const CLOUD_W = 56;
export const CLOUD_H = 41;
export const TETHER_X = 30;
export const TETHER_Y = 38;
/** The cloud's outline (CLOUD_W x CLOUD_H; the flat underside at TETHER_Y), lucide's cloud drawn larger. */
export const CLOUD_PATH =
	"M42.75,38 H20.5 a17.5,17.5 0 1 1 16.78,-22.5 h4.47 a11.25,11.25 0 1 1 0,22.5 Z";
/** How far apart the clouds' cables are, and how far above the button the clouds' undersides float (px). */
export const CLOUD_STEP = 64;
export const CLOUD_RISE = 42;
/** The first cable's place: over the button's own cloud glyph (px from its left edge). */
export const GLYPH_X = 25;
/** How far a socket stands out of the button's top edge, and how wide it is (px). */
export const SOCKET_H = 6;
export const SOCKET_W = 10;
/** How far a cable's handles bow out to the right, as it hangs (px). */
export const BOW = 7;

/** A Cloud Drive shared with the user: its owner, and how. */
export type SharedDrive = {
	owner: string;
	ownerName: string;
	access: "read" | "write";
};

/** The Cloud Drives shared with the user now (their active shares; none while sharing is off), by owner's name. */
export const sharedDrives = (
	peers: CloudDrivePeers | undefined,
): SharedDrive[] => {
	if (!peers?.settings.enabled) {
		return [];
	}
	const byOwner = new Map<string, SharedDrive>();
	for (const s of peers.asked) {
		if (s.state === "active" && s.owner !== peers.me) {
			// two shares of one drive (asked again): the wider access
			const was = byOwner.get(s.owner);
			byOwner.set(s.owner, {
				owner: s.owner,
				ownerName: s.ownerName,
				access: was?.access === "write" ? "write" : s.access,
			});
		}
	}
	return [...byOwner.values()].sort(
		(a, b) =>
			a.ownerName.localeCompare(b.ownerName) || a.owner.localeCompare(b.owner),
	);
};

/** The button's edges (px, the drawing's coordinates). */
export type ButtonBox = { left: number; top: number; right: number };

/** A cloud's place: its top-left corner, where its cable leaves it, its socket's middle, and where the cable joins the plug. */
export type CloudSpot = {
	corner: Point;
	from: Point;
	socket: Point;
	end: Point;
};

/**
 * Where `n` clouds' cables come down on the button: CLOUD_STEP apart from over its glyph to its right end, then on to
 * the left of the first.
 */
export const cloudXs = (button: ButtonBox, n: number): number[] => {
	const room = button.right - button.left - GLYPH_X - (CLOUD_W - TETHER_X);
	const fit = Math.max(1, Math.floor(room / CLOUD_STEP) + 1);
	return Array.from(
		{ length: n },
		(_, i) =>
			button.left +
			GLYPH_X +
			(i < fit ? i * CLOUD_STEP : -(i - fit + 1) * CLOUD_STEP),
	);
};

/** The cloud whose cable comes down on the button at `x`. */
export const spotAt = (button: ButtonBox, x: number): CloudSpot => {
	const under = button.top - CLOUD_RISE;
	return {
		corner: { x: x - TETHER_X, y: under - TETHER_Y },
		// a little inside its outline, so no gap shows where the cable leaves it
		from: { x, y: under - 1 },
		socket: { x, y: button.top },
		// the plug points down into the socket: its prongs end at the button's edge
		end: { x, y: button.top - (PLUG + GAP + 4) },
	};
};

/** Where a tether's handles rest: out of the cloud with a bow, and straight down into the plug. */
export const tetherRest = (from: Point, end: Point): [Point, Point] => {
	const drop = Math.max(8, end.y - from.y);
	return [
		{ x: from.x + BOW, y: from.y + drop * 0.5 },
		{ x: end.x, y: end.y - drop * 0.5 },
	];
};
