import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useQuery } from "react-query";
import { deploymentConfig } from "#/api/queries/deployment";
import { appearanceSettings } from "#/api/queries/users";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { Label } from "#/components/Label/Label";
import { useProxy } from "#/contexts/ProxyContext";
import { ThemeOverride } from "#/contexts/ThemeProvider";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { getTerminalConfig } from "#/modules/terminal/terminalConfig";
import type { ConnectionStatus } from "#/modules/terminal/types";
import { WorkspaceTerminal } from "#/modules/terminal/WorkspaceTerminal";
import themes from "#/theme";
import { openMaybePortForwardedURL } from "#/utils/portForward";
import { generateConnectionSessionId } from "#/utils/random";
import {
	endSession,
	loadSession,
	newSession,
	readEndOnClose,
	saveSession,
	startCommand,
	type TerminalSession,
	writeEndOnClose,
} from "./terminalSession";

type Phase =
	| { kind: "running" }
	| { kind: "ended"; message: string; resumable: boolean };

type AgentTerminalSectionProps = {
	agent: WorkspaceAgent;
	workspace: Workspace;
};

/**
 * Workspace page > agent > "Terminal": the agent's terminal in a drop-down
 * right under its "Logs", inside the page instead of a new window.
 *
 * "End session when closed" (on by default): collapsing the drop-down, or
 * leaving the workspace page, ends the shell. Off: it keeps running and is
 * there again when the drop-down is reopened in the same tab; meanwhile the
 * header shows "Session running" with an "End session" button. A shell that
 * exits ends the session; the drop-down then offers a new one.
 */
export const AgentTerminalSection: React.FC<AgentTerminalSectionProps> = ({
	agent,
	workspace,
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
	const [phase, setPhase] = useState<Phase>({ kind: "running" });
	const [endOnClose, setEndOnClose] = useState(readEndOnClose);
	const [ending, setEnding] = useState(false);
	const [clientSessionId] = useState(generateConnectionSessionId);
	const endOnCloseId = useId();
	const connected = useRef(false);

	const replaceSession = (next: TerminalSession | null) => {
		setSession(next);
		saveSession(agent.id, next);
	};

	const finish = async (
		ended: TerminalSession,
		report: boolean,
	): Promise<void> => {
		replaceSession(null);
		if (!report) {
			void endSession(agent.id, ended, terminalConfig.baseUrl);
			return;
		}
		setEnding(true);
		const result = await endSession(agent.id, ended, terminalConfig.baseUrl);
		setEnding(false);
		setPhase({
			kind: "ended",
			resumable: false,
			message: result
				? "Session ended."
				: result === null
					? "Disconnected. The agent ends the session after a few idle minutes."
					: "The workspace did not confirm the end; the agent ends the session after a few idle minutes.",
		});
	};

	const start = (next: TerminalSession | null) => {
		const current = next ?? newSession(agent.operating_system);
		if (!next) {
			replaceSession(current);
		}
		connected.current = false;
		setPhase({ kind: "running" });
	};

	// Leaving the workspace page with the drop-down open ends the session too.
	const endOnLeave = useEffectEvent(() => {
		if (open && session && endOnClose) {
			saveSession(agent.id, null);
			void endSession(agent.id, session, terminalConfig.baseUrl);
		}
	});
	useEffect(() => endOnLeave, []);

	const kept = Boolean(session && !open);
	const showTerminal = open && phase.kind === "running";
	const activeSession = showTerminal ? (session ?? undefined) : undefined;

	return (
		<section className="border-0 border-t border-solid border-border">
			<Collapsible
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						start(session);
					} else if (session && endOnClose) {
						void finish(session, false);
					}
				}}
			>
				<div className="px-4 py-2 relative flex items-center gap-2">
					<CollapsibleTrigger asChild>
						<Button
							variant="subtle"
							className="after:content-[''] after:absolute after:inset-0"
						>
							<ChevronDownIcon open={open} />
							<span>Terminal</span>
						</Button>
					</CollapsibleTrigger>
					{kept && session && (
						<span className="relative z-[1] flex items-center gap-2">
							<Badge size="xs">Session running</Badge>
							<Button
								size="sm"
								variant="destructive"
								onClick={() => {
									void finish(session, false);
								}}
							>
								End session
							</Button>
						</span>
					)}
				</div>
				<CollapsibleContent>
					<div className="px-4 pb-4">
						<div className="mb-2 flex flex-wrap items-center gap-3">
							<p
								role="status"
								aria-live="polite"
								className="m-0 text-sm text-content-secondary"
							>
								{ending
									? "Ending the session…"
									: phase.kind === "ended"
										? phase.message
										: ""}
							</p>
							<span className="flex-1" />
							<div
								className="flex items-center gap-2 text-sm text-content-secondary"
								title="Collapsing this drop-down (or leaving the page) ends the shell and everything running in it"
							>
								<Checkbox
									id={endOnCloseId}
									checked={endOnClose}
									onCheckedChange={(checked) => {
										const on = checked === true;
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
								variant="destructive"
								disabled={!session || ending || phase.kind === "ended"}
								onClick={() => {
									if (session) {
										void finish(session, true);
									}
								}}
							>
								End session
							</Button>
						</div>

						{phase.kind === "ended" ? (
							<div className="flex gap-2">
								<Button
									variant="outline"
									onClick={() => start(phase.resumable ? session : null)}
								>
									{phase.resumable ? "Reconnect" : "Start a new session"}
								</Button>
								{phase.resumable && (
									<Button
										variant="outline"
										onClick={() => {
											if (session) {
												void finish(session, false);
											}
											start(null);
										}}
									>
										New session
									</Button>
								)}
							</div>
						) : (
							activeSession && (
								<ThemeOverride theme={themes.dark}>
									<div className="h-[420px] overflow-hidden rounded-md border border-solid border-border">
										<WorkspaceTerminal
											key={activeSession.id}
											agentId={agent.id}
											operatingSystem={agent.operating_system}
											initialCommand={startCommand(activeSession)}
											reconnectionToken={activeSession.id}
											sessionId={clientSessionId}
											baseUrl={terminalConfig.baseUrl}
											terminalFontFamily={terminalConfig.fontFamily}
											renderer={terminalConfig.renderer}
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
												} else if (
													status === "disconnected" &&
													connected.current
												) {
													// The shell exited or the connection dropped:
													// stop before the terminal reconnects and starts
													// a fresh shell under the same id.
													connected.current = false;
													setPhase({
														kind: "ended",
														resumable: true,
														message:
															"The terminal disconnected: the shell exited or the connection dropped.",
													});
												}
											}}
										/>
									</div>
								</ThemeOverride>
							)
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
};
