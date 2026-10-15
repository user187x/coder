import {
	BanIcon,
	PlayIcon,
	PowerIcon,
	RotateCcwIcon,
	SquareIcon,
} from "lucide-react";
import type { Workspace, WorkspaceBuildParameter } from "#/api/typesGenerated";
import { TopbarButton } from "#/components/FullPageLayout/Topbar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";

export type ActionButtonProps = {
	loading?: boolean;
	handleAction: (buildParameters?: WorkspaceBuildParameter[]) => void;
	disabled?: boolean;
	tooltipText?: string;
	isRunning?: boolean;
	requireActiveVersion?: boolean;
};

export const UpdateButton: React.FC<ActionButtonProps> = ({
	handleAction,
	loading,
	disabled,
	isRunning,
	requireActiveVersion,
}) => {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<TopbarButton
					data-testid="workspace-update-button"
					disabled={loading || disabled}
					onClick={() => handleAction()}
				>
					{requireActiveVersion ? <PlayIcon /> : <RotateCcwIcon />}
					{loading ? (
						<>Updating&hellip;</>
					) : isRunning ? (
						<>Update and restart&hellip;</>
					) : (
						<>Update and start&hellip;</>
					)}
				</TopbarButton>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="max-w-xs">
				{requireActiveVersion
					? "This template requires automatic updates on workspace startup. Contact your administrator if you want to preserve the template version."
					: isRunning
						? "Stop workspace and restart it with the latest template version."
						: "Start workspace with the latest template version."}
			</TooltipContent>
		</Tooltip>
	);
};

export const ActivateButton: React.FC<ActionButtonProps> = ({
	handleAction,
	loading,
	disabled,
}) => {
	return (
		<TopbarButton disabled={loading || disabled} onClick={() => handleAction()}>
			<PowerIcon />
			{loading ? <>Activating&hellip;</> : "Activate"}
		</TopbarButton>
	);
};

type ActionButtonPropsWithWorkspace = ActionButtonProps & {
	workspace: Workspace;
};

export const StartButton: React.FC<ActionButtonPropsWithWorkspace> = ({
	handleAction,
	loading,
	disabled,
	tooltipText,
}) => {
	let mainButton = (
		<TopbarButton
			data-testid="workspace-start"
			onClick={() => handleAction()}
			disabled={disabled || loading}
		>
			<PlayIcon />
			{loading ? <>Starting&hellip;</> : "Start"}
		</TopbarButton>
	);

	if (tooltipText) {
		mainButton = (
			<Tooltip>
				<TooltipTrigger asChild>{mainButton}</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-xs">
					{tooltipText}
				</TooltipContent>
			</Tooltip>
		);
	}

	// Platform: the actions' arrow follows the action buttons (WorkspaceActions), whatever the state.
	return mainButton;
};

export const StopButton: React.FC<ActionButtonProps> = ({
	handleAction,
	loading,
	disabled,
}) => {
	return (
		<TopbarButton
			disabled={loading || disabled}
			onClick={() => handleAction()}
			data-testid="workspace-stop-button"
		>
			<SquareIcon />
			{loading ? <>Stopping&hellip;</> : "Stop"}
		</TopbarButton>
	);
};

export const RestartButton: React.FC<ActionButtonPropsWithWorkspace> = ({
	handleAction,
	loading,
	disabled,
}) => {
	// Platform: the actions' arrow follows the action buttons (WorkspaceActions), whatever the state.
	return (
		<TopbarButton
			onClick={() => handleAction()}
			data-testid="workspace-restart-button"
			disabled={loading || disabled}
		>
			<RotateCcwIcon />
			{loading ? <>Restarting&hellip;</> : <>Restart&hellip;</>}
		</TopbarButton>
	);
};

/** Platform: in the place of the button whose build it cancels (WorkspaceActions); `tooltipText` says which. */
export const CancelButton: React.FC<ActionButtonProps> = ({
	handleAction,
	tooltipText,
}) => {
	return (
		<TopbarButton
			onClick={() => handleAction()}
			title={tooltipText}
			data-testid="workspace-cancel-button"
		>
			<BanIcon />
			Cancel
		</TopbarButton>
	);
};

type DisabledButtonProps = {
	label: string;
};

export const DisabledButton: React.FC<DisabledButtonProps> = ({ label }) => {
	return (
		<TopbarButton disabled>
			<BanIcon />
			{label}
		</TopbarButton>
	);
};
