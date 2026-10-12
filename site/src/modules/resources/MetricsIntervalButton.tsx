import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { BARS, LEVELS } from "./MetadataHistogram";
import {
	GRAPH_CHOICES,
	type GraphEvery,
	setGraphEvery,
	shortInterval,
	spanOf,
	useAgentIntervals,
	useGraphEvery,
} from "./metricGraphSettings";

type MetricsIntervalButtonProps = { agentId: string };

/**
 * The agent card's "Metrics Interval" menu, beside Open ports and built like
 * it: the interval in the circle (1s by default), and a compact menu, in order
 * of length, of how often the metric graphs advance: 1 s and 5 s (between the
 * agent's readings the last one holds, dimmer), each reading as the agent
 * sends it (live), a bar per 30 s / 1 min / 5 min holding its highest reading,
 * or off for a browser short on processing power. Shown once the agent has
 * metrics.
 */
export const MetricsIntervalButton: React.FC<MetricsIntervalButtonProps> = ({
	agentId,
}) => {
	const every = useGraphEvery();
	const intervals = useAgentIntervals(agentId);
	if (!intervals || intervals.length === 0) {
		return null;
	}
	const usual = Math.min(...intervals.map((i) => i.s));
	const slower = intervals.filter((i) => i.s !== usual);
	const seconds = (v: number) => v || usual;
	const badge = every === "off" ? "off" : shortInterval(seconds(every));
	// in order of length; live sits at the agent's own interval
	const choices = [...GRAPH_CHOICES].sort(
		(a, b) => seconds(a as number) - seconds(b as number) || (a === 0 ? -1 : 1),
	);
	const covers = (v: number) => spanOf(BARS * seconds(v));

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					size="sm"
					variant="subtle"
					data-testid="metrics-interval-button"
				>
					<span
						className={cn(
							"text-xs font-medium h-5 min-w-5 px-1 rounded-full flex items-center justify-center bg-surface-tertiary tabular-nums",
							every === "off" && "text-content-secondary",
						)}
					>
						{badge}
					</span>
					Metrics Interval
					<ChevronDownIcon />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="p-0 w-[232px] mt-1 text-content-secondary bg-surface-secondary border-surface-quaternary"
			>
				<div className="px-3 pt-2.5 pb-1.5">
					<div className="text-[13px] font-semibold text-content-primary">
						Metrics Interval
					</div>
					<div
						className="text-[11px] leading-snug"
						title={slower.map((o) => `${o.name}: every ${o.s} s`).join("\n")}
					>
						Agent reports every {usual} s
						{slower.length > 0 &&
							` (${slower.length} every ${shortInterval(slower[0].s)})`}
					</div>
				</div>
				<div
					role="radiogroup"
					aria-label="Metrics interval"
					className="flex flex-col border-0 border-y border-solid border-surface-quaternary py-1"
				>
					{[...choices, "off" as const].map((v: GraphEvery) => (
						<button
							key={String(v)}
							type="button"
							role="radio"
							aria-checked={every === v}
							onClick={() => setGraphEvery(v)}
							title={
								v === "off"
									? "No graphs, nothing recorded: for a browser short on processing power"
									: v === 0
										? "A bar per reading, as the agent sends it"
										: v < usual
											? `Advances every ${spanOf(v)}; between the agent's readings the last one holds, dimmer`
											: `A bar per ${spanOf(v)}, its highest reading`
							}
							className={cn(
								"flex cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1 text-left text-inherit hover:bg-surface-tertiary",
								v === "off" &&
									"mt-1 border-0 border-t border-solid border-surface-quaternary pt-1.5",
							)}
						>
							<span className="flex h-[18px] min-w-8 items-center justify-center rounded-full bg-surface-tertiary px-1 text-[11px] font-medium tabular-nums text-content-primary">
								{v === "off" ? "off" : shortInterval(seconds(v))}
							</span>
							<span className="flex-1 text-[13px] text-content-primary">
								{v === "off" ? "Off" : v === 0 ? "Live" : spanOf(v)}
							</span>
							{v !== "off" && (
								<span className="text-[11px] tabular-nums">{covers(v)}</span>
							)}
							<CheckIcon
								className={cn(
									"size-3.5 shrink-0 text-content-primary",
									every !== v && "invisible",
								)}
							/>
						</button>
					))}
				</div>
				<div className="flex flex-col gap-1 px-3 py-2">
					<div
						role="group"
						className="flex items-center gap-1"
						aria-label="Colours: share of what there is"
					>
						{[...LEVELS].reverse().map((l) => (
							<span
								key={l.color}
								className="flex items-center gap-0.5 text-[10px] tabular-nums"
								title={l.label}
							>
								<span
									aria-hidden
									className="inline-block size-2 rounded-[2px]"
									style={{ background: l.color }}
								/>
								{Number.isFinite(l.from) ? `${l.from}%` : "<50"}
							</span>
						))}
					</div>
					<div className="text-[10px] leading-snug">
						Right column: span the graphs cover. Load counts per core.
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
};
