import { cn } from "cn";
import { LockIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformError } from "#/api/platform";
import {
	cloudDriveActivity,
	cloudDriveConnections,
	cloudDriveSettings,
	safe,
	setCloudDriveConnection,
} from "#/api/queries/platform";
import { quotaLevel } from "../workspaceQuota/WorkspaceQuotaPill";
import { pendingAttachments } from "./attachment";
import { DropHint, DropProgress, useCloudDriveDrop } from "./CloudDriveDrop";
import { CloudDriveRopes, ROPES_AREA } from "./CloudDriveRopes";
import { StatusIndicator } from "./CloudDriveSettings";
import { CloudDriveWindow, type View } from "./CloudDriveWindow";
import { formatBytes } from "./drivePaths";
import { SharedWithYou } from "./SharedWithYou";
import { room } from "./sharedWithYou";
import "./cloudDrive.css";

/**
 * The account's Cloud Drive, once above the Workspaces table, flush with its
 * right edge: its own files on S3, the same ones each of its connected
 * workspaces has at ~/cloud-drive, with a cable to each of those workspaces'
 * rows (CloudDriveRopes) - dragged away to disconnect one, out of the socket
 * onto another to connect it. Opened, a window in the middle of the screen
 * with the files (CloudDriveBrowser) and its Settings: where the files are
 * kept, and whether that answers; its Encryption (the owner's own key) and its
 * Source (a folder of one of their workspaces instead of S3). Only ever the
 * signed-in user's own drive; nothing where the deployment has none. Its
 * readout on one line (how much of how much, in a pill), its capacity bar on
 * the next - the entire drives shared with the user read and write each a
 * striped part of their own beside it, their room counted in. Two places to
 * click: its leading cloud (SharedWithYou: a plus in it, glowing and pulsing,
 * while something is shared with the user - a card for each, each opening the
 * window on it; its outline marching blue dots while the user's own is shared),
 * and the rest: the window. Files dropped on it from the computer go up to it
 * (CloudDriveDrop).
 */
/** How recent a transfer keeps the pill's light flashing (seconds). */
const ACTIVE_WITHIN_S = 1.5;

export const CloudDrive: React.FC<{
	/** The signed-in user's workspaces on the page: a cable to each connected one. */
	workspaceIds: readonly string[];
	shareWorkspaceIds?: readonly string[];
	/** Of them, those being deleted: their cables pop off and reel in (CloudDriveRopes). */
	deleting?: readonly string[];
	className?: string;
	/**
	 * toolbar (default): a button above the table, its cables roped to the rows. quota: the last column of the
	 * workspace quota table, laid out like the other columns, without cables.
	 */
	placement?: "toolbar" | "quota";
}> = ({
	workspaceIds,
	shareWorkspaceIds = [],
	deleting,
	className,
	placement = "toolbar",
}) => {
	const { data: summary, error } = useQuery(safe());
	const enabled = Boolean(summary?.enabled);
	const settings = useQuery({ ...cloudDriveSettings(), enabled });
	const connections = useQuery(cloudDriveConnections(enabled));
	// Its transfers (MinIO's trace): within the last 1.5 s, uploading or downloading - the light flashes.
	const activity = useQuery(cloudDriveActivity(enabled));
	const transferring = [activity.data?.up, activity.data?.down].some(
		(ago) => typeof ago === "number" && ago <= ACTIVE_WITHIN_S,
	);
	const queryClient = useQueryClient();
	const link = useMutation(setCloudDriveConnection(queryClient));
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>("files");
	// where the window opens: the user's own drive (""), or what is shared with them (its owner) at a folder
	const [openAt, setOpenAt] = useState({ drive: "", path: "" });
	// An admin's look at another account's Cloud Drive (read only), from a link (?cloudDrive=<id>&cloudDriveUser=
	// &cloudDrivePath=: Accounts' share approvals, the chat's share card and console): the window opens on it once.
	const [searchParams, setSearchParams] = useSearchParams();
	const [inspect, setInspect] = useState<{
		owner: string;
		ownerName: string;
	} | null>(null);
	const container = useRef<HTMLDivElement>(null);
	const openFiles = useCallback((drive: string, path: string) => {
		setOpenAt({ drive, path });
		setView("files");
		setOpen(true);
	}, []);
	const drop = useCloudDriveDrop(
		summary,
		settings.data?.status?.connected,
		() => openFiles("", ""),
	);
	// Flush with the table's right edge (the toolbar it sits in may be wider than the table).
	const [right, setRight] = useState(0);
	const present = Boolean(summary?.enabled);
	const inQuota = placement === "quota";
	useLayoutEffect(() => {
		const el = container.current;
		const area = el?.closest(`[${ROPES_AREA}]`);
		if (!el || !area || !present || inQuota) {
			return;
		}
		const place = () => {
			const table = area.querySelector("table");
			if (!table) {
				setRight(0);
				return;
			}
			const margin = Number.parseFloat(getComputedStyle(el).marginRight) || 0;
			// where its right edge would be with no margin, less the table's - its rounded card's (TableCard), the edge
			// seen, where it has one
			const next = Math.max(
				0,
				Math.round(
					el.getBoundingClientRect().right +
						margin -
						(table.closest(".table-card") ?? table).getBoundingClientRect()
							.right,
				),
			);
			setRight((r) => (Math.abs(next - r) > 1 ? next : r));
		};
		place();
		const resize = new ResizeObserver(place);
		resize.observe(area);
		const changes = new MutationObserver(place);
		changes.observe(area, { childList: true, subtree: true });
		window.addEventListener("resize", place);
		return () => {
			resize.disconnect();
			changes.disconnect();
			window.removeEventListener("resize", place);
		};
	}, [present, inQuota]);

	// Every workspace is connected but those its owner disconnected and those shared with others (a new one is
	// too); none until the list is in.
	const linked = useMemo(() => {
		if (!connections.data) {
			return [];
		}
		const off = new Set([
			...connections.data.disconnected,
			...(connections.data.shared ?? []),
		]);
		return [
			...workspaceIds.filter((id) => !off.has(id)),
			...(connections.data.workspaceConnections ?? [])
				.map((c) => c.workspaceId)
				.filter((id) => shareWorkspaceIds.includes(id)),
		];
	}, [connections.data, workspaceIds, shareWorkspaceIds]);
	// Of them, those whose drive is not attached in the workspace yet (it says so): their cables red until it is.
	const unattached = useMemo(() => {
		const waiting = new Set(pendingAttachments(connections.data));
		return linked.filter((id) => waiting.has(id));
	}, [connections.data, linked]);
	const onLink = useCallback(
		(workspaceId: string, connected: boolean) =>
			link.mutate(
				{ workspaceId, connected },
				{
					onSuccess: (result) => {
						if (result.older.includes(workspaceId)) {
							toast.info(
								connected
									? "Connected: the workspace has its Cloud Drive again once it is updated to its template's latest version."
									: "Disconnected: it takes effect once the workspace is updated to its template's latest version.",
							);
						}
					},
					onError: (err) =>
						toast.error(
							getErrorMessage(
								err,
								connected
									? "The workspace could not be connected."
									: "The workspace could not be disconnected.",
							),
						),
				},
			),
		[link.mutate],
	);

	const linkedDrive = searchParams.get("cloudDrive");
	useEffect(() => {
		if (!linkedDrive || !summary?.enabled) {
			return;
		}
		const ownerName = searchParams.get("cloudDriveUser") || "their";
		const path = searchParams.get("cloudDrivePath") || "";
		setInspect({ owner: linkedDrive, ownerName });
		setOpenAt({ drive: linkedDrive, path });
		setView("files");
		setOpen(true);
		setSearchParams(
			(params) => {
				params.delete("cloudDrive");
				params.delete("cloudDriveUser");
				params.delete("cloudDrivePath");
				return params;
			},
			{ replace: true },
		);
	}, [linkedDrive, summary?.enabled, searchParams, setSearchParams]);

	if (
		!summary ||
		!enabled ||
		(error instanceof PlatformError && error.status === 404)
	) {
		return null;
	}
	const status = settings.data?.status;
	// The room the user has: their own, and each entire drive shared with them read and write (null: a workspace's
	// folder is their Cloud Drive, no capacity to measure against).
	const space = room(summary);
	const usage = space
		? `${formatBytes(space.usedBytes)} of ${formatBytes(space.quotaBytes)}`
		: `${formatBytes(summary.usedBytes)} in ${summary.source?.name ?? "a workspace"}`;
	const encrypted = Boolean(summary.encrypted && !summary.source);
	const ariaLabel = `Cloud Drive: ${usage} used${space && space.parts.length > 1 ? `, ${formatBytes(space.parts.slice(1).reduce((n, p) => n + p.quotaBytes, 0))} of it shared with you` : ""}${encrypted ? ", encrypted" : ""}${status?.connected === true ? ", connected" : status?.connected === false ? ", not connected" : ""}`;
	const driveWindow = (
		<CloudDriveWindow
			open={open}
			onOpenChange={setOpen}
			view={view}
			onView={setView}
			summary={summary}
			openAt={openAt}
			inspect={inspect ?? undefined}
		/>
	);

	if (inQuota) {
		const level = space ? quotaLevel(space.usedBytes, space.quotaBytes) : "ok";
		return (
			<>
				<div
					ref={container}
					className={cn("cd-drive relative min-w-0 rounded-md", className)}
					data-testid="cloud-drive-container"
					data-drop={drop.over ? (drop.refusal ? "refused" : "on") : undefined}
					{...drop.handlers}
				>
					{drop.over && <DropHint refusal={drop.refusal} />}
					{/* its leading cloud, in the place of the other columns' icons: what is shared with the user */}
					<SharedWithYou
						className="absolute -left-[3px] -top-0.5 z-[1] !size-5 [&_svg]:!size-3.5"
						onOpen={openFiles}
					/>
					<button
						type="button"
						className="block w-full min-w-0 cursor-pointer rounded-md border-0 bg-transparent p-0 text-left text-content-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link"
						data-testid="cloud-drive"
						aria-haspopup="dialog"
						aria-label={ariaLabel}
						onClick={() => openFiles("", "")}
					>
						<span className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
							<span aria-hidden className="size-3.5 shrink-0" />
							<span className="font-medium">Cloud Drive</span>
							{encrypted && (
								<LockIcon
									aria-hidden
									className="size-3.5 shrink-0 text-content-link"
									data-testid="cloud-drive-encrypted"
								/>
							)}
							<span className="ml-auto">
								<StatusIndicator
									status={status}
									compact
									active={transferring}
								/>
							</span>
						</span>
						<span className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 tabular-nums">
							<span
								className="text-sm font-medium text-content-primary"
								data-testid="cloud-drive-usage"
							>
								{space
									? `${formatBytes(space.usedBytes)}/${formatBytes(space.quotaBytes)}`
									: usage}
							</span>
							{space && (
								<span
									className={cn(
										"text-xs",
										level === "full" && "text-content-destructive",
										level === "near" && "text-content-warning",
									)}
								>
									(
									{formatBytes(Math.max(space.quotaBytes - space.usedBytes, 0))}{" "}
									left)
								</span>
							)}
						</span>
						{drop.progress ? (
							<DropProgress progress={drop.progress} />
						) : (
							space && <CapacityBar space={space} quotaColors />
						)}
					</button>
				</div>
				{driveWindow}
			</>
		);
	}

	return (
		<>
			<div
				ref={container}
				// The theme's accent for its border: it follows the theme the user picks.
				className={cn(
					"cd-drive relative inline-flex shrink-0 rounded-md border border-solid border-content-link/60 bg-surface-primary text-sm transition-colors hover:border-content-link",
					className,
				)}
				style={{ marginRight: right }}
				data-testid="cloud-drive-container"
				data-drop={drop.over ? (drop.refusal ? "refused" : "on") : undefined}
				{...drop.handlers}
			>
				{drop.over && <DropHint refusal={drop.refusal} />}
				{/* its leading cloud: what is shared with the user (over the button's first line, where it leaves room) */}
				<SharedWithYou
					className="absolute left-2 top-[3px] z-[1]"
					onOpen={openFiles}
				/>
				<button
					type="button"
					className="flex min-w-0 cursor-pointer flex-col gap-1 rounded-md border-0 bg-transparent px-3 py-1.5 text-left text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link"
					data-testid="cloud-drive"
					aria-haspopup="dialog"
					aria-label={ariaLabel}
					onClick={() => openFiles("", "")}
				>
					<span className="flex w-full items-center gap-2 whitespace-nowrap leading-5">
						<span aria-hidden className="w-5 shrink-0" />
						<span className="font-semibold">Cloud Drive</span>
						{encrypted && (
							<LockIcon
								aria-hidden
								className="size-4 text-content-link"
								data-testid="cloud-drive-encrypted"
							/>
						)}
						<span
							className="inline-flex items-center rounded-full border border-solid border-border bg-surface-secondary px-2 text-xs leading-[18px] tabular-nums text-content-secondary"
							data-testid="cloud-drive-usage"
						>
							{usage}
						</span>
						<span className="ml-auto pl-1">
							<StatusIndicator status={status} compact active={transferring} />
						</span>
					</span>
					{drop.progress ? (
						<DropProgress progress={drop.progress} />
					) : (
						space && <CapacityBar space={space} />
					)}
				</button>
			</div>
			<CloudDriveRopes
				anchor={container}
				workspaceIds={[...workspaceIds, ...shareWorkspaceIds]}
				deleting={deleting}
				linked={linked}
				onLink={onLink}
				connected={status?.connected}
				unattached={unattached}
			/>
			{driveWindow}
		</>
	);
};

/**
 * The capacity bar, a line of its own: the user's own drive (filled as full as it is), and beside it each entire drive
 * shared with them read and write - striped, in the shared colour, as wide as its capacity - with what they add.
 */
const CapacityBar: React.FC<{
	space: NonNullable<ReturnType<typeof room>>;
	/** The quota table's colours: its track, and green, amber from 80% and red when full. */
	quotaColors?: boolean;
}> = ({ space, quotaColors }) => {
	const [own, ...shared] = space.parts;
	const fillOf = (used: number, quota: number) =>
		Math.min(1, quota > 0 ? used / quota : 0);
	const fill = fillOf(own.usedBytes, own.quotaBytes);
	const added = shared.reduce((n, p) => n + p.quotaBytes, 0);
	return (
		<span
			className="flex w-full items-center gap-2"
			data-testid="cloud-drive-capacity-bar"
		>
			<span className="flex h-1.5 min-w-0 flex-1 gap-[3px]">
				<span
					role="progressbar"
					aria-label="How full the Cloud Drive is"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(fill * 100)}
					title={`Your Cloud Drive: ${Math.round(fill * 100)}% full`}
					data-testid="cloud-drive-fill"
					className={cn(
						"relative h-full overflow-hidden rounded-full",
						quotaColors ? "bg-surface-quaternary" : "bg-surface-tertiary",
					)}
					style={{ flex: `${own.quotaBytes} 1 0` }}
				>
					<span
						className={cn(
							"absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
							quotaColors
								? {
										full: "bg-content-destructive",
										near: "bg-content-warning",
										ok: "bg-content-success",
									}[quotaLevel(own.usedBytes, own.quotaBytes)]
								: fill >= 0.9
									? "bg-content-destructive"
									: fill >= 0.75
										? "bg-content-warning"
										: "bg-content-link",
						)}
						style={{ width: `${Math.max(fill > 0 ? 3 : 0, fill * 100)}%` }}
					/>
				</span>
				{shared.map((p) => {
					const f = fillOf(p.usedBytes, p.quotaBytes);
					return (
						<span
							key={p.owner}
							role="progressbar"
							aria-label={`How full ${p.ownerName}'s Cloud Drive is (shared with you, read and write)`}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(f * 100)}
							title={`${p.ownerName}'s Cloud Drive, shared with you read and write: ${formatBytes(p.usedBytes)} of ${formatBytes(p.quotaBytes)}`}
							data-testid={`cloud-drive-fill-shared-${p.ownerName}`}
							className="cd-capacity-shared relative h-full overflow-hidden rounded-full"
							style={{ flex: `${p.quotaBytes} 1 0` }}
						>
							<span
								className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
								style={{ width: `${Math.max(f > 0 ? 3 : 0, f * 100)}%` }}
							/>
						</span>
					);
				})}
			</span>
			{shared.length > 0 && (
				<span
					className="shrink-0 text-xs tabular-nums text-content-success"
					data-testid="cloud-drive-shared-room"
					title={`Shared with you read and write: ${shared.map((p) => `${p.ownerName}'s ${formatBytes(p.quotaBytes)}`).join(", ")}`}
				>
					+{formatBytes(added)} shared
				</span>
			)}
		</span>
	);
};
