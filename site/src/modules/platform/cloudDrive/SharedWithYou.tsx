import { cn } from "cn";
import {
	EyeIcon,
	FileIcon,
	FolderIcon,
	FolderOpenIcon,
	HardDriveIcon,
	PencilIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { getErrorMessage } from "#/api/errors";
import { cloudDriveGlance, cloudDrivePeers } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import {
	resolvePlatformAvatar,
	usePlatformSnapshot,
} from "#/contexts/platformBoot";
import { formatBytes } from "./drivePaths";
import {
	baseName,
	mineSharedWith,
	openPath,
	type SharedDrive,
	sharedDrives,
} from "./sharedWithYou";
import "./cloudDrive.css";

/** How many of a drive's newest files its card lists. */
const LISTED = 6;

/**
 * The Cloud Drive's leading cloud on the Workspaces page: a plus in it, glowing and pulsing, while other users share
 * something with the user - their entire Cloud Drive, or folders and files of it. Clicked, a window lists them, a card
 * for each owner's (the HUD the floating clouds once had): whose, what (a drive shared only in parts: its first part,
 * how many more, and that part's access), how many files and how much, the newest of them, where the workspaces have
 * it; each opens the Cloud Drive window on it (onOpen: its owner and the folder to show). The other way round, while
 * the user's own Cloud Drive (or a part of it) is shared with someone (mineSharedWith): its outline a line of blue
 * dots marching round it, the cloud breathing a blue glow (data-shared) - dotted and still without animations.
 */
export const SharedWithYou: React.FC<{
	onOpen: (owner: string, path: string) => void;
	className?: string;
}> = ({ onOpen, className }) => {
	const peers = useQuery(cloudDrivePeers());
	const drives = sharedDrives(peers.data);
	const [open, setOpen] = useState(false);
	const n = drives.length;
	const write = drives.some((d) => d.access === "write");
	const out = mineSharedWith(peers.data);
	const yours =
		out.length > 0 ? `Your Cloud Drive is shared with ${names(out)}` : "";
	return (
		<>
			<button
				type="button"
				className={cn("cd-shares-icon", className)}
				data-shares={n > 0 || undefined}
				data-access={n > 0 ? (write ? "write" : "read") : undefined}
				data-shared={out.length > 0 || undefined}
				data-testid="cloud-drive-shares"
				aria-haspopup="dialog"
				aria-label={`${
					n > 0
						? `Shared with you: ${n} ${n === 1 ? "Cloud Drive" : "Cloud Drives"}`
						: "Shared with you: nothing yet"
				}${yours ? `. ${yours}` : ""}${n > 0 ? ". Show them" : ""}`}
				title={`${
					n > 0
						? `Shared with you: ${n} ${n === 1 ? "Cloud Drive" : "Cloud Drives"}`
						: "Nothing is shared with you"
				}${yours ? ` · ${yours}` : ""}`}
				onClick={() => setOpen(true)}
			>
				<CloudGlyph plus={n > 0} shared={out.length > 0} />
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					className="max-w-md gap-3"
					data-testid="cloud-drive-shares-dialog"
				>
					<DialogHeader>
						<DialogTitle>Shared with you</DialogTitle>
						<DialogDescription>
							{n > 0
								? "Cloud Drives - or folders and files of them - other users share with you. Open one here at once; your workspaces have it from their next start."
								: "Nothing is shared with you yet. Ask someone for their Cloud Drive in a chat, or they share theirs - or a folder or file of it - with you."}
						</DialogDescription>
					</DialogHeader>
					{n > 0 && (
						<ul
							className="m-0 -mr-2 flex max-h-[min(560px,65vh)] list-none flex-col gap-3 overflow-y-auto p-0 pr-2"
							aria-label="Shared with you"
							data-testid="cloud-drive-shares-list"
						>
							{drives.map((d) => (
								<li key={d.owner}>
									<ShareCard
										drive={d}
										onOpen={() => {
											setOpen(false);
											onOpen(d.owner, d.part ? openPath(d.part) : "");
										}}
									/>
								</li>
							))}
						</ul>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
};

/** Up to three names, then how many more: "ann", "ann and bob", "ann, bob, cy and 2 more". */
const names = (all: readonly string[]) =>
	all.length > 3
		? `${all.slice(0, 3).join(", ")} and ${all.length - 3} more`
		: all.length > 1
			? `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`
			: (all[0] ?? "");

/** The cloud's outline in path units: a whole number of its dots' spacing (cloudDrive.css, .cd-shares-cloud). */
const CLOUD_LENGTH = 60;

/**
 * Lucide's cloud, with a plus in it when something is shared with the user; its outline a line of dots when the
 * user's own drive is shared (its path's length set, so the dots are evenly spaced and march round it seamlessly).
 */
const CloudGlyph: React.FC<{ plus: boolean; shared: boolean }> = ({
	plus,
	shared,
}) => (
	<svg
		aria-hidden
		width={20}
		height={20}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		data-testid="cloud-drive-icon"
		data-shared={shared ? "true" : "false"}
	>
		<path
			className="cd-shares-cloud"
			pathLength={CLOUD_LENGTH}
			d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
		/>
		{plus && <path className="cd-shares-plus" d="M12.5 11.5v5M10 14h5" />}
	</svg>
);

/** One owner's card (the HUD the floating clouds had): whose, what, the access, its files, where it is. */
export const ShareCard: React.FC<{
	drive: SharedDrive;
	onOpen: () => void;
}> = ({ drive, onOpen }) => {
	const glance = useQuery(cloudDriveGlance(drive.owner, true, drive.part?.id));
	const platform = usePlatformSnapshot();
	const src = resolvePlatformAvatar(platform, drive.ownerName, undefined);
	const name = glance.data?.owner?.name || drive.ownerName;
	const initials =
		name
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0])
			.join("")
			.toUpperCase() || "?";
	const data = glance.data;
	const part = drive.part;
	const access = part?.access ?? drive.access;
	const Kind = !part
		? HardDriveIcon
		: part.kind === "folder"
			? FolderIcon
			: FileIcon;
	const what = part
		? `their ${part.kind} ${baseName(part.path)}${part.more > 0 ? ` (and ${part.more} more)` : ""}`
		: "their Cloud Drive";
	return (
		<article
			className="cd-share-card rounded-lg border border-solid border-border bg-surface-secondary px-3 py-2.5 text-xs"
			data-access={access}
			data-testid={`cloud-drive-share-card-${drive.owner}`}
			aria-label={`${drive.ownerName} shares ${what} with you`}
		>
			<div className="flex items-center gap-2.5">
				<span
					className="cd-avatar size-8 shrink-0"
					style={{ fontSize: 13 }}
					aria-hidden
				>
					{src ? <img src={src} alt="" /> : initials}
				</span>
				<div className="min-w-0 flex-1">
					<p className="m-0 truncate text-sm font-semibold text-content-primary">
						{name}
						{name !== drive.ownerName && (
							<span className="font-normal text-content-secondary">
								{" "}
								@{drive.ownerName}
							</span>
						)}
					</p>
					<p
						className="m-0 flex items-center gap-1 truncate text-content-secondary"
						data-testid="cloud-drive-share-card-what"
					>
						<Kind aria-hidden className="size-3.5 shrink-0" />
						shares {what} with you
					</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					onClick={onOpen}
					data-testid="cloud-drive-share-card-open"
				>
					<FolderOpenIcon />
					Open
				</Button>
			</div>
			<dl className="m-0 mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-0 border-t border-solid border-border pt-2">
				<dt className="text-content-secondary">Access</dt>
				<dd
					className="m-0 flex items-center gap-1.5 text-content-primary"
					data-testid="cloud-drive-share-card-access"
				>
					{access === "write" ? (
						<PencilIcon aria-hidden className="size-3.5 text-content-success" />
					) : (
						<EyeIcon aria-hidden className="size-3.5 text-content-link" />
					)}
					{access === "write"
						? "Read and write: open, add, change and delete"
						: "Read only: open and download"}
				</dd>
				<dt className="text-content-secondary">Shared</dt>
				<dd
					className="m-0 tabular-nums text-content-primary"
					data-testid="cloud-drive-share-card-size"
				>
					{data
						? `${formatBytes(data.usedBytes)} in ${data.files} ${data.files === 1 ? "file" : "files"}`
						: glance.isError
							? "-"
							: "Reading…"}
				</dd>
			</dl>
			{part?.kind !== "file" && (
				<ul className="m-0 mt-2 flex list-none flex-col gap-0.5 border-0 border-t border-solid border-border p-0 pt-2">
					{glance.isError ? (
						<li className="text-content-destructive">
							{getErrorMessage(glance.error, "Its files could not be read.")}
						</li>
					) : !data ? (
						<li className="text-content-secondary">Reading…</li>
					) : data.files === 0 ? (
						<li className="text-content-secondary">No files yet</li>
					) : (
						<>
							<li className="text-content-secondary">Newest files</li>
							{data.newest.slice(0, LISTED).map((file) => (
								<li key={file.path} className="flex items-center gap-1.5">
									<FileIcon
										aria-hidden
										className="size-3.5 shrink-0 text-content-secondary"
									/>
									<span
										className="min-w-0 flex-1 truncate text-content-primary"
										title={file.path}
									>
										{file.path}
									</span>
									<span className="shrink-0 tabular-nums">
										{formatBytes(file.size)}
									</span>
								</li>
							))}
							{data.files > LISTED && (
								<li className="text-content-secondary">
									and {data.files - Math.min(LISTED, data.newest.length)} more
								</li>
							)}
						</>
					)}
				</ul>
			)}
			<p className="m-0 mt-2 border-0 border-t border-solid border-border pt-2 text-content-secondary">
				Your workspaces have it at{" "}
				<code className="text-content-primary">
					~/cloud-drive/Shared/{drive.ownerName}
					{part ? `/${baseName(part.path)}` : ""}
				</code>{" "}
				from their next start.
			</p>
		</article>
	);
};
