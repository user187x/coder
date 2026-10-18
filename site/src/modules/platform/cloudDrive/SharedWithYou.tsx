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
	type IncomingShare,
	incomingShares,
	openPath,
	shareLink,
	shareWhat,
} from "./sharedWithYou";
import "./cloudDrive.css";

/** How many of a share's newest files its card lists. */
const LISTED = 6;

/**
 * The Cloud Drive's leading cloud on the Workspaces page: a plus in it, glowing and pulsing, while other users share
 * something with the user - an entire Cloud Drive, or a folder or a file of one. Clicked, a window lists them, a card
 * each: whose, what, the access, how many files and how much, the newest of them, where the workspaces have it; each
 * opens the Cloud Drive window on it (onOpen: its owner and the folder to show).
 */
export const SharedWithYou: React.FC<{
	onOpen: (owner: string, path: string) => void;
	className?: string;
}> = ({ onOpen, className }) => {
	const peers = useQuery(cloudDrivePeers());
	const shares = incomingShares(peers.data);
	const [open, setOpen] = useState(false);
	const n = shares.length;
	const write = shares.some((s) => s.access === "write");
	return (
		<>
			<button
				type="button"
				className={cn("cd-shares-icon", className)}
				data-shares={n > 0 || undefined}
				data-access={n > 0 ? (write ? "write" : "read") : undefined}
				data-testid="cloud-drive-shares"
				aria-haspopup="dialog"
				aria-label={
					n > 0
						? `Shared with you: ${n} ${n === 1 ? "share" : "shares"}. Show them`
						: "Shared with you: nothing yet"
				}
				title={
					n > 0
						? `Shared with you: ${n} ${n === 1 ? "share" : "shares"}`
						: "Nothing is shared with you"
				}
				onClick={() => setOpen(true)}
			>
				<CloudGlyph plus={n > 0} />
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
								? "Cloud Drives, folders and files other users share with you. Open one here at once; your workspaces have it from their next start."
								: "Nothing is shared with you yet. Ask someone for their Cloud Drive in a chat, or they share theirs - or a folder or file of it - with you."}
						</DialogDescription>
					</DialogHeader>
					{n > 0 && (
						<ul
							className="m-0 -mr-2 flex max-h-[min(560px,65vh)] list-none flex-col gap-3 overflow-y-auto p-0 pr-2"
							aria-label="Shares"
							data-testid="cloud-drive-shares-list"
						>
							{shares.map((s) => (
								<li key={s.id}>
									<ShareCard
										share={s}
										onOpen={() => {
											setOpen(false);
											onOpen(s.owner, openPath(s));
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

/** Lucide's cloud, with a plus in it when something is shared with the user. */
const CloudGlyph: React.FC<{ plus: boolean }> = ({ plus }) => (
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
	>
		<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
		{plus && <path className="cd-shares-plus" d="M12.5 11.5v5M10 14h5" />}
	</svg>
);

const kindIcon = (kind: IncomingShare["kind"]) =>
	kind === "drive" ? HardDriveIcon : kind === "folder" ? FolderIcon : FileIcon;

/** One share's card (the HUD the floating clouds once had): whose, what, the access, its files, where it is. */
export const ShareCard: React.FC<{
	share: IncomingShare;
	onOpen: () => void;
}> = ({ share, onOpen }) => {
	const glance = useQuery(cloudDriveGlance(share.owner, true, share.id));
	const platform = usePlatformSnapshot();
	const src = resolvePlatformAvatar(platform, share.ownerName, undefined);
	const name = glance.data?.owner?.name || share.ownerName;
	const initials =
		name
			.split(/[\s._-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0])
			.join("")
			.toUpperCase() || "?";
	const data = glance.data;
	const Kind = kindIcon(share.kind);
	return (
		<article
			className="cd-share-card rounded-lg border border-solid border-border bg-surface-secondary px-3 py-2.5 text-xs"
			data-access={share.access}
			data-testid={`cloud-drive-share-card-${share.id}`}
			aria-label={`${share.ownerName}'s ${shareWhat(share)}`}
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
						{name !== share.ownerName && (
							<span className="font-normal text-content-secondary">
								{" "}
								@{share.ownerName}
							</span>
						)}
					</p>
					<p
						className="m-0 flex items-center gap-1 truncate text-content-secondary"
						data-testid="cloud-drive-share-card-what"
					>
						<Kind aria-hidden className="size-3.5 shrink-0" />
						shares their {shareWhat(share)} with you
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
					{share.access === "write" ? (
						<PencilIcon aria-hidden className="size-3.5 text-content-success" />
					) : (
						<EyeIcon aria-hidden className="size-3.5 text-content-link" />
					)}
					{share.access === "write"
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
			{share.kind !== "file" && (
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
										{share.kind === "folder"
											? file.path.slice(share.path.length + 1)
											: file.path}
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
				Your workspaces have{" "}
				{share.kind === "drive" ? "it" : baseName(share.path)} at{" "}
				<code className="text-content-primary">{shareLink(share)}</code> from
				their next start.
			</p>
		</article>
	);
};
