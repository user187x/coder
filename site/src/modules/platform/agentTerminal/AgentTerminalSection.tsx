import {
	MaximizeIcon,
	MinimizeIcon,
	MinusIcon,
	PictureInPicture2Icon,
	PlayIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import {
	useEffect,
	useEffectEvent,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
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
import themes from "#/theme";
import { openMaybePortForwardedURL } from "#/utils/portForward";
import { FaMinusCircleIcon, FaPlusCircleIcon } from "./circleIcons";
import { TerminalPopout } from "./TerminalPopout";
import { TerminalTile } from "./TerminalTile";
import {
	loadLayout,
	reconcileLayout,
	replaceLayoutIds,
	type SplitDirection,
	saveLayout,
	splitLayout,
	terminalBounds,
} from "./terminalLayout";
import {
	endSession,
	fittingFontSize,
	loadSessions,
	MAX_CUSTOM_COMMAND_LENGTH,
	MAX_TERMINAL_FONT_SIZE,
	MIN_TERMINAL_FONT_SIZE,
	newSession,
	readCustomCommand,
	readEndOnClose,
	readFontSize,
	saveSessions,
	startCommand,
	stepFontSize,
	type TerminalSession,
	writeCustomCommand,
	writeEndOnClose,
	writeFontSize,
} from "./terminalSession";
import "./agentTerminal.css";

const MAX_TILES = 6;

type AgentTerminalSectionProps = {
	agent: WorkspaceAgent;
	workspace: Workspace;
	ready: boolean;
	handle?: React.ReactNode;
	panelId?: string;
	initiallyOpen?: boolean;
	onRemove?: () => void;
};

/** Independent terminal tiles share one toolbar and retain their PTYs across layout changes. */
export const AgentTerminalSection: React.FC<AgentTerminalSectionProps> = ({
	agent,
	workspace,
	ready,
	handle,
	panelId,
	initiallyOpen = false,
	onRemove,
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
	const sessionKey = panelId ? `${agent.id}:${panelId}` : agent.id;
	const [openRequested, setOpen] = useState(initiallyOpen && ready);
	const [sessions, setSessions] = useState(() => {
		const saved = loadSessions(sessionKey);
		return saved.length
			? saved
			: initiallyOpen && ready
				? [newSession(agent.operating_system)]
				: [];
	});
	useEffect(() => saveSessions(sessionKey, sessions), [sessionKey, sessions]);
	const [savedLayout, setLayout] = useState(() => loadLayout(sessionKey));
	const layout = useMemo(
		() =>
			reconcileLayout(
				savedLayout,
				sessions.map(({ id }) => id),
			),
		[savedLayout, sessions],
	);
	const bounds = useMemo(() => terminalBounds(layout), [layout]);
	const smallestWidth = Math.min(
		100,
		...[...bounds.values()].map((pane) => pane.width),
	);
	const smallestHeight = Math.min(
		100,
		...[...bounds.values()].map((pane) => pane.height),
	);
	useEffect(() => saveLayout(sessionKey, layout), [sessionKey, layout]);
	const [selectedId, setSelectedId] = useState<string>();
	const selected =
		sessions.find((session) => session.id === selectedId) ?? sessions[0];
	const [endOnClose, setEndOnClose] = useState(readEndOnClose);
	const endOnCloseId = useId();
	const customId = useId();
	const [custom, setCustom] = useState(() =>
		panelId ? { enabled: false, command: "" } : readCustomCommand(),
	);
	const changeCustom = (next: typeof custom) => {
		setCustom(next);
		if (!panelId) writeCustomCommand(next);
	};
	const [popoutRequested, setPoppedOut] = useState(false);
	const open = openRequested && sessions.length > 0;
	const poppedOut = popoutRequested && sessions.length > 0;
	const [chosenFontSize, setChosenFontSize] = useState(readFontSize);
	const [fitFontSize, setFitFontSize] = useState(13);
	const fontSize = chosenFontSize ?? fitFontSize;
	const terminalGrid = useRef<HTMLDivElement>(null);
	const surface = useRef<HTMLDivElement>(null);
	const [fullscreen, setFullscreen] = useState(false);
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
			2500,
		);
	};
	useEffect(() => {
		const grid = terminalGrid.current;
		if (!grid || chosenFontSize !== undefined) return;
		const observer = new ResizeObserver(() => {
			setFitFontSize(
				fittingFontSize(
					(grid.clientWidth * smallestWidth) / 100,
					(grid.clientHeight * smallestHeight) / 100,
				),
			);
		});
		observer.observe(grid);
		return () => observer.disconnect();
	}, [open, poppedOut, chosenFontSize, smallestWidth, smallestHeight]);
	useEffect(() => {
		const changed = () =>
			setFullscreen(document.fullscreenElement === surface.current);
		document.addEventListener("fullscreenchange", changed);
		return () => document.removeEventListener("fullscreenchange", changed);
	}, []);
	const toggleFullscreen = async () => {
		try {
			if (document.fullscreenElement === surface.current)
				await document.exitFullscreen();
			else await surface.current?.requestFullscreen();
		} catch {
			toast.error("Fullscreen is unavailable in this browser.");
		}
	};
	const reset = () => {
		setSessions([]);
		setPoppedOut(false);
		setOpen(false);
	};
	const terminate = (ended: TerminalSession[], report: boolean) => {
		void Promise.all(
			ended.map((session) =>
				endSession(agent.id, session, terminalConfig.baseUrl),
			),
		).then((results) => {
			if (report && results.includes(false))
				toast.info(
					"The workspace did not confirm every session ended; the agent ends idle sessions after a few minutes.",
				);
		});
	};
	const finishAll = (report: boolean) => {
		terminate(sessions, report);
		reset();
	};
	const finishTile = (ended: TerminalSession) => {
		terminate([ended], false);
		if (sessions.length === 1) reset();
		else
			setSessions((current) =>
				current.filter((session) => session.id !== ended.id),
			);
	};
	const createSession = () =>
		newSession(
			agent.operating_system,
			custom.enabled ? custom.command : undefined,
		);
	const addTile = (
		direction: SplitDirection = "horizontal",
		targetId = selected?.id,
	) => {
		if (sessions.length >= MAX_TILES) return;
		const next = createSession();
		if (layout !== null && targetId)
			setLayout(splitLayout(layout, targetId, next.id, direction));
		setSessions((current) => [...current, next]);
		setSelectedId(next.id);
	};
	const endOnLeave = useEffectEvent(() => {
		if ((open || poppedOut) && endOnClose) {
			saveSessions(sessionKey, []);
			saveLayout(sessionKey, null);
			terminate(sessions, false);
		}
	});
	useEffect(() => endOnLeave, []);
	const dock = () => {
		setPoppedOut(false);
		setOpen(true);
	};
	const closePopout = () => {
		if (endOnClose) finishAll(false);
		else setPoppedOut(false);
	};
	const openInBrowserWindow = () => {
		if (!selected) return;
		const href = getTerminalHref({
			username: workspace.owner_name,
			workspace: workspace.name,
			agent: agent.name,
		});
		openAppInNewWindow(
			`${href}${href.endsWith("?") ? "" : "&"}reconnect=${encodeURIComponent(selected.id)}`,
		);
		// Relinquish only the transferred PTY; the browser window now owns it.
		if (sessions.length === 1) reset();
		else
			setSessions((current) =>
				current.filter((session) => session.id !== selected.id),
			);
	};
	const active = open || poppedOut;
	const kept = sessions.length > 0 && !active;
	const endLabel = sessions.length > 1 ? "End all sessions" : "End session";
	const terminalSurface = (
		<div ref={surface} className="agent-terminal-surface">
			<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 pb-2">
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
						title="Smaller text in every terminal"
						disabled={fontSize <= MIN_TERMINAL_FONT_SIZE}
						onClick={() => changeFontSize(-1)}
					>
						<FaMinusCircleIcon className="size-4" />
					</Button>
					<span className="w-6 text-center tabular-nums">{fontSize}</span>
					<Button
						size="icon"
						variant="subtle"
						className="size-6 rounded-full"
						aria-label="Larger text"
						title="Larger text in every terminal"
						disabled={fontSize >= MAX_TERMINAL_FONT_SIZE}
						onClick={() => changeFontSize(1)}
					>
						<FaPlusCircleIcon className="size-4" />
					</Button>
				</div>
				<div
					role="group"
					aria-label="Terminal tiles"
					className="flex items-center gap-1"
				>
					<Button
						size="icon"
						variant="outline"
						className="size-7"
						aria-label="Add terminal below"
						title="Add terminal below"
						disabled={sessions.length >= MAX_TILES}
						onClick={() => addTile()}
					>
						<PlusIcon className="size-3.5" />
					</Button>
					<span className="text-xs tabular-nums text-content-secondary">
						{sessions.length}
					</span>
					<Button
						size="icon"
						variant="outline"
						className="size-7"
						aria-label="Close selected terminal"
						title="Close the focused terminal"
						disabled={!selected || sessions.length < 2}
						onClick={() => {
							if (selected) finishTile(selected);
						}}
					>
						<MinusIcon className="size-3.5" />
					</Button>
				</div>
				{agent.operating_system !== "windows" && (
					<div
						className="flex flex-wrap items-center gap-2 text-xs text-content-secondary"
						role="group"
						aria-label="Custom command"
					>
						<Switch
							id={customId}
							size="sm"
							checked={custom.enabled}
							onCheckedChange={(enabled) =>
								changeCustom({ ...custom, enabled })
							}
						/>
						<Label htmlFor={customId} className="text-xs font-normal">
							Custom command
						</Label>
						<Input
							aria-label="Command"
							className="h-7 w-48 px-2 font-mono text-xs"
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
							title="Restart every terminal with this command"
							onClick={() => {
								terminate(sessions, false);
								const next = sessions.map(createSession);
								setLayout(
									replaceLayoutIds(
										layout,
										new Map(
											sessions.flatMap((session, index) => {
												const replacement = next[index];
												return replacement
													? [[session.id, replacement.id]]
													: [];
											}),
										),
									),
								);
								setSessions(next);
							}}
						>
							<PlayIcon />
							{sessions.length > 1 ? "Run all" : "Run"}
						</Button>
					</div>
				)}
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					<div className="flex items-center gap-2 text-xs text-content-secondary">
						<Switch
							id={endOnCloseId}
							size="sm"
							checked={endOnClose}
							onCheckedChange={(on) => {
								setEndOnClose(on);
								writeEndOnClose(on);
							}}
						/>
						<Label htmlFor={endOnCloseId} className="text-xs font-normal">
							End session when closed
						</Label>
					</div>
					<Button
						size="icon"
						variant="outline"
						className="size-7"
						aria-label={
							fullscreen ? "Exit terminal fullscreen" : "Fullscreen terminals"
						}
						title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
						onClick={toggleFullscreen}
					>
						{fullscreen ? (
							<MinimizeIcon className="size-3.5" />
						) : (
							<MaximizeIcon className="size-3.5" />
						)}
					</Button>
					{!poppedOut && (
						<Button
							size="sm"
							variant="outline"
							className="h-7"
							disabled={fullscreen}
							onClick={() => {
								setPoppedOut(true);
								setOpen(false);
							}}
						>
							<PictureInPicture2Icon />
							Pop out
						</Button>
					)}
					<Button
						size="sm"
						variant="destructive"
						className="h-7"
						disabled={!sessions.length}
						onClick={() => finishAll(true)}
					>
						{endLabel}
					</Button>
				</div>
			</div>
			<ThemeOverride theme={themes.dark}>
				<div className="agent-terminal-tiles">
					<div
						ref={terminalGrid}
						className="relative flex-1"
						style={{
							minWidth: (240 * 100) / smallestWidth,
							minHeight: (180 * 100) / smallestHeight,
						}}
					>
						{sessions.map((session, index) => (
							<TerminalTile
								key={session.id}
								index={index}
								bounds={bounds.get(session.id)}
								canSplit={sessions.length < MAX_TILES}
								onSplit={(direction) => addTile(direction, session.id)}
								selected={sessions.length > 1 && session.id === selected?.id}
								onSelect={() => setSelectedId(session.id)}
								onEnd={() => finishTile(session)}
								showDimensions={dimensionsShown}
								agentId={agent.id}
								operatingSystem={agent.operating_system}
								initialCommand={startCommand(session)}
								reconnectionToken={session.id}
								baseUrl={terminalConfig.baseUrl}
								terminalFontFamily={terminalConfig.fontFamily}
								fontSize={fontSize}
								renderer={terminalRenderer(terminalConfig.renderer, agent)}
								loading={config.isLoading || appearance.isLoading}
								autoFocus={session.id === selected?.id}
								onOpenLink={(uri) =>
									openMaybePortForwardedURL(
										uri,
										proxy.preferredWildcardHostname,
										agent.name,
										workspace.name,
										workspace.owner_name,
									)
								}
							/>
						))}
					</div>
				</div>
			</ThemeOverride>
		</div>
	);
	return (
		<section
			className="agent-terminal-section border-0 border-t border-solid border-border"
			data-open={open || undefined}
		>
			<Collapsible
				open={open}
				disabled={!ready && !active}
				onOpenChange={(next) => {
					if (poppedOut) {
						if (next) dock();
						return;
					}
					if (next) {
						setOpen(true);
						if (!sessions.length) setSessions([createSession()]);
					} else if (endOnClose) finishAll(false);
					else setOpen(false);
				}}
			>
				<div className="px-4 py-2 relative flex shrink-0 items-center gap-2">
					{handle}
					<CollapsibleTrigger asChild>
						<Button
							variant="subtle"
							data-panel-title
							className="after:content-[''] after:absolute after:inset-0"
						>
							<ChevronDownIcon open={open} />
							<span>Terminal</span>
						</Button>
					</CollapsibleTrigger>
					{!ready && !active && (
						<Badge size="xs" className="relative z-[1]">
							Opens when the workspace is ready
						</Badge>
					)}
					{poppedOut && (
						<Badge size="xs" className="relative z-[1]">
							Popped out
						</Badge>
					)}
					{kept && (
						<span className="relative z-[1] flex items-center gap-2">
							<Badge size="xs">
								{sessions.length > 1
									? `${sessions.length} sessions running`
									: "Session running"}
							</Badge>
							<Button
								size="sm"
								variant="destructive"
								onClick={() => finishAll(false)}
							>
								{endLabel}
							</Button>
						</span>
					)}
					{onRemove && (
						<Button
							variant="subtle"
							size="icon"
							className="relative z-[1] ml-auto"
							aria-label="Remove terminal panel"
							onClick={() => {
								finishAll(false);
								onRemove();
							}}
						>
							<Trash2Icon className="size-4" />
						</Button>
					)}
				</div>
				<CollapsibleContent className="agent-terminal-content">
					<div className="px-4 pb-4">
						{open && !poppedOut && terminalSurface}
					</div>
				</CollapsibleContent>
			</Collapsible>
			{poppedOut && (
				<TerminalPopout
					title={`Terminals · ${workspace.name}.${agent.name}`}
					onDock={dock}
					onClose={closePopout}
					onOpenInBrowserWindow={openInBrowserWindow}
				>
					{terminalSurface}
				</TerminalPopout>
			)}
		</section>
	);
};
