import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "#/api/typesGenerated";
import { findWorkspaceAgent, getWorkspaceAgents } from "#/utils/workspace";

export type WorkspaceAppWithAgent = WorkspaceApp & {
	agent: WorkspaceAgent;
};

export function getAllAppsWithAgent(
	workspace: Workspace,
): WorkspaceAppWithAgent[] {
	return getWorkspaceAgents(workspace).flatMap((agent) =>
		normalizeWorkspaceApps(agent).apps.map((app) => ({
			...app,
			agent,
		})),
	);
}

export function findWorkspaceAppWithAgent(
	workspace: Workspace,
	agentId: string,
	appId: string,
): WorkspaceAppWithAgent | undefined {
	const agent = findWorkspaceAgent(workspace, agentId);
	if (!agent) {
		return undefined;
	}
	const app = agent.apps.find((workspaceApp) => workspaceApp.id === appId);
	if (!app) {
		return undefined;
	}
	return { ...app, agent };
}

export const isRetiredWorkspaceApp = (app: Pick<WorkspaceApp, "slug">) =>
	app.slug === "chromium" || app.slug === "ghostty";

/** Retires old template app entries without requiring a running workspace rebuild. */
export function normalizeWorkspaceApps(agent: WorkspaceAgent): WorkspaceAgent {
	if (
		!agent.apps.some(
			(app) =>
				isRetiredWorkspaceApp(app) ||
				(app.slug === "neko-browser" && !app.icon),
		)
	)
		return agent;
	const replacedTerminal = agent.apps.some((app) => app.slug === "ghostty");
	return {
		...agent,
		apps: agent.apps
			.filter((app) => !isRetiredWorkspaceApp(app))
			.map((app) =>
				app.slug === "neko-browser" && !app.icon
					? { ...app, icon: "/icon/browser-web-icon.png" }
					: app,
			),
		display_apps:
			replacedTerminal && !agent.display_apps.includes("web_terminal")
				? [...agent.display_apps, "web_terminal"]
				: agent.display_apps,
	};
}
