import { cn } from "cn";
import {
	ChevronRightIcon,
	CloudIcon,
	FolderInputIcon,
	FolderSymlinkIcon,
	LockIcon,
	PlugIcon,
	SettingsIcon,
	UsersIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { PlatformError } from "#/api/platform";
import {
	cloudDriveConnections,
	cloudDriveSettings,
	safe,
	setCloudDriveConnection,
} from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { CloudDriveBrowser } from "./CloudDriveBrowser";
import { CloudDriveConnections } from "./CloudDriveConnections";
import { CloudDriveEncryption } from "./CloudDriveEncryption";
import { CloudDriveMount } from "./CloudDriveMount";
import { CloudDrivePeersView } from "./CloudDrivePeers";
import { CloudDriveRopes, ROPES_AREA } from "./CloudDriveRopes";
import { CloudDriveSettings, StatusIndicator } from "./CloudDriveSettings";
import { CloudDriveSource } from "./CloudDriveSource";
import { formatBytes } from "./drivePaths";
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
 * signed-in user's own drive; nothing where the deployment has none. As tall
 * as the "+ Workspace" button above it.
 */
export const CloudDrive: React.FC<{
	/** The signed-in user's workspaces on the page: a cable to each connected one. */
	workspaceIds: readonly string[];
	className?: string;
}> = ({ workspaceIds, className }) => {
	const { data: summary, error } = useQuery(safe());
	const enabled = Boolean(summary?.enabled);
	const settings = useQuery({ ...cloudDriveSettings(), enabled });
	const connections = useQuery(cloudDriveConnections(enabled));
	const queryClient = useQueryClient();
	const link = useMutation(setCloudDriveConnection(queryClient));
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>("files");
	const button = useRef<HTMLButtonElement>(null);
	// Flush with the table's right edge (the toolbar it sits in may be wider than the table).
	const [right, setRight] = useState(0);
	const present = Boolean(summary?.enabled);
	useLayoutEffect(() => {
		const el = button.current;
		const area = el?.closest(`[${ROPES_AREA}]`);
		if (!el || !area || !present) {
			return;
		}
		const place = () => {
			const table = area.querySelector("table");
			if (!table) {
				setRight(0);
				return;
			}
			const margin = Number.parseFloat(getComputedStyle(el).marginRight) || 0;
			// where its right edge would be with no margin, less the table's
			const next = Math.max(
				0,
				Math.round(
					el.getBoundingClientRect().right +
						margin -
						table.getBoundingClientRect().right,
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
	}, [present]);

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
		return workspaceIds.filter((id) => !off.has(id));
	}, [connections.data, workspaceIds]);
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

	if (
		!summary ||
		!enabled ||
		(error instanceof PlatformError && error.status === 404)
	) {
		return null;
	}
	const status = settings.data?.status;
	const usage =
		summary.quotaBytes === null
			? `${formatBytes(summary.usedBytes)} in ${summary.source?.name ?? "a workspace"}`
			: `${formatBytes(summary.usedBytes)} of ${formatBytes(summary.quotaBytes)}`;
	const encrypted = Boolean(summary.encrypted && !summary.source);
	// How full it is (of its capacity; a workspace's folder as the source has none to measure against).
	const fill =
		summary.quotaBytes && summary.quotaBytes > 0
			? Math.min(1, summary.usedBytes / summary.quotaBytes)
			: null;

	return (
		<>
			<Button
				ref={button}
				variant="outline"
				// as tall as "+ Workspace" above it
				size="lg"
				// The theme's accent for its border: it follows the theme the user picks.
				className={cn(
					"gap-2 border-content-link/60 font-normal hover:border-content-link",
					className,
				)}
				style={{ marginRight: right }}
				data-testid="cloud-drive"
				aria-haspopup="dialog"
				aria-label={`Cloud Drive: ${usage} used${encrypted ? ", encrypted" : ""}${status?.connected === true ? ", connected" : status?.connected === false ? ", not connected" : ""}`}
				onClick={() => {
					setView("files");
					setOpen(true);
				}}
			>
				<CloudIcon aria-hidden />
				<span className="font-semibold">Cloud Drive</span>
				{encrypted && (
					<LockIcon
						aria-hidden
						className="text-content-link"
						data-testid="cloud-drive-encrypted"
					/>
				)}
				<span className="tabular-nums text-content-secondary">{usage}</span>
				{fill !== null && (
					<span
						role="progressbar"
						aria-label="How full the Cloud Drive is"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(fill * 100)}
						title={`${Math.round(fill * 100)}% full`}
						data-testid="cloud-drive-fill"
						className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-tertiary"
					>
						<span
							className={cn(
								"absolute inset-y-0 left-0 rounded-full transition-[width] duration-500",
								fill >= 0.9
									? "bg-content-destructive"
									: fill >= 0.75
										? "bg-content-warning"
										: "bg-content-link",
							)}
							style={{ width: `${Math.max(fill > 0 ? 3 : 0, fill * 100)}%` }}
						/>
					</span>
				)}
				<StatusIndicator status={status} compact />
			</Button>
			<CloudDriveRopes
				anchor={button}
				workspaceIds={workspaceIds}
				linked={linked}
				onLink={onLink}
				connected={status?.connected}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					className="max-w-3xl gap-0 overflow-hidden p-0"
					aria-describedby={undefined}
					data-testid="cloud-drive-dialog"
				>
					<header className="flex items-center gap-3 border-0 border-b border-solid border-border px-4 py-3">
						<CloudIcon aria-hidden className="size-5 text-content-secondary" />
						<DialogTitle className="flex items-center gap-1.5 text-base">
							{view !== "files" ? (
								<>
									<button
										type="button"
										className="cursor-pointer border-0 bg-transparent p-0 text-base font-semibold text-content-secondary hover:text-content-primary"
										onClick={() => setView("files")}
									>
										Cloud Drive
									</button>
									<ChevronRightIcon
										aria-hidden
										className="size-4 text-content-secondary"
									/>
									{VIEW_TITLES[view]}
								</>
							) : (
								"Cloud Drive"
							)}
						</DialogTitle>
						<StatusIndicator status={status} />
						<div className="ml-auto flex items-center gap-1">
							<Button
								size="icon"
								variant="subtle"
								aria-label="Workspaces: which are connected"
								title="Workspaces: which are connected"
								aria-pressed={view === "workspaces"}
								className={cn(
									view === "workspaces" &&
										"bg-surface-secondary text-content-primary",
								)}
								onClick={() =>
									setView((v) => (v === "workspaces" ? "files" : "workspaces"))
								}
							>
								<PlugIcon />
							</Button>
							<ViewButton
								view="encryption"
								current={view}
								label="Encryption: your own key"
								onToggle={setView}
							>
								<LockIcon />
							</ViewButton>
							<ViewButton
								view="source"
								current={view}
								label="Source: a workspace's folder as the Cloud Drive"
								onToggle={setView}
							>
								<FolderInputIcon />
							</ViewButton>
							<ViewButton
								view="mount"
								current={view}
								label="Mount: the Cloud Drive in a folder of a workspace"
								onToggle={setView}
							>
								<FolderSymlinkIcon />
							</ViewButton>
							<ViewButton
								view="sharing"
								current={view}
								label="Sharing: Cloud Drives between users"
								onToggle={setView}
							>
								<UsersIcon />
							</ViewButton>
							<Button
								size="icon"
								variant="subtle"
								aria-label="Settings"
								aria-pressed={view === "settings"}
								className={cn(
									view === "settings" &&
										"bg-surface-secondary text-content-primary",
								)}
								onClick={() => {
									// Opened: what the service has now.
									if (view !== "settings") {
										void settings.refetch();
									}
									setView((v) => (v === "settings" ? "files" : "settings"));
								}}
							>
								<SettingsIcon />
							</Button>
							<DialogClose asChild>
								<Button size="icon" variant="subtle" aria-label="Close">
									<XIcon />
								</Button>
							</DialogClose>
						</div>
					</header>
					{view === "files" ? (
						<CloudDriveBrowser summary={summary} />
					) : view === "workspaces" ? (
						<CloudDriveConnections />
					) : view === "encryption" ? (
						<CloudDriveEncryption />
					) : view === "source" ? (
						<CloudDriveSource />
					) : view === "mount" ? (
						<CloudDriveMount />
					) : view === "sharing" ? (
						<CloudDrivePeersView />
					) : settings.data ? (
						<CloudDriveSettings settings={settings.data} />
					) : (
						<p
							role={settings.error ? "alert" : undefined}
							className={cn(
								"m-0 px-6 py-8 text-center text-sm",
								settings.error
									? "text-content-destructive"
									: "text-content-secondary",
							)}
						>
							{settings.error
								? getErrorMessage(
										settings.error,
										"The Cloud Drive's settings could not be read.",
									)
								: "Opening…"}
						</p>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
};

type View =
	| "files"
	| "workspaces"
	| "encryption"
	| "source"
	| "mount"
	| "sharing"
	| "settings";

const VIEW_TITLES: Record<View, string> = {
	files: "Files",
	workspaces: "Workspaces",
	encryption: "Encryption",
	source: "Source",
	mount: "Mount",
	sharing: "Sharing",
	settings: "Settings",
};

const ViewButton: React.FC<{
	view: View;
	current: View;
	label: string;
	onToggle: (next: View) => void;
	children: React.ReactNode;
}> = ({ view, current, label, onToggle, children }) => (
	<Button
		size="icon"
		variant="subtle"
		aria-label={label}
		title={label}
		aria-pressed={current === view}
		className={cn(
			current === view && "bg-surface-secondary text-content-primary",
		)}
		onClick={() => onToggle(current === view ? "files" : view)}
	>
		{children}
	</Button>
);
