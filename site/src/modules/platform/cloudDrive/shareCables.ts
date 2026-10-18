/**
 * Where the Accounts table's Cloud Drive cables (AccountShareCables) sit: one for each Cloud Drive shared between two
 * accounts on the page, from a socket at its owner's row's right end to a plug at the right end of the row of whom it
 * is shared with - the Cloud Drive's own cables (cables.ts), between rows.
 */
import type { CloudDriveShare } from "#/api/platform";
import { cableReach, type Point } from "./cables";

/** A share drawn: its owner (the socket's row) and whom it is shared with (the plug's). */
export type ShareEdge = {
	key: string;
	owner: string;
	to: string;
	access: "read" | "write";
	label: string;
};

/** A row's right end, and its middle (px, the drawing's coordinates). */
export type ShareRow = { right: number; mid: number };

export type ShareEnds = {
	/** Each owner's socket: where it is drawn (the row's edge) and where its cables leave it. */
	sockets: Map<string, { at: Point; from: Point }>;
	/** Each share's plug (where the cable joins it), and how far right its loop reaches. */
	plugs: Map<string, { end: Point; reach: number }>;
};

/** The socket's and a plug's length (px), as the Cloud Drive's; the room between a row's edge and a plug. */
export const SOCKET = 7;
export const PLUG = 12;
export const GAP = 3;
/** How far apart a row's ends (its socket, its plugs) sit, round its middle (px). */
export const SPACING = 10;

/**
 * The shares between accounts as cables: the active ones (none while sharing is off), each once, both ends on the
 * page (`onPage`); and how many active ones have an end off the page.
 */
export const shareEdges = (
	shares: readonly CloudDriveShare[],
	onPage: ReadonlySet<string>,
): { edges: ShareEdge[]; offPage: number } => {
	const seen = new Set<string>();
	const edges: ShareEdge[] = [];
	let offPage = 0;
	for (const s of shares) {
		if (s.state !== "active" || seen.has(s.id) || s.owner === s.from) {
			continue;
		}
		seen.add(s.id);
		if (!onPage.has(s.owner) || !onPage.has(s.from)) {
			offPage++;
			continue;
		}
		edges.push({
			key: s.id,
			owner: s.owner,
			to: s.from,
			access: s.access,
			label: `${s.ownerName}'s Cloud Drive, shared with ${s.fromName} (${s.access === "write" ? "read and write" : "read only"})`,
		});
	}
	return { edges, offPage };
};

/**
 * Where every end sits. A row's ends - its socket first (when its drive is shared), then a plug for each drive shared
 * with it (their owners' rows top to bottom) - spread SPACING apart round its middle. The loops nest: the shorter a
 * cable's drop, the further in it lies (cableReach's rank).
 */
export const shareEnds = (
	edges: readonly ShareEdge[],
	rows: ReadonlyMap<string, ShareRow>,
): ShareEnds => {
	const sockets: ShareEnds["sockets"] = new Map();
	const plugs: ShareEnds["plugs"] = new Map();
	const ends = new Map<string, string[]>();
	const add = (row: string, end: string) => {
		const list = ends.get(row) ?? [];
		if (!list.includes(end)) {
			list.push(end);
		}
		ends.set(row, list);
	};
	const midOf = (id: string) => rows.get(id)?.mid ?? 0;
	const usable = edges.filter((e) => rows.has(e.owner) && rows.has(e.to));
	for (const e of usable) {
		add(e.owner, "socket");
	}
	for (const e of [...usable].sort((a, b) => midOf(a.owner) - midOf(b.owner))) {
		add(e.to, e.key);
	}
	const place = new Map<string, number>();
	for (const [row, list] of ends) {
		const sorted = [
			...list.filter((x) => x === "socket"),
			...list.filter((x) => x !== "socket"),
		];
		sorted.forEach((end, i) => {
			place.set(
				`${row}:${end}`,
				midOf(row) + (i - (sorted.length - 1) / 2) * SPACING,
			);
		});
	}
	for (const e of usable) {
		const owner = rows.get(e.owner) as ShareRow;
		if (!sockets.has(e.owner)) {
			const y = place.get(`${e.owner}:socket`) ?? owner.mid;
			sockets.set(e.owner, {
				at: { x: owner.right, y },
				from: { x: owner.right + SOCKET, y },
			});
		}
	}
	const order = [...usable].sort(
		(a, b) =>
			Math.abs(midOf(a.to) - midOf(a.owner)) -
				Math.abs(midOf(b.to) - midOf(b.owner)) ||
			Math.min(midOf(a.to), midOf(a.owner)) -
				Math.min(midOf(b.to), midOf(b.owner)),
	);
	order.forEach((e, rank) => {
		const row = rows.get(e.to) as ShareRow;
		const from = sockets.get(e.owner)?.from ?? { x: row.right, y: row.mid };
		const end = {
			x: row.right + GAP + PLUG,
			y: place.get(`${e.to}:${e.key}`) ?? row.mid,
		};
		plugs.set(e.key, { end, reach: cableReach(end.y - from.y, rank) });
	});
	return { sockets, plugs };
};

/** How far right of the table the loops reach at most (px): the room they need. */
export const loopsRoom = (ends: ShareEnds) =>
	Math.max(
		0,
		...[...ends.plugs.values()].map((p) => p.reach + GAP + PLUG + SOCKET),
	);
