import { useSyncExternalStore } from "react";

// The workspace page's sidebar button starts a new note; the notes themselves
// are drawn elsewhere (WorkspaceNotes, over the whole page). Each request bumps
// this counter, and WorkspaceNotes opens a draft when it changes.
let requests = 0;
const listeners = new Set<() => void>();

export const requestNoteDraft = () => {
	requests += 1;
	for (const listener of listeners) {
		listener();
	}
};

export const useNoteDraftRequests = (): number =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => requests,
	);
