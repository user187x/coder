import type { Workspace } from "#/api/typesGenerated";
import { lastUsedMessage } from "#/utils/workspace";
import { WorkspaceDormantBadge } from "../WorkspaceDormantBadge/WorkspaceDormantBadge";
import { WorkspaceStatusIndicator } from "../WorkspaceStatusIndicator/WorkspaceStatusIndicator";

type WorkspaceStatusProps = {
	workspace: Workspace;
	/** Platform: beside the status, outside its tooltip (the Workspaces table: the Cloud Drive attaching). */
	after?: React.ReactNode;
};

export const WorkspaceStatus: React.FC<WorkspaceStatusProps> = ({
	workspace,
	after,
}) => {
	const indicator = (
		<WorkspaceStatusIndicator workspace={workspace}>
			{workspace.dormant_at && <WorkspaceDormantBadge workspace={workspace} />}
		</WorkspaceStatusIndicator>
	);
	return (
		<div className="flex flex-col">
			{after ? (
				<div className="flex items-center gap-2">
					{indicator}
					{after}
				</div>
			) : (
				indicator
			)}
			<time
				dateTime={workspace.last_used_at}
				className="text-xs font-medium text-content-secondary ml-6 whitespace-nowrap"
			>
				{lastUsedMessage(workspace.last_used_at)}
			</time>
		</div>
	);
};
