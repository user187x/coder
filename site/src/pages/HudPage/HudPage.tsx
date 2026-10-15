import { cn } from "cn";
import {
	ArrowUpDownIcon,
	ArrowUpToLineIcon,
	ChevronRightIcon,
	GaugeIcon,
	RotateCcwIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import { Link as RouterLink } from "react-router";
import type { HudMetric } from "#/api/platform";
import { HUD_REFRESH_MS, hud } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Loader } from "#/components/Loader/Loader";
import { Margins } from "#/components/Margins/Margins";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { pageTitle } from "#/utils/page";
import "./hud.css";
import { HudGraphs } from "./HudGraphs";
import { hudIcon } from "./hudIcons";
import { applyOrder, elevate, readHudOrder, writeHudOrder } from "./hudOrder";
import { SystemUptime } from "./SystemUptime";
import { useFitText } from "./useFitText";

/** How many updates each sparkline (and "change") covers: 30 × 10 s = 5 minutes. */
const HISTORY = 30;

/** The totals' line: its text size, shrunk as far as this to keep it one line (px). */
const TOTALS_FONT_MAX = 14;
const TOTALS_FONT_MIN = 7;

const GROUP_LABEL: Record<HudMetric["group"], string> = {
	totals: "Total",
	leaders: "Top account",
	health: "Health",
};

const formatValue = (m: HudMetric) => {
	if (m.value === null) {
		return "—";
	}
	const n = Math.abs(m.value) >= 100 ? Math.round(m.value) : m.value;
	return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

/**
 * The HUD: the platform at a glance, for administrators. Every figure updates
 * in place every 10 seconds, like a ticker, without moving or blinking (a
 * changed tile gets one faint tint that fades); each shows its change over the
 * last five minutes and a sparkline. Clicking a figure opens what is behind it
 * (the top account's workspace, the running workspaces, ...); the Sort menu
 * moves figures to the top, in an order remembered in this browser.
 */
const HudPage: React.FC = () => {
	const { permissions } = useAuthenticated();
	const allowed = Boolean(permissions.viewDeploymentConfig);
	const { data, error } = useQuery({ ...hud(), enabled: allowed });
	const [order, setOrder] = useState(readHudOrder);
	const totalsLine = useRef<HTMLUListElement>(null);
	const totalsFont = useFitText(
		totalsLine,
		TOTALS_FONT_MAX,
		TOTALS_FONT_MIN,
		Boolean(data),
	);
	// Each metric's recent values, and which ones moved with the latest update.
	const [track, setTrack] = useState<{
		series: Record<string, number[]>;
		moved: Set<string>;
		at: string;
	}>({ series: {}, moved: new Set(), at: "" });
	useEffect(() => {
		if (!data) {
			return;
		}
		setTrack((prev) => {
			if (prev.at === data.generatedAt) {
				return prev;
			}
			const series = { ...prev.series };
			const moved = new Set<string>();
			for (const m of data.metrics) {
				if (m.value === null) {
					continue;
				}
				const past = series[m.id] ?? [];
				if (past.length && past[past.length - 1] !== m.value) {
					moved.add(m.id);
				}
				series[m.id] = [...past, m.value].slice(-HISTORY);
			}
			return { series, moved, at: data.generatedAt };
		});
	}, [data]);

	const reorder = (next: string[]) => {
		setOrder(next);
		writeHudOrder(next);
	};

	if (!allowed) {
		return (
			<Margins className="py-10">
				<p className="text-content-secondary">The HUD is for administrators.</p>
			</Margins>
		);
	}

	const metrics = data ? applyOrder(data.metrics, order) : [];
	const totals = data ? data.metrics.filter((m) => m.group === "totals") : [];

	return (
		<>
			<title>{pageTitle("HUD")}</title>
			<Margins className="flex flex-col gap-6 pb-12 pt-8">
				<header className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h1 className="m-0 flex items-center gap-2 text-2xl font-semibold">
							<GaugeIcon aria-hidden className="size-6" />
							HUD
						</h1>
						<p className="m-0 text-sm text-content-secondary">
							The platform at a glance, updated every {HUD_REFRESH_MS / 1000}{" "}
							seconds. Click a figure to open what is behind it.
						</p>
					</div>
					<div className="flex flex-col items-end gap-1.5 text-sm text-content-secondary">
						{data && (
							<span className="flex items-center gap-2" aria-live="off">
								<span
									aria-hidden
									className={cn(
										"inline-block size-2 rounded-full",
										data.live ? "bg-content-success" : "bg-content-warning",
									)}
								/>
								{data.live ? "Live" : "Updated"} ·{" "}
								{new Date(data.generatedAt).toLocaleTimeString("en-US")}
								{!data.live &&
									" · CPU and memory are what was requested: metrics-server is not answering"}
							</span>
						)}
						{data?.uptime && <SystemUptime uptime={data.uptime} />}
					</div>
				</header>

				{error ? <ErrorAlert error={error} /> : null}
				{!data && !error && <Loader />}

				{data && (
					<>
						{/* Every total on one line: the text shrinks (useFitText) rather than wrap. */}
						<ul
							ref={totalsLine}
							aria-label="Totals"
							data-testid="hud-totals"
							className="m-0 flex list-none flex-nowrap items-baseline justify-between gap-x-[1.75em] overflow-hidden whitespace-nowrap rounded-lg border border-solid border-border bg-surface-secondary/40 px-4 py-3 font-mono leading-5"
							style={{ fontSize: `${totalsFont}px` }}
						>
							{totals.map((m) => (
								<li key={m.id} className="shrink-0">
									<MetricLink
										metric={m}
										className="flex items-baseline gap-[0.6em] text-inherit no-underline hover:underline"
									>
										<span className="text-content-secondary">{m.label}</span>
										<span className="font-semibold tabular-nums text-content-primary">
											{formatValue(m)}
											{m.unit && m.value !== null ? ` ${m.unit}` : ""}
										</span>
										<Delta series={track.series[m.id]} inline />
									</MetricLink>
								</li>
							))}
						</ul>

						{/* The Sort menu sits with the graphs' controls, not over the totals (which grow). */}
						<HudGraphs
							leading={
								<SortMenu
									metrics={metrics}
									order={order}
									onRaise={(id) => reorder(elevate(order, id))}
									onReset={() => reorder([])}
								/>
							}
						/>

						<ul
							aria-label="Metrics"
							className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3 p-0"
						>
							{metrics.map((m, i) => (
								<li key={m.id}>
									<MetricTile
										metric={m}
										series={track.series[m.id]}
										first={i === 0 && order[0] === m.id}
										flash={
											track.at === data.generatedAt && track.moved.has(m.id)
										}
									/>
								</li>
							))}
						</ul>
					</>
				)}
			</Margins>
		</>
	);
};

/** `inline`: in the totals' line, its size following the line's. */
const Delta: React.FC<{ series?: number[]; inline?: boolean }> = ({
	series,
	inline,
}) => {
	if (!series || series.length < 2) {
		return null;
	}
	const change = series[series.length - 1] - series[0];
	if (Math.abs(change) < 1e-9) {
		return null;
	}
	return (
		<span
			className={cn(
				"tabular-nums text-content-secondary",
				inline ? "text-[0.85em]" : "text-xs",
			)}
			title="Change over the last few minutes"
		>
			{change > 0 ? "▲" : "▼"}{" "}
			{Math.abs(change).toLocaleString("en-US", { maximumFractionDigits: 2 })}
		</span>
	);
};

const Sparkline: React.FC<{ series?: number[] }> = ({ series }) => {
	if (!series || series.length < 2) {
		return <div className="h-7" />;
	}
	const min = Math.min(...series);
	const max = Math.max(...series);
	const span = max - min || 1;
	const points = series
		.map(
			(v, i) =>
				`${(i / (series.length - 1)) * 100},${26 - ((v - min) / span) * 22}`,
		)
		.join(" ");
	return (
		<svg
			aria-hidden
			viewBox="0 0 100 28"
			preserveAspectRatio="none"
			className="h-7 w-full text-content-link opacity-60"
		>
			<polyline
				points={points}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
};

type SortMenuProps = {
	metrics: readonly HudMetric[];
	order: readonly string[];
	onRaise: (id: string) => void;
	onReset: () => void;
};

/** Sort: pick a figure to move it to the top (the last one picked leads). */
const SortMenu: React.FC<SortMenuProps> = ({
	metrics,
	order,
	onRaise,
	onReset,
}) => (
	<DropdownMenu>
		<DropdownMenuTrigger asChild>
			<Button variant="outline" size="sm">
				<ArrowUpDownIcon />
				Sort
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent
			align="end"
			className="max-h-[min(70vh,32rem)] w-64 overflow-y-auto"
		>
			<DropdownMenuLabel>Move to the top</DropdownMenuLabel>
			{metrics.map((m, i) => (
				<DropdownMenuItem key={m.id} onSelect={() => onRaise(m.id)}>
					<ArrowUpToLineIcon
						aria-hidden
						className={cn(
							"size-3.5 shrink-0",
							i === 0 && order[0] === m.id ? "opacity-100" : "opacity-40",
						)}
					/>
					<span className="flex-1 truncate">{m.label}</span>
					<span className="text-xs text-content-secondary">
						{GROUP_LABEL[m.group]}
					</span>
				</DropdownMenuItem>
			))}
			<DropdownMenuSeparator />
			<DropdownMenuItem disabled={order.length === 0} onSelect={onReset}>
				<RotateCcwIcon aria-hidden className="size-3.5" />
				Reset order
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
);

const describeMetric = (metric: HudMetric) =>
	`${metric.label}: ${formatValue(metric)} ${metric.unit}${metric.detail ? `, ${metric.detail}` : ""}`;

/** A figure as a link to what is behind it, or as plain text when nothing is. */
const MetricLink: React.FC<{
	metric: HudMetric;
	className: string;
	title?: string;
	children: React.ReactNode;
}> = ({ metric, className, title, children }) =>
	metric.href ? (
		<RouterLink
			to={metric.href}
			className={className}
			title={title}
			aria-label={`${describeMetric(metric)}. Open.`}
		>
			{children}
		</RouterLink>
	) : (
		<div className={className} title={title}>
			{children}
		</div>
	);

type MetricTileProps = {
	metric: HudMetric;
	series?: number[];
	first: boolean;
	flash: boolean;
};

const MetricTile: React.FC<MetricTileProps> = ({
	metric,
	series,
	first,
	flash,
}) => {
	const Icon = hudIcon(metric.id);
	return (
		<MetricLink
			metric={metric}
			title={metric.hint || undefined}
			className={cn(
				"group flex h-full w-full flex-col gap-1 rounded-lg border border-solid border-border bg-surface-primary p-4 text-left text-content-primary no-underline",
				metric.href &&
					"cursor-pointer motion-safe:transition-colors hover:border-content-secondary",
				first && "border-content-link",
				flash && "hud-flash",
			)}
		>
			<span className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-content-secondary">
				<span className="flex min-w-0 items-center gap-1.5">
					<Icon
						aria-hidden
						data-testid="hud-metric-icon"
						className="size-3.5 shrink-0"
					/>
					<span className="truncate">{metric.label}</span>
				</span>
				<span className="flex shrink-0 items-center gap-1 normal-case tracking-normal">
					{GROUP_LABEL[metric.group]}
					{metric.href && (
						<ChevronRightIcon
							aria-hidden
							className="size-3.5 opacity-0 group-hover:opacity-100"
						/>
					)}
				</span>
			</span>
			<span className="flex items-baseline gap-1.5">
				<span className="text-3xl font-semibold tabular-nums">
					{formatValue(metric)}
				</span>
				{metric.unit && metric.value !== null && (
					<span className="text-sm text-content-secondary">{metric.unit}</span>
				)}
				<span className="ml-auto">
					<Delta series={series} />
				</span>
			</span>
			<span
				className={cn(
					"truncate text-sm",
					metric.group === "leaders"
						? "font-medium text-content-primary"
						: "text-content-secondary",
				)}
			>
				{metric.detail || " "}
			</span>
			<Sparkline series={series} />
		</MetricLink>
	);
};

export default HudPage;
