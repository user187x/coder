import { StickyNoteIcon } from "lucide-react";
import { useQuery } from "react-query";
import { PlatformAPI } from "#/api/platform";
import type { Workspace } from "#/api/typesGenerated";
import { SidebarIconButton } from "#/components/FullPageLayout/Sidebar";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { requestNoteDraft } from "./noteDraftStore";
import { notesKey } from "./WorkspaceNotes";

/**
 * Workspace page > left sidebar, under Resources and History: admins looking
 * at another user's workspace stick a post-it note on it from here. The
 * notes' amber marks the button; a dot shows how many are up.
 */
export const WorkspaceNotesButton: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const { user } = useAuthenticated();
	const query = useQuery({
		queryKey: notesKey(workspace.id),
		queryFn: () => PlatformAPI.getWorkspaceNotes(workspace.id),
		refetchInterval: 30_000,
		retry: false,
	});
	if (!query.data?.canEdit || workspace.owner_id === user.id) {
		return null;
	}
	const up = query.data.notes.filter((note) => !note.dismissedAt).length;
	return (
		<SidebarIconButton
			isActive={false}
			onClick={requestNoteDraft}
			title={`Stick a note on ${workspace.owner_name}'s workspace page`}
			data-testid="workspace-notes-add"
			className="relative"
		>
			<StickyNoteIcon className="size-icon-sm text-amber-400" />
			{up > 0 && (
				<span
					aria-hidden
					className="absolute right-1.5 top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-0.5 text-[9px] font-semibold leading-none text-black"
				>
					{up}
				</span>
			)}
			<span className="sr-only">
				Add a note{up > 0 ? ` (${up} on this workspace)` : ""}
			</span>
		</SidebarIconButton>
	);
};
