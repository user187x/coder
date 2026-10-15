import type React from "react";
import type { Workspace } from "#/api/typesGenerated";
import {
	StatusIndicator,
	StatusIndicatorDot,
	type StatusIndicatorProps,
} from "#/components/StatusIndicator/StatusIndicator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import {
	type DisplayWorkspaceStatusType,
	getDisplayWorkspaceStatus,
} from "#/utils/workspace";
import "./runningLight.css";

export const variantByStatusType: Record<
	DisplayWorkspaceStatusType,
	StatusIndicatorProps["variant"]
> = {
	active: "pending",
	inactive: "inactive",
	success: "success",
	error: "failed",
	danger: "warning",
	warning: "warning",
};

/** Platform: the running workspace's light on its page: rings of light turning round a pulsing core (runningLight.css). */
const RunningLight: React.FC = () => (
	<span
		aria-hidden
		data-testid="workspace-running-light"
		className="ws-running-light"
	>
		<i className="ws-running-ring ws-running-outer" />
		<i className="ws-running-ring ws-running-middle" />
		<i className="ws-running-ring ws-running-inner" />
		<i className="ws-running-core" />
	</span>
);

type WorkspaceStatusIndicatorProps = {
	workspace: Workspace;
	children?: React.ReactNode;
	/** Platform: a running, healthy workspace shows the running light instead of the dot. */
	runningLight?: boolean;
};

export const WorkspaceStatusIndicator: React.FC<
	WorkspaceStatusIndicatorProps
> = ({ workspace, children, runningLight = false }) => {
	let { text, type } = getDisplayWorkspaceStatus(
		workspace.latest_build.status,
		workspace.latest_build.job,
	);

	if (!workspace.health.healthy) {
		type = "warning";
	}

	const dot =
		runningLight &&
		type === "success" &&
		workspace.latest_build.status === "running" ? (
			<RunningLight />
		) : (
			<StatusIndicatorDot />
		);

	const statusIndicator = (
		<StatusIndicator variant={variantByStatusType[type]}>
			{dot}
			<span className="sr-only">Workspace status:</span> {text}
			{children}
		</StatusIndicator>
	);

	if (workspace.health.healthy) {
		return statusIndicator;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<StatusIndicator variant={variantByStatusType[type]}>
					{dot}
					<span className="sr-only">Workspace status:</span> {text}
					{children}
				</StatusIndicator>
			</TooltipTrigger>
			<TooltipContent>
				One or more workspace agents need attention. Expand an agent's logs for
				details.
			</TooltipContent>
		</Tooltip>
	);
};
