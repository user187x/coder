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
import { useWorkspaceContactLost } from "#/modules/platform/workspaceLiveness/liveness";
import {
	formatStarted,
	workspaceStartedAt,
} from "#/modules/platform/workspaceUptime/workspaceUptime";
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

/**
 * Platform: the running workspace's light on its page: rings of light turning
 * round a pulsing core (runningLight.css). Hovered, it tells when the
 * workspace started. No contact with Coder (the workspace page's check): grey
 * and still, and it says since when.
 */
const RunningLight: React.FC<{
	started: Date | null;
	/** No contact with Coder since (ms). */
	lostAt?: number | null;
}> = ({ started, lostAt }) => {
	const light = (
		<span
			aria-hidden
			data-testid="workspace-running-light"
			data-lost={lostAt ? true : undefined}
			className="ws-running-light"
		>
			<i className="ws-running-ring ws-running-outer" />
			<i className="ws-running-ring ws-running-middle" />
			<i className="ws-running-ring ws-running-inner" />
			<i className="ws-running-core" />
		</span>
	);
	if (!started && !lostAt) {
		return light;
	}
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className="inline-flex"
					data-testid="workspace-running-light-trigger"
				>
					{light}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{lostAt
					? `Last seen running. No contact with Coder since ${new Date(lostAt).toLocaleTimeString()}: reconnecting...`
					: started && `Started ${formatStarted(started)}`}
			</TooltipContent>
		</Tooltip>
	);
};

type WorkspaceStatusIndicatorProps = {
	workspace: Workspace;
	children?: React.ReactNode;
	/** Platform: on the indicator (the Workspaces table's pill). */
	className?: string;
	/** Platform: a running, healthy workspace shows the running light instead of the dot. */
	runningLight?: boolean;
};

export const WorkspaceStatusIndicator: React.FC<
	WorkspaceStatusIndicatorProps
> = ({ workspace, children, runningLight = false, className }) => {
	let { text, type } = getDisplayWorkspaceStatus(
		workspace.latest_build.status,
		workspace.latest_build.job,
	);

	if (!workspace.health.healthy) {
		type = "warning";
	}
	// Platform: no contact with Coder about it (its page's check): running as last seen, not running for sure
	const lostAt = useWorkspaceContactLost(workspace.id);
	const lostWhileRunning =
		lostAt !== null && workspace.latest_build.status === "running";
	if (lostWhileRunning) {
		text = "No contact";
		type = "inactive";
	}

	const dot =
		runningLight &&
		(type === "success" || lostWhileRunning) &&
		workspace.latest_build.status === "running" ? (
			<RunningLight started={workspaceStartedAt(workspace)} lostAt={lostAt} />
		) : (
			<StatusIndicatorDot />
		);

	const statusIndicator = (
		<StatusIndicator variant={variantByStatusType[type]} className={className}>
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
				<StatusIndicator
					variant={variantByStatusType[type]}
					className={className}
				>
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
