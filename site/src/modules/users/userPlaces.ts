import type { QueryClient } from "react-query";
import { workspaces } from "#/api/queries/workspaces";

/** A user's workspaces list (the Workspaces page filtered on them). */
export const userWorkspacesHref = (username: string) =>
	`/workspaces?filter=${encodeURIComponent(`owner:${username}`)}`;

/**
 * Where a user's workspace is: the workspace itself when they have exactly one, else their workspaces list (Admin ›
 * Accounts' rows, the chat console's Workspace).
 */
export const userWorkspaceHref = async (
	queryClient: QueryClient,
	username: string,
): Promise<string> => {
	const list = userWorkspacesHref(username);
	try {
		const result = await queryClient.fetchQuery(
			workspaces({ q: `owner:${username}`, limit: 2 }),
		);
		const [only] = result.workspaces;
		return result.count === 1 && only
			? `/@${encodeURIComponent(only.owner_name)}/${encodeURIComponent(only.name)}`
			: list;
	} catch {
		return list;
	}
};

/**
 * A user's Cloud Drive, for an admin (read only; not one its owner encrypted): their workspaces list, the Cloud Drive
 * window open on their drive - at a folder or file's folder, when given (a share's).
 */
export const userCloudDriveHref = (
	user: { id: string; username: string },
	path = "",
) => {
	const params = new URLSearchParams({
		filter: `owner:${user.username}`,
		cloudDrive: user.id,
		cloudDriveUser: user.username,
	});
	if (path) {
		params.set("cloudDrivePath", path);
	}
	return `/workspaces?${params}`;
};
