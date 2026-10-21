/**
 * What other users share with the signed-in user: each active share - an entire Cloud Drive, or a folder or a file of
 * one (the Cloud Drive window's drives, CloudDriveBrowser); a card for each owner's (the Cloud Drive's leading cloud,
 * SharedWithYou); and the room the entire drives shared read and write add to the user's own (its capacity bar). And
 * the other way round: whom the user's own is shared with (that leading cloud's dotted outline).
 */
import type {
	CloudDrivePeers,
	CloudDriveShare,
	SafeSummary,
} from "#/api/platform";

/** A share of another user's Cloud Drive with the user, active now. */
export type IncomingShare = Pick<
	CloudDriveShare,
	"id" | "owner" | "ownerName" | "access" | "kind" | "path"
>;

/** The active shares with the user (none while sharing is off): by owner, their entire drive first, then by path. */
export const incomingShares = (
	peers: CloudDrivePeers | undefined,
): IncomingShare[] => {
	if (!peers?.settings.enabled) {
		return [];
	}
	return peers.asked
		.filter((s) => s.state === "active" && s.owner !== peers.me)
		.map(({ id, owner, ownerName, access, kind, path }) => ({
			id,
			owner,
			ownerName,
			access,
			kind: kind ?? "drive",
			path: path ?? "",
		}))
		.sort(
			(a, b) =>
				a.ownerName.localeCompare(b.ownerName) ||
				Number(a.kind !== "drive") - Number(b.kind !== "drive") ||
				a.path.localeCompare(b.path),
		);
};

/** The last part of a path: a shared folder's or file's name. */
export const baseName = (path: string) =>
	path.slice(path.lastIndexOf("/") + 1) || path;

/** What a share is of: "their entire Cloud Drive", "the folder docs", "the file plan.md". */
export const shareWhat = (s: Pick<IncomingShare, "kind" | "path">) =>
	s.kind === "drive" ? "entire Cloud Drive" : `${s.kind} ${baseName(s.path)}`;

/** A Cloud Drive shared with the user (all of it, or parts): its owner, and how. */
export type SharedDrive = {
	owner: string;
	ownerName: string;
	/** The widest access of what is shared. */
	access: "read" | "write";
	/** Only parts of it shared (a folder or a file, none of all of it): the first of them, for its card, its own
	 * access, and how many more there are. */
	part?: {
		id: string;
		kind: "folder" | "file";
		path: string;
		access: "read" | "write";
		more: number;
	};
};

/** The Cloud Drives shared with the user now (their active shares; none while sharing is off), by owner's name: one
 * each, all of it or parts of it. */
export const sharedDrives = (
	peers: CloudDrivePeers | undefined,
): SharedDrive[] => {
	if (!peers?.settings.enabled) {
		return [];
	}
	const byOwner = new Map<string, CloudDrivePeers["asked"]>();
	for (const s of peers.asked) {
		if (s.state === "active" && s.owner !== peers.me) {
			byOwner.set(s.owner, [...(byOwner.get(s.owner) ?? []), s]);
		}
	}
	const wider = (shares: CloudDrivePeers["asked"]) =>
		shares.some((s) => s.access === "write") ? "write" : "read";
	return [...byOwner.values()]
		.map((shares): SharedDrive => {
			// two shares of one drive (asked again, or shared too): the wider access
			const whole = shares.filter((s) => (s.kind ?? "drive") === "drive");
			const first = shares[0];
			if (whole.length > 0) {
				return {
					owner: first.owner,
					ownerName: first.ownerName,
					access: wider(whole),
				};
			}
			const parts = [...shares].sort((a, b) => a.path.localeCompare(b.path));
			return {
				owner: first.owner,
				ownerName: first.ownerName,
				access: wider(parts),
				part: {
					id: parts[0].id,
					kind: parts[0].kind === "file" ? "file" : "folder",
					path: parts[0].path,
					access: parts[0].access,
					more: parts.length - 1,
				},
			};
		})
		.sort(
			(a, b) =>
				a.ownerName.localeCompare(b.ownerName) ||
				a.owner.localeCompare(b.owner),
		);
};

/**
 * Whom the user's own Cloud Drive - all of it, or a folder or a file of it - is shared with now (its active shares,
 * however they came about: shared by the user, or asked for and accepted, and approved by an admin where admins
 * approve them; none while sharing is off), by name, each once: the Cloud Drive's leading cloud says so.
 */
export const mineSharedWith = (
	peers: CloudDrivePeers | undefined,
): string[] => {
	if (!peers?.settings.enabled) {
		return [];
	}
	const names = peers.ofMine
		.filter((s) => s.state === "active" && s.from !== peers.me)
		.map((s) => s.fromName);
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
};

/** The folder the Cloud Drive window opens on for a part: the shared folder, a shared file's folder. */
export const openPath = (part: Pick<CloudDriveShare, "kind" | "path">) =>
	part.kind === "file"
		? part.path.slice(0, Math.max(0, part.path.lastIndexOf("/")))
		: part.path;

/** One part of the capacity bar: the user's own drive, or an entire drive shared with them read and write. */
export type RoomPart = {
	owner: string;
	/** "" for the user's own. */
	ownerName: string;
	usedBytes: number;
	quotaBytes: number;
};

/**
 * The room the user has: their own drive and each entire drive shared with them read and write (those with a
 * capacity to count) - in all, and each part for the bar. null where their own has no capacity (a workspace's folder).
 */
export const room = (
	summary: Pick<SafeSummary, "usedBytes" | "quotaBytes" | "shared">,
): { usedBytes: number; quotaBytes: number; parts: RoomPart[] } | null => {
	if (summary.quotaBytes === null || summary.quotaBytes <= 0) {
		return null;
	}
	const parts: RoomPart[] = [
		{
			owner: "",
			ownerName: "",
			usedBytes: summary.usedBytes,
			quotaBytes: summary.quotaBytes,
		},
		...(summary.shared ?? [])
			.filter((s) => s.quotaBytes !== null && s.quotaBytes > 0)
			.map((s) => ({
				owner: s.owner,
				ownerName: s.ownerName,
				usedBytes: s.usedBytes ?? 0,
				quotaBytes: s.quotaBytes as number,
			})),
	];
	return {
		usedBytes: parts.reduce((n, p) => n + p.usedBytes, 0),
		quotaBytes: parts.reduce((n, p) => n + p.quotaBytes, 0),
		parts,
	};
};
