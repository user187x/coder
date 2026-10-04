import { useEffect, useRef } from "react";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { ChatPanel } from "./ChatPanel";
import { ChatWindow } from "./ChatWindow";
import { setDrawerOpen, useChatConnection, useChatSnapshot } from "./chatStore";

// What may be fixed or sticky at the window's edges: the classification
// marking, the deployment stats footer, the navbar.
const BOTTOM_BARS =
	"#coder-classification-bottom, div.sticky.bottom-0, div.fixed.bottom-0";
const TOP_BARS = "#coder-classification-top, div.sticky.top-0";
const MEASURE_EVERY_MS = 500;

/**
 * Measures what the dock rests on and how much room its windows have. The
 * bars come and go (settings, pages, permissions), so their edges are
 * measured, not assumed: on scroll and resize, and twice a second for
 * everything else. The results are CSS variables on the dock, so measuring
 * never re-renders it.
 */
const useDockMeasurements = (dock: React.RefObject<HTMLDivElement | null>) => {
	useEffect(() => {
		let bottom = -1;
		let room = -1;
		const measure = () => {
			const element = dock.current;
			if (!element) {
				return;
			}
			const height = window.innerHeight;
			const bars = [...document.querySelectorAll(BOTTOM_BARS)]
				.filter((bar) => !element.contains(bar))
				.map((bar) => bar.getBoundingClientRect())
				.filter(
					(r) =>
						r.width > 0 &&
						r.height > 0 &&
						r.top < height &&
						r.height < height / 3,
				)
				.sort((a, b) => b.bottom - a.bottom);
			let occupied = 0;
			for (const r of bars) {
				// Stacked on the window's edge, or on a bar already counted.
				if (height - r.bottom <= occupied + 2) {
					occupied = Math.max(occupied, height - r.top);
				}
			}
			occupied = Math.round(occupied);
			if (occupied !== bottom) {
				bottom = occupied;
				element.style.setProperty("--chat-bottom", `${occupied}px`);
			}

			let top = 0;
			for (const bar of document.querySelectorAll(TOP_BARS)) {
				if (element.contains(bar)) {
					continue;
				}
				const r = bar.getBoundingClientRect();
				if (
					r.width > 0 &&
					r.height > 0 &&
					r.top < 160 &&
					r.height < height / 3
				) {
					top = Math.max(top, r.bottom);
				}
			}
			const panel = element.querySelector("[data-chat-panel]");
			const panelTop = panel
				? panel.getBoundingClientRect().top
				: height - Math.max(bottom, 0);
			// 8 px above the panel and 8 px below the navbar.
			const available = Math.max(0, Math.round(panelTop - top - 16));
			if (available !== room) {
				room = available;
				element.style.setProperty("--chat-room", `${available}px`);
			}
		};

		let queued = false;
		const queue = () => {
			if (queued) {
				return;
			}
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				measure();
			});
		};
		window.addEventListener("resize", queue);
		window.addEventListener("scroll", queue, { capture: true, passive: true });
		const interval = window.setInterval(measure, MEASURE_EVERY_MS);
		measure();
		return () => {
			window.removeEventListener("resize", queue);
			window.removeEventListener("scroll", queue, { capture: true });
			window.clearInterval(interval);
		};
	}, [dock]);
};

/**
 * Chat windows docked at the bottom right of every dashboard page, above the
 * Chats panel. An admin starts a conversation with "Chat" in Admin >
 * Accounts; the other person gets a window as soon as the message arrives, on
 * whatever page they have open.
 */
export const ChatDock: React.FC = () => {
	const embedded = isEmbeddedFrame();
	const dock = useRef<HTMLDivElement>(null);
	const state = useChatSnapshot();
	useDockMeasurements(dock);

	useChatConnection(!embedded);

	// Clicking elsewhere or pressing Escape closes the panel.
	useEffect(() => {
		if (!state.drawerOpen) {
			return;
		}
		const close = (event: Event) => {
			if (
				event instanceof KeyboardEvent
					? event.key === "Escape"
					: !(
							event.target instanceof Node &&
							dock.current?.contains(event.target)
						)
			) {
				setDrawerOpen(false);
			}
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", close);
		};
	}, [state.drawerOpen]);

	if (embedded || !state.me) {
		return null;
	}

	return (
		<div
			ref={dock}
			aria-label="Chats"
			role="region"
			className="pointer-events-none fixed right-4 z-[60] flex flex-col items-end gap-2 text-sm text-content-primary transition-[bottom] duration-200 motion-reduce:transition-none [&>*]:pointer-events-auto"
			style={{ bottom: "var(--chat-bottom, 0px)" }}
		>
			{state.windows.length > 0 && (
				<div className="pointer-events-none flex flex-row-reverse items-end gap-3 [&>*]:pointer-events-auto">
					{state.windows.map((w) => (
						<ChatWindow key={w.peer.id} window={w} dock={dock} />
					))}
				</div>
			)}
			<ChatPanel />
		</div>
	);
};
