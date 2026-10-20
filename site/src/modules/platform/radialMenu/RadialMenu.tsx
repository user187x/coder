import { cn } from "cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "react-query";
import { useNavigate } from "react-router";
import { buildInfo } from "#/api/queries/buildInfo";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { setDrawerOpen, useChatSnapshot } from "../chat/chatStore";
import { CHAT_CONSOLE_PAGE } from "../chat/consolePlaces";
import { useQuickMenu } from "./quickMenu";
import { Wheel, type WheelItem } from "./Wheel";
import { wheelOf } from "./wheelChoices";
import "./radialMenu.css";

/** How long a chosen wedge shows white before the page changes (ms). */
const CHOSEN_MS = 300;

/** No motion: the user menu's Animations off, or the system's reduced motion. */
const motionless = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

// What is open over the page and closes on Escape: it still does (its Escape is not taken from it), under the wheel.
// Tooltips, static lists and docked chat windows are not it.
const POPUPS = [
	"[data-radix-popper-content-wrapper]",
	'[role="dialog"][data-state="open"]',
	'[role="listbox"][data-state="open"]',
	'[role="alertdialog"]',
	'[aria-modal="true"]',
	".MuiPopover-root",
	".MuiModal-root",
	'[data-testid="announcement-scroll-view"]',
	'[data-chat-panel] [aria-expanded="true"]',
].join(", ");

/**
 * Whether an Escape opens the quick access wheel: always - on every page, from a field too, with a menu or dialog
 * open (that closes as it would) - but in a terminal, whose programs need Escape (vim, less): there Shift+Escape.
 */
export const escapeOpensWheel = (
	event: Pick<
		KeyboardEvent,
		"key" | "repeat" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey"
	>,
	doc: Document = document,
): boolean => {
	if (
		event.key !== "Escape" ||
		event.repeat ||
		event.ctrlKey ||
		event.altKey ||
		event.metaKey
	) {
		return false;
	}
	// a terminal: xterm's, or any the dashboard's terminal holds (Ghostty's has no .xterm)
	return (
		event.shiftKey || !doc.activeElement?.closest(".xterm, .workspace-terminal")
	);
};

/** Whether something is open over the page that closes on this Escape too (so the Escape is left to it as well). */
export const popupOpen = (doc: Document = document): boolean =>
	[...doc.querySelectorAll(POPUPS)].some(
		(el) =>
			// the wheel itself, fading out, and a tooltip do not count
			!el.closest("[data-radial-menu]") &&
			!el.querySelector('[role="tooltip"]') &&
			el.getClientRects().length > 0,
	);

declare global {
	interface Window {
		/** Opens the wheel of the page this one is embedded in (a dashboard page in a frame of the dashboard). */
		__platformRadialOpen?: () => void;
	}
}

/**
 * Platform: the quick access wheel (radial-menu.html), on every signed-in page (RequireAuth mounts it). Escape
 * opens it over the page - everything behind it under a see-through Gaussian blur - and each wedge goes straight to
 * its page: the wedges admins arranged (Admin Settings > Quick Menu: the dashboard's pages and every admin
 * category), or the default eight. Pages a user may not open show dimmed and say why. Escape again, or a click off the
 * wheel, closes it; the arrow keys go round it, Enter opens. A menu or dialog open closes on the same Escape, under
 * it; a terminal keeps its Escape (Shift+Escape there) - escapeOpensWheel.
 */
export const RadialMenu: React.FC = () => {
	const navigate = useNavigate();
	const { permissions } = useAuthenticated();
	const { metadata } = useEmbeddedMetadata();
	const build = useQuery(buildInfo(metadata["build-info"]));
	const chat = useChatSnapshot();
	const menu = useQuickMenu();
	// closed: not on the page at all; closing: fading out
	const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
	const open = phase === "open";
	const [chosen, setChosen] = useState<number | null>(null);
	const before = useRef<HTMLElement | null>(null);
	const openRef = useRef(open);
	openRef.current = open;

	const access = {
		permissions,
		oauth2Provider: Boolean(build.data?.oauth2_provider),
	};
	const choices = wheelOf(menu.data?.items);
	const items: WheelItem[] = choices.map((choice) => ({
		id: choice.id,
		name: choice.label,
		icon: choice.icon,
		allowed: choice.allowed(access),
		why: "Admins only",
	}));

	const close = useCallback(() => {
		setPhase(motionless() ? "closed" : "closing");
		setChosen(null);
		before.current?.focus?.();
	}, []);

	useEffect(() => {
		const embedded = isEmbeddedFrame();
		const openHere = () => {
			before.current = document.activeElement as HTMLElement | null;
			setPhase("open");
		};
		if (!embedded) {
			window.__platformRadialOpen = openHere;
		}
		// in the capture phase, ahead of the page's own Escape handlers: they see the page as it is, and an Escape
		// that opens or closes the wheel goes no further
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			if (openRef.current) {
				event.preventDefault();
				event.stopPropagation();
				close();
				return;
			}
			if (!escapeOpensWheel(event)) {
				return;
			}
			const show = () => {
				if (!embedded) {
					openHere();
					return;
				}
				// a page in a frame of the dashboard: the wheel opens over the whole window, the frame's page included
				try {
					window.parent.__platformRadialOpen?.();
				} catch {
					// a parent of another origin: no wheel
				}
			};
			// a menu or dialog open: it closes on this Escape as it would (its focus and all), then the wheel opens
			if (popupOpen()) {
				window.setTimeout(show, 0);
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			show();
		};
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			if (!embedded && window.__platformRadialOpen === openHere) {
				window.__platformRadialOpen = undefined;
			}
		};
	}, [close]);

	const choose = (index: number) => {
		const choice = choices[index];
		if (!items[index]?.allowed || chosen !== null) {
			return;
		}
		setChosen(index);
		const go = () => {
			setPhase("closed");
			setChosen(null);
			if (!choice.chat) {
				navigate(choice.to ?? "/");
			} else if (chat.me?.admin ?? access.permissions.editDeploymentConfig) {
				navigate(CHAT_CONSOLE_PAGE);
			} else {
				setDrawerOpen(true);
				// a page without the Chats panel (the editor, a terminal): to one that has it, open
				if (!document.querySelector('[role="region"][aria-label="Chats"]')) {
					navigate("/workspaces");
				}
			}
		};
		if (motionless()) {
			go();
		} else {
			window.setTimeout(go, CHOSEN_MS);
		}
	};

	if (phase === "closed") {
		return null;
	}
	return createPortal(
		// biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (the window's listener); a click off the wheel is the pointer's way
		<div
			className={cn(
				"radial-overlay",
				phase === "closing" && "radial-overlay-closing",
			)}
			role="dialog"
			aria-modal="true"
			aria-label="Quick access"
			data-radial-menu=""
			data-testid="radial-menu"
			onAnimationEnd={(e) => {
				if (e.target === e.currentTarget && phase === "closing") {
					setPhase("closed");
				}
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					close();
				}
			}}
		>
			<Wheel items={items} onChoose={choose} chosen={chosen} autoFocus={open} />
			<p className="radial-hint">
				Press Escape or click anywhere outside the wheel to close
			</p>
		</div>,
		document.body,
	);
};
