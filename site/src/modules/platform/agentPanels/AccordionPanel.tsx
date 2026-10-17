import { cn } from "cn";
import { SquareArrowOutUpRightIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Collapsible,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";

const DEFAULT_HEIGHT = 640;
export const MIN_APP_HEIGHT = 200;
export const MAX_APP_HEIGHT = 4000;
/** A page that scrolls as a whole grows to fit it, up to this. */
const MAX_FIT_HEIGHT = 2400;
const KEY_STEP = 40;

const clampHeight = (height: number) =>
	Math.min(MAX_APP_HEIGHT, Math.max(MIN_APP_HEIGHT, Math.round(height)));

export type AccordionPanelProps = {
	/** Its id (a popped-out window is named after it). */
	id: string;
	title: string;
	icon?: React.ReactNode;
	/** The reorder handle (AgentPanels), at the left of its header. */
	handle?: React.ReactNode;
	/** Why it can't open now, shown after its title (it rolls up and starts over once it can). */
	unavailable?: string;
	/** At the right of its header, before Pop out (an app's port, ...). */
	extras?: React.ReactNode;
	/** Just added: open it right away. */
	initiallyOpen: boolean;
	/** The page it shows: Pop out opens it in a browser window of its own. None: no Pop out. */
	href?: string;
	/** Grow to fit its page when that scrolls as a whole (same origin only: File Browser). */
	fitToPage?: boolean;
	/** The height the user gave it before, if any. */
	height: number | undefined;
	onHeightChange: (height: number) => void;
	onRemove: () => void;
	/** For tests and styles: what it holds. */
	kind: string;
	slug: string;
	/** What it shows: mounted the first time it opens, kept while it is rolled up, gone when it is removed. */
	children: React.ReactNode;
};

/**
 * The accordion panel any app goes in (AgentPanels): a header to roll it up or down, the app below - loaded when the
 * panel first opens; rolling it up only hides it (the app keeps its state), the bin removes the panel and closes the
 * app. While it can't open (its workspace not ready, the app gone), it rolls up and starts over when next opened.
 *
 * Height: the handle at the bottom right makes it any height (dragged, or with the up and down arrow keys) - the width
 * always stays the card's; a page that scrolls as a whole first grows to fit it (fitToPage). The height the user picks
 * is remembered.
 *
 * Pop out: the app moves into a browser window of its own and leaves the panel (one copy of it, not two - a desktop
 * has one screen); "Bring back", or closing that window, returns it to the panel. The bin closes the window too.
 */
export const AccordionPanel: React.FC<AccordionPanelProps> = ({
	id,
	title,
	icon,
	handle,
	unavailable,
	extras,
	initiallyOpen,
	href,
	fitToPage,
	height,
	onHeightChange,
	onRemove,
	kind,
	slug,
	children,
}) => {
	const available = !unavailable;
	const [open, setOpen] = useState(initiallyOpen && available);
	const [loaded, setLoaded] = useState(initiallyOpen && available);
	const [boxHeight, setBoxHeight] = useState(height ?? DEFAULT_HEIGHT);
	const [resizing, setResizing] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const userSized = useRef(height !== undefined);
	// Its own browser window, while it is popped out.
	const [popup, setPopup] = useState<Window | null>(null);
	useEffect(() => {
		if (!popup) {
			return;
		}
		// Closed by the user: it comes back to the panel.
		const timer = window.setInterval(() => {
			if (popup.closed) {
				setPopup(null);
				setLoaded(true);
				setOpen(true);
			}
		}, 500);
		return () => window.clearInterval(timer);
	}, [popup]);
	const bringBack = () => {
		popup?.close();
		setPopup(null);
		setLoaded(true);
		setOpen(true);
	};
	useEffect(() => {
		if (!available) {
			setOpen(false);
			setLoaded(false);
		}
	}, [available]);

	// Grow to the page, a few times while it settles after loading.
	useEffect(() => {
		if (!loaded || !open || userSized.current || !fitToPage) {
			return;
		}
		const iframe = box.current?.querySelector("iframe");
		if (!iframe) {
			return;
		}
		const fit = () => {
			if (userSized.current) {
				return;
			}
			let root: HTMLElement | undefined;
			try {
				root = iframe.contentDocument?.documentElement;
			} catch {
				return; // Not the dashboard's origin: it cannot be measured.
			}
			if (!root || root.clientHeight === 0) {
				return;
			}
			const extra = root.scrollHeight - root.clientHeight;
			if (extra > 1) {
				setBoxHeight((current) =>
					Math.max(current, Math.min(MAX_FIT_HEIGHT, current + extra)),
				);
			}
		};
		const timers: number[] = [];
		const onLoad = () => {
			for (const delay of [100, 600, 1500, 3000]) {
				timers.push(window.setTimeout(fit, delay));
			}
		};
		iframe.addEventListener("load", onLoad);
		if (iframe.contentDocument?.readyState === "complete") {
			onLoad();
		}
		return () => {
			iframe.removeEventListener("load", onLoad);
			for (const timer of timers) {
				window.clearTimeout(timer);
			}
		};
	}, [loaded, open, fitToPage]);

	const resizeTo = (next: number) => {
		userSized.current = true;
		const clamped = clampHeight(next);
		setBoxHeight(clamped);
		return clamped;
	};

	const onResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const startY = event.clientY;
		const startHeight = boxHeight;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// The window listeners below do without it.
		}
		setResizing(true);
		let last = startHeight;
		const onMove = (move: PointerEvent) => {
			last = resizeTo(startHeight + move.clientY - startY);
		};
		const onEnd = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onEnd);
			window.removeEventListener("pointercancel", onEnd);
			setResizing(false);
			onHeightChange(last);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onEnd);
		window.addEventListener("pointercancel", onEnd);
	};

	return (
		<section
			className="border-0 border-t border-solid border-border"
			data-testid="agent-app-panel"
			data-kind={kind}
			data-app={slug}
		>
			<Collapsible
				open={open}
				disabled={!available}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						setLoaded(true);
					}
				}}
			>
				<div className="px-4 py-2 relative flex items-center gap-2">
					{handle}
					<CollapsibleTrigger asChild>
						<Button
							variant="subtle"
							className="after:content-[''] after:absolute after:inset-0"
						>
							<ChevronDownIcon open={open} />
							{icon}
							<span>{title}</span>
						</Button>
					</CollapsibleTrigger>
					{unavailable && (
						<Badge size="xs" className="relative z-[1]">
							{unavailable}
						</Badge>
					)}
					{popup && (
						<Badge size="xs" className="relative z-[1]">
							In its own window
						</Badge>
					)}
					<span className="relative z-[1] ml-auto flex items-center gap-1">
						{extras}
						{href && available && !popup && (
							<Button
								size="sm"
								variant="outline"
								title={`Open ${title} in a browser window of its own`}
								onClick={() => {
									const win = window.open(
										href,
										`coder-app-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
										"popup,width=1280,height=820",
									);
									if (win) {
										setPopup(win);
										setLoaded(false);
									}
								}}
							>
								<SquareArrowOutUpRightIcon />
								Pop out
							</Button>
						)}
						{popup && (
							<Button
								size="sm"
								variant="outline"
								title={`Close ${title}'s window and show it here again`}
								onClick={bringBack}
							>
								<Undo2Icon />
								Bring back
							</Button>
						)}
						<Button
							size="icon"
							variant="subtle"
							className="text-content-secondary hover:text-content-destructive"
							aria-label={`Remove the ${title} panel`}
							title={`Remove this panel and close ${title}`}
							onClick={() => {
								popup?.close();
								onRemove();
							}}
						>
							<Trash2Icon />
						</Button>
					</span>
				</div>
				{popup && open && (
					<div className="flex items-center justify-between gap-3 px-4 pb-4 text-sm text-content-secondary">
						<span>
							{title} is open in its own browser window. Bring it back to show
							it here again.
						</span>
						<Button size="sm" variant="outline" onClick={() => popup.focus()}>
							<SquareArrowOutUpRightIcon />
							Go to the window
						</Button>
					</div>
				)}
				{loaded && available && (
					<div className={cn("relative px-4 pb-6", !open && "hidden")}>
						<div
							ref={box}
							style={{ height: boxHeight }}
							className={cn(
								"overflow-hidden rounded-md border border-solid border-border",
								// The pointer must not disappear into the app while resizing.
								resizing && "select-none [&_iframe]:pointer-events-none",
							)}
							data-testid="agent-app-frame"
						>
							{children}
						</div>
						<button
							type="button"
							aria-label={`Resize the ${title} panel`}
							title="Drag to resize (or use the up and down arrow keys)"
							data-testid="app-panel-resize"
							className="absolute right-4 bottom-0.5 flex h-5 w-8 cursor-ns-resize touch-none items-center justify-center rounded border-0 bg-transparent p-0 text-content-secondary hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link"
							onPointerDown={onResizeStart}
							onKeyDown={(event) => {
								if (event.key === "ArrowUp" || event.key === "ArrowDown") {
									event.preventDefault();
									onHeightChange(
										resizeTo(
											boxHeight +
												(event.key === "ArrowDown" ? KEY_STEP : -KEY_STEP),
										),
									);
								}
							}}
						>
							{/* Two short lines, like a grip. */}
							<svg
								aria-hidden
								viewBox="0 0 16 8"
								className="h-2 w-4"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<path d="M1 2h14M4 6h8" />
							</svg>
						</button>
					</div>
				)}
			</Collapsible>
		</section>
	);
};
