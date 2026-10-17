import { formatBytes } from "./drivePaths";

/** A file going up to the Cloud Drive or coming down from it, as its window shows it. */
export type Transfer = {
	id: number;
	kind: "upload" | "download";
	name: string;
	loaded: number;
	total: number;
	startedAt: number;
	error?: string;
	done?: boolean;
	/** Handed to the browser's own download (a file too large to hold in memory). */
	browser?: boolean;
};

/** Without a way to write a download to disk as it comes, files up to this are held in memory, then saved. */
export const MEMORY_LIMIT = 1024 ** 3;

/** "12.3 MB of 1.2 GB · 34 MB/s · 35 s left", from how much has gone, of how much, since when. */
export const describe = (t: Transfer, now = Date.now()): string => {
	const seconds = Math.max(0.001, (now - t.startedAt) / 1000);
	const rate = t.loaded / seconds;
	const parts = [`${formatBytes(t.loaded)} of ${formatBytes(t.total)}`];
	if (t.loaded > 0 && seconds >= 0.5) {
		parts.push(`${formatBytes(rate)}/s`);
		const left = (t.total - t.loaded) / Math.max(rate, 1);
		parts.push(
			left < 60
				? `${Math.ceil(left)} s left`
				: `${Math.floor(left / 60)} min ${Math.ceil(left % 60)} s left`,
		);
	}
	return parts.join(" · ");
};

type SavePicker = (options: { suggestedName: string }) => Promise<{
	createWritable: () => Promise<{
		write: (chunk: Uint8Array) => Promise<void>;
		close: () => Promise<void>;
		abort?: () => Promise<void>;
	}>;
}>;

/**
 * A Cloud Drive file onto this computer with its progress (loaded, total): where the browser can write a file as it
 * comes (Chromium: the save dialog), straight to disk; else into memory, then saved as a download - unless it is
 * larger than MEMORY_LIMIT, which goes to the browser's own download (and its own progress). Call it from the click:
 * the save dialog needs it. "cancelled": the save dialog was closed.
 */
export const download = async (
	url: string,
	name: string,
	size: number,
	onProgress: (loaded: number, total: number) => void,
): Promise<"saved" | "browser" | "cancelled"> => {
	const picker = (window as unknown as { showSaveFilePicker?: SavePicker })
		.showSaveFilePicker;
	const save = (href: string) => {
		const a = document.createElement("a");
		a.href = href;
		a.download = name;
		a.rel = "noopener";
		document.body.appendChild(a);
		a.click();
		a.remove();
	};
	let file:
		| Awaited<ReturnType<Awaited<ReturnType<SavePicker>>["createWritable"]>>
		| undefined;
	if (picker) {
		try {
			file = await (await picker({ suggestedName: name })).createWritable();
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") {
				return "cancelled";
			}
			file = undefined; // not allowed here: as if there were no such dialog
		}
	}
	if (!file && size > MEMORY_LIMIT) {
		save(url);
		return "browser";
	}
	const response = await fetch(url, { credentials: "same-origin" });
	if (!response.ok || !response.body) {
		await file?.abort?.();
		throw new Error(
			response.status === 404
				? "It is not in your Cloud Drive (any more)."
				: `The download failed (${response.status}).`,
		);
	}
	const total = Number(response.headers.get("Content-Length")) || size;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	onProgress(0, total);
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		loaded += value.length;
		if (file) {
			await file.write(value);
		} else {
			chunks.push(value);
		}
		onProgress(loaded, total);
	}
	if (file) {
		await file.close();
	} else {
		const href = URL.createObjectURL(new Blob(chunks as BlobPart[]));
		save(href);
		window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
	}
	return "saved";
};
