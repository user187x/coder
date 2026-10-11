import { useEffect, useState } from "react";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { initializingStep } from "./workspaceReadiness";
import "./workspaceInitializing.css";

const MAX_LISTED_SCRIPTS = 3;

const elapsed = (since: string, now: number) => {
	const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
	const m = Math.floor(seconds / 60);
	const s = String(seconds % 60).padStart(2, "0");
	return `${m}:${s}`;
};

type WorkspaceInitializingProps = {
	workspace: Workspace;
	agent: WorkspaceAgent;
};

/**
 * Workspace page > agent card, while the workspace starts (agentInitializing):
 * this panel stands in for the agent's apps (and Coder's "Workspace agent is
 * connecting" message), saying what the start is doing - the agent connecting,
 * then the startup scripts, how many have finished and which are still
 * running - and how long it has taken. The apps and the terminal appear once
 * the workspace is ready (agentAppsReady).
 */
export const WorkspaceInitializing: React.FC<WorkspaceInitializingProps> = ({
	workspace,
	agent,
}) => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);

	const { step, scripts } = initializingStep(agent);
	const listed = scripts?.running.slice(0, MAX_LISTED_SCRIPTS) ?? [];
	const more = (scripts?.running.length ?? 0) - listed.length;

	return (
		<section
			className="ws-init"
			role="status"
			aria-live="polite"
			data-testid="workspace-initializing"
		>
			<div className="ws-init-stripes" />
			<div className="ws-init-stage">
				<img src="/loading-brix.gif" alt="" className="ws-init-anim" />
				<div className="ws-init-text">
					<h2 className="ws-init-title">WORKSPACE INITIALIZING</h2>
					<div className="ws-init-info">
						<p className="ws-init-step">{step}</p>
						{scripts && (
							<>
								<div
									className="ws-init-progress"
									role="progressbar"
									aria-label="Startup scripts finished"
									aria-valuemin={0}
									aria-valuemax={scripts.total}
									aria-valuenow={scripts.done}
								>
									<div
										style={{
											width: `${(scripts.done / scripts.total) * 100}%`,
										}}
									/>
								</div>
								<p className="ws-init-detail">
									{scripts.done} of {scripts.total} finished
									{listed.length > 0 &&
										` · running ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}`}
								</p>
							</>
						)}
						<p className="ws-init-note">
							{elapsed(workspace.latest_build.created_at, now)} elapsed · apps
							and the terminal open as soon as the workspace is ready
						</p>
					</div>
				</div>
			</div>
			<div className="ws-init-stripes" />
		</section>
	);
};
