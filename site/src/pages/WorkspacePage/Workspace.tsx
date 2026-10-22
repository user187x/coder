import { useRef } from "react";
import type * as TypesGen from "#/api/typesGenerated";
import { isEmbeddedFrame } from "#/contexts/platformBoot";
import { useSearchParamsKey } from "#/hooks/useSearchParamsKey";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { LockdownBanner } from "#/modules/platform/lockdown/Lockdown";
import { useReportEmbeddedSize } from "#/modules/platform/workspaceGrid/embeddedSize";
import { WorkspaceNav } from "#/modules/platform/workspaceNav/WorkspaceNav";
import { WorkspaceNotesButton } from "#/modules/platform/workspaceNotes/WorkspaceNotesButton";
import { ProvisionerStatusAlert } from "#/modules/provisioners/ProvisionerStatusAlert";
import { AgentRow } from "#/modules/resources/AgentRow";
import { WorkspaceTimings } from "#/modules/workspaces/WorkspaceTiming/WorkspaceTimings";
import type { WorkspacePermissions } from "../../modules/workspaces/permissions";
import { HistorySidebar } from "./HistorySidebar";
import { ResourceMetadata } from "./ResourceMetadata";
import { ResourcesSidebar } from "./ResourcesSidebar";
import { resourceOptionValue, useResourcesNav } from "./useResourcesNav";
import { WorkspaceBuildFailedAlert } from "./WorkspaceBuildFailedAlert";
import { WorkspaceBuildLogsSection } from "./WorkspaceBuildLogsSection";
import {
	getActiveTransitionStats,
	WorkspaceBuildProgress,
} from "./WorkspaceBuildProgress";
import { WorkspaceDeletedBanner } from "./WorkspaceDeletedBanner";
import { WorkspaceTopbar } from "./WorkspaceTopbar";

type WorkspaceProps = {
	workspace: TypesGen.Workspace;
	template: TypesGen.Template;
	permissions: WorkspacePermissions;
	isUpdating: boolean;
	isRestarting: boolean;
	buildLogs?: TypesGen.ProvisionerJobLog[];
	latestVersion?: TypesGen.TemplateVersion;
	timings?: TypesGen.WorkspaceBuildTimings;
	sharingDisabled?: boolean;
	handleStart: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleStop: () => void;
	handleRestart: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleUpdate: () => void;
	handleCancel: () => void;
	handleDormantActivate: () => void;
	handleRetry: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleDebug: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
};

/**
 * Workspace is the top-level component for viewing an individual workspace
 */
export const Workspace: React.FC<WorkspaceProps> = ({
	workspace,
	isUpdating,
	isRestarting,
	template,
	buildLogs,
	latestVersion,
	permissions,
	timings,
	handleStart,
	handleStop,
	handleRestart,
	handleUpdate,
	handleCancel,
	handleDormantActivate,
	handleRetry,
	handleDebug,
}) => {
	const getLink = useLinks();
	// Platform: in the workspace grid's frame, the dashboard alone (no top bar, side bar or resource strip), its
	// size told to the grid, which fits it to its cell
	const embedded = isEmbeddedFrame();
	const dashboardRef = useRef<HTMLDivElement>(null);
	useReportEmbeddedSize(dashboardRef, embedded);
	const createWorkspaceLink = `${getLink(
		linkToTemplate(workspace.organization_name, workspace.template_name),
	)}/workspace`;
	const templateName =
		workspace.template_display_name || workspace.template_name;

	const transitionStats =
		template !== undefined
			? getActiveTransitionStats(template, workspace)
			: undefined;

	const sidebarOption = useSearchParamsKey({ key: "sidebar" });
	const setSidebarOption = (newOption: string) => {
		if (sidebarOption.value === newOption) {
			sidebarOption.deleteValue();
		} else {
			sidebarOption.setValue(newOption);
		}
	};

	const resources = [...workspace.latest_build.resources].sort(
		(a, b) => countAgents(b) - countAgents(a),
	);
	const visibleResources = resources.filter((r) => !r.hide);
	const resourcesNav = useResourcesNav(visibleResources);
	const selectedResource = resources.find(
		(r) => resourceOptionValue(r) === resourcesNav.value,
	);
	// If an agent has a `parent_id`, that means it is child of another agent. We
	// do not want these agents to be displayed at the top-level on this page. We
	// want them to display _as children_ of their parents.
	const topAgents =
		selectedResource?.agents?.filter((agent) => agent.parent_id === null) ?? [];
	// Platform: the Build timeline, the last agent card's footer - or, with no agent card, a card of its own.
	const buildTimeline = (footer: boolean) => (
		<WorkspaceTimings
			footer={footer}
			provisionerTimings={timings?.provisioner_timings}
			agentScriptTimings={timings?.agent_script_timings}
			agentConnectionTimings={timings?.agent_connection_timings}
		/>
	);

	const workspaceRunning = workspace.latest_build.status === "running";
	const workspacePending = workspace.latest_build.status === "pending";
	const haveBuildLogs = (buildLogs ?? []).length > 0;
	const shouldShowBuildLogs = haveBuildLogs && !workspaceRunning;
	const provisionersHealthy =
		(workspace.latest_build.matched_provisioners?.available ?? 1) > 0;
	const shouldShowProvisionerAlert =
		workspacePending && !haveBuildLogs && !provisionersHealthy && !isRestarting;

	const dashboard = (
		<div className="flex flex-col gap-6 max-w-[1200px] m-auto">
			{/* Platform: the notice while an admin has the workspace locked down */}
			<LockdownBanner workspace={workspace} />
			{workspace.latest_build.status === "deleted" && (
				<WorkspaceDeletedBanner
					createWorkspaceLink={createWorkspaceLink}
					templateName={templateName}
				/>
			)}

			{shouldShowProvisionerAlert && (
				<ProvisionerStatusAlert
					matchingProvisioners={
						workspace.latest_build.matched_provisioners?.count
					}
					availableProvisioners={
						workspace.latest_build.matched_provisioners?.available ?? 0
					}
					tags={workspace.latest_build.job.tags}
				/>
			)}

			{workspace.latest_build.job.error && (
				<WorkspaceBuildFailedAlert build={workspace.latest_build} />
			)}

			{transitionStats !== undefined && (
				<WorkspaceBuildProgress
					workspace={workspace}
					transitionStats={transitionStats}
				/>
			)}

			{shouldShowBuildLogs && <WorkspaceBuildLogsSection logs={buildLogs} />}

			{selectedResource && (
				<section className="flex flex-col gap-6 grow min-w-0">
					{topAgents.map((agent, i) => (
						<AgentRow
							key={agent.id}
							agent={agent}
							subAgents={selectedResource.agents?.filter(
								(a) => a.parent_id === agent.id,
							)}
							workspace={workspace}
							template={template}
							onUpdateAgent={handleUpdate} // On updating the workspace the agent version is also updated
							// Platform: the Build timeline is the last card's footer, under its last panel
							footer={
								i === topAgents.length - 1 ? buildTimeline(true) : undefined
							}
						/>
					))}

					{(!selectedResource.agents ||
						selectedResource.agents?.length === 0) && (
						<div className="flex justify-center items-center w-full h-full">
							<div>
								<h4 className="text-base font-medium">
									No agents are currently assigned to this resource.
								</h4>
							</div>
						</div>
					)}
				</section>
			)}

			{topAgents.length === 0 && buildTimeline(false)}
		</div>
	);

	if (embedded) {
		return (
			<div
				ref={dashboardRef}
				data-testid="workspace-dashboard-only"
				className="p-3"
			>
				{/* the grid fits it whole: never a scrollbar, even while it grows (before the grid has fitted it) */}
				<style>
					{
						"html{scrollbar-width:none;overflow:hidden}html::-webkit-scrollbar{display:none}"
					}
				</style>
				{dashboard}
			</div>
		);
	}

	return (
		<div className="flex flex-col flex-1 min-h-0">
			{/* Platform: no left sidebar - its Resources and History open from the top pill (WorkspaceNav), which floats
			    over the dashboard as wide as it, staying in view as the dashboard scrolls */}
			<div className="relative flex-1 min-h-0 w-full overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,hsl(var(--content-disabled))_0,transparent_1px)] bg-position-[-2px_-2px] bg-size-[16px_16px] p-4 pt-3 md:p-8 md:pt-4">
				<div className="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-surface-primary to-transparent"></div>

				<div className="relative z-10">
					<WorkspaceTopbar
						workspace={workspace}
						template={template}
						permissions={permissions}
						latestVersion={latestVersion}
						isUpdating={isUpdating}
						isRestarting={isRestarting}
						handleStart={handleStart}
						handleStop={handleStop}
						handleRestart={handleRestart}
						handleUpdate={handleUpdate}
						handleCancel={handleCancel}
						handleRetry={handleRetry}
						handleDebug={handleDebug}
						handleDormantActivate={handleDormantActivate}
						navigation={
							<WorkspaceNav
								value={sidebarOption.value}
								onToggle={setSidebarOption}
								onClose={sidebarOption.deleteValue}
								extra={<WorkspaceNotesButton workspace={workspace} />}
								panels={{
									resources: (
										<ResourcesSidebar
											failed={workspace.latest_build.status === "failed"}
											resources={resources}
											isSelected={resourcesNav.isSelected}
											onChange={(r) => {
												resourcesNav.select(r);
												sidebarOption.deleteValue();
											}}
										/>
									),
									history: <HistorySidebar workspace={workspace} />,
								}}
							/>
						}
					/>
					{selectedResource && (
						<ResourceMetadata
							resource={selectedResource}
							className="mb-6 overflow-hidden rounded-2xl"
						/>
					)}
					{dashboard}
				</div>
			</div>
		</div>
	);
};

const countAgents = (resource: TypesGen.WorkspaceResource) => {
	return resource.agents ? resource.agents.length : 0;
};
