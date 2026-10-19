import type {
	CloudDriveAttachment,
	CloudDriveConnections,
} from "#/api/platform";

/**
 * The Cloud Drive in the user's workspaces as they report it (the service's connections' attachment: each started
 * workspace's word, from its agent's metadata): whether a connected workspace still waits for its drive - an orange
 * cloud beside its status, a red cable into its row - and what to say of it.
 */

/** The words of a drive not there (yet) in a workspace meant to have it. */
const NOT_THERE: ReadonlySet<CloudDriveAttachment> = new Set([
	"starting",
	"waiting",
	"unanswered",
	"offline",
	"stale",
	"detached",
]);

/** While a workspace waits for its drive, the connections are read this often (else every 30 seconds). */
export const ATTACHMENT_REFRESH_MS = 2_000;

/**
 * The word of a connected workspace whose drive is not attached (yet), or null: attached, disconnected or shared with
 * others (no drive is meant to be there), or a workspace that does not say (stopped, an older template version).
 */
export const attachmentPending = (
	data: CloudDriveConnections | undefined,
	workspaceId: string,
): CloudDriveAttachment | null => {
	const word = data?.attachment?.[workspaceId];
	if (
		!data ||
		!word ||
		data.disconnected.includes(workspaceId) ||
		data.shared?.includes(workspaceId)
	) {
		return null;
	}
	return NOT_THERE.has(word) ? word : null;
};

/** The connected workspaces whose drive is not attached yet. */
export const pendingAttachments = (
	data: CloudDriveConnections | undefined,
): string[] =>
	Object.keys(data?.attachment ?? {}).filter(
		(id) => attachmentPending(data, id) !== null,
	);

/** What the orange cloud says of it. */
export const attachmentMessage = (word: CloudDriveAttachment): string => {
	switch (word) {
		case "unanswered":
			return "Cloud Drive: linked, but its storage does not answer yet";
		case "offline":
			return "Cloud Drive: not here - its source workspace was not running when this one started. Restart this one once it runs.";
		case "stale":
			return "Cloud Drive: not confirmed - the workspace has not reported for a while";
		case "starting":
			return "Cloud Drive: attaching as the workspace starts…";
		default:
			return "Cloud Drive: attaching to this workspace…";
	}
};
