import { useEffect } from "react";

/** What an embedded dashboard page tells the page around it: its content's size (the workspace grid fits it). */
export const EMBED_SIZE_MESSAGE = "platform-embed-size";

type EmbedSizeMessage = {
	type: typeof EMBED_SIZE_MESSAGE;
	width: number;
	height: number;
};

export const isEmbedSizeMessage = (data: unknown): data is EmbedSizeMessage =>
	typeof data === "object" &&
	data !== null &&
	"type" in data &&
	data.type === EMBED_SIZE_MESSAGE &&
	"height" in data &&
	typeof data.height === "number" &&
	Number.isFinite(data.height) &&
	data.height > 0 &&
	"width" in data &&
	typeof data.width === "number" &&
	Number.isFinite(data.width) &&
	data.width > 0;

/**
 * In a page in the platform's frame: tells the page around it (this origin only) how big the element is, now and
 * each time it changes - the workspace grid scales a dashboard to fit its cell by it.
 */
export const useReportEmbeddedSize = (
	ref: React.RefObject<HTMLElement | null>,
	enabled: boolean,
) => {
	useEffect(() => {
		const el = ref.current;
		if (!enabled || !el || typeof ResizeObserver === "undefined") {
			return;
		}
		let previous: EmbedSizeMessage | undefined;
		const report = () => {
			const message: EmbedSizeMessage = {
				type: EMBED_SIZE_MESSAGE,
				width: el.scrollWidth,
				height: el.offsetHeight,
			};
			if (
				!isEmbedSizeMessage(message) ||
				(message.width === previous?.width &&
					message.height === previous?.height)
			)
				return;
			previous = message;
			try {
				window.parent.postMessage(message, window.location.origin);
			} catch {
				// no page around it to tell
			}
		};
		report();
		const observer = new ResizeObserver(report);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref, enabled]);
};
