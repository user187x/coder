import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { StatusIndicatorDot } from "#/components/StatusIndicator/StatusIndicator";
import { UsageBar } from "#/components/UsageBar/UsageBar";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { QuotaBar } from "./dashboardCharts";
import {
	type DashboardScope,
	type DashboardWorkspace,
	type Resource,
	WATERMARK_TEXT,
	watermarkLevel,
} from "./dashboardModel";
import { RESOURCE_STYLE } from "./SummaryCard";

/** Rows shown before the rest sit behind "Show more". */
const VISIBLE_ROWS = 6;

const statusVariant = (status: string) =>
	status === "running"
		? "success"
		: status === "failed" || status === "canceled"
			? "failed"
			: status === "stopped" || status === "deleted"
				? "inactive"
				: "pending";

const statusText = (status: string) =>
	status ? status[0].toUpperCase() + status.slice(1) : "Unknown";

const workspaceHref = (w: DashboardWorkspace, me: string) =>
	`/@${encodeURIComponent(w.owner ?? me)}/${encodeURIComponent(w.name)}`;

/** A list that shows its first rows and keeps the rest in a keyboard-reachable drawer. */
const Drawer = <T,>({
	items,
	render,
	noun,
}: {
	items: readonly T[];
	render: (item: T) => React.ReactNode;
	noun: string;
}) => {
	const [open, setOpen] = useState(false);
	const shown = items.slice(0, VISIBLE_ROWS);
	const rest = items.slice(VISIBLE_ROWS);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<ul className="m-0 flex list-none flex-col gap-3 p-0">
				{shown.map(render)}
			</ul>
			{rest.length > 0 && (
				<>
					<CollapsibleContent asChild>
						<ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
							{rest.map(render)}
						</ul>
					</CollapsibleContent>
					<CollapsibleTrigger className="mt-3 flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-medium text-content-link">
						{open ? `Show fewer ${noun}` : `Show ${rest.length} more ${noun}`}
						<ChevronDownIcon
							aria-hidden
							className={cn(
								"size-3.5 transition-transform",
								open && "rotate-180",
							)}
						/>
					</CollapsibleTrigger>
				</>
			)}
		</Collapsible>
	);
};

const SHARE_ORDER: readonly Resource[] = ["cpu", "memory", "disk"];

/** Three thin bars: the workspace's share of each limit. */
const ShareBars: React.FC<{
	workspace: DashboardWorkspace;
	limits: DashboardScope["limits"];
	limitName: string;
}> = ({ workspace, limits, limitName }) => {
	const shares = SHARE_ORDER.map((r) => {
		const limit = limits[r];
		return {
			resource: r,
			share: limit && limit > 0 ? workspace[r] / limit : null,
		};
	});
	const label = `${workspace.name} share of ${limitName}: ${shares
		.map(
			(s) =>
				`${RESOURCE_STYLE[s.resource].label} ${s.share === null ? "no limit" : `${Math.round(s.share * 100)}%`}`,
		)
		.join(", ")}`;
	return (
		<div role="img" aria-label={label} className="flex w-20 flex-col gap-0.5">
			{shares.map((s) => (
				<div
					key={s.resource}
					className="h-1 overflow-hidden rounded-full bg-surface-tertiary"
				>
					<div
						className={cn(
							"h-full rounded-full",
							RESOURCE_STYLE[s.resource].dot,
						)}
						style={{ width: `${Math.min(100, (s.share ?? 0) * 100)}%` }}
					/>
				</div>
			))}
		</div>
	);
};

export const WorkspacesCardBody: React.FC<{
	scope: DashboardScope;
	me: string;
	limitName: string;
}> = ({ scope, me, limitName }) => {
	const rows = [...scope.workspaces].sort(
		(a, b) =>
			Number(b.running) - Number(a.running) ||
			b.cpu + b.memory - (a.cpu + a.memory),
	);
	return (
		<Drawer
			items={rows}
			noun="workspaces"
			render={(w) => (
				<li key={w.id} className="flex items-center gap-3">
					<StatusIndicatorDot
						size="sm"
						variant={statusVariant(w.status)}
						aria-hidden
					/>
					<div className="flex min-w-0 flex-1 flex-col">
						<Link
							to={workspaceHref(w, me)}
							className="truncate text-sm font-medium text-content-primary no-underline hover:underline"
						>
							{w.owner ? `${w.owner}/${w.name}` : w.name}
						</Link>
						<span className="text-xs text-content-secondary">
							{statusText(w.status)}
							{w.template ? ` · ${w.template}` : ""}
						</span>
					</div>
					<span className="text-right text-xs tabular-nums text-content-secondary">
						{formatQuotaNumber(w.cpu)} {w.cpu === 1 ? "core" : "cores"}
						<br />
						{formatQuotaNumber(w.memory)} GiB · {formatQuotaNumber(w.disk)} GB
					</span>
					<ShareBars
						workspace={w}
						limits={scope.limits}
						limitName={limitName}
					/>
				</li>
			)}
		/>
	);
};

export type DiskReading = { used: number; total: number } | null;

export const DisksCardBody: React.FC<{
	scope: DashboardScope;
	disks: ReadonlyMap<string, DiskReading>;
	limitName: string;
}> = ({ scope, disks, limitName }) => {
	const rows = [...scope.workspaces].sort((a, b) => b.disk - a.disk);
	return (
		<div className="flex flex-col gap-4">
			<Drawer
				items={rows}
				noun="volumes"
				render={(w) => {
					const reading = disks.get(w.id) ?? null;
					const size = reading?.total || w.disk;
					const level = reading ? watermarkLevel(reading.used, size) : "none";
					return (
						<li key={w.id} className="flex flex-col gap-1">
							<div className="flex items-baseline justify-between gap-2 text-xs">
								<span className="truncate font-medium text-content-primary">
									{w.owner ? `${w.owner}/${w.name}` : w.name}
								</span>
								<span className="tabular-nums text-content-secondary">
									{reading
										? `${formatQuotaNumber(reading.used)} / ${formatQuotaNumber(size)} GB`
										: `${formatQuotaNumber(size)} GB${w.running ? "" : ", not running"}`}
								</span>
							</div>
							{reading && (
								<UsageBar
									percent={size > 0 ? (reading.used / size) * 100 : 0}
									severity={
										level === "danger"
											? "exceeded"
											: level === "warning"
												? "warning"
												: "normal"
									}
									ariaLabel={`${w.name} disk: ${formatQuotaNumber(reading.used)} of ${formatQuotaNumber(size)} GB used, ${WATERMARK_TEXT[level].toLowerCase().replace("quota", "size")}`}
								/>
							)}
						</li>
					);
				}}
			/>
			<div className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4">
				<div className="flex items-baseline justify-between text-xs">
					<span className="font-semibold text-content-primary">
						Total allocated
					</span>
					<span className="tabular-nums text-content-secondary">
						{formatQuotaNumber(scope.allocated.disk)}
						{scope.limits.disk === null
							? " GB"
							: ` / ${formatQuotaNumber(scope.limits.disk)} GB`}
					</span>
				</div>
				<QuotaBar
					label="Disk allocated"
					unit="GB"
					limit={scope.limits.disk}
					limitName={limitName}
					segments={[
						{
							label: "Running",
							value: scope.running.disk,
							fill: "bg-highlight-green",
						},
						{
							label: "Stopped",
							value: scope.stopped.disk,
							fill: "bg-highlight-grey",
						},
					]}
				/>
			</div>
		</div>
	);
};
