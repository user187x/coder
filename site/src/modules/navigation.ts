/**
 * @fileoverview TODO: centralize navigation code here! URL constants, URL formatting, all of it
 */

import { useCallback } from "react";
import type { DashboardValue } from "./dashboard/DashboardProvider";
import { useDashboard } from "./dashboard/useDashboard";

type LinkThunk = (state: DashboardValue) => string;

export function useLinks() {
	const dashboard = useDashboard();
	const get = useCallback(
		(thunk: LinkThunk): string => thunk(dashboard),
		[dashboard],
	);
	return get;
}

export const linkToTemplate =
	(organizationName: string, templateName: string): LinkThunk =>
	(dashboard) =>
		dashboard.showOrganizations
			? `/templates/${organizationName}/${templateName}`
			: `/templates/${templateName}`;

/** Opens the template picker on the Workspaces page. */
export const createWorkspaceSearchParam = "create-workspace";

/** Coder's deployment latency view. */
export const pingLatencyPath = "/hud/latency";
