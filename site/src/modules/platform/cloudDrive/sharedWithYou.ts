/**
 * What other users share with the signed-in user (the Cloud Drive window's drives, CloudDriveBrowser): each active
 * share - an entire Cloud Drive, or a folder or a file of one.
 */
import type { CloudDrivePeers, CloudDriveShare } from "#/api/platform";

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
