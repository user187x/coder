import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	HelpPopoverText,
	HelpPopoverTitle,
} from "#/components/HelpPopover/HelpPopover";
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

type RefreshIntervalButtonProps = { agentId: string };

/**
 * The agent card's "Refresh Interval" menu, beside Open ports and built like
 * it: the interval in the circle (10s, 30s, 1m, 5m, or off), and a popover to
 * change how often the metric graphs advance (each reading the agent sends, or
 * a bar per 30 s / 1 min / 5 min holding its highest reading), or to turn them
 * off on a browser short on processing power. Shown once the agent has metrics.
 */
export const RefreshIntervalButton: React.FC<RefreshIntervalButtonProps> = ({
	agentId,
}) => {
	const every = useGraphEvery();
	const intervals = useAgentIntervals(agentId);
	if (!intervals || intervals.length === 0) {
		return null;
	}
	const usual = Math.min(...intervals.map((i) => i.s));
	const others = intervals.filter((i) => i.s !== usual);
	const badge = every === "off" ? "off" : shortInterval(every || usual);

	const label = (v: GraphEvery) =>
		v === "off" ? "Off" : v === 0 ? "Live" : spanOf(v);
	const detail = (v: GraphEvery) =>
		v === "off"
			? "No graphs, nothing recorded: for a browser short on processing power"
			: v === 0
				? `A bar per reading, as the agent sends it (every ${usual} s)`
				: `A bar per ${spanOf(v)}: its highest reading · covers ${spanOf(BARS * v)}`;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					size="sm"
					variant="subtle"
					data-testid="refresh-interval-button"
				>
					<span
						className={cn(
							"text-xs font-medium h-5 min-w-5 px-1 rounded-full flex items-center justify-center bg-surface-tertiary tabular-nums",
							every === "off" && "text-content-secondary",
						)}
					>
						{badge}
					</span>
					Refresh Interval
					<ChevronDownIcon />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="p-0 w-[360px] mt-1 text-content-secondary bg-surface-secondary border-surface-quaternary"
			>
				<div className="flex flex-col p-5 pb-3">
					<HelpPopoverTitle>Refresh Interval</HelpPopoverTitle>
					<HelpPopoverText>
						How often the metric graphs above the values advance. The agent
						reports every {usual} s
						{others.length > 0 &&
							` (${others.map((o) => `${o.name} ${o.s} s`).join(", ")})`}
						, as set in the template.
					</HelpPopoverText>
				</div>
				<div
					role="radiogroup"
					aria-label="Refresh interval"
					className="flex flex-col border-0 border-y border-solid border-surface-quaternary py-1"
				>
					{[...GRAPH_CHOICES, "off" as const].map((v) => (
						<button
							key={String(v)}
							type="button"
							role="radio"
							aria-checked={every === v}
							onClick={() => setGraphEvery(v)}
							className={cn(
								"flex cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-2 text-left text-inherit hover:bg-surface-tertiary",
								v === "off" &&
									"mt-1 border-0 border-t border-solid border-surface-quaternary pt-3",
							)}
						>
							<span className="flex h-5 min-w-9 items-center justify-center rounded-full bg-surface-tertiary px-1 text-xs font-medium tabular-nums text-content-primary">
								{v === "off" ? "off" : shortInterval(v || usual)}
							</span>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="text-sm font-medium text-content-primary">
									{label(v)}
								</span>
								<span className="text-xs">{detail(v)}</span>
							</span>
							<CheckIcon
								className={cn(
									"size-4 shrink-0 text-content-primary",
									every !== v && "invisible",
								)}
							/>
						</button>
					))}
				</div>
				<div className="flex flex-col gap-1.5 p-5 pt-3">
					<span className="text-xs font-medium text-content-primary">
						Colours (share of what there is)
					</span>
					<ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-0.5 p-0 text-xs">
						{LEVELS.map((l) => (
							<li key={l.color} className="flex items-center gap-2">
								<span
									aria-hidden
									className="inline-block size-2.5 rounded-sm"
									style={{ background: l.color }}
								/>
								{l.label}
							</li>
						))}
					</ul>
					<span className="text-xs">
						Load average counts per core (1.0 = every core busy). The graphs
						start when this page opens.
					</span>
				</div>
			</PopoverContent>
		</Popover>
	);
};
