import { ClockIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Workspace } from "#/api/typesGenerated";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import {
	formatStarted,
	formatUptime,
	uptimeInWords,
	workspaceStartedAt,
} from "./workspaceUptime";

/** The clock, every second (the pill shows seconds in the first hour). */
const useNow = (active: boolean): number => {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active]);
	return now;
};

/**
 * The workspace page's uptime: how long the workspace has been on, in a pill
 * between the agent's Open Ports and its apps, counting up; its start on
 * hover. Nothing unless the workspace is running.
 */
export const WorkspaceUptime: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const started = workspaceStartedAt(workspace);
	const now = useNow(started !== null);
	if (!started) {
		return null;
	}
	const up = now - started.getTime();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="timer"
					aria-label={`Up ${uptimeInWords(up)}, since ${formatStarted(started)}`}
					data-testid="workspace-uptime"
					className="inline-flex items-center gap-1.5 rounded-full border border-solid border-border bg-surface-secondary px-3 py-1 text-xs tabular-nums text-content-secondary"
				>
					<ClockIcon aria-hidden className="size-3.5" />
					Uptime
					<span className="font-semibold text-content-primary">
						{formatUptime(up)}
					</span>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				Up {uptimeInWords(up)}: on since {formatStarted(started)}
			</TooltipContent>
		</Tooltip>
	);
};
