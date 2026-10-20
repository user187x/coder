import { cn } from "cn";
import {
	BriefcaseIcon,
	CircleUserIcon,
	EyeIcon,
	FileTextIcon,
	ImageIcon,
	type LucideIcon,
	MegaphoneIcon,
	MessagesSquareIcon,
	UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { canViewDeploymentSettings } from "#/modules/permissions";
import { setDrawerOpen, useChatSnapshot } from "../chat/chatStore";
import { CHAT_CONSOLE_PAGE } from "../chat/consolePlaces";
import "./radialMenu.css";

// The wheel (radial-menu.html): eight wedges round a centre that names the one pointed at.
const SIZE = 600;
const CENTER = SIZE / 2;
const OUTER = 280;
const INNER = 110;
const TEXT_RADIUS = 255;
const ICON_RADIUS = 185;
const ICON = 34;
const PAD_DEGREES = 2;
/** How long a chosen wedge shows white before the page changes (ms). */
const CHOSEN_MS = 300;

const polar = (radius: number, degrees: number) => {
	const r = ((degrees - 90) * Math.PI) / 180;
	return { x: CENTER + radius * Math.cos(r), y: CENTER + radius * Math.sin(r) };
};

/** A wedge of the ring: between two angles, a little apart from its neighbours. */
const wedgePath = (start: number, end: number) => {
	const a = polar(OUTER, start + PAD_DEGREES);
	const b = polar(OUTER, end - PAD_DEGREES);
	const c = polar(INNER, end - PAD_DEGREES);
	const d = polar(INNER, start + PAD_DEGREES);
	const large = end - start <= 180 ? 0 : 1;
	return `M ${a.x} ${a.y} A ${OUTER} ${OUTER} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${INNER} ${INNER} 0 ${large} 0 ${d.x} ${d.y} Z`;
};

/** The arc a wedge's name runs along: reversed in the lower half, so it reads left to right there too. */
const textArc = (start: number, end: number) => {
	const mid = (start + end) / 2;
	const lower = mid > 90 && mid < 270;
	const from = polar(TEXT_RADIUS, lower ? end : start);
	const to = polar(TEXT_RADIUS, lower ? start : end);
	return `M ${from.x} ${from.y} A ${TEXT_RADIUS} ${TEXT_RADIUS} 0 0 ${lower ? 0 : 1} ${to.x} ${to.y}`;
};

/** No motion: the user menu's Animations off, or the system's reduced motion. */
const motionless = () =>
	document.documentElement.dataset.animations === "off" ||
	(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

const OVERLAYS =
	'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-chat-panel] [aria-expanded="true"]';

/**
 * Whether an Escape opens the quick access wheel: only when nothing else on the page has a use for it - no dialog,
 * menu, list or popover open (Escape closes those), not typing in a field or a terminal, no modifier keys.
 */
export const escapeOpensWheel = (
	event: Pick<
		KeyboardEvent,
		| "key"
		| "repeat"
		| "defaultPrevented"
		| "ctrlKey"
		| "altKey"
		| "metaKey"
		| "shiftKey"
	>,
	doc: Document = document,
): boolean => {
	if (
		event.key !== "Escape" ||
		event.repeat ||
		event.defaultPrevented ||
		event.ctrlKey ||
		event.altKey ||
		event.metaKey ||
		event.shiftKey
	) {
		return false;
	}
	const active = doc.activeElement as HTMLElement | null;
	if (
		active &&
		(active.matches(
			"input, textarea, select, iframe, [contenteditable=''], [contenteditable='true']",
		) ||
			active.isContentEditable ||
			active.closest(".xterm, [role='textbox']"))
	) {
		return false;
	}
	// (the wheel itself, fading out, aside)
	return ![...doc.querySelectorAll(OVERLAYS)].some(
		(el) => !el.closest("[data-radial-menu]"),
	);
};

type Wedge = {
	name: string;
	icon: LucideIcon;
	/** Where it goes; none: what it does instead. */
	to?: string;
	act?: () => void;
	allowed: boolean;
	why?: string;
};

/**
 * Platform: the quick access wheel (radial-menu.html). Escape opens it over the page - everything behind it under a
 * see-through Gaussian blur - and each wedge goes straight to its part of the dashboard: Workspaces, Templates,
 * Images, Users, Account, Chat (the console for admins, the Chats panel for the others), Announcement, HUD. Pages a
 * user may not open show dimmed and say why. Escape again, or a click off the wheel, closes it; the arrow keys go
 * round it, Enter opens. Opens only when the Escape is not someone else's (escapeOpensWheel).
 */
export const RadialMenu: React.FC = () => {
	const navigate = useNavigate();
	const { permissions } = useAuthenticated();
	const chat = useChatSnapshot();
	const admin = canViewDeploymentSettings(permissions);
	// closed: not on the page at all; closing: fading out
	const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
	const open = phase === "open";
	const [hovered, setHovered] = useState<number | null>(null);
	const [chosen, setChosen] = useState<number | null>(null);
	const wedges = useRef<(SVGPathElement | null)[]>([]);
	const before = useRef<HTMLElement | null>(null);
	const openRef = useRef(open);
	openRef.current = open;
	const id = useId();

	const items: Wedge[] = [
		{
			name: "Workspaces",
			icon: BriefcaseIcon,
			to: "/workspaces",
			allowed: true,
		},
		{ name: "Templates", icon: FileTextIcon, to: "/templates", allowed: true },
		{ name: "Images", icon: ImageIcon, to: "/images", allowed: true },
		{
			name: "Users",
			icon: UsersIcon,
			to: "/deployment/users",
			allowed: Boolean(permissions.viewAllUsers),
			why: "Admins only",
		},
		{
			name: "Account",
			icon: CircleUserIcon,
			to: "/settings/account",
			allowed: true,
		},
		{
			name: "Chat",
			icon: MessagesSquareIcon,
			...(chat.me?.admin
				? { to: CHAT_CONSOLE_PAGE }
				: { act: () => setDrawerOpen(true) }),
			allowed: Boolean(chat.me),
			why: "Chat is not connected",
		},
		{
			name: "Announcement",
			icon: MegaphoneIcon,
			to: "/deployment/announcement",
			allowed: admin,
			why: "Admins only",
		},
		{
			name: "HUD",
			icon: EyeIcon,
			to: "/hud",
			allowed: admin,
			why: "Admins only",
		},
	];
	const step = 360 / items.length;

	const close = useCallback(() => {
		setPhase(motionless() ? "closed" : "closing");
		setHovered(null);
		setChosen(null);
		before.current?.focus?.();
	}, []);

	useEffect(() => {
		if (isEmbeddedFrame()) {
			return;
		}
		// in the capture phase, ahead of the page's own Escape handlers: they see the page as it is
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
			event.preventDefault();
			before.current = document.activeElement as HTMLElement | null;
			setPhase("open");
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [close]);

	// the first wedge that opens, focused as the wheel appears
	useEffect(() => {
		if (open) {
			const first = items.findIndex((i) => i.allowed);
			wedges.current[first]?.focus();
		}
	}, [open]);

	const choose = (index: number) => {
		const item = items[index];
		if (!item.allowed || chosen !== null) {
			return;
		}
		setChosen(index);
		const go = () => {
			setPhase("closed");
			setHovered(null);
			setChosen(null);
			if (item.to) {
				navigate(item.to);
			} else {
				item.act?.();
			}
		};
		if (motionless()) {
			go();
		} else {
			window.setTimeout(go, CHOSEN_MS);
		}
	};

	const move = (from: number, by: number) => {
		for (let k = 1; k <= items.length; k++) {
			const next = (from + by * k + items.length * k) % items.length;
			if (items[next].allowed) {
				wedges.current[next]?.focus();
				return;
			}
		}
	};

	const shown = hovered ?? chosen;
	const label = shown === null ? "Menu" : items[shown].name;
	const note =
		shown !== null && !items[shown].allowed ? items[shown].why : undefined;

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
			<div className="radial-wheel" role="menu" aria-label="Go to">
				<svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden={false}>
					<defs>
						{items.map((item, i) => (
							<path
								key={item.name}
								id={`${id}-arc-${i}`}
								d={textArc(i * step, (i + 1) * step)}
							/>
						))}
					</defs>
					{items.map((item, i) => {
						const at = polar(ICON_RADIUS, i * step + step / 2);
						const Icon = item.icon;
						const lit = hovered === i || chosen === i;
						return (
							<g
								key={item.name}
								className={cn(
									"radial-item",
									lit && "radial-item-lit",
									chosen === i && "radial-item-chosen",
									!item.allowed && "radial-item-off",
								)}
							>
								<path
									ref={(el) => {
										wedges.current[i] = el;
									}}
									className="radial-wedge"
									d={wedgePath(i * step, (i + 1) * step)}
									role="menuitem"
									tabIndex={item.allowed ? 0 : -1}
									aria-label={
										item.allowed ? item.name : `${item.name} (${item.why})`
									}
									aria-disabled={!item.allowed || undefined}
									data-testid={`radial-${item.name.toLowerCase()}`}
									onMouseEnter={() => setHovered(i)}
									onMouseLeave={() => setHovered(null)}
									onFocus={() => setHovered(i)}
									onBlur={() => setHovered(null)}
									onClick={(e) => {
										e.stopPropagation();
										choose(i);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											choose(i);
										} else if (
											e.key === "ArrowRight" ||
											e.key === "ArrowDown"
										) {
											e.preventDefault();
											move(i, 1);
										} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
											e.preventDefault();
											move(i, -1);
										} else if (e.key === "Tab") {
											e.preventDefault();
											move(i, e.shiftKey ? -1 : 1);
										}
									}}
								/>
								<Icon
									aria-hidden
									className="radial-icon"
									x={at.x - ICON / 2}
									y={at.y - ICON / 2}
									width={ICON}
									height={ICON}
								/>
								<text className="radial-text" aria-hidden>
									<textPath
										href={`#${id}-arc-${i}`}
										startOffset="50%"
										textAnchor="middle"
									>
										{item.name}
									</textPath>
								</text>
							</g>
						);
					})}
				</svg>
				<div className="radial-center" aria-live="polite">
					<div className="radial-center-name">{label}</div>
					{note && <div className="radial-center-note">{note}</div>}
				</div>
			</div>
			<p className="radial-hint">
				Press Escape or click anywhere outside the wheel to close
			</p>
		</div>,
		document.body,
	);
};
