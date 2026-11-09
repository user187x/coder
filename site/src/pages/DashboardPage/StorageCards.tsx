import { LockIcon } from "lucide-react";
import type { CloudDriveSettings, SafeSummary } from "#/api/platform";
import {
	StatusIndicator,
	StatusIndicatorDot,
} from "#/components/StatusIndicator/StatusIndicator";
import { formatBytes } from "#/modules/platform/cloudDrive/drivePaths";
import { formatQuotaNumber } from "#/pages/UsersPage/quotaFormatting";
import { DottedRow, GraphFrame, ShowWorkspaces } from "./DashboardCard";
import { QuotaBar, WatermarkBadge } from "./dashboardCharts";
import { type DashboardWorkspace, watermarkLevel } from "./dashboardModel";

const connection = (
	drive: SafeSummary,
	settings: CloudDriveSettings | undefined,
): { variant: "success" | "failed" | "warning" | "inactive"; text: string } => {
	if (drive.offline) {
		return { variant: "warning", text: `Offline: ${drive.offline}` };
	}
	if (drive.volume === "pending") {
		return { variant: "warning", text: "Preparing its volume" };
	}
	const connected = settings?.status.connected;
	if (connected === false) {
		return {
			variant: "failed",
			text: settings?.status.error
				? `Disconnected: ${settings.status.error}`
				: "Disconnected",
		};
	}
	return connected
		? { variant: "success", text: "Connected" }
		: { variant: "inactive", text: "Not checked yet" };
};

/**
 * The caller's Cloud Drive: their files and the room they use in drives shared with them, against what they may
 * use (their own quota plus those drives'), with the backend's connection.
 */
export const CloudDriveCardBody: React.FC<{
	drive: SafeSummary;
	settings: CloudDriveSettings | undefined;
	/** The account's workspaces and whether each has the drive connected (a workspace can be disconnected). */
	workspaces?: readonly { id: string; label: string; value: string }[];
}> = ({ drive, settings, workspaces = [] }) => {
	const shared = drive.shared ?? [];
	const sharedUsed = shared.reduce((sum, s) => sum + (s.usedBytes ?? 0), 0);
	const quotas = [drive.quotaBytes, ...shared.map((s) => s.quotaBytes)];
	const limit = quotas.every((q) => q !== null)
		? quotas.reduce<number>((sum, q) => sum + (q ?? 0), 0)
		: null;
	const used = drive.usedBytes + sharedUsed;
	const status = connection(drive, settings);
	const level = watermarkLevel(used, limit);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="flex items-center gap-1.5 truncate text-sm font-medium text-content-primary">
						{settings?.bucket || "Cloud Drive"}
						{drive.encrypted && (
							<LockIcon aria-label="Encrypted" className="size-3.5" />
						)}
					</span>
					<StatusIndicator variant={status.variant} size="sm">
						<StatusIndicatorDot />
						{status.text}
					</StatusIndicator>
				</div>
				<div className="flex flex-col items-end text-xs tabular-nums">
					<span className="font-semibold text-content-primary">
						{formatBytes(used)}
						{limit !== null && ` / ${formatBytes(limit)}`}
					</span>
					{limit !== null && (
						<span className="text-content-secondary">
							{formatBytes(Math.max(0, limit - used))} free
						</span>
					)}
				</div>
			</div>
			<GraphFrame className="flex flex-col gap-3">
				<QuotaBar
					label="Cloud Drive used"
					unit="bytes"
					format={formatBytes}
					limit={limit}
					segments={[
						{
							label: "Your files",
							value: drive.usedBytes,
							fill: "bg-highlight-sky",
						},
						{
							label: "Shared with you",
							value: sharedUsed,
							fill: "bg-highlight-purple",
						},
					]}
				/>
				<div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-secondary">
					<span className="flex items-center gap-1.5">
						<span
							aria-hidden
							className="size-2 rounded-full bg-highlight-sky"
						/>
						Your files {formatBytes(drive.usedBytes)}
					</span>
					{shared.length > 0 && (
						<span className="flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2 rounded-full bg-highlight-purple"
							/>
							Shared with you {formatBytes(sharedUsed)}
						</span>
					)}
					<WatermarkBadge level={level} />
				</div>
			</GraphFrame>
			<dl className="m-0 flex flex-col gap-1.5 border-0 border-t border-solid border-border pt-3">
				<DottedRow label="Files" value={drive.files.toLocaleString("en-US")} />
				<DottedRow label="Mounted at" value={drive.mountPath || "N/A"} />
				{shared.length > 0 && (
					<DottedRow label="Drives shared with you" value={shared.length} />
				)}
			</dl>
			{workspaces.length > 0 && <ShowWorkspaces rows={workspaces} />}
		</div>
	);
};

/** GPUs the running workspaces' pods ask for (a stopped workspace has no pod, so claims none). */
export const GpuCardBody: React.FC<{
	workspaces: readonly DashboardWorkspace[];
	/** False in the whole-cluster view, whose report has no GPU claims. */
	known?: boolean;
}> = ({ workspaces, known = true }) => {
	const withGpus = workspaces.filter((w) => (w.gpus ?? 0) > 0);
	const claimed = withGpus.reduce((sum, w) => sum + (w.gpus ?? 0), 0);
	return (
		<div className="relative flex min-h-28 flex-col gap-4">
			{/* A graphics card behind the figures, centred, half see-through */}
			<img
				src="/dashboard-gpu.png"
				alt=""
				aria-hidden
				className="pointer-events-none absolute inset-0 m-auto max-h-28 max-w-full object-contain opacity-50"
			/>
			<div className="relative flex items-center gap-3">
				<span className="flex flex-col">
					{/* No figure while nothing is claimed: the card says so, greyed out */}
					{(!known || withGpus.length > 0) && (
						<span className="text-2xl font-semibold tabular-nums text-content-primary">
							{known ? formatQuotaNumber(claimed) : "N/A"}
						</span>
					)}
					<span className="text-xs text-content-secondary">
						{!known
							? "GPU claims are shown for your own workspaces"
							: withGpus.length === 0
								? "No workspace has a GPU enabled"
								: "GPUs claimed by running workspaces"}
					</span>
				</span>
			</div>
			<dl className="relative m-0 flex flex-col gap-1.5">
				{withGpus.map((w) => (
					<DottedRow
						key={w.id}
						label={w.name}
						value={`${formatQuotaNumber(w.gpus ?? 0)} GPU`}
					/>
				))}
			</dl>
		</div>
	);
};
