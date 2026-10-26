import { cn } from "cn";
import { CloudIcon, FileIcon, FolderIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import {
	cloudDriveConnections,
	safe,
	safeListing,
} from "#/api/queries/platform";
import type { Workspace } from "#/api/typesGenerated";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { CloudDriveWindow, type View } from "./CloudDriveWindow";
import { formatBytes } from "./drivePaths";

/** How many of the drive's top folders and files the HUD lists. */
const LISTED = 6;

/** Opens the workspace owner's Cloud Drive and previews its usage. */
export const CloudDriveGlyph: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const { user } = useAuthenticated();
	const mine = workspace.owner_id === user.id;
	const { data: summary } = useQuery({ ...safe(), enabled: mine });
	const enabled = mine && Boolean(summary?.enabled);
	const connections = useQuery(cloudDriveConnections(enabled));
	const [open, setOpen] = useState(false);
	const listing = useQuery(safeListing("", enabled && open));
	// Clicked: the Cloud Drive's window, over the page blurred (CloudDriveWindow)
	const [windowOpen, setWindowOpen] = useState(false);
	const [view, setView] = useState<View>("files");

	if (
		!enabled ||
		!summary ||
		!connections.data ||
		connections.data.shared?.includes(workspace.id)
	) {
		return null;
	}
	const connected = !connections.data.disconnected.includes(workspace.id);
	const used = summary.usedBytes;
	const quota = summary.quotaBytes;
	const percent = quota ? Math.min(100, (used / quota) * 100) : 0;
	const entries = listing.data
		? [
				...listing.data.folders.map((f) => ({ ...f, folder: true, size: 0 })),
				...listing.data.files.map((f) => ({ ...f, folder: false })),
			]
		: [];

	return (
		<>
			<Tooltip open={open} onOpenChange={setOpen}>
				<TooltipTrigger asChild>
					<button
						type="button"
						aria-label={`Cloud Drive ${connected ? "connected" : "disconnected"}: ${formatBytes(used)}${quota === null ? "" : ` of ${formatBytes(quota)}`} used`}
						data-testid="cloud-drive-glyph"
						data-state={connected ? "connected" : "disconnected"}
						className="cd-glyph relative flex h-5 min-w-5 cursor-pointer items-center justify-center border-0 bg-transparent p-0 px-1 text-content-secondary"
						onClick={() => {
							setOpen(false);
							setView("files");
							setWindowOpen(true);
						}}
					>
						<span aria-hidden className="cd-cloud-icon relative size-3.5" />
					</button>
				</TooltipTrigger>
				<TooltipContent
					className="w-64 px-3 py-2.5"
					data-testid="cloud-drive-hud"
				>
					<p className="m-0 flex items-center gap-1.5 font-semibold text-content-primary">
						<CloudIcon aria-hidden className="size-3.5 text-content-link" />
						Cloud Drive
						<span className="ml-auto font-normal text-content-secondary">
							{summary.mountPath.replace(/^\/home\/coder\//, "~/")}
						</span>
					</p>
					<div
						role="progressbar"
						aria-label="Cloud Drive used"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(percent)}
						className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
					>
						<div
							className={cn(
								"h-full rounded-full",
								percent >= 90
									? "bg-content-destructive"
									: percent >= 75
										? "bg-content-warning"
										: "bg-content-link",
							)}
							style={{ width: `${Math.max(percent, used ? 1 : 0)}%` }}
						/>
					</div>
					<p className="m-0 mt-1 flex justify-between tabular-nums">
						<span>{formatBytes(used)} used</span>
						<span>
							{quota === null
								? `in ${summary.source?.name ?? "a workspace"}`
								: `${formatBytes(Math.max(0, quota - used))} free`}
						</span>
					</p>
					<ul className="m-0 mt-2 flex list-none flex-col gap-0.5 border-0 border-t border-solid border-border p-0 pt-2">
						{listing.isLoading ? (
							<li className="text-content-secondary">Reading…</li>
						) : listing.isError ? (
							<li className="text-content-destructive">
								Its files could not be read.
							</li>
						) : entries.length === 0 ? (
							<li className="text-content-secondary">Empty</li>
						) : (
							entries.slice(0, LISTED).map((entry) => (
								<li
									key={`${entry.folder ? "d" : "f"}:${entry.name}`}
									className="flex items-center gap-1.5"
								>
									{entry.folder ? (
										<FolderIcon
											aria-hidden
											className="size-3.5 shrink-0 text-content-link"
										/>
									) : (
										<FileIcon
											aria-hidden
											className="size-3.5 shrink-0 text-content-secondary"
										/>
									)}
									<span className="min-w-0 flex-1 truncate text-content-primary">
										{entry.name}
									</span>
									{!entry.folder && (
										<span className="shrink-0 tabular-nums">
											{formatBytes(entry.size)}
										</span>
									)}
								</li>
							))
						)}
						{entries.length > LISTED && (
							<li className="text-content-secondary">
								and {entries.length - LISTED} more
							</li>
						)}
					</ul>
				</TooltipContent>
			</Tooltip>
			<CloudDriveWindow
				open={windowOpen}
				onOpenChange={setWindowOpen}
				view={view}
				onView={setView}
				summary={summary}
			/>
		</>
	);
};
