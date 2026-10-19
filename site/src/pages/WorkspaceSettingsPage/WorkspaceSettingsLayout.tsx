import "./workspaceSettings.css";
import { Suspense } from "react";
import { useQuery } from "react-query";
import {
	Outlet,
	Link as RouterLink,
	useParams,
	useSearchParams,
} from "react-router";
import {
	workspaceByOwnerAndName,
	workspacePermissions,
} from "#/api/queries/workspaces";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { useClipboard } from "#/hooks/useClipboard";
import { pageTitle } from "#/utils/page";
import { CheckGlyph, CopyGlyph, TerminalGlyph } from "./settingsIcons";
import { WorkspaceSettings } from "./useWorkspaceSettings";

/** A version ID shortened as the design shows it: its first and last 8 characters. */
const shortId = (id: string) =>
	id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;

/** The template version the settings apply to, with a copy button. */
const VersionChip: React.FC<{ id: string }> = ({ id }) => {
	const { copyToClipboard, showCopiedSuccess } = useClipboard();
	return (
		<div
			className="flex h-[38px] items-center gap-2 rounded-(--ws-r-md) border border-solid border-(--ws-line) bg-(--ws-chip) pl-3 pr-1.5"
			data-testid="version-chip"
		>
			<span className="text-xs text-(--ws-muted)">Version</span>
			<code className="ws-mono text-xs text-(--ws-text-2)" title={id}>
				{shortId(id)}
			</code>
			<button
				type="button"
				aria-label="Copy version ID"
				title={showCopiedSuccess ? "Copied" : "Copy version ID"}
				className="ws-hit flex size-7 cursor-pointer items-center justify-center rounded-(--ws-r-xs) border-0 bg-transparent text-(--ws-muted) hover:text-(--ws-text)"
				onClick={() => void copyToClipboard(id)}
			>
				{showCopiedSuccess ? <CheckGlyph /> : <CopyGlyph />}
			</button>
		</div>
	);
};

/**
 * Platform: the workspace settings page's frame - its header (the way back to Workspaces and the workspace, the
 * title, the template version) over the page (WorkspaceSettingsCardsPage), in the page's own look
 * (workspaceSettings.css).
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

			<header className="border-0 border-b border-solid border-(--ws-header-line) bg-(--ws-header)">
				<div className="mx-auto flex max-w-(--ws-content) flex-wrap items-center justify-between gap-4 px-8 py-5">
					<div className="flex min-w-0 items-center gap-3.5">
						<div className="flex size-[46px] shrink-0 items-center justify-center rounded-(--ws-r-lg) border border-solid border-(--ws-well-line) bg-(--ws-raised) text-(--ws-soft)">
							<TerminalGlyph />
						</div>
						<div className="min-w-0">
							<nav
								aria-label="Breadcrumb"
								className="flex items-center gap-1.5 text-[13px] text-(--ws-muted)"
							>
								<RouterLink to="/workspaces" className="ws-quiet-link ws-hit">
									Workspaces
								</RouterLink>
								<span aria-hidden="true">/</span>
								<RouterLink
									to={`/@${username}/${workspaceName}`}
									className="ws-quiet-link ws-hit min-w-0 text-(--ws-text-2)"
								>
									<span className="block truncate">{workspaceName}</span>
								</RouterLink>
							</nav>
							<h1 className="m-0 mt-0.5 text-[22px] font-semibold leading-[1.5] tracking-[-0.01em]">
								Workspace settings
							</h1>
						</div>
					</div>
					{versionId && (
						<div className="flex flex-wrap items-center gap-2.5">
							<VersionChip id={versionId} />
						</div>
					)}
				</div>
			</header>

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
