import { cn } from "cn";
import { ChevronDownIcon, TimerIcon } from "lucide-react";
import { useState } from "react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { BARS, LEVELS } from "./MetadataHistogram";

const STORE_KEY = "workspace.metrics.graphEvery";

/** Seconds per bar: 0 = every reading. */
const CHOICES = [
	{ every: 0, label: "Live" },
	{ every: 30, label: "30 s" },
	{ every: 60, label: "1 min" },
	{ every: 300, label: "5 min" },
] as const;

const read = () => {
	try {
		const v = Number(localStorage.getItem(STORE_KEY));
		return CHOICES.some((c) => c.every === v) ? v : 0;
	} catch {
		return 0;
	}
};

/** The graphs' interval, remembered in this browser. */
export const useGraphEvery = () => {
	const [every, setEvery] = useState(read);
	return [
		every,
		(v: number) => {
			setEvery(v);
			try {
				localStorage.setItem(STORE_KEY, String(v));
			} catch {
				// a private window: the choice lasts this visit
			}
		},
	] as const;
};

const span = (seconds: number) =>
	seconds >= 3600
		? `${+(seconds / 3600).toFixed(1)} h`
		: seconds >= 60
			? `${Math.round(seconds / 60)} min`
			: `${seconds} s`;

type MetricGraphsControlProps = {
	metadata: readonly WorkspaceAgentMetadata[];
	every: number;
	onChange: (every: number) => void;
};

/**
 * The last item of the workspace's metrics: how often the graphs above the
 * values advance (each reading the agent sends, or the highest reading of each
 * 30 s / 1 min / 5 min), with how often the agent reports each metric (set in
 * the template) and what the colours mean.
 */
export const MetricGraphsControl: React.FC<MetricGraphsControlProps> = ({
	metadata,
	every,
	onChange,
}) => {
	const intervals = metadata
		.filter((m) => m.description.interval > 0)
		.map((m) => ({
			name: m.description.display_name,
			s: m.description.interval,
		}));
	const usual = intervals.length ? Math.min(...intervals.map((i) => i.s)) : 10;
	const others = intervals.filter((i) => i.s !== usual);
	const covers = BARS * (every || usual);
	const current = CHOICES.find((c) => c.every === every) ?? CHOICES[0];

	return (
		<div className="leading-relaxed flex flex-col overflow-visible shrink-0">
			<div className="text-content-secondary whitespace-nowrap text-[13px]">
				Graphs
			</div>
			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="my-1 flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md border border-solid border-border bg-transparent px-2 text-xs text-content-primary hover:bg-surface-secondary"
						data-testid="metric-graphs-control"
						aria-label={`Graph interval: ${current.label}. Change`}
					>
						<TimerIcon className="size-3.5 text-content-secondary" />
						{every ? `every ${current.label}` : `live · ${usual} s`}
						<ChevronDownIcon className="size-3 text-content-secondary" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-80 p-4">
					<div className="flex flex-col gap-3 text-sm">
						<div>
							<div className="font-semibold">Metric graphs</div>
							<p className="m-0 text-xs text-content-secondary">
								The agent reports every {usual} s
								{others.length > 0 &&
									` (${others.map((o) => `${o.name} ${o.s} s`).join(", ")})`}
								, as set in the template.
							</p>
						</div>
						<div className="flex flex-col gap-1.5">
							<span className="text-xs font-medium text-content-secondary">
								A bar for
							</span>
							<div
								role="radiogroup"
								aria-label="Graph interval"
								className="grid grid-cols-4 gap-1"
							>
								{CHOICES.map((c) => (
									<button
										key={c.every}
										type="button"
										role="radio"
										aria-checked={every === c.every}
										onClick={() => onChange(c.every)}
										className={cn(
											"cursor-pointer rounded-md border border-solid px-1 py-1.5 text-xs",
											every === c.every
												? "border-content-primary bg-surface-secondary font-medium text-content-primary"
												: "border-border bg-transparent text-content-secondary hover:text-content-primary",
										)}
									>
										{c.label}
									</button>
								))}
							</div>
							<span
								className="text-xs text-content-secondary"
								data-testid="metric-graphs-readout"
							>
								{every
									? `Each bar: the highest reading of ${current.label}. `
									: "Live: each bar is one reading, as it arrives. "}
								The graphs cover the last {span(covers)} since this page opened.
							</span>
						</div>
						<div className="flex flex-col gap-1">
							<span className="text-xs font-medium text-content-secondary">
								Colours (share of what there is)
							</span>
							<ul className="m-0 grid list-none grid-cols-1 gap-0.5 p-0 text-xs">
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
							<span className="text-xs text-content-secondary">
								Load average counts per core (1.0 = every core busy).
							</span>
						</div>
					</div>
				</PopoverContent>
			</Popover>
			<div className="text-sm text-content-secondary whitespace-nowrap">
				{span(covers)}
			</div>
		</div>
	);
};
