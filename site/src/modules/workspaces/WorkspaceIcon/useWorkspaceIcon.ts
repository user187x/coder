import { useQuery } from "react-query";
import type { Workspace } from "#/api/typesGenerated";
import { WorkspaceExtrasAPI, workspaceIconsKey } from "#/api/workspaceVolumes";

/** Every workspace's own icon (set in its Settings), fetched once and shared. */
export const useWorkspaceIcons = () =>
	useQuery({
		queryKey: workspaceIconsKey,
		queryFn: WorkspaceExtrasAPI.icons,
		staleTime: 60_000,
		select: (d) => d.icons,
	});

/** The workspace's icon: its own when set, else its template's. */
export const useWorkspaceIcon = (
	workspace: Pick<Workspace, "id" | "template_icon">,
) => {
	const { data } = useWorkspaceIcons();
	return data?.[workspace.id] || workspace.template_icon;
};
