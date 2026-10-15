import { cn } from "cn";
import { SquareArrowOutUpRightIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "#/api/typesGenerated";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Collapsible,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { useAppLink } from "#/modules/apps/useAppLink";
import { WorkspaceAppFrame } from "#/modules/apps/WorkspaceAppFrame";

const DEFAULT_HEIGHT = 640;
export const MIN_APP_HEIGHT = 200;
export const MAX_APP_HEIGHT = 4000;
/** An app that scrolls its whole page grows to fit it, up to this. */
const MAX_FIT_HEIGHT = 2400;
/**
 * The apps that grow to fit their page. Not the desktop, code-server or marimo:
 * they size themselves to the box (noVNC even resizes the remote desktop to
 * it), so growing the box to their page would never stop.
 */
const FIT_TO_PAGE = new Set(["filebrowser"]);
const KEY_STEP = 40;

/** The apps whose panel shows the port and protocol their service runs on: the dataflow template's. */
const SERVICE_APPS = new Set(["nifi", "airflow"]);

/**
 * The protocol and port an app's service runs on, inside the workspace: its
 * health check's (the service itself; NiFi's app URL is the nginx in front of
 * it), else its URL's. Null without either, or for an address that is not one.
 */
export const servicePort = (
	app: Pick<WorkspaceApp, "url" | "healthcheck">,
): { protocol: "HTTP" | "HTTPS"; port: number } | null => {
	const address = app.healthcheck?.url || app.url;
	if (!address) {
		return null;
	}
	try {
		const url = new URL(address);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		const secure = url.protocol === "https:";
		return {
			protocol: secure ? "HTTPS" : "HTTP",
			port: url.port ? Number(url.port) : secure ? 443 : 80,
		};
	} catch {
		return null;
	}
};

const clampHeight = (height: number) =>
	Math.min(MAX_APP_HEIGHT, Math.max(MIN_APP_HEIGHT, Math.round(height)));

type AgentAppPanelProps = {
	/** The panel's id (its browser window is named after it). */
	id: string;
	workspace: Workspace;
	agent: WorkspaceAgent;
	/** The app, or undefined when the workspace no longer has it. */
	app: WorkspaceApp | undefined;
	slug: string;
	handle: React.ReactNode;
	/** The workspace is ready (agentAppsReady): until then the panel does not open. */
	ready: boolean;
	/** Just added: open it right away. */
	initiallyOpen: boolean;
	/** The height the user gave it before, if any. */
	height: number | undefined;
	onHeightChange: (height: number) => void;
	onRemove: () => void;
};

/**
 * A panel the user added (AddPanelTab): one of the workspace's apps embedded
 * in the page, like the Terminal panel. The app loads when the panel first
 * opens; collapsing the panel only hides it (the app keeps its state), the
 * bin removes the panel and closes the app. A workspace that stops takes the
 * app with it: the panel rolls up and starts over when it is next opened.
 *
 * Height: File Browser, which scrolls its whole page, first grows to fit it, so
 * there is no scroll bar; the handle at the bottom right makes it any
 * height (dragged, or with the up and down arrow keys) - the width always
 * stays the card's. The height the user picks is remembered.
 *
 * Pop out (like the Terminal panel's): the app moves into a browser window of
 * its own and leaves the panel (one copy of the app, not two - the desktop has
 * one screen); "Bring back", or closing that window, returns it to the panel.
 * The bin closes the window too.
 */
export const AgentAppPanel: React.FC<AgentAppPanelProps> = ({
	id,
	workspace,
	agent,
	app,
	slug,
	handle,
	ready,
	initiallyOpen,
	height,
	onHeightChange,
	onRemove,
}) => {
	const [open, setOpen] = useState(initiallyOpen && ready);
	const [loaded, setLoaded] = useState(initiallyOpen && ready);
	const [boxHeight, setBoxHeight] = useState(height ?? DEFAULT_HEIGHT);
	const [resizing, setResizing] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const userSized = useRef(height !== undefined);
	// The app's own browser window, while it is popped out.
	const [popup, setPopup] = useState<Window | null>(null);
	useEffect(() => {
		if (!popup) {
			return;
		}
		// Closed by the user: the app comes back to the panel.
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
		if (!ready) {
			setOpen(false);
			setLoaded(false);
		}
	}, [ready]);
	const name = app?.display_name || slug;
	const service = app && SERVICE_APPS.has(slug) ? servicePort(app) : null;

	// Grow to the app's page, a few times while it settles after loading.
	useEffect(() => {
		if (!loaded || !open || userSized.current || !FIT_TO_PAGE.has(slug)) {
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
	}, [loaded, open, slug]);

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
			data-app={slug}
		>
			<Collapsible
				open={open}
				disabled={!app || !ready}
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
							{app?.icon && <ExternalImage src={app.icon} className="size-4" />}
							<span>{name}</span>
							{service && (
								<span
									className="rounded-full border border-solid border-border-default bg-surface-secondary px-2 py-px font-mono text-[11px] leading-4 font-medium text-content-secondary"
									title={`${name} runs on port ${service.port} (${service.protocol}) inside the workspace`}
									data-testid="agent-app-service-port"
								>
									{service.protocol} :{service.port}
								</span>
							)}
						</Button>
					</CollapsibleTrigger>
					{!app && (
						<Badge size="xs" className="relative z-[1]">
							No longer in this workspace
						</Badge>
					)}
					{app && !ready && (
						<Badge size="xs" className="relative z-[1]">
							Opens when the workspace is ready
						</Badge>
					)}
					{popup && (
						<Badge size="xs" className="relative z-[1]">
							In its own window
						</Badge>
					)}
					<span className="relative z-[1] ml-auto flex items-center gap-1">
						{app && ready && !popup && (
							<PopOutButton
								id={id}
								name={name}
								app={app}
								agent={agent}
								workspace={workspace}
								onPoppedOut={(win) => {
									setPopup(win);
									setLoaded(false);
								}}
							/>
						)}
						{popup && (
							<Button
								size="sm"
								variant="outline"
								title={`Close ${name}'s window and show it here again`}
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
							aria-label={`Remove the ${name} panel`}
							title={`Remove this panel and close ${name}`}
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
							{name} is open in its own browser window. Bring it back to show it
							here again.
						</span>
						<Button size="sm" variant="outline" onClick={() => popup.focus()}>
							<SquareArrowOutUpRightIcon />
							Go to the window
						</Button>
					</div>
				)}
				{loaded && app && (
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
							<WorkspaceAppFrame
								workspace={workspace}
								app={{ ...app, agent }}
								active
							/>
						</div>
						<button
							type="button"
							aria-label={`Resize the ${name} panel`}
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

type PopOutButtonProps = {
	id: string;
	name: string;
	app: WorkspaceApp;
	agent: WorkspaceAgent;
	workspace: Workspace;
	onPoppedOut: (win: Window) => void;
};

/** Opens the app in a browser window of its own (named after the panel, so a second click reuses it). */
const PopOutButton: React.FC<PopOutButtonProps> = ({
	id,
	name,
	app,
	agent,
	workspace,
	onPoppedOut,
}) => {
	const link = useAppLink(app, { agent, workspace });
	return (
		<Button
			size="sm"
			variant="outline"
			disabled={!link.href}
			title={`Open ${name} in a browser window of its own`}
			onClick={() => {
				const win = window.open(
					link.href,
					`coder-app-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
					"popup,width=1280,height=820",
				);
				if (win) {
					onPoppedOut(win);
				}
			}}
		>
			<SquareArrowOutUpRightIcon />
			Pop out
		</Button>
	);
};
