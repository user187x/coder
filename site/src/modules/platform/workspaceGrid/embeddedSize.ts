import { useEffect } from "react";

/** What an embedded dashboard page tells the page around it: its content's size (the workspace grid fits it). */
export const EMBED_SIZE_MESSAGE = "platform-embed-size";

export type EmbedSizeMessage = {
	type: typeof EMBED_SIZE_MESSAGE;
	width: number;
	height: number;
};

export const isEmbedSizeMessage = (data: unknown): data is EmbedSizeMessage =>
	typeof data === "object" &&
	data !== null &&
	(data as EmbedSizeMessage).type === EMBED_SIZE_MESSAGE &&
	typeof (data as EmbedSizeMessage).height === "number" &&
	typeof (data as EmbedSizeMessage).width === "number";

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
		const report = () => {
			// Measure intrinsic content without the viewport stretch used to equalize grid cards.
			el.setAttribute("data-measuring", "");
			const height = el.offsetHeight;
			el.removeAttribute("data-measuring");
			const message: EmbedSizeMessage = {
				type: EMBED_SIZE_MESSAGE,
				width: el.scrollWidth,
				height,
			};
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
