import { cn } from "cn";
import {
	ChevronRightIcon,
	DownloadIcon,
	FileIcon,
	FolderIcon,
	FolderPlusIcon,
	RefreshCwIcon,
	Trash2Icon,
	UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import {
	PlatformAPI,
	type SafeListing,
	type SafeSummary,
} from "#/api/platform";
import { safeKey, safeListing } from "#/api/queries/platform";
import { Button } from "#/components/Button/Button";
import {
	breadcrumbs,
	formatBytes,
	joinPath,
	usedPercent,
	validName,
} from "./drivePaths";

const levelOf = (percent: number) =>
	percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";

/** Where the workspaces mount it, as their users see it: ~/cloud-drive. */
export const homePath = (path: string) =>
	path.replace(/^\/home\/coder(?=\/|$)/, "~");

type Upload = {
	id: number;
	name: string;
	fraction: number;
	error?: string;
	done?: boolean;
};

let nextUpload = 1;

/**
 * The Cloud Drive's files (in its window): folders and files with their size
 * and date, upload with progress (or by dropping files on it), new folder,
 * download, delete (asked once more); how full it is, and where its
 * workspaces have it.
 */
export const CloudDriveBrowser: React.FC<{ summary: SafeSummary }> = ({
	summary,
}) => {
	const queryClient = useQueryClient();
	const [path, setPath] = useState("");
	const listing = useQuery(safeListing(path, true));
	const [uploads, setUploads] = useState<Upload[]>([]);
	const [folderName, setFolderName] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: safeKey });

	const patchUpload = (id: number, patch: Partial<Upload>) =>
		setUploads((all) => all.map((u) => (u.id === id ? { ...u, ...patch } : u)));

	const uploadFiles = async (files: File[]) => {
		setProblem(null);
		for (const file of files) {
			const id = nextUpload++;
			const bad = validName(file.name);
			setUploads((all) => [
				...all,
				{ id, name: file.name, fraction: 0, error: bad ?? undefined },
			]);
			if (bad) {
				continue;
			}
			try {
				await PlatformAPI.uploadToSafe(joinPath(path, file.name), file, (f) =>
					patchUpload(id, { fraction: f }),
				);
				patchUpload(id, { fraction: 1, done: true });
			} catch (e) {
				patchUpload(id, {
					error: e instanceof Error ? e.message : "The upload failed.",
				});
			}
		}
		await refresh();
		window.setTimeout(
			() => setUploads((all) => all.filter((u) => !u.done)),
			2500,
		);
	};

	const makeFolder = async () => {
		const name = (folderName ?? "").trim();
		const bad = validName(name);
		if (bad) {
			setProblem(bad);
			return;
		}
		try {
			await PlatformAPI.makeSafeFolder(joinPath(path, name));
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
			await PlatformAPI.deleteFromSafe(target);
			await refresh();
		} catch (e) {
			setProblem(e instanceof Error ? e.message : "It was not deleted.");
		}
	};

	const percent = usedPercent(summary.usedBytes, summary.quotaBytes);
	const data: SafeListing | undefined = listing.data;
	const empty = data && data.folders.length === 0 && data.files.length === 0;

	return (
		<div
			className={cn(
				"flex max-h-[min(560px,70vh)] flex-col text-sm",
				dragging && "cd-drop",
			)}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) {
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
				void uploadFiles([...event.dataTransfer.files]);
			}}
		>
			<header className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border px-4 py-3">
				<nav
					aria-label="Folder"
					className="flex min-w-0 flex-1 items-center gap-1"
				>
					{breadcrumbs(path).map((crumb, i, all) => (
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
				<Button
					size="sm"
					variant="outline"
					onClick={() => fileInput.current?.click()}
				>
					<UploadIcon />
					Upload
				</Button>
				<Button size="sm" variant="outline" onClick={() => setFolderName("")}>
					<FolderPlusIcon />
					New folder
				</Button>
				<Button
					size="icon"
					variant="subtle"
					aria-label="Refresh"
					onClick={() => void refresh()}
				>
					<RefreshCwIcon />
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
									</button>
									<DeleteButton
										name={folder.name}
										confirming={confirming === target}
										onClick={() => void remove(target)}
									/>
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
										<a
											href={PlatformAPI.safeDownloadUrl(target)}
											download={file.name}
											aria-label={`Download ${file.name}`}
											className="inline-flex size-7 items-center justify-center rounded text-content-secondary hover:text-content-primary"
										>
											<DownloadIcon aria-hidden className="size-4" />
										</a>
										<DeleteButton
											name={file.name}
											confirming={confirming === target}
											onClick={() => void remove(target)}
										/>
									</span>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{(uploads.length > 0 || problem) && (
				<div className="flex flex-col gap-1.5 border-0 border-t border-solid border-border px-4 py-2">
					{problem && (
						<p role="alert" className="m-0 text-xs text-content-destructive">
							{problem}
						</p>
					)}
					{uploads.map((u) => (
						<div
							key={u.id}
							className="flex items-center gap-3 text-xs"
							data-testid="cloud-drive-upload"
						>
							<span
								className="w-48 truncate text-content-primary"
								title={u.name}
							>
								{u.name}
							</span>
							{u.error ? (
								<span className="text-content-destructive">{u.error}</span>
							) : (
								<>
									<span
										className="cd-progress flex-1"
										role="progressbar"
										aria-label={`Uploading ${u.name}`}
										aria-valuenow={Math.round(u.fraction * 100)}
										aria-valuemin={0}
										aria-valuemax={100}
									>
										<i style={{ width: `${Math.round(u.fraction * 100)}%` }} />
									</span>
									<span className="w-10 text-right tabular-nums text-content-secondary">
										{u.done ? "Done" : `${Math.round(u.fraction * 100)}%`}
									</span>
								</>
							)}
						</div>
					))}
				</div>
			)}

			<footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-border px-4 py-2.5 text-xs text-content-secondary">
				<span className="flex items-center gap-2 tabular-nums">
					<span
						className="cd-meter w-28"
						data-level={levelOf(percent)}
						role="meter"
						aria-label="Cloud Drive used"
						aria-valuenow={summary.usedBytes}
						aria-valuemin={0}
						aria-valuemax={summary.quotaBytes}
					>
						<i style={{ width: `${percent}%` }} />
					</span>
					{`${formatBytes(summary.usedBytes)} of ${formatBytes(summary.quotaBytes)} · ${summary.files} ${summary.files === 1 ? "file" : "files"}`}
				</span>
				<span>
					{summary.volume === "ready"
						? `In each of your workspaces at ${homePath(summary.mountPath)}`
						: "Being set up: your workspaces get it in a minute"}
				</span>
				<span className="ml-auto">
					Up to {formatBytes(summary.maxUploadBytes)} a file; drop files here to
					upload them
				</span>
			</footer>
		</div>
	);
};

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
