import { cn } from "cn";
import type { Workspace } from "#/api/typesGenerated";
import { lastUsedMessage } from "#/utils/workspace";
import { WorkspaceDormantBadge } from "../WorkspaceDormantBadge/WorkspaceDormantBadge";
import { WorkspaceStatusIndicator } from "../WorkspaceStatusIndicator/WorkspaceStatusIndicator";
import "./workspaceStatusPill.css";

type WorkspaceStatusProps = {
	workspace: Workspace;
	/** Platform: beside the status, outside its tooltip (the Workspaces table: the Cloud Drive attaching). */
	after?: React.ReactNode;
	/** Platform: the status in a tinted pill, when it was last used centred under it (the Workspaces table). */
	pill?: boolean;
};

export const WorkspaceStatus: React.FC<WorkspaceStatusProps> = ({
	workspace,
	after,
	pill = false,
}) => {
	const lastUsed = lastUsedMessage(workspace.last_used_at);
	const indicator = (
		<WorkspaceStatusIndicator
			workspace={workspace}
			className={pill ? "workspace-status-pill" : undefined}
		>
			{workspace.dormant_at && <WorkspaceDormantBadge workspace={workspace} />}
		</WorkspaceStatusIndicator>
	);
	return (
		<div
			className={cn("flex flex-col", pill && "items-center gap-1")}
			data-hint={pill ? `Last used: ${lastUsed}` : undefined}
		>
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
				className={cn(
					"text-xs font-medium text-content-secondary whitespace-nowrap",
					!pill && "ml-6",
				)}
			>
				{lastUsed}
			</time>
		</div>
	);
};
