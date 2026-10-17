import { useEffect, useRef, useState } from "react";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { initializingMilestones, initializingStep } from "./workspaceReadiness";
import "./workspaceInitializing.css";

const MAX_LISTED_SCRIPTS = 3;

const elapsed = (since: string, now: number) => {
	const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
	const m = Math.floor(seconds / 60);
	const s = String(seconds % 60).padStart(2, "0");
	return `${m}:${s}`;
};

// Between milestones the bar creeps toward the next one - never reaching it -
// so a long step still shows life: up to CREEP of the gap, half of that in
// CREEP_HALF_LIFE_MS.
const CREEP = 0.85;
const CREEP_HALF_LIFE_MS = 12_000;

/** Overall progress (0-1): the milestones reached, plus a creep into the next. */
export const useStartProgress = (
	done: number,
	total: number,
	now: number,
): number => {
	const since = useRef({ done, at: now });
	if (since.current.done !== done) {
		since.current = { done, at: now };
	}
	if (total <= 0) {
		return 0;
	}
	if (done >= total) {
		return 1;
	}
	const t = Math.max(0, now - since.current.at);
	const creep = CREEP * (1 - 0.5 ** (t / CREEP_HALF_LIFE_MS));
	return Math.min(1, (done + creep) / total);
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
 * running, then the apps the scripts start until each answers its health
 * check - and how long it has taken. The apps and the terminal appear once
 * the workspace is ready (agentAppsReady).
 */
export const WorkspaceInitializing: React.FC<WorkspaceInitializingProps> = ({
	workspace,
	agent,
}) => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 500);
		return () => window.clearInterval(timer);
	}, []);
	const milestones = initializingMilestones(agent);
	const overall = useStartProgress(milestones.done, milestones.total, now);
	const percent = Math.round(overall * 100);

	const { step, progress } = initializingStep(agent);
	const listed = progress?.pending.slice(0, MAX_LISTED_SCRIPTS) ?? [];
	const more = (progress?.pending.length ?? 0) - listed.length;

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
						<div className="ws-init-meter">
							<div
								className="ws-init-progress"
								role="progressbar"
								aria-label="Workspace start"
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={percent}
								aria-valuetext={`${percent}%: ${milestones.done} of ${milestones.total} steps done`}
								title={`${milestones.done} of ${milestones.total} steps done: the agent, each startup script, each app's health check`}
							>
								<div
									className="ws-init-progress-fill"
									style={{ width: `${Math.max(2, overall * 100)}%` }}
								/>
							</div>
							<span className="ws-init-percent">{percent}%</span>
						</div>
						{progress && (
							<p className="ws-init-detail">
								{progress.done} of {progress.total}{" "}
								{progress.of === "apps" ? "up" : "finished"}
								{listed.length > 0 &&
									` · ${progress.of === "apps" ? "starting" : "running"} ${listed.join(", ")}${more > 0 ? ` and ${more} more` : ""}`}
							</p>
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
