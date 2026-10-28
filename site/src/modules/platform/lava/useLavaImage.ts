import { useEffect, useSyncExternalStore } from "react";
import type { LavaSettings } from "./lava";
import { readLavaSettings } from "./lavaPng";

/** What is known of each picture: its lava settings, or null for any other picture. */
const known = new Map<string, LavaSettings | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** The start of a picture that holds its settings, well past them (they follow the 33-byte header). */
const HEAD_BYTES = 16 * 1024;

/** Only pictures the platform service keeps (avatars, the logo, icons, the announcement's) or that are being chosen. */
const mayBeLava = (src: string) => {
	if (src.startsWith("data:image/png;base64,")) {
		return true;
	}
	try {
		const url = new URL(src, location.href);
		return (
			url.origin === location.origin && url.pathname.startsWith("/__coder-ui/")
		);
	} catch {
		return false;
	}
};

const head = async (src: string): Promise<Uint8Array> => {
	if (src.startsWith("data:")) {
		const start = src.indexOf(",") + 1;
		const base64 = src.slice(start, start + Math.ceil(HEAD_BYTES / 3) * 4);
		return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	}
	const response = await fetch(src, { credentials: "same-origin" });
	const reader = response.ok ? response.body?.getReader() : undefined;
	if (!reader) {
		return new Uint8Array();
	}
	const out = new Uint8Array(HEAD_BYTES);
	let length = 0;
	try {
		while (length < HEAD_BYTES) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const part = value.subarray(0, HEAD_BYTES - length);
			out.set(part, length);
			length += part.length;
		}
	} finally {
		// The rest of the picture is not needed.
		void reader.cancel().catch(() => {});
	}
	return out.subarray(0, length);
};

/**
 * Platform: the lava settings a picture carries (lavaPng.ts), so it can be
 * drawn live (LiveLava); undefined until known and for any other picture. Each
 * picture's start is read once per page.
 */
export const useLavaImage = (src: string | undefined) => {
	const settings = useSyncExternalStore(subscribe, () =>
		src ? known.get(src) : undefined,
	);
	useEffect(() => {
		if (!src || known.has(src) || pending.has(src) || !mayBeLava(src)) {
			return;
		}
		pending.add(src);
		head(src)
			.then(readLavaSettings)
			.catch(() => null)
			.then((found) => {
				known.set(src, found);
				pending.delete(src);
				for (const listener of listeners) {
					listener();
				}
			});
	}, [src]);
	return settings ?? undefined;
};
