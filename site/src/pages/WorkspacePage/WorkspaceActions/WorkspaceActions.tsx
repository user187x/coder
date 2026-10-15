import { Fragment, useState } from "react";
import { useQuery } from "react-query";
import { deploymentConfig } from "#/api/queries/deployment";
import type { Workspace, WorkspaceBuildParameter } from "#/api/typesGenerated";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import {
	type ActionType,
	abilitiesByWorkspaceStatus,
} from "#/modules/workspaces/actions";
import { buildRow } from "#/modules/workspaces/buildRow";
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
	const abilityPermissions = {
		canDebug: Boolean(deployment?.config.enable_terraform_debug_mode),
		isOwner: user.roles.some((role) => role.name === "owner"),
	};
	const { actions, canCancel, canAcceptJobs } = abilitiesByWorkspaceStatus(
		workspace,
		abilityPermissions,
	);
	const { status, transition } = workspace.latest_build;

	// Platform: while a build runs the buttons stay as they were before it (buildRow): remembered here while the
	// workspace takes new builds.
	const steady = canAcceptJobs && !isRestarting && !isUpdating;
	const [before, setBefore] = useState<readonly ActionType[] | null>(
		steady ? actions : null,
	);
	if (steady && !sameActions(before, actions)) {
		setBefore(actions);
	}
	const actionsWhen = (as: "running" | "stopped") =>
		abilitiesByWorkspaceStatus(
			{ ...workspace, latest_build: { ...workspace.latest_build, status: as } },
			abilityPermissions,
		).actions;
	const row = workspace.latest_build.has_external_agent
		? null
		: buildRow({
				status,
				transition,
				isRestarting,
				isUpdating,
				before,
				running: actionsWhen("running"),
				stopped: actionsWhen("stopped"),
			});

	const tooltipText = getTooltipText(
		workspace,
		permissions.updateWorkspaceVersion,
	);

	// A mapping of button type to the corresponding React component; Platform: `disabled` for those that wait
	// while a build runs.
	const mapping = (disabled: boolean): Record<ActionType, React.ReactNode> => ({
		updateAndStart: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning={false}
				requireActiveVersion={false}
				disabled={disabled}
			/>
		),
		updateAndStartRequireActiveVersion: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning={false}
				requireActiveVersion
				disabled={disabled}
			/>
		),
		updateAndRestart: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning
				requireActiveVersion={false}
				disabled={disabled}
			/>
		),
		updateAndRestartRequireActiveVersion: (
			<UpdateButton
				handleAction={handleUpdate}
				isRunning
				requireActiveVersion
				disabled={disabled}
			/>
		),
		updating: <UpdateButton loading handleAction={handleUpdate} />,
		start: (
			<StartButton
				workspace={workspace}
				handleAction={handleStart}
				tooltipText={tooltipText}
				disabled={disabled}
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

		stop: <StopButton handleAction={handleStop} disabled={disabled} />,
		stopping: <StopButton loading handleAction={handleStop} />,
		restart: (
			<RestartButton
				workspace={workspace}
				handleAction={handleRestart}
				tooltipText={tooltipText}
				disabled={disabled}
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
		activate: (
			<ActivateButton
				handleAction={handleDormantActivate}
				disabled={disabled}
			/>
		),
		activating: <ActivateButton loading handleAction={handleDormantActivate} />,
		retry: (
			<RetryButton
				handleAction={handleRetry}
				workspace={workspace}
				enableBuildParameters={workspace.latest_build.transition === "start"}
				disabled={disabled}
			/>
		),
		debug: (
			<DebugButton
				handleAction={handleDebug}
				workspace={workspace}
				enableBuildParameters={workspace.latest_build.transition === "start"}
				disabled={disabled}
			/>
		),
	});
	const buttonMapping = mapping(false);
	const waiting = mapping(true);

	/**
	 * Platform: the place of the build's own button while it runs: Cancel when
	 * it can be canceled, else what it is doing.
	 */
	const activeSlot = (action: ActionType | undefined): React.ReactNode => {
		if (canCancel) {
			return (
				<CancelButton handleAction={handleCancel} tooltipText={cancelText()} />
			);
		}
		if (status === "canceling") {
			return buttonMapping.canceling;
		}
		if (isRestarting) {
			return buttonMapping.restarting;
		}
		if (isUpdating) {
			return buttonMapping.updating;
		}
		if (status === "pending") {
			return buttonMapping.pending;
		}
		if (action === "deleting") {
			return buttonMapping.deleting;
		}
		if (action === "activate") {
			return buttonMapping.activating;
		}
		return transition === "stop"
			? buttonMapping.stopping
			: buttonMapping.starting;
	};
	const cancelText = () =>
		isRestarting
			? "Cancel the restart"
			: isUpdating
				? "Cancel the update"
				: transition === "delete"
					? "Cancel deleting the workspace"
					: transition === "stop"
						? "Cancel stopping the workspace"
						: "Cancel starting the workspace";

	return (
		<div
			// Platform: the buttons end as far from the edge as the navbar's user menu above them (its px-6),
			// evenly spaced.
			className="flex flex-wrap items-center justify-end gap-2 pr-6"
			data-testid="workspace-actions"
		>
			{/* Platform: while a build runs (a restart too: it would otherwise appear as stopping), the buttons
			    as they were, the build's own one its Cancel, the others waiting (buildRow). */}
			{row ? (
				<>
					{row.actions.map((action, i) => (
						<Fragment key={action}>
							{i === row.active ? activeSlot(action) : waiting[action]}
						</Fragment>
					))}
					{row.active < 0 && activeSlot(undefined)}
				</>
			) : (
				actions.map((action) => (
					<Fragment key={action}>{buttonMapping[action]}</Fragment>
				))
			)}

			{/* Platform: every workspace action (no ⋮ menu, Share among them) under one arrow, right after
			    the action buttons (beside Restart or Start), in every state: mounted once, so it never goes
			    while the workspace builds; during a build only what would start another is unavailable in it. */}
			<WorkspaceMoreActions
				workspace={workspace}
				variant="arrow"
				disabled={false}
				jobsBlocked={!canAcceptJobs}
				share={
					permissions.shareWorkspace
						? { canUpdatePermissions: permissions.updateWorkspace }
						: undefined
				}
			/>
		</div>
	);
};

const sameActions = (
	a: readonly ActionType[] | null,
	b: readonly ActionType[],
) => a !== null && a.length === b.length && a.every((x, i) => x === b[i]);

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
