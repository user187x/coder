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

/** Platform: the running workspace's light on its page (site/static, an animated green dot). */
const RUNNING_LIGHT = "/workspace-running.gif";

type WorkspaceStatusIndicatorProps = {
	workspace: Workspace;
	children?: React.ReactNode;
	/** Platform: a running, healthy workspace shows the animated light instead of the dot. */
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
			<img
				src={RUNNING_LIGHT}
				alt=""
				data-testid="workspace-running-light"
				className="size-5 shrink-0"
			/>
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
