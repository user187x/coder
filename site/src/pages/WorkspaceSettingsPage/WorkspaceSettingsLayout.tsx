import "#/modules/platform/settingsPage/settingsPage.css";
import { Suspense } from "react";
import { useQuery } from "react-query";
import { Outlet, useParams, useSearchParams } from "react-router";
import {
	workspaceByOwnerAndName,
	workspacePermissions,
} from "#/api/queries/workspaces";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { SettingsPageHeader } from "#/modules/platform/settingsPage/SettingsPageHeader";
import { TerminalGlyph } from "#/modules/platform/settingsPage/settingsIcons";
import { pageTitle } from "#/utils/page";
import { WorkspaceSettings } from "./useWorkspaceSettings";

/**
 * Platform: the workspace settings page's frame - its header (the way back to Workspaces and the workspace, the
 * title, the template version) over the page (WorkspaceSettingsCardsPage), in the page's own look
 * (settingsPage.css).
 */
export const WorkspaceSettingsLayout: React.FC = () => {
	const params = useParams() as {
		workspace: string;
		username: string;
	};
	const workspaceName = params.workspace;
	const username = params.username.replace("@", "");
	const [searchParams] = useSearchParams();
	const workspaceQuery = useQuery(
		workspaceByOwnerAndName(username, workspaceName),
	);

	const permissionsQuery = useQuery(workspacePermissions(workspaceQuery.data));

	if (workspaceQuery.isLoading) {
		return <Loader />;
	}

	const error = workspaceQuery.error || permissionsQuery.error;
	const workspace = workspaceQuery.data;
	const versionId =
		searchParams.get("templateVersionId") ??
		workspace?.latest_build.template_version_id;

	return (
		<div className="ws-settings min-h-full">
			<title>{pageTitle(workspaceName, "Workspace Settings")}</title>

			<SettingsPageHeader
				icon={<TerminalGlyph />}
				crumbs={[
					{ label: "Workspaces", to: "/workspaces" },
					{ label: workspaceName, to: `/@${username}/${workspaceName}` },
				]}
				title="Workspace settings"
				versionId={versionId}
			/>

			{error ? (
				<div className="mx-auto max-w-(--ws-content) p-8">
					<ErrorAlert error={error} />
				</div>
			) : (
				workspace && (
					<WorkspaceSettings.Provider
						value={{
							owner: username,
							workspace,
							permissions: permissionsQuery.data,
						}}
					>
						<Suspense fallback={<Loader />}>
							<Outlet />
						</Suspense>
					</WorkspaceSettings.Provider>
				)
			)}
		</div>
	);
};
