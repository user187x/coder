import { cn } from "cn";
import { PictureInPicture2Icon, PlayIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useQuery } from "react-query";
import { toast } from "sonner";
import { deploymentConfig } from "#/api/queries/deployment";
import { appearanceSettings } from "#/api/queries/users";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Switch } from "#/components/Switch/Switch";
import { useProxy } from "#/contexts/ProxyContext";
import { ThemeOverride } from "#/contexts/ThemeProvider";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { getTerminalHref, openAppInNewWindow } from "#/modules/apps/apps";
import {
	getTerminalConfig,
	terminalRenderer,
} from "#/modules/terminal/terminalConfig";
import type { ConnectionStatus } from "#/modules/terminal/types";
import { WorkspaceTerminal } from "#/modules/terminal/WorkspaceTerminal";
import themes from "#/theme";
import { openMaybePortForwardedURL } from "#/utils/portForward";
import { generateConnectionSessionId } from "#/utils/random";
import { FaMinusCircleIcon, FaPlusCircleIcon } from "./circleIcons";
import { TerminalPopout } from "./TerminalPopout";
import {
	endSession,
	fittingFontSize,
	loadSession,
	MAX_CUSTOM_COMMAND_LENGTH,
	MAX_TERMINAL_FONT_SIZE,
	MIN_TERMINAL_COLS,
	MIN_TERMINAL_FONT_SIZE,
	MIN_TERMINAL_ROWS,
	newSession,
	readCustomCommand,
	readEndOnClose,
	readFontSize,
	saveSession,
	startCommand,
	stepFontSize,
	type TerminalSession,
	writeCustomCommand,
	writeEndOnClose,
	writeFontSize,
} from "./terminalSession";

/** How long the columns x rows readout stays after the last text size change. */
const DIMENSIONS_SHOWN_MS = 2500;

type AgentTerminalSectionProps = {
	agent: WorkspaceAgent;
	workspace: Workspace;
	/** The workspace is ready (agentAppsReady): until then the terminal does not open. */
	ready: boolean;
	/** The panel's reorder handle (AgentPanels), at the left of its header. */
	handle?: React.ReactNode;
};

/**
 * Workspace page > agent > "Terminal": the agent's terminal in a drop-down
 * right under its "Logs", inside the page instead of a new window.
 *
 * When the terminal terminates - its shell exits, the connection drops, or
 * "End session" - the drop-down rolls back up and starts over: the next open
 * is a new session, as on a fresh page.
 *
 * "End session when closed" (on by default): collapsing the drop-down, or
 * leaving the workspace page, ends the shell. Off: it keeps running and is
 * there again when the drop-down is reopened in the same tab; meanwhile the
 * header shows "Session running" with an "End session" button.
 *
 * "Pop out" moves the same session into a floating window over the page;
 * closing that window leaves the drop-down collapsed (and, with "End session
 * when closed", ends the shell), docking it puts the terminal back, and "Open
 * in a browser window" hands the session to Coder's own terminal page in a
 * window of its own (this page then lets go of it). The text size buttons
 * change only this terminal's text (the page layout stays): it starts at the
 * largest size that still shows 80x24 characters, the least full-screen tools
 * such as btop need, until the user picks a size. While they change it, the
 * terminal's columns x rows show in a small pill in its top-right corner, for
 * a few seconds after the last change.
 *
 * "Custom command" (on by default: tmux's shared session "monitor" with btop
 * in it, started or joined; remembered in this browser): new sessions run it
 * first and continue in the login shell when it exits.
 * "Run" starts a new session with it right away.
 *
 * Until the workspace is ready (its startup scripts, the terminal's tmux among
 * them, have finished) the drop-down stays shut; a terminal already open or
 * popped out is left alone.
 */
export const AgentTerminalSection: React.FC<AgentTerminalSectionProps> = ({
	agent,
	workspace,
	ready,
	handle,
}) => {
	const { proxy } = useProxy();
	const { metadata } = useEmbeddedMetadata();
	const config = useQuery(deploymentConfig());
	const appearance = useQuery(appearanceSettings(metadata.userAppearance));
	const terminalConfig = getTerminalConfig(
		config.data,
		appearance.data,
		proxy.preferredPathAppURL,
	);

	const [open, setOpen] = useState(false);
	const [session, setSession] = useState<TerminalSession | null>(() =>
		loadSession(agent.id),
	);
	const [endOnClose, setEndOnClose] = useState(readEndOnClose);
	const [clientSessionId] = useState(generateConnectionSessionId);
	const endOnCloseId = useId();
	const customId = useId();
	const [custom, setCustom] = useState(readCustomCommand);
	const changeCustom = (next: typeof custom) => {
		setCustom(next);
		writeCustomCommand(next);
	};
	const canRunCommands = agent.operating_system !== "windows";
	const connected = useRef(false);
	const [poppedOut, setPoppedOut] = useState(false);
	// The user's text size; until they choose one, a size that fits 80x24.
	const [chosenFontSize, setChosenFontSize] = useState(readFontSize);
	const [fitFontSize, setFitFontSize] = useState<number>();
	const fontSize = chosenFontSize ?? fitFontSize ?? 13;
	const [dimensions, setDimensions] = useState<{
		cols: number;
		rows: number;
	}>();
	const terminalBox = useRef<HTMLDivElement>(null);

	// The columns x rows readout: shown while the user changes the text size,
	// until DIMENSIONS_SHOWN_MS after the last change.
	const [dimensionsShown, setDimensionsShown] = useState(false);
	const hideDimensions = useRef<number>(undefined);
	useEffect(() => () => window.clearTimeout(hideDimensions.current), []);

	const changeFontSize = (by: number) => {
		const next = stepFontSize(fontSize, by);
		setChosenFontSize(next);
		writeFontSize(next);
		setDimensionsShown(true);
		window.clearTimeout(hideDimensions.current);
		hideDimensions.current = window.setTimeout(
			() => setDimensionsShown(false),
			DIMENSIONS_SHOWN_MS,
		);
	};
	// Too small for 80x24 at the starting size: one step smaller, until it fits.
	useEffect(() => {
		if (
			chosenFontSize === undefined &&
			dimensions &&
			(dimensions.cols < MIN_TERMINAL_COLS ||
				dimensions.rows < MIN_TERMINAL_ROWS) &&
			fontSize > MIN_TERMINAL_FONT_SIZE
		) {
			setFitFontSize(fontSize - 1);
		}
	}, [chosenFontSize, dimensions, fontSize]);

	const replaceSession = (next: TerminalSession | null) => {
		setSession(next);
		saveSession(agent.id, next);
	};

	// Back to the start: no session, drop-down rolled up, not popped out. The
	// next open starts a new session.
	const reset = () => {
		connected.current = false;
		replaceSession(null);
		setPoppedOut(false);
		setOpen(false);
		setDimensions(undefined);
	};

	/** Ends the session's shell and starts over; `report`: say so if the workspace did not confirm it. */
	const finish = (ended: TerminalSession, report: boolean) => {
		reset();
		void endSession(agent.id, ended, terminalConfig.baseUrl).then((result) => {
			if (report && result === false) {
				toast.info(
					"The workspace did not confirm the end of the session; the agent ends it after a few idle minutes.",
				);
			}
		});
	};

	const start = (next: TerminalSession | null) => {
		if (!next) {
			replaceSession(
				newSession(
					agent.operating_system,
					custom.enabled ? custom.command : undefined,
				),
			);
		}
		connected.current = false;
	};

	// Leaving the workspace page with the terminal open ends the session too.
	const endOnLeave = useEffectEvent(() => {
		if ((open || poppedOut) && session && endOnClose) {
			saveSession(agent.id, null);
			void endSession(agent.id, session, terminalConfig.baseUrl);
		}
	});
	useEffect(() => endOnLeave, []);

	const kept = Boolean(session && !open && !poppedOut);
	const activeSession = open || poppedOut ? (session ?? undefined) : undefined;

	const popOut = () => {
		setPoppedOut(true);
		setOpen(false);
	};
	const dock = () => {
		setPoppedOut(false);
		setOpen(true);
	};
	const closePopout = () => {
		if (session && endOnClose) {
			finish(session, false);
			return;
		}
		setPoppedOut(false);
	};
	// The session moves to Coder's terminal page in a browser window of its
	// own (same reconnect id: the same shell). This page lets go of it, so
	// leaving or closing it no longer ends it.
	const openInBrowserWindow = () => {
		if (!session) {
			return;
		}
		const href = getTerminalHref({
			username: workspace.owner_name,
			workspace: workspace.name,
			agent: agent.name,
		});
		openAppInNewWindow(
			`${href}${href.endsWith("?") ? "" : "&"}reconnect=${encodeURIComponent(session.id)}`,
		);
		reset();
	};

	// Minus, the size, plus: one small oval.
	const fontSizeControls = (
		<div
			className="flex items-center gap-0.5 rounded-full border border-solid border-border bg-surface-secondary/40 px-0.5 text-xs text-content-secondary"
			role="group"
			aria-label="Terminal text size"
		>
			<Button
				size="icon"
				variant="subtle"
				className="size-6 rounded-full"
				aria-label="Smaller text"
				title="Smaller text"
				disabled={fontSize <= MIN_TERMINAL_FONT_SIZE}
				onClick={() => changeFontSize(-1)}
			>
				<FaMinusCircleIcon className="size-4" />
			</Button>
			<span className="w-6 text-center tabular-nums" title="Text size (px)">
				{fontSize}
			</span>
			<Button
				size="icon"
				variant="subtle"
				className="size-6 rounded-full"
				aria-label="Larger text"
				title="Larger text"
				disabled={fontSize >= MAX_TERMINAL_FONT_SIZE}
				onClick={() => changeFontSize(1)}
			>
				<FaPlusCircleIcon className="size-4" />
			</Button>
		</div>
	);

	const terminalBody = (boxClassName: string) =>
		activeSession && (
			<ThemeOverride theme={themes.dark}>
				<div
					ref={terminalBox}
					className={cn(
						"relative overflow-hidden rounded-md border border-solid border-border",
						boxClassName,
					)}
				>
					<WorkspaceTerminal
						key={activeSession.id}
						agentId={agent.id}
						operatingSystem={agent.operating_system}
						initialCommand={startCommand(activeSession)}
						reconnectionToken={activeSession.id}
						sessionId={clientSessionId}
						baseUrl={terminalConfig.baseUrl}
						terminalFontFamily={terminalConfig.fontFamily}
						fontSize={fontSize}
						onResize={(cols, rows) => setDimensions({ cols, rows })}
						renderer={terminalRenderer(terminalConfig.renderer, agent)}
						loading={config.isLoading || appearance.isLoading}
						autoFocus
						onOpenLink={(uri) =>
							openMaybePortForwardedURL(
								uri,
								proxy.preferredWildcardHostname,
								agent.name,
								workspace.name,
								workspace.owner_name,
							)
						}
						onStatusChange={(status: ConnectionStatus) => {
							if (status === "connected") {
								connected.current = true;
							} else if (status === "disconnected" && connected.current) {
								// The shell exited or the connection dropped: the
								// terminal terminated. End what may be left of it
								// (before the terminal would reconnect and start a
								// fresh shell under the same id) and start over.
								finish(activeSession, false);
							}
						}}
					/>
					{dimensions && (
						// Columns x rows in a pill in the terminal's top-right corner, while the text size changes.
						<span
							data-testid="terminal-dimensions"
							data-shown={dimensionsShown || undefined}
							aria-hidden={!dimensionsShown}
							title={`Terminal size ${dimensions.cols} columns by ${dimensions.rows} rows`}
							className={cn(
								"pointer-events-none absolute right-5 top-3.5 z-[1] select-none rounded-full border border-solid bg-surface-primary/85 px-2 py-0.5 font-mono text-[10px] leading-4 tabular-nums shadow-sm",
								"transition-opacity duration-300 motion-reduce:transition-none",
								dimensionsShown ? "opacity-100" : "opacity-0",
								dimensions.cols < MIN_TERMINAL_COLS ||
									dimensions.rows < MIN_TERMINAL_ROWS
									? "border-border-warning text-content-warning"
									: "border-border text-content-secondary",
							)}
						>
							{dimensions.cols}x{dimensions.rows}
						</span>
					)}
				</div>
			</ThemeOverride>
		);

	// The first time the drop-down's terminal box is laid out, size the text to fit 80x24.
	useEffect(() => {
		const box = terminalBox.current;
		if (chosenFontSize === undefined && fitFontSize === undefined && box) {
			setFitFontSize(fittingFontSize(box.clientWidth, box.clientHeight));
		}
	});

	return (
		<section className="border-0 border-t border-solid border-border">
			<Collapsible
				open={open}
				disabled={!ready && !open && !poppedOut}
				onOpenChange={(next) => {
					if (poppedOut) {
						if (next) {
							dock();
						}
						return;
					}
					if (next) {
						setOpen(true);
						start(session);
					} else if (session && endOnClose) {
						finish(session, false);
					} else {
						setOpen(false);
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
							<span>Terminal</span>
						</Button>
					</CollapsibleTrigger>
					{!ready && !open && !poppedOut && (
						<Badge size="xs" className="relative z-[1]">
							Opens when the workspace is ready
						</Badge>
					)}
					{poppedOut && (
						<Badge size="xs" className="relative z-[1]">
							Popped out
						</Badge>
					)}
					{kept && session && (
						<span className="relative z-[1] flex items-center gap-2">
							<Badge size="xs">Session running</Badge>
							<Button
								size="sm"
								variant="destructive"
								onClick={() => finish(session, false)}
							>
								End session
							</Button>
						</span>
					)}
				</div>
				<CollapsibleContent>
					<div className="px-4 pb-4">
						{/* Three columns: text size (left), the custom command (centred), session controls (right). */}
						<div className="mb-2 flex flex-wrap items-center gap-x-8 gap-y-2">
							<div className="flex min-w-max flex-1 basis-0 items-center">
								{fontSizeControls}
							</div>
							{canRunCommands && (
								<div
									className="flex items-center justify-center gap-2 text-sm text-content-secondary"
									role="group"
									aria-label="Custom command"
									title="New sessions run this command first, then continue in your shell"
								>
									<Switch
										id={customId}
										size="sm"
										checked={custom.enabled}
										onCheckedChange={(enabled) =>
											changeCustom({ ...custom, enabled })
										}
									/>
									<Label htmlFor={customId} className="font-normal">
										Custom command
									</Label>
									<Input
										aria-label="Command"
										className="h-7 w-72 px-2 font-mono text-xs"
										spellCheck={false}
										autoComplete="off"
										maxLength={MAX_CUSTOM_COMMAND_LENGTH}
										disabled={!custom.enabled}
										value={custom.command}
										onChange={(event) =>
											changeCustom({ ...custom, command: event.target.value })
										}
									/>
									<Button
										size="sm"
										variant="outline"
										className="h-7"
										disabled={!custom.enabled || !custom.command.trim()}
										title="Start a new session with this command now"
										onClick={() => {
											if (session) {
												void endSession(
													agent.id,
													session,
													terminalConfig.baseUrl,
												);
											}
											start(null);
										}}
									>
										<PlayIcon />
										Run
									</Button>
								</div>
							)}
							<div className="flex min-w-max flex-1 basis-0 items-center justify-end gap-3">
								<div
									className="flex items-center gap-2 text-sm text-content-secondary"
									title="Collapsing this drop-down (or leaving the page) ends the shell and everything running in it"
								>
									<Switch
										id={endOnCloseId}
										size="sm"
										checked={endOnClose}
										onCheckedChange={(on) => {
											setEndOnClose(on);
											writeEndOnClose(on);
										}}
									/>
									<Label htmlFor={endOnCloseId} className="font-normal">
										End session when closed
									</Label>
								</div>
								<Button
									size="sm"
									variant="outline"
									disabled={!activeSession}
									title="Open this terminal in a window over the page"
									onClick={popOut}
								>
									<PictureInPicture2Icon />
									Pop out
								</Button>
								<Button
									size="sm"
									variant="destructive"
									disabled={!session}
									onClick={() => {
										if (session) {
											finish(session, true);
										}
									}}
								>
									End session
								</Button>
							</div>
						</div>

						{!poppedOut && terminalBody("h-[420px]")}
					</div>
				</CollapsibleContent>
			</Collapsible>
			{poppedOut && (
				<TerminalPopout
					title={`Terminal · ${workspace.name}.${agent.name}`}
					onDock={dock}
					onClose={closePopout}
					onOpenInBrowserWindow={openInBrowserWindow}
					toolbar={fontSizeControls}
				>
					{terminalBody("h-full")}
				</TerminalPopout>
			)}
		</section>
	);
};
