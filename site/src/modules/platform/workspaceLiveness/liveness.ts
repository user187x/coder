import { useSyncExternalStore } from "react";

/**
 * Whether the dashboard is in contact with Coder about a workspace, by its id: the workspace page watches its
 * workspace (Coder's watch stream) and asks Coder every few seconds whether it answers; when neither gets through
 * (Coder, its cluster or the network gone) the page's live parts - the running light, the agent card's border, the
 * metric graphs and the network lights - stop and turn grey instead of looking alive. Unknown (no workspace page):
 * in contact.
 */
const lost = new Map<string, number>(); // workspace id -> since (ms)
const listeners = new Set<() => void>();
let version = 0;

const changed = () => {
	version++;
	for (const listener of listeners) {
		listener();
	}
};

export const setWorkspaceContact = (workspaceId: string, ok: boolean) => {
	if (ok ? !lost.has(workspaceId) : lost.has(workspaceId)) {
		return;
	}
	if (ok) {
		lost.delete(workspaceId);
	} else {
		lost.set(workspaceId, Date.now());
	}
	changed();
};

/** When contact with Coder about the workspace was lost (ms), or null while in contact. */
export const workspaceContactLostAt = (workspaceId: string | undefined) =>
	workspaceId ? (lost.get(workspaceId) ?? null) : null;

export const useWorkspaceContactLost = (
	workspaceId: string | undefined,
): number | null => {
	useSyncExternalStore(
		(onChange) => {
			listeners.add(onChange);
			return () => {
				listeners.delete(onChange);
			};
		},
		() => version,
	);
	return workspaceContactLostAt(workspaceId);
};
