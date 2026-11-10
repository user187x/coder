import { cn } from "cn";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type { UserUIPreferences } from "#/api/platform";
import {
	updateUserUIPreferences,
	userUIPreferences,
} from "#/api/queries/platform";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { DriveShareNotification } from "../cloudDrive/DriveShareNotification";
import { ChatFullScreen, ChatSidePanel } from "./ChatAttached";
import { ChatConsoleOverlay } from "./ChatConsoleOverlay";
import { ChatFocusOverlay } from "./ChatFocusOverlay";
import { ChatPanel } from "./ChatPanel";
import {
	closeConsoleOverlay,
	exitFullScreen,
	setDockMode,
	useChatConnection,
	useChatSnapshot,
	windowsBeside,
} from "./chatStore";
import { CHAT_CONSOLE_PAGE } from "./consolePlaces";
import {
	chatRightEdge,
	type DockPosition,
	placeDock,
	snapDockPosition,
} from "./dockPosition";
import "./chatDock.css";
import { bottomBarsHeight } from "#/utils/bottomBars";

// What may be fixed or sticky at the window's edges: the classification
// marking, the deployment stats footer, the navbar.
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
const useDockMeasurements = (
	dock: React.RefObject<HTMLDivElement | null>,
	position: DockPosition | null | undefined,
) => {
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
			if (!element || element.dataset.dragging || element.dataset.resizing) {
				return;
			}
			const height = window.innerHeight;
			const right = document.documentElement.getBoundingClientRect().right;
			const boundary = chatRightEdge();
			const reserved = Math.max(
				0,
				document.documentElement.clientWidth - boundary,
			);
			const positioned =
				position &&
				["bar", "window", "compact"].includes(element.dataset.mode ?? "");
			const expanded =
				!position &&
				document
					.querySelector(
						".workspace-dashboard-page[data-workspace-expanded] .workspace-dashboard-scroll",
					)
					?.getBoundingClientRect();
			const uptime =
				!position &&
				document
					.querySelector(
						'.workspace-dashboard-page[data-workspace-expanded] [data-testid="workspace-uptime"]',
					)
					?.getBoundingClientRect();
			const footerControl = element
				.querySelector(
					element.dataset.mode === "bar"
						? "[data-chat-panel]"
						: "[data-chat-restore]",
				)
				?.getBoundingClientRect();
			// The bar and compact button share Uptime's centerline; the dock adds 10 px below it.
			const bottom =
				expanded && uptime && footerControl
					? Math.max(
							0,
							height -
								uptime.top -
								uptime.height / 2 -
								footerControl.height / 2 -
								10,
						)
					: expanded
						? Math.max(0, height - expanded.bottom)
						: bottomBarsHeight(element);
			if (!positioned) {
				element.style.right = expanded
					? uptime
						? `${Math.max(16, reserved + 16, right - uptime.left + 8)}px`
						: `${Math.max(16, reserved + 16, right - expanded.right + 16)}px`
					: reserved
						? `${reserved + 16}px`
						: "";
			}
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
			top = Math.round(expanded ? expanded.top : top);
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
			if (positioned) {
				// Size the raised panel before positioning it so it remains inside the viewport.
				set(element, "--chat-space", Math.max(0, height - bottom - top - 18));
				placeDock(element, position, top, bottom);
			} else {
				element.style.left = "";
				element.style.top = "";
				element.style.bottom = "calc(var(--chat-bottom, 0px) + 10px)";
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
	}, [dock, position]);
};

/**
 * The dashboard chat dock contains contacts and conversations in one raised panel.
 * It can also attach beside the page or expand to full screen. Administrator
 * console and focus overlays retain the dock's conversations underneath them.
 */
export const ChatDock: React.FC = () => {
	const embedded = isEmbeddedFrame();
	const dock = useRef<HTMLDivElement>(null);
	const state = useChatSnapshot();
	const mode = state.dockMode;
	const shown = !embedded && Boolean(state.me);
	const preferences = useQuery({ ...userUIPreferences(), enabled: shown });
	const client = useQueryClient();
	const position = preferences.data?.chat_position;
	const hidden = Boolean(preferences.data?.chat_hidden);
	const savePosition = useMutation({
		...updateUserUIPreferences(client),
		onError: (error) =>
			toast.error(getErrorMessage(error, "Could not save chat layout.")),
	});
	const drag = useRef<{
		x: number;
		y: number;
		left: number;
		top: number;
		width: number;
		height: number;
		moved: boolean;
		anchors: { left: string; top: string; right: string; bottom: string };
	} | null>(null);
	const suppressDragClick = useRef(false);
	const cancelDrag = () => {
		const start = drag.current;
		drag.current = null;
		suppressDragClick.current = false;
		if (start && dock.current) {
			Object.assign(dock.current.style, start.anchors);
			delete dock.current.dataset.dragging;
		}
	};
	useDockMeasurements(dock, position);
	const moveToEdge = (next: DockPosition | null) =>
		savePosition.mutate({ chat_position: next });
	const closeChat = () =>
		savePosition.mutate(
			{ chat_hidden: true },
			{
				onSuccess: () => setDockMode("bar"),
			},
		);
	const resize = (size: UserUIPreferences["chat_size"]) => {
		const element = dock.current;
		if (!element) return;
		const top =
			Number.parseFloat(element.style.getPropertyValue("--chat-top")) || 0;
		const bottom = bottomBarsHeight(element);
		const next = snapDockPosition(element.getBoundingClientRect(), {
			width: chatRightEdge(),
			height: window.innerHeight,
			top,
			bottom,
		});
		savePosition.mutate(
			{ chat_size: size, chat_position: next },
			{
				onSuccess: () => placeDock(element, next, top, bottom),
				onError: () => {
					const panel = element.querySelector<HTMLElement>("[data-chat-panel]");
					if (panel) {
						panel.style.width = `min(${preferences.data?.chat_size?.width ?? 420}px, calc(calc(100vw/var(--app-zoom,1)) - 32px))`;
						panel.style.height = `min(${preferences.data?.chat_size?.height ?? 520}px, var(--chat-space, 520px))`;
					}
					if (position) placeDock(element, position, top, bottom);
				},
				onSettled: () => {
					delete element.dataset.resizing;
				},
			},
		);
	};

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

	// Another page asked for (the navbar, a link, the console's): full screen and the console over the page give way
	// to it.
	const path = useRef(location.pathname);
	useEffect(() => {
		if (path.current !== location.pathname) {
			path.current = location.pathname;
			exitFullScreen();
			closeConsoleOverlay();
		}
	}, [location.pathname]);

	// The raised window lowers on a click elsewhere or Escape; full screen ends
	// on Escape. The side panel stays.
	useEffect(() => {
		if (
			hidden ||
			state.consoleOverlay ||
			(mode !== "window" && mode !== "full")
		) {
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
				!preferences.data?.chat_keep_open &&
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
	}, [mode, state.consoleOverlay, hidden, preferences.data?.chat_keep_open]);

	// Attached, the chat takes its room from the page (chatDock.css), under full screen too.
	const sideways =
		shown &&
		!hidden &&
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
	if (hidden) {
		return (
			<ChatFocusOverlay
				onReply={() => savePosition.mutate({ chat_hidden: false })}
			/>
		);
	}
	const floating = mode === "bar" || mode === "window" || mode === "compact";
	// The console over the page: every conversation is in it, so the windows (a second copy of one) wait hidden -
	// as they were, drafts and all - and the dock goes under its blur with the rest of the page.
	const overlaid = state.consoleOverlay;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={!floating}>
				<div
					onClickCapture={(event) => {
						if (!suppressDragClick.current) return;
						suppressDragClick.current = false;
						event.preventDefault();
						event.stopPropagation();
					}}
					onPointerDownCapture={(event) => {
						suppressDragClick.current = false;
						if (
							event.button !== 0 ||
							!floating ||
							!(event.target instanceof Element) ||
							!event.target.closest("[data-chat-drag], [data-chat-restore]") ||
							event.target.closest(
								"button:not([data-chat-drag], [data-chat-restore]), a, input, [role=switch]",
							)
						)
							return;
						const rect = event.currentTarget.getBoundingClientRect();
						drag.current = {
							x: event.clientX,
							y: event.clientY,
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
							moved: false,
							anchors: {
								left: event.currentTarget.style.left,
								top: event.currentTarget.style.top,
								right: event.currentTarget.style.right,
								bottom: event.currentTarget.style.bottom,
							},
						};
						event.target.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						const start = drag.current;
						if (!start) return;
						if ((event.buttons & 1) === 0) {
							cancelDrag();
							return;
						}
						const element = event.currentTarget;
						if (!start.moved) {
							if (
								Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4
							)
								return;
							start.moved = true;
							suppressDragClick.current = true;
							element.dataset.dragging = "true";
							element.setPointerCapture(event.pointerId);
						}
						event.preventDefault();
						element.style.left = `${Math.max(0, Math.min(chatRightEdge() - start.width, start.left + event.clientX - start.x))}px`;
						element.style.top = `${Math.max(0, Math.min(window.innerHeight - start.height, start.top + event.clientY - start.y))}px`;
						element.style.bottom = "auto";
						element.style.right = "auto";
					}}
					onPointerUp={(event) => {
						const start = drag.current;
						if (!start) return;
						drag.current = null;
						if (!start.moved) return;
						const element = event.currentTarget;
						delete element.dataset.dragging;
						element.releasePointerCapture(event.pointerId);
						const top =
							Number.parseFloat(element.style.getPropertyValue("--chat-top")) ||
							0;
						const bottom = bottomBarsHeight(element);
						const next = snapDockPosition(element.getBoundingClientRect(), {
							width: chatRightEdge(),
							height: window.innerHeight,
							top,
							bottom,
						});
						placeDock(element, next, top, bottom);
						moveToEdge(next);
					}}
					onPointerCancel={cancelDrag}
					ref={dock}
					aria-label="Chats"
					role="region"
					data-mode={mode}
					className={cn(
						"chat-floating-dock pointer-events-none fixed right-4 flex flex-col items-end gap-2 text-sm text-content-primary transition-[bottom] duration-200 motion-reduce:transition-none md:flex-row md:gap-3 [&>*]:pointer-events-auto",
						// Floating, in front of everything but the chat's own overlays; attached or full screen (or under the
						// console over the page), a part of the page: above it and its navbar, below its dialogs (the ones
						// opened from the chat too).
						floating && !overlaid ? "z-[60]" : "z-[45]",
						mode === "compact" && "right-6",
					)}
					// Platform: floating 10px clear of what it rests on (GUI-UPDATES)
					style={{ bottom: "calc(var(--chat-bottom, 0px) + 10px)" }}
				>
					{state.me && <DriveShareNotification userId={state.me.id} />}
					<ChatPanel
						dock={dock}
						size={preferences.data?.chat_size}
						onResize={resize}
						onClose={closeChat}
					/>
					{mode === "side" && <ChatSidePanel onClose={closeChat} />}
					{mode === "full" && <ChatFullScreen onClose={closeChat} />}
					<ChatConsoleOverlay />
					<ChatFocusOverlay />
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label="Chat dock position"
				className="z-[2147483647]"
			>
				<ContextMenuCheckboxItem
					checked={Boolean(preferences.data?.chat_keep_open)}
					onSelect={(event) => event.preventDefault()}
					onCheckedChange={(checked) =>
						savePosition.mutate({ chat_keep_open: checked })
					}
				>
					Keep chat open
				</ContextMenuCheckboxItem>
				<ContextMenuItem onSelect={closeChat}>Hide</ContextMenuItem>
				{/* Everyone's, not only the console's (ChatBarControls): under the docked Settings, or full screen */}
				<ContextMenuItem onSelect={() => setDockMode("side")}>
					Attach to the right side
				</ContextMenuItem>
				<ContextMenuItem onSelect={() => setDockMode("full")}>
					Full screen
				</ContextMenuItem>
				{(["top", "right", "bottom", "left"] as const).map((edge) => (
					<ContextMenuItem
						key={edge}
						onSelect={() => moveToEdge({ edge, offset: 0.5 })}
					>
						Move chat to {edge}
					</ContextMenuItem>
				))}
				<ContextMenuItem onSelect={() => moveToEdge(null)}>
					Reset chat position
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() => savePosition.mutate({ chat_size: null })}
				>
					Reset chat size
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};
