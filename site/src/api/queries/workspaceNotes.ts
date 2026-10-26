import type { QueryClient } from "react-query";
import { PlatformAPI, type WorkspaceNote } from "#/api/platform";
import { notesByUserKey } from "./platform";

export const workspaceNotesKey = (id: string) =>
	["platform", "notes", id] as const;
export const workspaceNotes = (id: string) => ({
	queryKey: workspaceNotesKey(id),
	queryFn: () => PlatformAPI.getWorkspaceNotes(id),
	retry: false,
	refetchInterval: 30_000,
});
const refresh = (client: QueryClient, id: string) =>
	Promise.all([
		client.invalidateQueries({ queryKey: workspaceNotesKey(id) }),
		client.invalidateQueries({ queryKey: notesByUserKey }),
	]);
export const saveAccountNote = (client: QueryClient, workspaceId: string) => ({
	mutationFn: ({
		id,
		...note
	}: { id?: string } & Pick<WorkspaceNote, "text" | "color">) =>
		id
			? PlatformAPI.updateWorkspaceNote(id, note)
			: PlatformAPI.createWorkspaceNote(workspaceId, {
					...note,
					x: Math.max(0, 0.5 - 110 / window.innerWidth),
					y: Math.max(0, 0.5 - 85 / window.innerHeight),
				}),
	onSuccess: () => refresh(client, workspaceId),
});
export const deleteAccountNote = (
	client: QueryClient,
	workspaceId: string,
) => ({
	mutationFn: PlatformAPI.deleteWorkspaceNote,
	onSuccess: () => refresh(client, workspaceId),
});
