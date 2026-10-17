import { cn } from "cn";
import { TimerIcon } from "lucide-react";
import type { DERPRegion, WorkspaceAgent } from "#/api/typesGenerated";
import {
	Tooltip,
	TooltipContent,
	TooltipMessage,
	TooltipTitle,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { getLatencyColor } from "#/utils/latency";

const getDisplayLatency = (agent: WorkspaceAgent) => {
	// Find the right latency to display
	const latencyValues = Object.values(agent.latency ?? {});
	const latency =
		latencyValues.find((derp) => derp.preferred) ??
		// Accessing an array index can return undefined as well
		// for some reason TS does not handle that
		(latencyValues[0] as DERPRegion | undefined);

	if (!latency) {
		return undefined;
	}

	return {
		...latency,
		color: getLatencyColor(latency.latency_ms),
	};
};

type AgentLatencyProps = {
	agent: WorkspaceAgent;
};

export const AgentLatency: React.FC<AgentLatencyProps> = ({ agent }) => {
	const latency = getDisplayLatency(agent);

	if (!latency || !agent.latency) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label="latency"
					className={cn("inline-flex items-center gap-1", latency.color)}
				>
					{/* Platform: a stopwatch before the latency: it is a time */}
					<TimerIcon aria-hidden className="size-3.5" />
					{Math.round(latency.latency_ms)}ms
				</button>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">
				<TooltipTitle>Latency</TooltipTitle>
				<TooltipMessage>
					This is the latency overhead on non peer to peer connections. The
					first row is the preferred relay.
				</TooltipMessage>
				<div className="flex-col gap-1 mt-4">
					{Object.entries(agent.latency)
						.sort(([, a], [, b]) => a.latency_ms - b.latency_ms)
						.map(([regionName, region]) => (
							<div
								className={cn(
									"flex items-center justify-between gap-1",
									region.preferred && "text-content-primary",
								)}
								key={regionName}
							>
								<strong>{regionName}</strong>
								{Math.round(region.latency_ms)}ms
							</div>
						))}
				</div>
			</TooltipContent>
		</Tooltip>
	);
};
