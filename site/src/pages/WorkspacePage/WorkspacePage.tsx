import { useEffect, useEffectEvent, useState } from "react";
import { useQuery, useQueryClient } from "react-query";
import { useParams } from "react-router";
import { toast } from "sonner";
import { watchWorkspace } from "#/api/api";
import { template as templateQueryOptions } from "#/api/queries/templates";
import { workspaceBuildsKey } from "#/api/queries/workspaceBuilds";
import {
	workspaceByOwnerAndName,
	workspacePermissions,
} from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { Margins } from "#/components/Margins/Margins";
import {
	setWorkspaceContact,
	useWorkspaceContactLost,
	workspaceContactLostAt,
} from "#/modules/platform/workspaceLiveness/liveness";
import { WorkspaceReadyPage } from "./WorkspaceReadyPage";

/** How often the workspace page asks whether Coder answers, and how long it waits (ms). */
const PROBE_EVERY_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;

const WorkspacePage: React.FC = () => {
	const queryClient = useQueryClient();
	const params = useParams() as {
		username: string;
		workspace: string;
	};
	const workspaceName = params.workspace;
	const username = params.username.replace("@", "");

	// Workspace
	const workspaceQueryOptions = workspaceByOwnerAndName(
		username,
		workspaceName,
	);
	const workspaceQuery = useQuery(workspaceQueryOptions);
	const workspace = workspaceQuery.data;

	// Template
	const templateQuery = useQuery({
		...templateQueryOptions(workspace?.template_id ?? ""),
		enabled: Boolean(workspace),
	});
	const template = templateQuery.data;

	// Permissions
	const permissionsQuery = useQuery(workspacePermissions(workspace));
	const permissions = permissionsQuery.data;

	// Watch workspace changes
	const updateWorkspaceData = useEffectEvent(
		async (newWorkspaceData: Workspace) => {
			if (!workspace) {
				throw new Error(
					"Applying an update for a workspace that is undefined.",
				);
			}

			queryClient.setQueryData(
				workspaceQueryOptions.queryKey,
				newWorkspaceData,
			);

			const hasNewBuild =
				newWorkspaceData.latest_build.id !== workspace.latest_build.id;
			const lastBuildHasChanged =
				newWorkspaceData.latest_build.status !== workspace.latest_build.status;

			if (hasNewBuild || lastBuildHasChanged) {
				await queryClient.invalidateQueries({
					queryKey: workspaceBuildsKey(newWorkspaceData.id),
				});
			}
		},
	);
	const workspaceId = workspace?.id;
	// Platform: a new watch after contact with Coder came back (the old one is closed, or hung)
	const [watchGeneration, setWatchGeneration] = useState(0);
	useEffect(() => {
		if (!workspaceId) {
			return;
		}

		const socket = watchWorkspace(workspaceId);
		let closing = false;
		// Platform: the watch broke - the page's live parts stop and turn grey until Coder answers again
		const lost = () => {
			if (!closing) {
				setWorkspaceContact(workspaceId, false);
			}
		};
		socket.addEventListener("message", (event) => {
			if (event.parseError) {
				toast.error(
					`Unable to process latest data for workspace "${workspaceName}".`,
					{
						description: "Please try refreshing the page.",
					},
				);
				return;
			}

			setWorkspaceContact(workspaceId, true);
			if (event.parsedMessage.type === "data") {
				updateWorkspaceData(event.parsedMessage.data as Workspace);
			}
		});
		socket.addEventListener("error", lost);
		socket.addEventListener("close", lost);

		return () => {
			closing = true;
			socket.close();
		};
		// (watchGeneration: a new watch each time it changes)
	}, [workspaceId, workspaceName, watchGeneration]);

	// Platform: the watch alone does not notice Coder gone when its connection hangs (its keep-alive pings are the
	// browser's own): every few seconds, does Coder answer? Back again: a new watch, and the workspace as it is now.
	useEffect(() => {
		if (!workspaceId) {
			return;
		}
		let stopped = false;
		const probe = async () => {
			const ok = await fetch("/api/v2/buildinfo", {
				cache: "no-store",
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			}).then(
				(r) => r.ok,
				() => false,
			);
			if (stopped) {
				return;
			}
			if (!ok) {
				setWorkspaceContact(workspaceId, false);
			} else if (workspaceContactLostAt(workspaceId) !== null) {
				setWorkspaceContact(workspaceId, true);
				setWatchGeneration((g) => g + 1);
				void queryClient.invalidateQueries({
					queryKey: workspaceByOwnerAndName(username, workspaceName).queryKey,
				});
			}
		};
		const timer = window.setInterval(probe, PROBE_EVERY_MS);
		return () => {
			stopped = true;
			window.clearInterval(timer);
			// off the page: nothing else checks, so nothing else shows it as lost
			setWorkspaceContact(workspaceId, true);
		};
	}, [workspaceId, queryClient, username, workspaceName]);

	// Platform: one notice while contact is lost, gone when it is back
	const contactLostAt = useWorkspaceContactLost(workspaceId);
	useEffect(() => {
		const id = `workspace-contact-${workspaceId}`;
		if (contactLostAt === null) {
			toast.dismiss(id);
			return;
		}
		toast.warning(`No contact with Coder about "${workspaceName}".`, {
			id,
			duration: Number.POSITIVE_INFINITY,
			description:
				"Reconnecting... Until then the page shows the workspace as last seen, greyed out.",
		});
	}, [contactLostAt, workspaceId, workspaceName]);

	// Page statuses
	const pageError =
		workspaceQuery.error ?? templateQuery.error ?? permissionsQuery.error;
	const isLoading = !workspace || !template || !permissions;

	return pageError ? (
		<Margins>
			<ErrorAlert error={pageError} className="my-4" />
		</Margins>
	) : isLoading ? (
		<Loader />
	) : (
		<WorkspaceReadyPage
			workspace={workspace}
			template={template}
			permissions={permissions}
		/>
	);
};

export default WorkspacePage;
