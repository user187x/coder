import { cn } from "cn";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { ChatFullScreen, ChatSidePanel } from "./ChatAttached";
import { ChatFocusOverlay } from "./ChatFocusOverlay";
import { ChatPanel } from "./ChatPanel";
import { ChatWindow } from "./ChatWindow";
import {
	exitFullScreen,
	setDockMode,
	useChatConnection,
	useChatSnapshot,
	windowsBeside,
} from "./chatStore";
import { CHAT_CONSOLE_PAGE } from "./consolePlaces";
import "./chatDock.css";

// What may be fixed or sticky at the window's edges: the classification
// marking, the deployment stats footer, the navbar.
const BOTTOM_BARS =
	"#coder-classification-bottom, div.sticky.bottom-0, div.fixed.bottom-0";
const TOP_BARS = "#coder-classification-top, div.sticky.top-0";
const MEASURE_EVERY_MS = 500;
// Menus opened from the dock (a window's More) are portalled out of it: clicking them is not clicking elsewhere.
const POPPERS = "[data-radix-popper-content-wrapper]";

/**
 * Measures what the dock rests on and how much room its windows have. The
 * bars come and go (settings, pages, permissions), so their edges are
 * measured, not assumed: on scroll and resize, and twice a second for
 * everything else. The results are CSS variables on the dock, so measuring
 * never re-renders it: --chat-bottom (the bottom bars' height), --chat-top
 * (the navbar's bottom: where the side panel and full screen start),
 * --chat-space (the raised window's room) and --chat-room (the windows').
 */
const useDockMeasurements = (dock: React.RefObject<HTMLDivElement | null>) => {
	useEffect(() => {
		const last = new Map<string, number>();
		const set = (element: HTMLElement, name: string, px: number) => {
			if (last.get(name) !== px) {
				last.set(name, px);
				element.style.setProperty(name, `${px}px`);
			}
		};
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
			const bottom = Math.round(occupied);
			set(element, "--chat-bottom", bottom);

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
			top = Math.round(top);
			set(element, "--chat-top", top);
			// From 8 px below the navbar down to the dock (floating 10 px clear of the bottom bars).
			set(element, "--chat-space", Math.max(0, height - bottom - 10 - top - 8));

			// The windows: beside the panel, as tall as it may rise; above it, up
			// to it. 8 px below the navbar, and above the panel.
			const panel = element
				.querySelector("[data-chat-panel]")
				?.getBoundingClientRect();
			const base = panel
				? windowsBeside()
					? panel.bottom + 8
					: panel.top
				: height - bottom;
			set(element, "--chat-room", Math.max(0, Math.round(base - top - 16)));
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
 * The chat on every dashboard page, Gmail style: the Chats bar at the bottom
 * right, which rises into a small window (ChatPanel), with a window for each
 * open conversation beside it (above it on a narrow screen). From the raised
 * window the chat attaches to the right side, below the navbar, or goes full
 * screen (ChatAttached); there the conversations open inside it. An admin
 * starts a conversation with "Chat" in Admin > Accounts; the other person gets
 * a window as soon as the message arrives, on whatever page they have open.
 * Admins' chat console is not here: asked for (the panel's console button, the
 * bell), the dashboard goes to its page.
 */
export const ChatDock: React.FC = () => {
	const embedded = isEmbeddedFrame();
	const dock = useRef<HTMLDivElement>(null);
	const state = useChatSnapshot();
	const mode = state.dockMode;
	const shown = !embedded && Boolean(state.me);
	useDockMeasurements(dock);

	useChatConnection(!embedded);

	// The console was asked for (openConsole): its page, the Chat page's first card.
	const navigate = useNavigate();
	const location = useLocation();
	const consoleRequest = useRef(state.consoleRequest);
	useEffect(() => {
		if (state.consoleRequest === consoleRequest.current) {
			return;
		}
		consoleRequest.current = state.consoleRequest;
		if (location.pathname !== CHAT_CONSOLE_PAGE) {
			navigate(CHAT_CONSOLE_PAGE);
		}
	}, [state.consoleRequest, location.pathname, navigate]);

	// Another page asked for (the navbar, a link): full screen gives way to it.
	const path = useRef(location.pathname);
	useEffect(() => {
		if (path.current !== location.pathname) {
			path.current = location.pathname;
			exitFullScreen();
		}
	}, [location.pathname]);

	// The raised window lowers on a click elsewhere or Escape; full screen ends
	// on Escape. The side panel stays.
	useEffect(() => {
		if (mode !== "window" && mode !== "full") {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			// Taken by what closed on it (a menu, a dialog, a window's message box).
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			if (mode === "window") {
				setDockMode("bar");
			} else {
				exitFullScreen();
			}
		};
		const onPointer = (event: PointerEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			if (
				mode === "window" &&
				!(target && (dock.current?.contains(target) || target.closest(POPPERS)))
			) {
				setDockMode("bar");
			}
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [mode]);

	// Attached, the chat takes its room from the page (chatDock.css), under full screen too.
	const sideways =
		shown &&
		(mode === "side" || (mode === "full" && state.fullFrom === "side"));
	useEffect(() => {
		if (!sideways) {
			return;
		}
		const root = document.documentElement;
		root.dataset.chatSide = "";
		return () => {
			delete root.dataset.chatSide;
		};
	}, [sideways]);

	if (!shown) {
		return null;
	}
	const floating = mode === "bar" || mode === "window";

	return (
		<div
			ref={dock}
			aria-label="Chats"
			role="region"
			data-mode={mode}
			className={cn(
				"pointer-events-none fixed right-4 flex flex-col items-end gap-2 text-sm text-content-primary transition-[bottom] duration-200 motion-reduce:transition-none md:flex-row md:gap-3 [&>*]:pointer-events-auto",
				// Floating, in front of everything but the chat's own overlays; attached or full screen, a part of
				// the page: above it and its navbar, below its dialogs (the ones opened from the chat too).
				floating ? "z-[60]" : "z-[45]",
			)}
			// Platform: floating 10px clear of what it rests on (GUI-UPDATES)
			style={{ bottom: "calc(var(--chat-bottom, 0px) + 10px)" }}
		>
			{floating && state.windows.length > 0 && (
				<div className="pointer-events-none flex flex-row-reverse items-end gap-3 [&>*]:pointer-events-auto">
					{state.windows.map((w) => (
						<ChatWindow key={w.peer.id} window={w} dock={dock} />
					))}
				</div>
			)}
			{floating && <ChatPanel />}
			{mode === "side" && <ChatSidePanel dock={dock} />}
			{mode === "full" && <ChatFullScreen dock={dock} />}
			<ChatFocusOverlay />
		</div>
	);
};
