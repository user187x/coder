import { Fragment } from "react";
import { useQuery } from "react-query";
import { deploymentConfig } from "#/api/queries/deployment";
import type { Workspace, WorkspaceBuildParameter } from "#/api/typesGenerated";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import {
	type ActionType,
	abilitiesByWorkspaceStatus,
} from "#/modules/workspaces/actions";
import type { WorkspacePermissions } from "#/modules/workspaces/permissions";
import { WorkspaceMoreActions } from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceMoreActions";
import {
	ActivateButton,
	CancelButton,
	DisabledButton,
	RestartButton,
	StartButton,
	StopButton,
	UpdateButton,
} from "./Buttons";
import { DebugButton } from "./DebugButton";
import { RetryButton } from "./RetryButton";
import { ShareButton } from "./ShareButton";

type WorkspaceActionsProps = {
	workspace: Workspace;
	isUpdating: boolean;
	isRestarting: boolean;
	permissions: WorkspacePermissions;
	handleStart: (buildParameters?: WorkspaceBuildParameter[]) => void;
	handleStop: () => void;
	handleRestart: (buildParameters?: WorkspaceBuildParameter[]) => void;
	handleUpdate: () => void;
	handleCancel: () => void;
	handleRetry: (buildParameters?: WorkspaceBuildParameter[]) => void;
	handleDebug: (buildParameters?: WorkspaceBuildParameter[]) => void;
	handleDormantActivate: () => void;
};

export const WorkspaceActions: React.FC<WorkspaceActionsProps> = ({
	workspace,
	isUpdating,
	isRestarting,
	permissions,
	handleStart,
	handleStop,
	handleRestart,
	handleUpdate,
	handleCancel,
	handleRetry,
	handleDebug,
	handleDormantActivate,
}) => {
	const {
		permissions: { viewDeploymentConfig },
		user,
	} = useAuthenticated();
	const { data: deployment } = useQuery({
		...deploymentConfig(),
		enabled: viewDeploymentConfig,
	});
	const { actions, canCancel, canAcceptJobs } = abilitiesByWorkspaceStatus(
		workspace,
		{
			canDebug: Boolean(deployment?.config.enable_terraform_debug_mode),
			isOwner: user.roles.some((role) => role.name === "owner"),
		},
	);

	const tooltipText = getTooltipText(
		workspace,
		permissions.updateWorkspaceVersion,
	);

	// A mapping of button type to the corresponding React component
	const buttonMapping: Record<ActionType, React.ReactNode> = {
		updateAndStart: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning={false}
				requireActiveVersion={false}
			/>
		),
		updateAndStartRequireActiveVersion: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning={false}
				requireActiveVersion
			/>
		),
		updateAndRestart: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning
				requireActiveVersion={false}
			/>
		),
		updateAndRestartRequireActiveVersion: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning
				requireActiveVersion
			/>
		),
		updating: <UpdateButton loading handleAction={handleUpdate} />,
		start: (
			<StartButton
				workspace={workspace}
				handleAction={handleStart}
				tooltipText={tooltipText}
			/>
		),
		starting: (
			<StartButton
				loading
				workspace={workspace}
				handleAction={handleStart}
				tooltipText={tooltipText}
			/>
		),

		stop: <StopButton handleAction={handleStop} />,
		stopping: <StopButton loading handleAction={handleStop} />,
		restart: (
			<RestartButton
				workspace={workspace}
				handleAction={handleRestart}
				tooltipText={tooltipText}
			/>
		),
		restarting: (
			<RestartButton
				loading
				workspace={workspace}
				handleAction={handleRestart}
				tooltipText={tooltipText}
			/>
		),

		deleting: <DisabledButton label="Deleting" />,
		canceling: <DisabledButton label="Canceling..." />,
		deleted: <DisabledButton label="Deleted" />,
		pending: <DisabledButton label="Pending..." />,
		activate: <ActivateButton handleAction={handleDormantActivate} />,
		activating: <ActivateButton loading handleAction={handleDormantActivate} />,
		retry: (
			<RetryButton
				handleAction={handleRetry}
				workspace={workspace}
				enableBuildParameters={workspace.latest_build.transition === "start"}
			/>
		),
		debug: (
			<DebugButton
				handleAction={handleDebug}
				workspace={workspace}
				enableBuildParameters={workspace.latest_build.transition === "start"}
			/>
		),
	};

	return (
		<div
			// Platform: room to the right of the last button (Share), which the ⋮ menu used to give.
			className="flex flex-wrap items-center justify-end gap-2 pr-3"
			data-testid="workspace-actions"
		>
			{/* Restarting must be handled separately, because it otherwise would appear as stopping */}
			{isUpdating
				? buttonMapping.updating
				: isRestarting
					? buttonMapping.restarting
					: actions.map((action) => (
							<Fragment key={action}>{buttonMapping[action]}</Fragment>
						))}

			{/* Platform: every workspace action (no ⋮ menu) under one arrow, right after the action buttons
			    (beside Restart or Start), in every state: mounted once, so it never goes while the workspace
			    builds; during a build only what would start another is unavailable in it. */}
			<WorkspaceMoreActions
				workspace={workspace}
				variant="arrow"
				disabled={false}
				jobsBlocked={!canAcceptJobs}
				className="-ml-1"
			/>

			{canCancel && <CancelButton handleAction={handleCancel} />}

			{permissions.shareWorkspace && (
				<ShareButton
					workspace={workspace}
					canUpdatePermissions={permissions.updateWorkspace}
				/>
			)}
		</div>
	);
};

function getTooltipText(
	workspace: Workspace,
	canChangeVersions: boolean,
): string {
	if (canChangeVersions && workspace.template_require_active_version) {
		return "This template requires automatic updates on workspace startup, but template administrators can ignore this policy.";
	}

	if (workspace.automatic_updates === "always") {
		return "Automatic updates are enabled for this workspace. Modify the update policy in workspace settings if you want to preserve the template version.";
	}

	return "";
}
