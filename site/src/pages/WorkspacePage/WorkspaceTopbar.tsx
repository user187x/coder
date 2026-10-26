import { cn } from "cn";
import {
	ChevronLeftIcon,
	CircleDollarSignIcon,
	ShieldBanIcon,
	TrashIcon,
} from "lucide-react";
import { useQuery } from "react-query";
import { Link as RouterLink } from "react-router";
import { workspaceQuota } from "#/api/queries/workspaceQuota";
import type * as TypesGen from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import {
	Topbar,
	TopbarAvatar,
	TopbarData,
	TopbarDivider,
	TopbarIcon,
	TopbarIconButton,
} from "#/components/FullPageLayout/Topbar";
import {
	HelpPopover,
	HelpPopoverContent,
	HelpPopoverTrigger,
} from "#/components/HelpPopover/HelpPopover";
import { Link } from "#/components/Link/Link";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/Tooltip/Tooltip";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import { LockdownBadge } from "#/modules/platform/lockdown/Lockdown";
import { useWorkspaceRestricted } from "#/modules/platform/quarantine/WorkspaceRestriction";
import { useWorkspaceIcon } from "#/modules/workspaces/WorkspaceIcon/useWorkspaceIcon";
import { WorkspaceStatusIndicator } from "#/modules/workspaces/WorkspaceStatusIndicator/WorkspaceStatusIndicator";
import { displayDormantDeletion } from "#/utils/dormant";
import { formatDate } from "#/utils/time";
import type { WorkspacePermissions } from "../../modules/workspaces/permissions";
import { WorkspaceActions } from "./WorkspaceActions/WorkspaceActions";
import { WorkspaceNotifications } from "./WorkspaceNotifications/WorkspaceNotifications";
import { WorkspaceScheduleControls } from "./WorkspaceScheduleControls";

import "#/modules/workspaces/workspaceBarberPole.css";

const BREADCRUMB_SEGMENT_CLASS = cn(
	"flex items-center flex-row flex-nowrap gap-2",
	"max-w-40 whitespace-nowrap cursor-default",
);
const BREADCRUMB_TEXT_CLASS = "overflow-x-hidden text-ellipsis";

type WorkspaceTopbarProps = {
	isUpdating: boolean;
	isRestarting: boolean;
	workspace: TypesGen.Workspace;
	template: TypesGen.Template;
	permissions: WorkspacePermissions;
	latestVersion?: TypesGen.TemplateVersion;
	handleStart: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleStop: () => void;
	handleRestart: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleUpdate: () => void;
	handleCancel: () => void;
	handleDormantActivate: () => void;
	handleRetry: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	handleDebug: (buildParameters?: TypesGen.WorkspaceBuildParameter[]) => void;
	/** Platform: the page's Resources / History toggles (the former left sidebar), at the pill's start. */
	navigation?: React.ReactNode;
};

export const WorkspaceTopbar: React.FC<WorkspaceTopbarProps> = ({
	workspace,
	template,
	latestVersion,
	permissions,
	isUpdating,
	isRestarting,
	handleStart,
	handleStop,
	handleRestart,
	handleUpdate,
	handleCancel,
	handleDormantActivate,
	handleRetry,
	handleDebug,
	navigation,
}) => {
	const restricted = useWorkspaceRestricted(workspace);
	const workspaceIcon = useWorkspaceIcon(workspace);
	const { entitlements, organizations, showOrganizations } = useDashboard();
	const getLink = useLinks();

	// Quota
	const hasDailyCost = workspace.latest_build.daily_cost > 0;
	const { data: quota } = useQuery({
		...workspaceQuota(workspace.organization_name, workspace.owner_name),

		// Don't need to tie the enabled condition to showOrganizations because
		// even if the customer hasn't enabled the orgs enterprise feature, all
		// workspaces have an associated organization under the hood
		enabled: hasDailyCost,
	});

	// Dormant
	const allowAdvancedScheduling =
		entitlements.features.advanced_template_scheduling.enabled;
	// This check can be removed when https://github.com/coder/coder/milestone/19
	// is merged up
	const shouldDisplayDormantData = displayDormantDeletion(
		workspace,
		allowAdvancedScheduling,
	);

	const activeOrg = organizations.find(
		(org) => org.id === workspace.organization_id,
	);

	const orgDisplayName = activeOrg?.display_name || workspace.organization_name;

	const isImmutable =
		workspace.latest_build.status === "deleted" ||
		workspace.latest_build.status === "deleting";

	const templateLink = getLink(
		linkToTemplate(workspace.organization_name, workspace.template_name),
	);

	const buildStatus = workspace.latest_build.status;
	const transitioning =
		(["pending", "starting", "stopping", "canceling"].includes(buildStatus) &&
			workspace.latest_build.transition !== "delete") ||
		((isRestarting || isUpdating) &&
			["running", "stopped"].includes(buildStatus));

	return (
		// Platform: a floating bar - a smoothly rounded rectangle, the main dashboards' cards' 18px - as wide as the
		// dashboard under it, all its parts kept; it stays in view as the dashboard scrolls (sticky), and the Resources /
		// History lists drop from it
		<Topbar
			className={cn(
				"[grid-area:topbar] sticky top-0 z-30 mx-auto mb-4 max-w-[1200px] md:mb-6 flex-wrap gap-y-2 rounded-[18px] border border-solid border-border bg-surface-primary/85 px-2 shadow-lg backdrop-blur-md",
				transitioning && !restricted && "workspace-barber-pole",
				restricted && "workspace-restricted-pole",
			)}
			data-testid="workspace-topbar"
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<TopbarIconButton asChild>
						<RouterLink to="/workspaces" aria-label="Back to workspaces">
							<ChevronLeftIcon className="size-icon-sm" />
						</RouterLink>
					</TopbarIconButton>
				</TooltipTrigger>
				<TooltipContent side="bottom">Back to workspaces</TooltipContent>
			</Tooltip>

			{navigation}

			<div className="flex items-center gap-y-6 gap-x-2 flex-wrap px-3 py-2 mr-auto">
				<TopbarData className="flex-wrap">
					<OwnerBreadcrumb
						ownerName={workspace.owner_name}
						ownerAvatarUrl={workspace.owner_avatar_url}
					/>

					{showOrganizations && (
						<>
							<TopbarDivider />
							<OrganizationBreadcrumb
								orgName={orgDisplayName}
								orgIconUrl={activeOrg?.icon}
								orgPageUrl={`/organizations/${encodeURIComponent(workspace.organization_name)}`}
							/>
						</>
					)}

					<TopbarDivider />

					<WorkspaceBreadcrumb
						workspaceName={workspace.name}
						workspaceIconUrl={workspaceIcon}
						templateIconUrl={workspace.template_icon}
						rootTemplateUrl={templateLink}
						templateVersionName={workspace.latest_build.template_version_name}
						templateDisplayName={
							workspace.template_display_name || workspace.template_name
						}
						latestBuildVersionName={
							workspace.latest_build.template_version_name
						}
					/>
				</TopbarData>

				{quota && quota.budget > 0 && (
					<RouterLink
						to={
							showOrganizations
								? `/workspaces?filter=organization:${encodeURIComponent(workspace.organization_name)}`
								: "/workspaces"
						}
						title={
							showOrganizations
								? `See affected workspaces for ${orgDisplayName}`
								: "See affected workspaces"
						}
						className="text-inherit no-underline"
					>
						<TopbarData>
							<TopbarIcon>
								<CircleDollarSignIcon
									className="size-icon-sm"
									aria-label="Daily usage"
								/>
							</TopbarIcon>

							<span>
								{workspace.latest_build.daily_cost}{" "}
								<span className="text-content-secondary">credits of</span>{" "}
								{quota.budget}
							</span>
						</TopbarData>
					</RouterLink>
				)}

				{shouldDisplayDormantData && (
					<TopbarData>
						<TopbarIcon>
							<TrashIcon />
						</TopbarIcon>
						<RouterLink
							to={`${templateLink}/settings/schedule`}
							title="Schedule settings"
							className="text-inherit no-underline"
						>
							{workspace.deleting_at ? (
								<>Deletion on {formatDate(new Date(workspace.deleting_at))}</>
							) : (
								"Deletion soon"
							)}
						</RouterLink>
					</TopbarData>
				)}
			</div>

			{!isImmutable && (
				<div className="flex flex-wrap grow items-center justify-end gap-x-4 gap-y-2 min-h-12">
					<WorkspaceScheduleControls
						workspace={workspace}
						template={template}
						canUpdateSchedule={permissions.updateWorkspace}
					/>

					<WorkspaceNotifications
						workspace={workspace}
						template={template}
						latestVersion={latestVersion}
						permissions={permissions}
						onRestartWorkspace={handleRestart}
						onUpdateWorkspace={handleUpdate}
						onActivateWorkspace={handleDormantActivate}
					/>

					{/* Platform: an animated light while it runs. */}
					{restricted ? (
						<>
							<span
								role="status"
								className="inline-flex items-center gap-1.5 rounded-full border border-solid border-content-warning/40 bg-surface-primary px-2 py-1 text-xs text-content-warning"
							>
								<ShieldBanIcon className="size-3.5" aria-hidden />
								Access locked
							</span>
							<LockdownBadge workspace={workspace} goldIcon />
						</>
					) : (
						<WorkspaceStatusIndicator
							workspace={workspace}
							runningLight
							className="workspace-topbar-running-status gap-1.5 rounded-full border border-solid border-current/20 bg-surface-secondary px-2 py-1 text-xs"
						/>
					)}

					<WorkspaceActions
						workspace={workspace}
						permissions={permissions}
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
					/>
				</div>
			)}
		</Topbar>
	);
};

type OwnerBreadcrumbProps = Readonly<{
	ownerName: string;
	ownerAvatarUrl: string;
}>;

const OwnerBreadcrumb: React.FC<OwnerBreadcrumbProps> = ({
	ownerName,
	ownerAvatarUrl,
}) => {
	return (
		<HelpPopover>
			<HelpPopoverTrigger asChild>
				<span className={BREADCRUMB_SEGMENT_CLASS}>
					<Avatar size="sm" fallback={ownerName} src={ownerAvatarUrl} />
					<span className={BREADCRUMB_TEXT_CLASS}>{ownerName}</span>
				</span>
			</HelpPopoverTrigger>

			<HelpPopoverContent align="center">
				<AvatarData title={ownerName} subtitle="Owner" src={ownerAvatarUrl} />
			</HelpPopoverContent>
		</HelpPopover>
	);
};

type OrganizationBreadcrumbProps = Readonly<{
	orgName: string;
	orgPageUrl?: string;
	orgIconUrl?: string;
}>;

const OrganizationBreadcrumb: React.FC<OrganizationBreadcrumbProps> = ({
	orgName,
	orgPageUrl,
	orgIconUrl,
}) => {
	return (
		<HelpPopover>
			<HelpPopoverTrigger asChild>
				<span className={BREADCRUMB_SEGMENT_CLASS}>
					<Avatar
						size="sm"
						variant="icon"
						src={orgIconUrl}
						fallback={orgName}
					/>
					<span className={BREADCRUMB_TEXT_CLASS}>{orgName}</span>
				</span>
			</HelpPopoverTrigger>

			<HelpPopoverContent align="center">
				<AvatarData
					title={
						orgPageUrl ? (
							<Link asChild showExternalIcon={false} className="text-inherit">
								<RouterLink to={orgPageUrl}>{orgName}</RouterLink>
							</Link>
						) : (
							orgName
						)
					}
					subtitle="Organization"
					avatar={
						orgIconUrl && (
							<Avatar
								variant="icon"
								src={orgIconUrl}
								fallback={orgName}
								size="md"
							/>
						)
					}
					imgFallbackText={orgName}
				/>
			</HelpPopoverContent>
		</HelpPopover>
	);
};

type WorkspaceBreadcrumbProps = Readonly<{
	workspaceName: string;
	/** Its own icon (Settings), else the template's. */
	workspaceIconUrl: string;
	templateIconUrl: string;
	rootTemplateUrl: string;
	templateVersionName: string;
	latestBuildVersionName: string;
	templateDisplayName: string;
}>;

const WorkspaceBreadcrumb: React.FC<WorkspaceBreadcrumbProps> = ({
	workspaceName,
	workspaceIconUrl,
	templateIconUrl,
	rootTemplateUrl,
	templateVersionName,
	latestBuildVersionName,
	templateDisplayName,
}) => {
	return (
		<div className="flex items-center">
			<HelpPopover>
				<HelpPopoverTrigger asChild>
					<span className={BREADCRUMB_SEGMENT_CLASS}>
						<TopbarAvatar
							src={workspaceIconUrl}
							fallback={templateDisplayName}
						/>

						<span className={cn(BREADCRUMB_TEXT_CLASS, "font-medium")}>
							{workspaceName}
						</span>
					</span>
				</HelpPopoverTrigger>

				<HelpPopoverContent align="center">
					<AvatarData
						title={
							<Link asChild showExternalIcon={false} className="text-inherit">
								<RouterLink to={rootTemplateUrl}>
									{templateDisplayName}
								</RouterLink>
							</Link>
						}
						subtitle={
							<Link asChild showExternalIcon={false} className="text-inherit">
								<RouterLink
									to={`${rootTemplateUrl}/versions/${encodeURIComponent(templateVersionName)}`}
								>
									Version: {latestBuildVersionName}
								</RouterLink>
							</Link>
						}
						avatar={
							<Avatar
								variant="icon"
								src={templateIconUrl}
								fallback={templateDisplayName}
								size="md"
							/>
						}
						imgFallbackText={templateDisplayName}
					/>
				</HelpPopoverContent>
			</HelpPopover>
			<CopyButton text={workspaceName} label="Copy workspace name" />
		</div>
	);
};
