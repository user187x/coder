/**
 * What other users share with the signed-in user, for the Cloud Drive's leading cloud on the Workspaces page
 * (SharedWithYou): each active share - an entire Cloud Drive, or a folder or a file of one - and the room the entire
 * drives shared read and write add to their own.
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

/** Where the user's workspaces have it (from their next start). */
export const shareLink = (
	s: Pick<IncomingShare, "kind" | "path" | "ownerName">,
) =>
	`~/cloud-drive-shared/${s.ownerName}${s.kind === "drive" ? "" : `/${baseName(s.path)}`}`;

/** The folder the Cloud Drive window opens on for it: the shared folder, a shared file's folder, the drive's top. */
export const openPath = (s: Pick<IncomingShare, "kind" | "path">) =>
	s.kind === "folder"
		? s.path
		: s.kind === "file"
			? s.path.slice(0, Math.max(0, s.path.lastIndexOf("/")))
			: "";

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
