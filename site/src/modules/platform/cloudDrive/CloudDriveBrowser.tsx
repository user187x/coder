import { cn } from "cn";
import {
	CheckIcon,
	ChevronRightIcon,
	DownloadIcon,
	FileIcon,
	FolderIcon,
	FolderPlusIcon,
	RefreshCwIcon,
	Share2Icon,
	Trash2Icon,
	UploadIcon,
	UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import {
	PlatformAPI,
	type SafeListing,
	type SafeSummary,
} from "#/api/platform";
import { cloudDrivePeers, safeKey, safeListing } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	breadcrumbs,
	formatBytes,
	joinPath,
	usedPercent,
	validName,
} from "./drivePaths";
import { ShareDialog } from "./ShareDialog";
import { incomingShares, shareWhat } from "./sharedWithYou";
import {
	describe,
	download,
	type Transfer,
	transferId,
	upload,
} from "./transfers";

/** How long Refresh spins at least, and shows its check after. */
const REFRESH_MIN_SPIN_MS = 700;
const REFRESH_DONE_MS = 1200;

const levelOf = (percent: number) =>
	percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";

/** Where the workspaces mount it, as their users see it: ~/cloud-drive. */
export const homePath = (path: string) =>
	path.replace(/^\/home\/coder(?=\/|$)/, "~");

/**
 * The Cloud Drive's files (in its window): folders and files with their size
 * and date, upload (or drop files on it) and download, each with a moving bar,
 * how much has gone, how fast and how long is left (transfers.ts); new folder,
 * delete (asked once more); how full it is, and where its workspaces have it;
 * Share - the entire drive, a folder or a file of it (ShareDialog). Opened on
 * what is shared with the user (`initialDrive`: its owner's id, `initialPath`:
 * the folder) from the Workspaces page's shares: there, only what is shared is
 * reached, and written only where it is shared read and write. An admin's look
 * at another account's drive (`inspect`, from a link): all of it, read only -
 * not one its owner encrypted (the service says so).
 */
export const CloudDriveBrowser: React.FC<{
	summary: SafeSummary;
	initialDrive?: string;
	initialPath?: string;
	inspect?: { owner: string; ownerName: string };
}> = ({ summary, initialDrive = "", initialPath = "", inspect }) => {
	const queryClient = useQueryClient();
	const [path, setPath] = useState(initialPath);
	// Which Cloud Drive: the user's own (""), or one shared with them - all of it or parts (its owner's id) - open at
	// once, while their workspaces get it at their next start.
	const [drive, setDrive] = useState(initialDrive);
	const peers = useQuery(cloudDrivePeers());
	const incoming = incomingShares(peers.data);
	const fromOwner = incoming.filter((s) => s.owner === drive);
	const owners = [...new Map(incoming.map((s) => [s.owner, s])).values()];
	const shared = fromOwner[0];
	const inspecting = Boolean(inspect && drive === inspect.owner && !shared);
	useEffect(() => {
		if (drive && peers.isSuccess && !shared && drive !== inspect?.owner) {
			setDrive("");
			setPath("");
		}
	}, [drive, peers.isSuccess, shared, inspect?.owner]);
	const listing = useQuery(safeListing(path, true, drive));
	// In a shared drive, the folder says what the user may do there (null: a folder on the way to what is shared).
	const canWrite = !drive || listing.data?.access === "write";
	// What of the user's own drive is shared already (a mark on it), and what they are sharing now.
	const sharedOfMine = new Set(
		(peers.data?.ofMine ?? [])
			.filter((s) => ["asked", "approval", "active"].includes(s.state))
			.map((s) => s.path ?? ""),
	);
	const [sharing, setSharing] = useState<{
		path: string;
		kind: "drive" | "folder" | "file";
	} | null>(null);
	const [transfers, setTransfers] = useState<Transfer[]>([]);
	const [folderName, setFolderName] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: safeKey });
	// The Refresh button's feedback: spinning while it reads (at least a moment, so it shows), then a check.
	const [refreshing, setRefreshing] = useState<"idle" | "busy" | "done">(
		"idle",
	);
	const refreshNow = async () => {
		if (refreshing === "busy") {
			return;
		}
		setRefreshing("busy");
		const started = Date.now();
		try {
			await refresh();
		} finally {
			const left = REFRESH_MIN_SPIN_MS - (Date.now() - started);
			if (left > 0) {
				await new Promise((resolve) => setTimeout(resolve, left));
			}
			setRefreshing("done");
			setTimeout(() => setRefreshing("idle"), REFRESH_DONE_MS);
		}
	};

	const patch = (id: number, change: Partial<Transfer>) =>
		setTransfers((all) =>
			all.map((t) => (t.id === id ? { ...t, ...change } : t)),
		);
	// A finished transfer stays a moment, then goes.
	const finish = (id: number, change: Partial<Transfer>) => {
		patch(id, { ...change, done: true });
		window.setTimeout(
			() => setTransfers((all) => all.filter((t) => t.id !== id)),
			change.browser ? 6000 : 2500,
		);
	};

	const uploadFiles = async (files: File[]) => {
		setProblem(null);
		await upload(files, path, drive, {
			start: (t) => setTransfers((all) => [...all, t]),
			progress: (id, loaded) => patch(id, { loaded }),
			done: (id, size) => finish(id, { loaded: size }),
			failed: (id, error) => patch(id, { error }),
		});
		await refresh();
	};

	const downloadFile = async (target: string, name: string, size: number) => {
		const id = transferId();
		setTransfers((all) => [
			...all,
			{
				id,
				kind: "download",
				name,
				loaded: 0,
				total: size,
				startedAt: Date.now(),
			},
		]);
		try {
			const how = await download(
				PlatformAPI.safeDownloadUrl(target, drive || undefined),
				name,
				size,
				(loaded, total) => patch(id, { loaded, total }),
			);
			if (how === "cancelled") {
				setTransfers((all) => all.filter((t) => t.id !== id));
			} else {
				finish(id, how === "browser" ? { browser: true } : { loaded: size });
			}
		} catch (e) {
			patch(id, {
				error: e instanceof Error ? e.message : "The download failed.",
			});
		}
	};

	const makeFolder = async () => {
		const name = (folderName ?? "").trim();
		const bad = validName(name);
		if (bad) {
			setProblem(bad);
			return;
		}
		try {
			await PlatformAPI.makeSafeFolder(
				joinPath(path, name),
				drive || undefined,
			);
			setFolderName(null);
			setProblem(null);
			await refresh();
		} catch (e) {
			setProblem(e instanceof Error ? e.message : "The folder was not made.");
		}
	};

	const remove = async (target: string) => {
		if (confirming !== target) {
			setConfirming(target);
			return;
		}
		setConfirming(null);
		try {
			await PlatformAPI.deleteFromSafe(target, drive || undefined);
			await refresh();
		} catch (e) {
			setProblem(e instanceof Error ? e.message : "It was not deleted.");
		}
	};

	// a workspace's folder (the source) has its volume's room, no quota
	const quota = summary.quotaBytes;
	const percent = quota === null ? 0 : usedPercent(summary.usedBytes, quota);
	const data: SafeListing | undefined = listing.data;
	const empty = data && data.folders.length === 0 && data.files.length === 0;

	return (
		<div
			className={cn(
				"flex max-h-[min(560px,70vh)] flex-col text-sm",
				dragging && "cd-drop",
			)}
			onDragOver={(event) => {
				if (canWrite && event.dataTransfer.types.includes("Files")) {
					event.preventDefault();
					setDragging(true);
				}
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) {
					setDragging(false);
				}
			}}
			onDrop={(event) => {
				event.preventDefault();
				setDragging(false);
				if (canWrite) {
					void uploadFiles([...event.dataTransfer.files]);
				}
			}}
		>
			{(owners.length > 0 || inspect) && (
				<div
					className="flex flex-wrap items-center gap-1.5 border-0 border-b border-solid border-border px-4 py-2 text-xs"
					role="tablist"
					aria-label="Cloud Drives"
					data-testid="cloud-drive-drives"
				>
					{[
						{ owner: "", label: "Mine" },
						...(inspect && !owners.some((s) => s.owner === inspect.owner)
							? [
									{
										owner: inspect.owner,
										label: `${inspect.ownerName}'s (admin view, read only)`,
									},
								]
							: []),
						...owners.map((s) => {
							const parts = incoming.filter((x) => x.owner === s.owner);
							const whole = parts.find((x) => x.kind === "drive");
							return {
								owner: s.owner,
								label: whole
									? `${s.ownerName}'s (${whole.access === "write" ? "read and write" : "read only"})`
									: `${s.ownerName}'s (${parts.length} shared)`,
							};
						}),
					].map((d) => (
						<button
							key={d.owner || "mine"}
							type="button"
							role="tab"
							aria-selected={drive === d.owner}
							onClick={() => {
								setDrive(d.owner);
								setPath("");
								setFolderName(null);
								setConfirming(null);
							}}
							className={cn(
								"cursor-pointer rounded-full border border-solid px-2.5 py-0.5",
								drive === d.owner
									? "border-content-link bg-surface-sky text-content-primary"
									: "border-border bg-transparent text-content-secondary hover:text-content-primary",
							)}
							data-testid={`cloud-drive-drive-${d.owner || "mine"}`}
						>
							{d.label}
						</button>
					))}
				</div>
			)}
			<header className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3">
				<nav
					aria-label="Folder"
					className="flex min-w-0 flex-1 items-center gap-1"
				>
					{breadcrumbs(
						path,
						shared
							? `${shared.ownerName}'s Cloud Drive`
							: inspecting && inspect
								? `${inspect.ownerName}'s Cloud Drive`
								: "Cloud Drive",
					).map((crumb, i, all) => (
						<span key={crumb.path} className="flex min-w-0 items-center gap-1">
							{i > 0 && (
								<ChevronRightIcon
									aria-hidden
									className="size-3.5 shrink-0 text-content-secondary"
								/>
							)}
							<button
								type="button"
								className={cn(
									"truncate border-0 bg-transparent p-0 text-sm",
									i === all.length - 1
										? "font-semibold text-content-primary"
										: "cursor-pointer text-content-secondary hover:text-content-primary",
								)}
								aria-current={i === all.length - 1 ? "location" : undefined}
								onClick={() => setPath(crumb.path)}
							>
								{crumb.name}
							</button>
						</span>
					))}
				</nav>
				<input
					ref={fileInput}
					type="file"
					multiple
					hidden
					data-testid="cloud-drive-file-input"
					onChange={(event) => {
						const files = [...(event.target.files ?? [])];
						event.target.value = "";
						void uploadFiles(files);
					}}
				/>
				{!drive && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => setSharing({ path: "", kind: "drive" })}
						data-testid="cloud-drive-share-drive"
						title="Share your entire Cloud Drive"
					>
						<Share2Icon />
						Share drive
					</Button>
				)}
				{canWrite && (
					<>
						<Button
							size="sm"
							variant="outline"
							onClick={() => fileInput.current?.click()}
						>
							<UploadIcon />
							Upload
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setFolderName("")}
						>
							<FolderPlusIcon />
							New folder
						</Button>
					</>
				)}
				<Button
					size="icon"
					variant="subtle"
					aria-label={
						refreshing === "busy"
							? "Refreshing"
							: refreshing === "done"
								? "Refreshed"
								: "Refresh"
					}
					title={refreshing === "done" ? "Up to date" : "Refresh"}
					aria-busy={refreshing === "busy"}
					onClick={() => void refreshNow()}
					data-testid="cloud-drive-refresh"
					data-state={refreshing}
				>
					{refreshing === "done" ? (
						<CheckIcon className="text-content-success" />
					) : (
						<RefreshCwIcon
							className={cn(
								"transition-transform",
								refreshing === "busy" && "animate-spin",
							)}
						/>
					)}
				</Button>
			</header>

			<div
				className="min-h-[180px] flex-1 overflow-auto px-2 py-2"
				data-testid="cloud-drive-listing"
			>
				{folderName !== null && (
					<form
						className="flex items-center gap-2 px-2 py-1.5"
						onSubmit={(event) => {
							event.preventDefault();
							void makeFolder();
						}}
					>
						<FolderIcon aria-hidden className="size-4 text-content-secondary" />
						<input
							// biome-ignore lint/a11y/noAutofocus: the field the button just opened
							autoFocus
							aria-label="New folder's name"
							value={folderName}
							onChange={(event) => setFolderName(event.target.value)}
							placeholder="Folder name"
							className="h-7 flex-1 rounded border border-solid border-border bg-surface-secondary px-2 text-sm text-content-primary"
						/>
						<Button size="sm" type="submit">
							Create
						</Button>
						<Button
							size="sm"
							variant="subtle"
							onClick={() => setFolderName(null)}
						>
							Cancel
						</Button>
					</form>
				)}
				{listing.isLoading && (
					<p className="px-3 py-6 text-center text-content-secondary">
						Opening…
					</p>
				)}
				{listing.error && (
					<p
						role="alert"
						className="px-3 py-6 text-center text-content-destructive"
					>
						{listing.error instanceof Error
							? listing.error.message
							: "The Cloud Drive could not be read."}
					</p>
				)}
				{empty && (
					<p className="px-3 py-8 text-center text-content-secondary">
						{path
							? "This folder is empty."
							: shared
								? `${shared.ownerName}'s Cloud Drive is empty.`
								: `Your Cloud Drive is empty. Upload files here (or drop them on it), or save them in ${homePath(summary.mountPath)} in any of your workspaces.`}
					</p>
				)}
				{data && !empty && (
					<ul className="m-0 list-none p-0" aria-label="Files">
						{data.folders.map((folder) => {
							const target = `${joinPath(path, folder.name)}/`;
							return (
								<li
									key={`d:${folder.name}`}
									className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-secondary"
								>
									<button
										type="button"
										className="flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-sm text-content-primary"
										onClick={() => setPath(joinPath(path, folder.name))}
									>
										<FolderIcon
											aria-hidden
											className="size-4 shrink-0 text-content-link"
										/>
										<span className="truncate">{folder.name}</span>
										{!drive &&
											sharedOfMine.has(joinPath(path, folder.name)) && (
												<SharedMark />
											)}
										{drive && folder.access && (
											<AccessMark access={folder.access} />
										)}
									</button>
									<span className="flex items-center gap-1">
										{!drive && (
											<ShareButton
												name={folder.name}
												onClick={() =>
													setSharing({
														path: joinPath(path, folder.name),
														kind: "folder",
													})
												}
											/>
										)}
										{canWrite && (
											<DeleteButton
												name={folder.name}
												confirming={confirming === target}
												onClick={() => void remove(target)}
											/>
										)}
									</span>
								</li>
							);
						})}
						{data.files.map((file) => {
							const target = joinPath(path, file.name);
							return (
								<li
									key={`f:${file.name}`}
									className="group grid grid-cols-[1fr_80px_150px_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-secondary"
								>
									<span className="flex min-w-0 items-center gap-2 text-content-primary">
										<FileIcon
											aria-hidden
											className="size-4 shrink-0 text-content-secondary"
										/>
										<span className="truncate" title={file.name}>
											{file.name}
										</span>
										{!drive && sharedOfMine.has(target) && <SharedMark />}
										{drive && file.access && (
											<AccessMark access={file.access} />
										)}
									</span>
									<span className="text-right text-xs tabular-nums text-content-secondary">
										{formatBytes(file.size)}
									</span>
									<span className="text-xs tabular-nums text-content-secondary">
										{new Date(file.modified).toLocaleString(undefined, {
											dateStyle: "medium",
											timeStyle: "short",
										})}
									</span>
									<span className="flex items-center gap-1">
										<button
											type="button"
											aria-label={`Download ${file.name}`}
											onClick={() =>
												void downloadFile(target, file.name, file.size)
											}
											className="inline-flex size-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-content-secondary hover:text-content-primary"
										>
											<DownloadIcon aria-hidden className="size-4" />
										</button>
										{!drive && (
											<ShareButton
												name={file.name}
												onClick={() =>
													setSharing({ path: target, kind: "file" })
												}
											/>
										)}
										{canWrite && (
											<DeleteButton
												name={file.name}
												confirming={confirming === target}
												onClick={() => void remove(target)}
											/>
										)}
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{(transfers.length > 0 || problem) && (
				<div className="flex flex-col gap-1.5 border-0 border-t border-solid border-border px-4 py-2">
					{problem && (
						<p role="alert" className="m-0 text-xs text-content-destructive">
							{problem}
						</p>
					)}
					{transfers.map((t) => (
						<TransferRow key={t.id} transfer={t} />
					))}
				</div>
			)}

			{sharing && (
				<ShareDialog
					path={sharing.path}
					kind={sharing.kind}
					onClose={() => setSharing(null)}
				/>
			)}
			{shared ? (
				<footer
					className="flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-border px-4 py-2.5 text-xs text-content-secondary"
					data-testid="cloud-drive-shared-footer"
				>
					<span>
						{`Shared with you by ${shared.ownerName}: ${fromOwner
							.map(
								(s) =>
									`${s.kind === "drive" ? "their entire Cloud Drive" : `the ${shareWhat(s)}`} (${s.access === "write" ? "read and write" : "read only"})`,
							)
							.join(", ")}`}
					</span>
					<span>
						{`In your workspaces at ~/cloud-drive/Shared/${shared.ownerName} from their next start`}
					</span>
					{canWrite && (
						<span className="ml-auto">
							Up to {formatBytes(summary.maxUploadBytes)} a file
						</span>
					)}
				</footer>
			) : (
				<footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-border px-4 py-2.5 text-xs text-content-secondary">
					<span className="flex items-center gap-2 tabular-nums">
						{quota !== null && (
							<span
								className="cd-meter w-28"
								data-level={levelOf(percent)}
								role="meter"
								aria-label="Cloud Drive used"
								aria-valuenow={summary.usedBytes}
								aria-valuemin={0}
								aria-valuemax={quota}
							>
								<i style={{ width: `${percent}%` }} />
							</span>
						)}
						{`${formatBytes(summary.usedBytes)}${quota === null ? ` in ${summary.source?.path ?? "a workspace's folder"}` : ` of ${formatBytes(quota)}`} · ${summary.files} ${summary.files === 1 ? "file" : "files"}`}
					</span>
					<span>
						{summary.volume === "ready"
							? `In each of your workspaces at ${homePath(summary.mountPath)}`
							: "Being set up: your workspaces get it in a minute"}
					</span>
					<span className="ml-auto">
						Up to {formatBytes(summary.maxUploadBytes)} a file; drop files here
						to upload them
					</span>
				</footer>
			)}
		</div>
	);
};

/** A mark on what of the user's own drive is shared with someone. */
const SharedMark: React.FC = () => (
	<span
		className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-sky px-1.5 text-[11px] text-content-link"
		title="Shared with someone"
		data-testid="cloud-drive-shared-mark"
	>
		<UsersIcon aria-hidden className="size-3" />
		shared
	</span>
);

/** In a folder on the way to what is shared with the user: what each shared one gives. */
const AccessMark: React.FC<{ access: "read" | "write" }> = ({ access }) => (
	<span
		className={cn(
			"inline-flex shrink-0 items-center rounded-full px-1.5 text-[11px]",
			access === "write"
				? "bg-surface-green text-content-success"
				: "bg-surface-sky text-content-link",
		)}
	>
		{access === "write" ? "read and write" : "read only"}
	</span>
);

const ShareButton: React.FC<{ name: string; onClick: () => void }> = ({
	name,
	onClick,
}) => (
	<button
		type="button"
		aria-label={`Share ${name}`}
		title={`Share ${name}`}
		onClick={onClick}
		className="inline-flex size-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-content-secondary opacity-60 hover:text-content-link hover:opacity-100 group-hover:opacity-100"
	>
		<Share2Icon aria-hidden className="size-4" />
	</button>
);

const DeleteButton: React.FC<{
	name: string;
	confirming: boolean;
	onClick: () => void;
}> = ({ name, confirming, onClick }) =>
	confirming ? (
		<Button size="xs" variant="destructive" onClick={onClick}>
			Delete?
		</Button>
	) : (
		<button
			type="button"
			aria-label={`Delete ${name}`}
			onClick={onClick}
			className="inline-flex size-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-content-secondary opacity-60 hover:text-content-destructive hover:opacity-100 group-hover:opacity-100"
		>
			<Trash2Icon aria-hidden className="size-4" />
		</button>
	);

/** A transfer: which way, the file, a moving bar, how much has gone, how fast, how long is left. */
const TransferRow: React.FC<{ transfer: Transfer }> = ({ transfer: t }) => {
	const percent = t.total
		? Math.min(100, Math.round((t.loaded / t.total) * 100))
		: 0;
	const verb = t.kind === "upload" ? "Uploading" : "Downloading";
	const Icon = t.kind === "upload" ? UploadIcon : DownloadIcon;
	return (
		<div
			className="flex items-center gap-3 text-xs"
			data-testid={`cloud-drive-${t.kind}`}
		>
			<Icon aria-hidden className="size-3.5 shrink-0 text-content-secondary" />
			<span
				className="w-40 shrink-0 truncate text-content-primary"
				title={t.name}
			>
				{t.name}
			</span>
			{t.error ? (
				<span className="text-content-destructive">{t.error}</span>
			) : t.browser ? (
				<span className="text-content-secondary">
					Too large to follow here: in your browser's downloads.
				</span>
			) : (
				<>
					<span
						className="cd-progress flex-1"
						role="progressbar"
						aria-label={`${verb} ${t.name}`}
						aria-valuenow={percent}
						aria-valuemin={0}
						aria-valuemax={100}
						data-done={t.done || undefined}
					>
						<i style={{ width: `${percent}%` }} />
					</span>
					<span className="w-56 shrink-0 text-right tabular-nums text-content-secondary">
						{t.done ? "Done" : `${percent}% · ${describe(t)}`}
					</span>
				</>
			)}
		</div>
	);
};
