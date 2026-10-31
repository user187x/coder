import { cn } from "cn";
import { Button } from "#/components/Button/Button";
import {
	Tooltip,
	TooltipContent,
	TooltipTitle,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import "#/modules/platform/workspaceUpdate/updatePulse.css";
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
	agentUpdateAvailable?: boolean;
	restartReasons?: readonly string[];
	onUpdate?: () => void;
	updateDisabled?: boolean;
};

export const WorkspaceStatus: React.FC<WorkspaceStatusProps> = ({
	workspace,
	after,
	pill = false,
	agentUpdateAvailable = false,
	restartReasons,
	onUpdate,
	updateDisabled = false,
}) => {
	const needsUpdate =
		workspace.health.healthy && (agentUpdateAvailable || workspace.outdated);
	const lastUsed = lastUsedMessage(workspace.last_used_at);
	const indicator = (
		<WorkspaceStatusIndicator
			workspace={workspace}
			listPill={pill}
			agentUpdateAvailable={pill && needsUpdate}
			className={pill ? "workspace-status-pill" : undefined}
		>
			{workspace.dormant_at && <WorkspaceDormantBadge workspace={workspace} />}
		</WorkspaceStatusIndicator>
	);
	const status = (
		<div
			className={cn("flex flex-col", pill && "items-center gap-1")}
			data-hint={pill ? `Last used: ${lastUsed}` : undefined}
		>
			{pill && needsUpdate && workspace.latest_build.status === "running" ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="subtle"
							aria-disabled={updateDisabled || !onUpdate}
							aria-label={`Running. Restart ${workspace.name}; update available`}
							className="h-auto min-w-0 rounded-full p-0 hover:bg-transparent"
							onClick={(event) => {
								event.stopPropagation();
								if (!updateDisabled) onUpdate?.();
							}}
						>
							{indicator}
						</Button>
					</TooltipTrigger>
					<TooltipContent className="max-w-sm">
						<TooltipTitle>Restart recommended</TooltipTitle>
						<ul className="m-0 space-y-2 pl-4">
							{(restartReasons?.length
								? restartReasons
								: [
										...(workspace.outdated
											? ["A template update is available."]
											: []),
										...(agentUpdateAvailable
											? ["An agent update is available."]
											: []),
									]
							).map((reason) => (
								<li key={reason}>{reason}</li>
							))}
						</ul>
					</TooltipContent>
				</Tooltip>
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
	// Platform: what goes beside it (the Cloud Drive attaching), centred on the whole status - its pill and when it
	// was last used - so in the middle of the table's row
	return after ? (
		<div className="inline-flex items-center gap-2">
			{status}
			{after}
		</div>
	) : (
		status
	);
};
