import { cn } from "cn";
import dayjs from "dayjs";
import { useLayoutEffect, useRef } from "react";
import type { WorkspaceAgentMetadata } from "#/api/typesGenerated";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { loadReading, metricCapacity } from "./infrastructureMetrics";
import {
	levelColor,
	MetadataHistogram,
	oneDecimal,
	shareOf,
	splitPercent,
} from "./MetadataHistogram";
import { metricName, metricRank } from "./metadataGroups";
import type { GraphEvery } from "./metricGraphSettings";

type ItemStatus = "stale" | "valid" | "loading" | "error";

type MetadataItemProps = {
	item: WorkspaceAgentMetadata;
	maximum?: { text: string; label: string } | null;
	maximumUnavailableLabel?: string;
	/** Its readings so far, for the live graph above the value. */
	history: React.ComponentProps<typeof MetadataHistogram>["samples"];
	/** Seconds per bar (0: one per reading); "off": no graph. */
	every: GraphEvery;
	/** Stopped at (ms): its graph stays as it was then. */
	pausedAt?: number;
};

export const MetadataItem: React.FC<MetadataItemProps> = ({
	item,
	maximum,
	maximumUnavailableLabel = "Assigned maximum not reported",
	history,
	every,
	pausedAt,
}) => {
	const staleThreshold = Math.max(
		item.description.interval + item.description.timeout * 2,
		// In case there is intense backpressure, we give a little bit of slack.
		5,
	);

	const status: ItemStatus = (() => {
		if (item.result.error) return "error";
		const year = dayjs(item.result.collected_at).year();
		if (year <= 1970 || Number.isNaN(year)) {
			return "loading";
		}
		// There is a special circumstance for metadata with `interval: 0`. It is
		// expected that they run once and never again, so never display them as
		// stale.
		if (item.result.age > staleThreshold && item.description.interval > 0) {
			return "stale";
		}
		return "valid";
	})();

	// Assigned capacity and current utilization are shown separately.
	const reading = splitPercent(oneDecimal(item.result.value));
	const capacity =
		metricRank(item) === 3
			? loadReading(item)
			: maximum === undefined
				? metricCapacity(item.result.value)
				: maximum;
	const numeric = /^\s*-?\d/.test(item.result.value);
	const resource = numeric || capacity !== null || metricRank(item) < 4;
	const percent =
		status === "loading" || item.result.error.length > 0
			? null
			: reading.percent;

	// Stale data is as good as no data. Plus, we want to build confidence in our
	// users that what's shown is real. If times aren't correctly synced this
	// could be buggy. But, how common is that anyways?
	const value =
		status === "loading" ? (
			<Skeleton
				width={65}
				height={12}
				variant="text"
				className="mx-auto mt-[6px]"
			/>
		) : status === "stale" ? (
			<Tooltip>
				<TooltipTrigger asChild>
					<StaticWidth className="mx-auto text-center text-ellipsis overflow-hidden whitespace-nowrap max-w-full text-[13px] text-content-disabled cursor-pointer">
						{reading.text}
					</StaticWidth>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					This data is stale and no longer up to date
				</TooltipContent>
			</Tooltip>
		) : (
			// Platform: never wider than its column (StaticWidth only grows): a long reading - a script's error - is cut
			// short, whole on hover, instead of widening its group and pushing the next one aside for good; centred
			// under the graph
			<StaticWidth
				className={cn(
					"mx-auto text-center text-ellipsis overflow-hidden whitespace-nowrap max-w-full text-[13px] text-content-success",
					item.result.error.length > 0 && "text-content-destructive",
				)}
				title={item.result.error || reading.text}
			>
				{item.result.error && resource ? "Unavailable" : reading.text}
			</StaticWidth>
		);

	return (
		<div className="leading-relaxed flex w-full min-w-0 flex-col">
			<div className="flex flex-wrap items-center justify-between gap-1">
				<div
					className="flex min-w-0 flex-wrap items-center gap-1"
					title={`${metricName(item)}: ${status === "stale" ? "Stale reading: " : ""}${item.result.error || item.result.value}`}
				>
					<span className="max-w-full shrink-0 text-content-secondary text-ellipsis overflow-hidden whitespace-nowrap text-xs">
						{metricName(item)}
					</span>
					{resource && (
						<span
							className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-surface-tertiary px-1 text-[11px] font-medium tabular-nums text-content-primary"
							role="img"
							aria-label={
								capacity?.label ??
								(metricRank(item) === 3
									? "Load average unavailable"
									: maximumUnavailableLabel)
							}
							title={
								capacity?.label ??
								(metricRank(item) === 3
									? "Load average unavailable"
									: maximumUnavailableLabel)
							}
						>
							{capacity?.text ?? "?"}
						</span>
					)}
				</div>
				{percent !== null && (
					<PercentChip percent={percent} stale={status === "stale"} />
				)}
			</div>

			{every !== "off" && history.length > 0 && (
				<MetadataHistogram
					samples={history}
					share={shareOf(item)}
					every={every}
					hold={
						every > 0 && every < item.description.interval
							? item.description.interval * 1.5 + item.description.timeout
							: 0
					}
					stale={status !== "valid"}
					label={metricName(item)}
					pausedAt={pausedAt}
				/>
			)}

			{(!numeric || status === "loading" || status === "error") && (
				<div data-testid="metadata-value" className="text-center">
					{value}
				</div>
			)}
		</div>
	);
};

/** The reading's percentage, tinted like its graph (levelColor). */
const PercentChip: React.FC<{ percent: number; stale: boolean }> = ({
	percent,
	stale,
}) => {
	const color = levelColor(percent);
	return (
		<span
			className={cn(
				"shrink-0 rounded-md border border-solid px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums",
				stale && "border-border text-content-disabled",
			)}
			style={
				stale
					? undefined
					: {
							color,
							borderColor: `${color}66`,
							backgroundColor: `${color}1a`,
						}
			}
			data-testid="metadata-percent"
		>
			{Math.round(percent)}%
		</span>
	);
};

const StaticWidth: React.FC<Omit<React.ComponentProps<"div">, "ref">> = ({
	children,
	...attrs
}) => {
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		// Ignore this in storybook
		if (!ref.current || process.env.STORYBOOK === "true") {
			return;
		}

		const currentWidth = ref.current.getBoundingClientRect().width;
		ref.current.style.width = "auto";
		const autoWidth = ref.current.getBoundingClientRect().width;
		ref.current.style.width =
			autoWidth > currentWidth ? `${autoWidth}px` : `${currentWidth}px`;
	}, [children]);

	return (
		<div ref={ref} {...attrs}>
			{children}
		</div>
	);
};
