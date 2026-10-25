import { cn } from "cn";
import {
	BanIcon,
	CircleAlertIcon,
	EllipsisVerticalIcon,
	ExternalLinkIcon,
	FileIcon,
	PlayIcon,
	RefreshCcwIcon,
	RotateCcwIcon,
	SquareTerminalIcon,
} from "lucide-react";
import type React from "react";
import { createContext, useContext, useState } from "react";
import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "react-query";
import { Link, useNavigate } from "react-router";
import { API } from "#/api/api";
import { templateVersion } from "#/api/queries/templates";
import {
	cancelBuild,
	deleteWorkspace,
	setOptimisticWorkspaceListBuildStatus,
	startWorkspace,
	stopWorkspace,
} from "#/api/queries/workspaces";
import type {
	Template,
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "#/api/typesGenerated";
import { Avatar } from "#/components/Avatar/Avatar";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { AvatarDataSkeleton } from "#/components/Avatar/AvatarDataSkeleton";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import {
	TableLoaderSkeleton,
	TableRowSkeleton,
} from "#/components/TableLoader/TableLoader";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import {
	getTerminalHref,
	getVSCodeHref,
	isAppUrlValid,
	openAppInNewWindow,
} from "#/modules/apps/apps";
import { useAppLink } from "#/modules/apps/useAppLink";
import { findWorkspaceAppWithAgent } from "#/modules/apps/workspaceApps";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { CloudDriveAttachBadge } from "#/modules/platform/cloudDrive/CloudDriveAttachBadge";
import { CloudDriveLockBadge } from "#/modules/platform/cloudDrive/CloudDriveLockBadge";
import {
	CloudDriveSocket,
	useCloudDriveLinks,
} from "#/modules/platform/cloudDrive/CloudDriveSocket";
import {
	LockdownBadge,
	useAllLockdowns,
} from "#/modules/platform/lockdown/Lockdown";
import { AppsCarousel } from "#/modules/platform/workspaceApps/AppsCarousel";
import { agentAppsReady } from "#/modules/platform/workspaceInitializing/workspaceReadiness";
import { abilitiesByWorkspaceStatus } from "#/modules/workspaces/actions";
import { WorkspaceBuildCancelDialog } from "#/modules/workspaces/WorkspaceBuildCancelDialog/WorkspaceBuildCancelDialog";
import { useWorkspaceIcons } from "#/modules/workspaces/WorkspaceIcon/useWorkspaceIcon";
import { WorkspaceMoreActions } from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceMoreActions";
import { WorkspaceOutdatedTooltip } from "#/modules/workspaces/WorkspaceOutdatedTooltip/WorkspaceOutdatedTooltip";
import { WorkspaceStatus } from "#/modules/workspaces/WorkspaceStatus/WorkspaceStatus";
import {
	useWorkspaceUpdate,
	WorkspaceUpdateDialogs,
} from "#/modules/workspaces/WorkspaceUpdateDialogs";
import {
	getDisplayWorkspaceTemplateName,
	workspaceAgentNeedsUpdate,
} from "#/utils/workspace";
import {
	isDeleting,
	isStartingUp,
	markRestarting,
	useRestarting,
} from "./startingRows";
import { WorkspaceSharingIndicator } from "./WorkspaceSharingIndicator";
import { WorkspacesEmpty } from "./WorkspacesEmpty";
import "./startingRows.css";
import "./workspacesTable.css";
import "#/modules/platform/workspaceUpdate/updatePulse.css";
import { WorkspaceResources } from "#/modules/platform/workspaceResources/WorkspaceResources";
import { WorkspaceTunnelStatus } from "#/modules/platform/workspaceTunnels/WorkspaceTableTunnels";

type WorkspacesTableProps = {
	workspaces?: readonly Workspace[];
	checkedWorkspaces: readonly Workspace[];
	error?: unknown;
	isUsingFilter: boolean;
	onClearFilter: () => void;
	onCheckChange: (checkedWorkspaces: readonly Workspace[]) => void;
	templates?: Template[];
	canCreateTemplate: boolean;
	canCreateWorkspace: boolean;
	onActionSuccess: () => Promise<void>;
	onActionError: (error: unknown) => void;
};

export const WorkspacesTable: React.FC<WorkspacesTableProps> = ({
	workspaces,
	checkedWorkspaces,
	isUsingFilter,
	onClearFilter,
	onCheckChange,
	templates,
	canCreateTemplate,
	canCreateWorkspace,
	onActionSuccess,
	onActionError,
}) => {
	const { data: icons } = useWorkspaceIcons();
	const dashboard = useDashboard();
	const { user: me } = useAuthenticated();
	const isLoading = !workspaces;
	const isEmpty = workspaces && workspaces.length === 0;
	const hideHeaders = isLoading || isEmpty;
	// Platform: admins' Lock Down badges, in a column of their own before Name (no heading).
	const locks = useAllLockdowns();
	// Platform: the Cloud Drive's socket on each row, its own column at the end (none without a Cloud Drive).
	const drive = useCloudDriveLinks();

	const table = (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-0 pr-0">
						{isLoading ? (
							<Skeleton className="size-4" />
						) : (
							<Checkbox
								className={cn("my-0", isEmpty && "invisible")}
								disabled={isEmpty}
								checked={
									!isEmpty && checkedWorkspaces.length === workspaces.length
								}
								onCheckedChange={(checked) => {
									if (!checked) {
										onCheckChange([]);
									} else {
										onCheckChange(workspaces);
									}
								}}
								aria-label="Select all workspaces"
							/>
						)}
					</TableHead>
					{locks.isSuccess && (
						<TableHead className="w-0 px-1">
							<span className="sr-only">Lock Down</span>
						</TableHead>
					)}
					{/* Platform: as wide as the names, the Resources right beside them */}
					<TableHead
						className={cn("w-0 whitespace-nowrap", hideHeaders && "invisible")}
					>
						Name
					</TableHead>
					{/* Platform: CPU and RAM as live graphs, the disk used of what it was given */}
					<TableHead
						className={cn("w-0 px-6 text-center", hideHeaders && "invisible")}
					>
						Resources
					</TableHead>
					<TableHead
						className={cn("w-[18%] text-center", hideHeaders && "invisible")}
					>
						Template
					</TableHead>
					<TableHead
						className={cn("w-[14%] text-center", hideHeaders && "invisible")}
					>
						Status
					</TableHead>
					<TableHead
						className={cn("w-0 text-center", hideHeaders && "invisible")}
					>
						Apps
					</TableHead>
					<TableHead
						className={cn("w-0 text-center", hideHeaders && "invisible")}
					>
						Controls
					</TableHead>
					{drive.enabled && (
						<TableHead
							className={cn("w-0 text-center", hideHeaders && "invisible")}
						>
							Drive
						</TableHead>
					)}
				</TableRow>
			</TableHeader>
			<TableBody className="[&_td]:h-[78px]">
				{isLoading && <TableLoader />}
				{isEmpty && (
					<TableRow>
						<TableCell colSpan={999}>
							<WorkspacesEmpty
								templates={templates}
								isUsingFilter={isUsingFilter}
								onClearFilter={onClearFilter}
								canCreateTemplate={canCreateTemplate}
								canCreateWorkspace={canCreateWorkspace}
							/>
						</TableCell>
					</TableRow>
				)}
				{workspaces?.map((workspace) => {
					const checked = checkedWorkspaces.some((w) => w.id === workspace.id);
					const activeOrg = dashboard.organizations.find(
						(o) => o.id === workspace.organization_id,
					);
					const workspacePageLink = `/@${workspace.owner_name}/${workspace.name}`;
					const templateName = getDisplayWorkspaceTemplateName(workspace);
					const agentUpdateAvailable = workspace.latest_build.resources.some(
						(resource) =>
							resource.agents?.some((agent) =>
								workspaceAgentNeedsUpdate(
									agent,
									dashboard.buildInfo.version,
									dashboard.buildInfo.agent_api_version,
								),
							),
					);

					return (
						<WorkspacesRow
							workspace={workspace}
							workspacePageLink={workspacePageLink}
							key={workspace.id}
							checked={checked}
						>
							<TableCell className="pr-0">
								<Checkbox
									data-testid={`checkbox-${workspace.id}`}
									disabled={cantBeChecked(workspace)}
									checked={checked}
									onClick={(e) => {
										e.stopPropagation();
									}}
									onCheckedChange={(checked) => {
										if (checked) {
											onCheckChange([...checkedWorkspaces, workspace]);
										} else {
											onCheckChange(
												checkedWorkspaces.filter((w) => w.id !== workspace.id),
											);
										}
									}}
									aria-label={`Select workspace ${workspace.name}`}
								/>
							</TableCell>

							{locks.isSuccess && (
								<TableCell className="w-0 px-1">
									<LockdownBadge
										goldIcon
										workspace={workspace}
										modes={locks.data.workspaces[workspace.id]?.modes ?? []}
										className="h-8 min-w-8 justify-center"
									/>
								</TableCell>
							)}

							<TableCell>
								<AvatarData
									title={
										<div className="flex items-center gap-1">
											<Link
												to={workspacePageLink}
												className="whitespace-nowrap select-none"
											>
												{workspace.name}
											</Link>
											{workspace.outdated && (
												<WorkspaceOutdatedTooltip workspace={workspace} />
											)}
										</div>
									}
									subtitle={
										<div className="flex items-center gap-1">
											<span className="sr-only">Owner: </span>
											<div className="flex gap-2">
												{workspace.owner_name}
												{workspace.shared_with &&
													workspace.shared_with.length > 0 && (
														<WorkspaceSharingIndicator
															sharedWith={workspace.shared_with}
															settingsPath={`/@${workspace.owner_name}/${workspace.name}/settings/sharing`}
														/>
													)}
											</div>
										</div>
									}
									avatar={
										<Avatar
											src={workspace.owner_avatar_url}
											fallback={workspace.owner_name}
											size="lg"
											className="rounded-[10px]"
										/>
									}
								/>
							</TableCell>

							<TableCell className="px-6">
								<WorkspaceResources workspace={workspace} />
							</TableCell>

							<TableCell className="text-center">
								{/* Platform: the template as a pill, its icon in a tile */}
								<div className="flex flex-col items-center gap-1">
									<span
										className="inline-flex max-w-56 items-center gap-2 rounded-[10px] border border-solid border-border bg-surface-primary py-1 pl-1 pr-2.5"
										data-hint={`Made from the ${templateName} template`}
									>
										{/* Platform: a lock over it while its Cloud Drive is encrypted. */}
										<CloudDriveLockBadge
											workspaceId={workspace.id}
											ownerId={workspace.owner_id}
										>
											<Avatar
												variant="icon"
												src={icons?.[workspace.id] || workspace.template_icon}
												fallback={templateName}
												size="md"
												className="rounded-[7px]"
											/>
										</CloudDriveLockBadge>
										<span className="truncate text-[13px] font-semibold text-content-primary">
											{templateName}
										</span>
									</span>
									{dashboard.showOrganizations && (
										<span className="pl-1 text-xs text-content-secondary">
											<span className="sr-only">Organization:</span>{" "}
											{activeOrg?.display_name || workspace.organization_name}
										</span>
									)}
								</div>
							</TableCell>

							<TableCell className="text-center">
								{/* Platform: an orange cloud beside Running until its Cloud Drive is attached */}
								<WorkspaceRowStatus
									workspace={workspace}
									agentUpdateAvailable={agentUpdateAvailable}
									pill
									after={<CloudDriveAttachBadge workspace={workspace} />}
								/>
								<WorkspaceTunnelStatus workspaceId={workspace.id} />
							</TableCell>

							<WorkspaceActionsCell
								workspace={workspace}
								agentUpdateAvailable={agentUpdateAvailable}
								onActionSuccess={onActionSuccess}
								onActionError={onActionError}
							/>

							{drive.enabled && (
								<TableCell
									className="text-center"
									onClick={(e) => e.stopPropagation()}
								>
									<CloudDriveSocket
										workspace={workspace}
										links={drive}
										mine={workspace.owner_id === me.id}
									/>
								</TableCell>
							)}
						</WorkspacesRow>
					);
				})}
			</TableBody>
		</Table>
	);
	return table;
};

const RestartDialogContext = createContext({
	open: false,
	setOpen: (_open: boolean) => {},
	canRestart: false,
});

const WorkspaceRowStatus: React.FC<
	React.ComponentProps<typeof WorkspaceStatus>
> = (props) => {
	const restart = useContext(RestartDialogContext);
	return (
		<WorkspaceStatus
			{...props}
			onUpdate={() => restart.setOpen(true)}
			updateDisabled={!restart.canRestart}
		/>
	);
};

type WorkspacesRowProps = {
	workspace: Workspace;
	workspacePageLink: string;
	children?: React.ReactNode;
	checked: boolean;
};

const WorkspacesRow: React.FC<WorkspacesRowProps> = ({
	workspace,
	workspacePageLink,
	children,
	checked,
}) => {
	const navigate = useNavigate();
	const [restartOpen, setRestartOpen] = useState(false);
	const restartBusy = useIsMutating({
		predicate: (mutation) =>
			mutation.options.meta?.workspaceId === workspace.id,
	});
	const { user } = useAuthenticated();
	const abilities = abilitiesByWorkspaceStatus(workspace, {
		canDebug: false,
		isOwner: user.roles.some((role) => role.name === "owner"),
	});

	const openLinkInNewTab = () => window.open(workspacePageLink, "_blank");
	const { role, hover, ...clickableProps } = useClickableTableRow({
		onMiddleClick: openLinkInNewTab,
		onClick: (event) => {
			// Order of booleans actually matters here for Windows-Mac compatibility;
			// meta key is Cmd on Macs, but on Windows, it's either the Windows key,
			// or the key does nothing at all (depends on the browser)
			const shouldOpenInNewTab =
				event.shiftKey || event.metaKey || event.ctrlKey;

			if (shouldOpenInNewTab) {
				openLinkInNewTab();
			} else {
				navigate(workspacePageLink);
			}
		},
	});

	// Started, updated or restarted: a barber pole across the row until it is up or failed (startingRows.ts).
	const starting = isStartingUp(workspace, useRestarting(workspace.id));
	// Being deleted: a shine sweeps across the row until it is gone.
	const deleting = isDeleting(workspace);

	return (
		<RestartDialogContext.Provider
			value={{
				open: restartOpen,
				setOpen: setRestartOpen,
				canRestart:
					abilities.canAcceptJobs &&
					abilities.actions.some((action) =>
						[
							"restart",
							"updateAndRestart",
							"updateAndRestartRequireActiveVersion",
						].includes(action),
					) &&
					!starting &&
					!restartBusy,
			}}
		>
			<TableRow
				{...clickableProps}
				data-testid={`workspace-${workspace.id}`}
				data-workspace-tunnel-row={workspace.id}
				data-hint={`Open ${workspace.name} (a middle-click or Ctrl-click: in a new tab)`}
				data-starting={starting || undefined}
				data-deleting={deleting || undefined}
				aria-busy={starting || undefined}
				className={cn([
					checked
						? "bg-surface-secondary hover:bg-surface-secondary"
						: undefined,
					starting && "workspace-row-starting",
					deleting && "workspace-row-deleting",
					clickableProps.className,
				])}
			>
				{children}
			</TableRow>
		</RestartDialogContext.Provider>
	);
};

const TableLoader: React.FC = () => {
	return (
		<TableLoaderSkeleton>
			<TableRowSkeleton>
				<TableCell className="w-0 pr-0">
					<Checkbox disabled />
				</TableCell>
				<TableCell>
					<AvatarDataSkeleton />
				</TableCell>
				<TableCell>
					<Skeleton className="h-[38px] w-[200px] rounded-md" />
				</TableCell>
				<TableCell>
					<AvatarDataSkeleton />
				</TableCell>
				<TableCell>
					<Skeleton className="mx-auto h-6 w-24 rounded-full" />
				</TableCell>
				<TableCell>
					<Skeleton className="h-12 w-[200px] rounded-[14px]" />
				</TableCell>
				<TableCell className="w-0">
					<div className="flex gap-1 justify-center">
						<Skeleton className="size-9 rounded-[10px]" />
						<Button size="icon-lg" variant="subtle" disabled>
							<EllipsisVerticalIcon aria-hidden="true" />
						</Button>
					</div>
				</TableCell>
			</TableRowSkeleton>
		</TableLoaderSkeleton>
	);
};

const cantBeChecked = (workspace: Workspace) => {
	return ["deleting", "pending"].includes(workspace.latest_build.status);
};

type WorkspaceActionsCellProps = {
	workspace: Workspace;
	agentUpdateAvailable: boolean;
	onActionSuccess: () => Promise<void>;
	onActionError: (error: unknown) => void;
};

const WorkspaceActionsCell: React.FC<WorkspaceActionsCellProps> = ({
	workspace,
	agentUpdateAvailable,
	onActionSuccess,
	onActionError,
}) => {
	const { user } = useAuthenticated();

	const queryClient = useQueryClient();
	const abilities = abilitiesByWorkspaceStatus(workspace, {
		canDebug: false,
		isOwner: user.roles.find((role) => role.name === "owner") !== undefined,
	});

	const startWorkspaceOptions = startWorkspace(workspace, queryClient);
	const startWorkspaceMutation = useMutation({
		...startWorkspaceOptions,
		onSuccess: async (build) => {
			startWorkspaceOptions.onSuccess(build);
			await onActionSuccess();
		},
		onError: onActionError,
	});

	const stopWorkspaceOptions = stopWorkspace(workspace, queryClient);
	const stopWorkspaceMutation = useMutation({
		...stopWorkspaceOptions,
		onSuccess: async (build) => {
			stopWorkspaceOptions.onSuccess(build);
			await onActionSuccess();
		},
		onError: onActionError,
	});

	const restartWorkspaceMutation = useMutation({
		mutationFn: API.restartWorkspace,
		meta: { workspaceId: workspace.id },
		// restartWorkspace resolves only after the full stop/start sequence and
		// the list has no live updates, so optimistically show the row as
		// stopping. This reflects the restart immediately and flips the list to
		// its fast poll interval, which then tracks the real build statuses.
		onMutate: async () => {
			markRestarting(workspace.id, true);
			await queryClient.cancelQueries({
				queryKey: ["workspaces"],
			});
			return {
				rollback: setOptimisticWorkspaceListBuildStatus(
					queryClient,
					workspace.id,
					"stopping",
					"stop",
				),
			};
		},
		onSuccess: async () => {
			await onActionSuccess();
		},
		onError: (error, _variables, context) => {
			context?.rollback?.();
			onActionError(error);
		},
		onSettled: () => markRestarting(workspace.id, false),
	});

	const cancelJobOptions = cancelBuild(workspace, queryClient);
	const cancelBuildMutation = useMutation({
		...cancelJobOptions,
		onSuccess: async () => {
			cancelJobOptions.onSuccess();
			await onActionSuccess();
		},
		onError: onActionError,
	});

	const { data: latestVersion } = useQuery({
		...templateVersion(workspace.template_active_version_id),
		enabled: workspace.outdated,
	});
	const workspaceUpdate = useWorkspaceUpdate({
		workspace,
		latestVersion,
		onSuccess: onActionSuccess,
		onError: onActionError,
	});

	const deleteWorkspaceOptions = deleteWorkspace(workspace, queryClient);
	const deleteWorkspaceMutation = useMutation({
		...deleteWorkspaceOptions,
		onSuccess: async (build) => {
			deleteWorkspaceOptions.onSuccess(build);
			await onActionSuccess();
		},
		onError: onActionError,
	});

	const [isStopConfirmOpen, setIsStopConfirmOpen] = useState(false);
	const { open: isRestartConfirmOpen, setOpen: setIsRestartConfirmOpen } =
		useContext(RestartDialogContext);
	const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);

	const isRetrying =
		startWorkspaceMutation.isPending ||
		stopWorkspaceMutation.isPending ||
		deleteWorkspaceMutation.isPending;

	const retry = () => {
		switch (workspace.latest_build.transition) {
			case "start":
				startWorkspaceMutation.mutate({});
				break;
			case "stop":
				stopWorkspaceMutation.mutate({});
				break;
			case "delete":
				deleteWorkspaceMutation.mutate({});
				break;
		}
	};

	// Platform: the apps in a column of their own, the actions in Controls (the update and restart button never
	// among the apps)
	return (
		<>
			<TableCell
				className="w-0"
				onClick={(e) => {
					// Prevent the click in the apps to trigger the row click
					e.stopPropagation();
				}}
			>
				<div className="flex justify-center">
					{workspace.latest_build.status === "running" &&
						(workspace.latest_app_status ? (
							<WorkspaceAppStatusLinks workspace={workspace} />
						) : (
							<WorkspaceApps workspace={workspace} />
						))}
				</div>
			</TableCell>
			<TableCell
				className="w-0"
				onClick={(e) => {
					// Prevent the click in the actions to trigger the row click
					e.stopPropagation();
				}}
			>
				<div className="workspace-controls flex gap-1.5 justify-center">
					{abilities.actions.includes("start") && (
						<PrimaryAction
							onClick={() => startWorkspaceMutation.mutate({})}
							isLoading={startWorkspaceMutation.isPending}
							label="Start workspace"
						>
							<PlayIcon />
						</PrimaryAction>
					)}

					{abilities.actions.includes("updateAndStart") && (
						<>
							<PrimaryAction
								onClick={workspaceUpdate.update}
								isLoading={workspaceUpdate.isUpdating}
								label="Update and start workspace"
							>
								<RotateCcwIcon
									className="workspace-update-pulse"
									data-testid="workspace-update-pulse"
								/>
							</PrimaryAction>
							<WorkspaceUpdateDialogs {...workspaceUpdate.dialogProps} />
						</>
					)}

					{abilities.actions.includes("updateAndStartRequireActiveVersion") && (
						<>
							<PrimaryAction
								onClick={workspaceUpdate.update}
								isLoading={workspaceUpdate.isUpdating}
								label="This template requires automatic updates on workspace startup. Contact your administrator if you want to preserve the template version."
							>
								<PlayIcon />
							</PrimaryAction>
							<WorkspaceUpdateDialogs {...workspaceUpdate.dialogProps} />
						</>
					)}

					{abilities.actions.includes("updateAndRestart") && (
						<>
							<PrimaryAction
								onClick={workspaceUpdate.update}
								isLoading={workspaceUpdate.isUpdating}
								label="Update and restart workspace"
							>
								<RotateCcwIcon
									className="workspace-update-pulse"
									data-testid="workspace-update-pulse"
								/>
							</PrimaryAction>
							<WorkspaceUpdateDialogs {...workspaceUpdate.dialogProps} />
						</>
					)}

					{abilities.actions.includes(
						"updateAndRestartRequireActiveVersion",
					) && (
						<>
							<PrimaryAction
								onClick={workspaceUpdate.update}
								isLoading={workspaceUpdate.isUpdating}
								label="This template requires automatic updates on workspace restart. Contact your administrator if you want to preserve the template version."
							>
								<PlayIcon />
							</PrimaryAction>
							<WorkspaceUpdateDialogs {...workspaceUpdate.dialogProps} />
						</>
					)}

					{abilities.canCancel && (
						<PrimaryAction
							onClick={() => setIsCancelConfirmOpen(true)}
							isLoading={cancelBuildMutation.isPending}
							label="Cancel build"
						>
							<BanIcon />
						</PrimaryAction>
					)}

					{abilities.actions.includes("retry") && (
						<PrimaryAction
							onClick={retry}
							isLoading={isRetrying}
							label="Retry build"
						>
							<RefreshCcwIcon />
						</PrimaryAction>
					)}

					<WorkspaceMoreActions
						workspace={workspace}
						agentUpdateAvailable={agentUpdateAvailable}
						disabled={!abilities.canAcceptJobs}
						onStop={
							abilities.actions.includes("stop")
								? () => setIsStopConfirmOpen(true)
								: undefined
						}
						isStopping={stopWorkspaceMutation.isPending}
						onRestart={
							abilities.actions.includes("restart")
								? () => setIsRestartConfirmOpen(true)
								: undefined
						}
						isRestarting={restartWorkspaceMutation.isPending}
						onActionSuccess={onActionSuccess}
					/>
				</div>
				{/* Stop workspace confirmation dialog */}
				<ConfirmDialog
					open={isStopConfirmOpen}
					title="Stop workspace"
					description={`Are you sure you want to stop the workspace "${workspace.name}"? This will terminate all running processes and disconnect any active sessions.`}
					confirmText="Stop"
					onClose={() => setIsStopConfirmOpen(false)}
					onConfirm={() => {
						stopWorkspaceMutation.mutate({});
						setIsStopConfirmOpen(false);
					}}
					type="delete"
				/>

				{/* Restart workspace confirmation dialog */}
				<ConfirmDialog
					open={isRestartConfirmOpen}
					title={
						workspace.outdated
							? "Update and restart workspace"
							: "Restart workspace"
					}
					description={
						workspace.outdated
							? `Update "${workspace.name}" to the latest template version and restart it? This will stop all running processes and delete non-persistent data.`
							: `Are you sure you want to restart the workspace "${workspace.name}"? This will stop all running processes and delete non-persistent data.`
					}
					confirmText={workspace.outdated ? "Update and restart" : "Restart"}
					disabled={
						restartWorkspaceMutation.isPending ||
						workspaceUpdate.isUpdating ||
						!abilities.canAcceptJobs
					}
					onClose={() => setIsRestartConfirmOpen(false)}
					onConfirm={() => {
						if (
							restartWorkspaceMutation.isPending ||
							workspaceUpdate.isUpdating ||
							!abilities.canAcceptJobs
						)
							return;
						if (workspace.outdated)
							workspaceUpdate.dialogProps.confirmUpdateDialogProps.onConfirm();
						else restartWorkspaceMutation.mutate({ workspace });
						setIsRestartConfirmOpen(false);
					}}
					type="info"
				/>

				<WorkspaceBuildCancelDialog
					open={isCancelConfirmOpen}
					onClose={() => setIsCancelConfirmOpen(false)}
					onConfirm={() => {
						cancelBuildMutation.mutate();
						setIsCancelConfirmOpen(false);
					}}
					workspace={workspace}
				/>
			</TableCell>
		</>
	);
};

type PrimaryActionProps = React.PropsWithChildren<{
	label: string;
	isLoading?: boolean;
	onClick: () => void;
}>;

const PrimaryAction: React.FC<PrimaryActionProps> = ({
	onClick,
	isLoading,
	label,
	children,
}) => {
	// Platform: what it does in the table's footer (TableCard), not a tooltip of its own
	return (
		<Button
			variant="outline"
			size="icon-lg"
			onClick={onClick}
			disabled={isLoading}
			data-hint={label}
		>
			<Spinner loading={isLoading}>{children}</Spinner>
			<span className="sr-only">{label}</span>
		</Button>
	);
};

// The apps shown at once in the workspace row; more: Platform's carousel slides over all of them (AppsCarousel)
const WORKSPACE_APPS_SLOTS = 4;

type WorkspaceAppsProps = {
	workspace: Workspace;
};

const WorkspaceApps: React.FC<WorkspaceAppsProps> = ({ workspace }) => {
	/**
	 * Coder is pretty flexible and allows an enormous variety of use cases, such
	 * as having multiple resources with many agents, but they are not common. The
	 * most common scenario is to have one single compute resource with one single
	 * agent containing all the apps. We get the apps from the first compute
	 * resource (they are sorted to return the compute resource first).
	 *
	 * For multi-agent workspaces with sub-agents we show the apps from the parent
	 * agent (the one without a `parent_id`). Sub-agents, such as those created by
	 * devcontainers, are skipped so agent ordering does not determine which apps
	 * appear.
	 *
	 * When a workspace has multiple parent-level agents we show the apps from the
	 * first one only; aggregating apps across agents is tracked separately.
	 */
	const agent = workspace.latest_build.resources
		.filter((r) => !r.hide)
		.at(0)
		?.agents?.find((a) => a.parent_id === null);
	// Platform: no app buttons until the workspace is ready.
	if (!agent || !agentAppsReady(agent)) {
		return null;
	}

	const builtinApps = new Set(agent.display_apps);
	builtinApps.delete("port_forwarding_helper");
	builtinApps.delete("ssh_helper");

	const userApps = agent.apps.filter(
		(app) =>
			(app.health === "healthy" || app.health === "disabled") && !app.hidden,
	);

	const buttons: React.ReactNode[] = [];

	if (builtinApps.has("vscode")) {
		buttons.push(
			<VSCodeIconLink
				key="vscode"
				variant="vscode"
				label="Open VSCode"
				owner={workspace.owner_name}
				workspace={workspace.name}
				agent={agent.name}
				folder={agent.expanded_directory}
			/>,
		);
	}

	if (builtinApps.has("vscode_insiders")) {
		buttons.push(
			<VSCodeIconLink
				key="vscode-insiders"
				variant="vscode-insiders"
				label="Open VSCode Insiders"
				owner={workspace.owner_name}
				workspace={workspace.name}
				agent={agent.name}
				folder={agent.expanded_directory}
			/>,
		);
	}

	for (const app of userApps) {
		buttons.push(
			<IconAppLink
				key={app.id}
				app={app}
				workspace={workspace}
				agent={agent}
			/>,
		);
	}

	if (builtinApps.has("web_terminal")) {
		const href = getTerminalHref({
			username: workspace.owner_name,
			workspace: workspace.name,
			agent: agent.name,
		});
		buttons.push(
			<BaseIconLink
				key="terminal"
				href={href}
				onClick={(e) => {
					e.preventDefault();
					openAppInNewWindow(href);
				}}
				label="Open Terminal"
			>
				<SquareTerminalIcon className="size-7!" />
			</BaseIconLink>,
		);
	}

	return (
		<AppsCarousel visible={WORKSPACE_APPS_SLOTS} framed>
			{buttons}
		</AppsCarousel>
	);
};

type WorkspaceAppStatusLinksProps = {
	workspace: Workspace;
};

const WorkspaceAppStatusLinks: React.FC<WorkspaceAppStatusLinksProps> = ({
	workspace,
}) => {
	const status = workspace.latest_app_status;
	const appWithAgent = status
		? findWorkspaceAppWithAgent(workspace, status.agent_id, status.app_id)
		: undefined;

	return (
		<>
			{appWithAgent && (
				<IconAppLink
					app={appWithAgent}
					workspace={workspace}
					agent={appWithAgent.agent}
				/>
			)}

			{status?.uri && status?.uri !== "n/a" && (
				<BaseIconLink label={status.uri} href={status.uri} target="_blank">
					{status.uri.startsWith("file://") ? (
						<FileIcon />
					) : (
						<ExternalLinkIcon />
					)}
				</BaseIconLink>
			)}
		</>
	);
};

type IconAppLinkProps = {
	app: WorkspaceApp;
	workspace: Workspace;
	agent: WorkspaceAgent;
};

const IconAppLink: React.FC<IconAppLinkProps> = ({ app, workspace, agent }) => {
	const link = useAppLink(app, {
		workspace,
		agent,
	});

	// A malformed external app URL can't be opened. Render a non-navigating
	// icon with an explanatory tooltip instead of a broken link.
	if (!isAppUrlValid(app)) {
		return (
			<BaseIconLink
				key={app.id}
				label={`${link.label} has an invalid URL`}
				onClick={() => {}}
			>
				{app.icon ? (
					<ExternalImage src={app.icon} />
				) : (
					<CircleAlertIcon
						aria-hidden="true"
						className="size-icon-sm text-content-warning"
					/>
				)}
			</BaseIconLink>
		);
	}

	return (
		<BaseIconLink
			key={app.id}
			label={`Open ${link.label}`}
			href={link.href}
			onClick={link.onClick}
		>
			<ExternalImage src={app.icon ?? "/icon/widgets.svg"} />
		</BaseIconLink>
	);
};

type VSCodeIconLinkProps = {
	variant: "vscode" | "vscode-insiders";
	label: string;
	owner: string;
	workspace: string;
	agent: string;
	folder?: string;
};

// Generates an API key on click instead of on page load, since
// key generation is a POST request that should only fire when
// the user actually wants to open VS Code.
const VSCodeIconLink: React.FC<VSCodeIconLinkProps> = ({
	variant,
	label,
	owner,
	workspace,
	agent,
	folder,
}) => {
	const generateKeyMutation = useMutation({
		mutationFn: () => API.getApiKey(),
		onSuccess: ({ key }) => {
			// We use a `location.href` here instead of a `navigate` because
			// these are protocol-specific links.
			location.href = getVSCodeHref(variant, {
				owner,
				workspace,
				token: key,
				agent,
				folder,
			});
		},
	});

	return (
		<BaseIconLink
			label={label}
			isLoading={generateKeyMutation.isPending}
			onClick={() => {
				if (!generateKeyMutation.isPending) {
					generateKeyMutation.mutate();
				}
			}}
		>
			<ExternalImage
				src={
					variant === "vscode" ? "/icon/code.svg" : "/icon/code-insiders.svg"
				}
				alt=""
			/>
		</BaseIconLink>
	);
};

type BaseIconLinkCommonProps = React.PropsWithChildren<{
	label: string;
	isLoading?: boolean;
}>;

type BaseIconLinkAnchorProps = BaseIconLinkCommonProps & {
	href: string;
	onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
	target?: string;
};

type BaseIconLinkButtonProps = BaseIconLinkCommonProps & {
	href?: never;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

type BaseIconLinkProps = BaseIconLinkAnchorProps | BaseIconLinkButtonProps;

const BaseIconLink: React.FC<BaseIconLinkProps> = ({
	isLoading,
	label,
	children,
	...rest
}) => {
	const loadingClass = isLoading ? "animate-pulse" : "";

	// Platform: what it opens in the table's footer (TableCard), not a tooltip of its own
	return rest.href !== undefined ? (
		<Button variant="outline" size="icon-lg" asChild disabled={isLoading}>
			<a
				target={rest.target}
				className={loadingClass}
				href={rest.href}
				data-hint={label}
				onClick={(e) => {
					e.stopPropagation();
					rest.onClick?.(e);
				}}
			>
				{children}
				<span className="sr-only">{label}</span>
			</a>
		</Button>
	) : (
		<Button
			variant="outline"
			size="icon-lg"
			className={loadingClass}
			data-hint={label}
			onClick={(e) => {
				e.stopPropagation();
				rest.onClick(e);
			}}
			disabled={isLoading}
		>
			{children}
			<span className="sr-only">{label}</span>
		</Button>
	);
};
