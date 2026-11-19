import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useQuery } from "react-query";
import { coderHeartbeat } from "#/api/queries/platform";
import "./hudHeartbeat.css";

const baseline = "M0 23 H200";
const warningLatency = 250;
const criticalLatency = 800;

function heartbeatTrace(latency: number) {
	const spacing = 32 + 168 * Math.min(latency / criticalLatency, 1);
	const beats = Math.floor(200 / spacing);
	const first = (200 - (beats - 1) * spacing) / 2;
	const pulses = Array.from({ length: beats }, (_, index) => {
		const start = first + index * spacing - 14;
		return `H${start} l3 -3 3 3 3 0 2 5 3 -21 4 28 4 -12 q3 -4 6 0`;
	});
	return `M0 23 ${pulses.join(" ")} H200`;
}

/** Draws one sweep for each successful probe, with slower responses represented by wider beat spacing. */
export const HudHeartbeat = () => {
	const heartbeat = useQuery(coderHeartbeat());
	const reading = heartbeat.isSuccess ? heartbeat.data : undefined;
	const latency = reading?.latency;
	const previous = reading?.previous;
	const change =
		latency !== undefined && previous !== undefined ? latency - previous : 0;
	const Trend = change > 0 ? ArrowUpIcon : ArrowDownIcon;
	const ok = "hsl(var(--content-link))";
	const warning = "var(--hud-heartbeat-warning)";
	const critical = "var(--hud-heartbeat-critical)";
	const color =
		latency === undefined
			? heartbeat.isError
				? critical
				: ok
			: latency < warningLatency
				? `color-mix(in srgb, ${ok}, ${warning} ${(latency / warningLatency) * 100}%)`
				: `color-mix(in srgb, ${warning}, ${critical} ${Math.min((latency - warningLatency) / (criticalLatency - warningLatency), 1) * 100}%)`;

	return (
		<div className="hud-heartbeat" style={{ color }}>
			<div className="flex items-center justify-between gap-2 px-2 pt-1.5 text-xs">
				<span className="font-medium text-content-primary">
					Coder heartbeat
				</span>
				<span
					className="flex items-center gap-0.5 font-mono tabular-nums"
					aria-live="polite"
				>
					{change !== 0 && (
						<>
							<Trend aria-hidden className="size-3 shrink-0" />
							<span className="sr-only">
								{change > 0 ? "Latency increased" : "Latency decreased"}
							</span>
						</>
					)}
					{latency !== undefined ? (
						<span>{latency} ms</span>
					) : heartbeat.isError ? (
						"No response"
					) : (
						"Checking…"
					)}
				</span>
			</div>
			<svg
				aria-hidden
				viewBox="0 0 200 44"
				preserveAspectRatio="none"
				className="block h-10 w-full"
			>
				<path
					d={baseline}
					className={
						heartbeat.isError
							? "hud-heartbeat-flatline"
							: "hud-heartbeat-baseline"
					}
				/>
				{latency !== undefined && (
					<path
						key={heartbeat.dataUpdatedAt}
						d={heartbeatTrace(latency)}
						pathLength={1}
						className="hud-heartbeat-trace"
					/>
				)}
			</svg>
		</div>
	);
};
