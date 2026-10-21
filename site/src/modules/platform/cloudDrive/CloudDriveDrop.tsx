import { BanIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "react-query";
import { toast } from "sonner";
import type { SafeSummary } from "#/api/platform";
import { safeKey } from "#/api/queries/platform";
import { formatBytes } from "./drivePaths";
import { describe, type Transfer, upload } from "./transfers";
import "./cloudDrive.css";

/** Why the user's own Cloud Drive takes no files now: a few words while they are held over it, and what a drop says. */
export type Refusal = { hint: string; message: string };

/**
 * Why a drop on the Cloud Drive is refused now, or null: it takes files. Its files cannot be reached (`offline`: its
 * source workspace stopped, a re-encryption), its storage does not answer, it is full, or it is still taking the files
 * dropped before (`busy`).
 */
export const dropRefusal = (
	summary: Pick<SafeSummary, "usedBytes" | "quotaBytes" | "offline">,
	connected: boolean | null | undefined,
	busy: boolean,
): Refusal | null => {
	if (summary.offline) {
		return {
			hint: "Your Cloud Drive cannot be reached now",
			message: `Not uploaded: your Cloud Drive cannot be reached now (${summary.offline}).`,
		};
	}
	if (connected === false) {
		return {
			hint: "Your Cloud Drive's storage does not answer",
			message:
				"Not uploaded: your Cloud Drive's storage does not answer now. Try again once it is connected.",
		};
	}
	if (summary.quotaBytes !== null && summary.usedBytes >= summary.quotaBytes) {
		return {
			hint: "Your Cloud Drive is full",
			message: `Not uploaded: your Cloud Drive is full (${formatBytes(summary.usedBytes)} of ${formatBytes(summary.quotaBytes)}). Make room in it first.`,
		};
	}
	if (busy) {
		return {
			hint: "Still uploading the files dropped before",
			message:
				"Not uploaded: your Cloud Drive is still taking the files dropped before. Drop these once they are in.",
		};
	}
	return null;
};

/** Dropped files on their way up: the one going now, which of how many, and the bytes of those before it, of all. */
export type DropUpload = {
	transfer: Transfer;
	index: number;
	count: number;
	before: number;
	total: number;
};

/** Files from the computer: a drag of anything else (text, a link) passes the Cloud Drive by. */
const holdsFiles = (event: React.DragEvent) =>
	event.dataTransfer.types.includes("Files");

/**
 * The Cloud Drive above the Workspaces table as a drop target: files dragged onto it from the computer go up to the
 * top of the user's own drive, as its window's Upload sends them (transfers.ts, upload). While they are held over it,
 * `over` (a dashed ring and a line saying so: DropHint); on their way up, `progress` (DropProgress); then a toast, done
 * or what failed. Where it takes none now (`refusal`), a drop is refused, saying why. Only drags of files: the cables'
 * plugs are dragged with the pointer, not this, and pass it by.
 */
export const useCloudDriveDrop = (
	summary: SafeSummary | undefined,
	connected: boolean | null | undefined,
	onOpen: () => void,
) => {
	const queryClient = useQueryClient();
	const [over, setOver] = useState(false);
	const [progress, setProgress] = useState<DropUpload | null>(null);
	const refusal = summary
		? dropRefusal(summary, connected, progress !== null)
		: null;

	const send = async (files: File[]) => {
		const total = files.reduce((n, f) => n + f.size, 0);
		const names = new Map<number, string>();
		const failed: string[] = [];
		let index = 0;
		let before = 0;
		try {
			await upload(files, "", "", {
				start: (t) => {
					names.set(t.id, t.name);
					if (t.error) {
						failed.push(`${t.name} (${t.error})`);
					}
					setProgress({
						transfer: t,
						index: index++,
						count: files.length,
						before,
						total,
					});
					before += t.total;
				},
				progress: (id, loaded) =>
					setProgress((p) =>
						p?.transfer.id === id
							? { ...p, transfer: { ...p.transfer, loaded } }
							: p,
					),
				done: () => {},
				failed: (id, error) => failed.push(`${names.get(id)} (${error})`),
			});
		} finally {
			setProgress(null);
		}
		await queryClient.invalidateQueries({ queryKey: safeKey });
		const uploaded = files.length - failed.length;
		if (failed.length === 0) {
			toast.success(
				uploaded === 1
					? `${files[0].name} is in your Cloud Drive.`
					: `${uploaded} files are in your Cloud Drive.`,
				{ action: { label: "Open", onClick: onOpen } },
			);
		} else {
			toast.error(
				uploaded > 0
					? `${uploaded} of ${files.length} files uploaded to your Cloud Drive; not uploaded: ${failed.join(", ")}.`
					: `Not uploaded to your Cloud Drive: ${failed.join(", ")}.`,
			);
		}
	};

	const hold = (event: React.DragEvent) => {
		if (!holdsFiles(event)) {
			return;
		}
		event.preventDefault();
		if (!refusal) {
			event.dataTransfer.dropEffect = "copy";
		}
		setOver(true);
	};

	return {
		over,
		refusal,
		progress,
		handlers: {
			onDragEnter: hold,
			onDragOver: hold,
			onDragLeave: (event: React.DragEvent) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setOver(false);
				}
			},
			onDrop: (event: React.DragEvent) => {
				if (!holdsFiles(event)) {
					return;
				}
				event.preventDefault();
				setOver(false);
				if (refusal) {
					toast.error(refusal.message);
					return;
				}
				// A folder comes as a file too, one that cannot be read: left out, and said so.
				const folders = new Set(
					Array.from(event.dataTransfer.items ?? []).flatMap((item) => {
						const entry = item.webkitGetAsEntry?.();
						return entry?.isDirectory ? [entry.name] : [];
					}),
				);
				const files = Array.from(event.dataTransfer.files).filter(
					(f) => !folders.has(f.name),
				);
				if (folders.size > 0) {
					toast.error(
						`Folders are not uploaded here (${[...folders].join(", ")}): drop the files in them, or open the Cloud Drive to make the folder first.`,
					);
				}
				if (files.length > 0) {
					void send(files);
				}
			},
		},
	};
};

/** Over the Cloud Drive while files are held over it: a drop uploads them to it - or why it takes none now. */
export const DropHint: React.FC<{ refusal: Refusal | null }> = ({
	refusal,
}) => (
	<span
		className="cd-drop-hint"
		role="status"
		data-testid="cloud-drive-drop-hint"
		data-refused={refusal ? "true" : undefined}
	>
		{refusal ? (
			<BanIcon aria-hidden className="size-4 shrink-0" />
		) : (
			<UploadIcon aria-hidden className="size-4 shrink-0" />
		)}
		<span className="truncate">
			{refusal ? refusal.hint : "Drop to upload to your Cloud Drive"}
		</span>
	</span>
);

/**
 * In place of the capacity bar (as tall) while dropped files go up: the transfers' moving bar, as far as all of them
 * have gone; which file, which of how many, how fast and how long it has left on hover.
 */
export const DropProgress: React.FC<{ progress: DropUpload }> = ({
	progress: p,
}) => {
	const percent =
		p.total > 0
			? Math.min(
					100,
					Math.round(((p.before + p.transfer.loaded) / p.total) * 100),
				)
			: 0;
	return (
		<span
			className="cd-progress flex h-1.5 w-full"
			role="progressbar"
			aria-label={`Uploading ${p.transfer.name} to your Cloud Drive${p.count > 1 ? ` (${p.index + 1} of ${p.count})` : ""}`}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={percent}
			title={`${p.transfer.name}${p.count > 1 ? ` (${p.index + 1} of ${p.count})` : ""}: ${describe(p.transfer)}`}
			data-testid="cloud-drive-drop-progress"
		>
			<i style={{ width: `${percent}%` }} />
		</span>
	);
};
