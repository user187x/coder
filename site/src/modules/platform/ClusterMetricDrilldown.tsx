import { cn } from "cn";
import { createContext, useContext, useId, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { ClusterMetricHistoryChart } from "./ClusterMetricHistoryChart";
import {
	type ClusterMetric,
	type ClusterMetricSample,
	type ClusterMetricSelection,
	clusterMetrics,
	hudSamplePath,
	nearestSample,
} from "./clusterMetricHistory";

const Drilldown = createContext<
	| {
			sample: (
				metric: ClusterMetric,
				sample: ClusterMetricSample,
				every: number,
				control: HTMLButtonElement,
			) => void;
			range: (
				selection: ClusterMetricSelection,
				control: HTMLButtonElement,
			) => void;
	  }
	| undefined
>(undefined);

/** Shares the HUD navigation and range dialog across both Settings layouts. */
export function ClusterMetricDrilldown({
	canViewHud,
	children,
}: {
	canViewHud: boolean;
	children: React.ReactNode;
}) {
	const navigate = useNavigate();
	const [range, setRange] = useState<ClusterMetricSelection>();
	const returnFocus = useRef<HTMLButtonElement>(null);
	const showRange = (
		selection: ClusterMetricSelection,
		control: HTMLButtonElement,
	) => {
		returnFocus.current = control;
		setRange(selection);
	};
	const first = range?.samples[0];
	const last = range?.samples.at(-1);
	return (
		<Drilldown.Provider
			value={{
				range: showRange,
				sample: (metric, sample, every, control) => {
					if (canViewHud) void navigate(hudSamplePath(metric, sample.t));
					else showRange({ metric, every, samples: [sample] }, control);
				},
			}}
		>
			{children}
			<Dialog
				open={Boolean(range)}
				onOpenChange={(open) => !open && setRange(undefined)}
			>
				{range && first && last && (
					<DialogContent
						className="w-[min(94vw,52rem)] max-w-none gap-4 rounded-2xl"
						overlayClassName="backdrop-blur-md"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							returnFocus.current?.focus();
						}}
					>
						<DialogTitle>{clusterMetrics[range.metric].title}</DialogTitle>
						<DialogDescription>
							{new Date(first.t * 1000).toLocaleString("en-US")}
							{last.t !== first.t &&
								` to ${new Date(last.t * 1000).toLocaleString("en-US")}`}
						</DialogDescription>
						<ClusterMetricHistoryChart {...range} />
						<DialogClose asChild>
							<Button variant="outline" className="justify-self-end">
								Close
							</Button>
						</DialogClose>
					</DialogContent>
				)}
			</Dialog>
		</Drilldown.Provider>
	);
}

type PlotSnapshot<T extends ClusterMetricSample> = {
	samples: T[];
	start: number;
	span: number;
	every: number;
};

function sampleAt<T extends ClusterMetricSample>(
	plot: PlotSnapshot<T>,
	offset: number,
	length: number,
) {
	const fraction = length ? Math.min(1, Math.max(0, offset / length)) : 1;
	return nearestSample(plot.samples, plot.start + fraction * plot.span);
}

export function ClusterMetricPlot<T extends ClusterMetricSample>({
	metric,
	samples,
	every,
	start,
	span,
	vertical = false,
	summary,
	className,
	children,
}: PlotSnapshot<T> & {
	metric: ClusterMetric;
	vertical?: boolean;
	summary?: string;
	className?: string;
	children: (samples: T[]) => React.ReactNode;
}) {
	const actions = useContext(Drilldown);
	const instructions = useId();
	const gesture = useRef<
		| {
				pointer: number;
				coordinate: number;
				from: number;
				plot: PlotSnapshot<T>;
		  }
		| undefined
	>(undefined);
	const [selection, setSelection] = useState<{
		from: number;
		to: number;
		plot: PlotSnapshot<T>;
	}>();
	if (!actions) return children(samples);
	const reset = () => {
		gesture.current = undefined;
		setSelection(undefined);
	};
	const coordinate = (event: React.PointerEvent<HTMLButtonElement>) =>
		vertical ? event.clientY : event.clientX;
	const readingAt = (
		plot: PlotSnapshot<T>,
		event: React.PointerEvent<HTMLButtonElement>,
	) => {
		const box = event.currentTarget.getBoundingClientRect();
		return sampleAt(
			plot,
			coordinate(event) - (vertical ? box.top : box.left),
			vertical ? box.height : box.width,
		);
	};
	const percent = (t: number, plot: PlotSnapshot<T>) =>
		Math.min(100, Math.max(0, (100 * (t - plot.start)) / plot.span));
	const from = selection
		? percent(
				Math.min(selection.from, selection.to) - selection.plot.every / 2,
				selection.plot,
			)
		: 0;
	const to = selection
		? percent(
				Math.max(selection.from, selection.to) + selection.plot.every / 2,
				selection.plot,
			)
		: 0;

	return (
		<DropdownMenuItem
			asChild
			disabled={!samples.length}
			className={cn(
				"relative m-0 block w-full min-w-0 cursor-pointer touch-none overflow-hidden rounded p-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-content-link [&>svg]:size-full",
				className,
			)}
			onSelect={(event) => event.preventDefault()}
		>
			<button
				type="button"
				data-metric-plot=""
				aria-label={clusterMetrics[metric].title}
				aria-describedby={instructions}
				title={summary}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					const plot = { samples, every, start, span };
					const sample = readingAt(plot, event);
					if (!sample) return;
					gesture.current = {
						pointer: event.pointerId,
						coordinate: coordinate(event),
						from: sample.t,
						plot,
					};
					event.currentTarget.setPointerCapture?.(event.pointerId);
				}}
				onPointerMove={(event) => {
					const held = gesture.current;
					if (
						held?.pointer !== event.pointerId ||
						Math.abs(coordinate(event) - held.coordinate) < 5
					)
						return;
					const sample = readingAt(held.plot, event);
					if (sample && sample.t !== selection?.to)
						setSelection({ from: held.from, to: sample.t, plot: held.plot });
				}}
				onPointerUp={(event) => {
					const held = gesture.current;
					if (held?.pointer !== event.pointerId) return;
					const sample = readingAt(held.plot, event);
					reset();
					if (!sample) return;
					if (Math.abs(coordinate(event) - held.coordinate) >= 5) {
						const from = Math.min(held.from, sample.t);
						const to = Math.max(held.from, sample.t);
						actions.range(
							{
								metric,
								every: held.plot.every,
								samples: held.plot.samples.filter(
									(sample) => sample.t >= from && sample.t <= to,
								),
							},
							event.currentTarget,
						);
					} else {
						actions.sample(
							metric,
							sample,
							held.plot.every,
							event.currentTarget,
						);
					}
				}}
				onPointerCancel={reset}
				onLostPointerCapture={reset}
				onClick={(event) => {
					const latest = samples.at(-1);
					if (event.detail === 0 && latest)
						actions.sample(metric, latest, every, event.currentTarget);
				}}
			>
				<span id={instructions} hidden>
					Activate a sample or drag to select a time range.
				</span>
				{children(selection?.plot.samples ?? samples)}
				{selection && (
					<span
						aria-hidden
						className="pointer-events-none absolute border border-solid border-content-primary bg-content-primary/20"
						style={
							vertical
								? { insetInline: 0, top: `${from}%`, height: `${to - from}%` }
								: { insetBlock: 0, left: `${from}%`, width: `${to - from}%` }
						}
					/>
				)}
			</button>
		</DropdownMenuItem>
	);
}
