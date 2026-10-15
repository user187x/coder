import {
	ArchiveIcon,
	CopyIcon,
	DownloadIcon,
	EllipsisVerticalIcon,
	HardDriveIcon,
	HistoryIcon,
	RotateCcwIcon,
	SettingsIcon,
	SlidersHorizontalIcon,
	SquareIcon,
	TrashIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { Link as RouterLink } from "react-router";
import { toast } from "sonner";
import { ParameterValidationError } from "#/api/api";
import {
	type ApiError,
	getErrorDetail,
	getErrorMessage,
	isApiError,
} from "#/api/errors";
import {
	changeVersion,
	deleteWorkspace,
	workspacePermissions,
} from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { TopbarButton } from "#/components/FullPageLayout/Topbar";
import { WorkspaceErrorDialog } from "../ErrorDialog/WorkspaceErrorDialog";
import { UpdateBuildParametersDialog } from "../WorkspaceUpdateDialogs";
import { ChangeWorkspaceVersionDialog } from "./ChangeWorkspaceVersionDialog";
import { DownloadLogsDialog } from "./DownloadLogsDialog";
import { useWorkspaceDuplication } from "./useWorkspaceDuplication";
import { WorkspaceDeleteDialog } from "./WorkspaceDeleteDialog";
import { BackupHomeDialog, ExpandDiskDialog } from "./WorkspaceVolumeDialogs";

type WorkspaceMoreActionsProps = {
	workspace: Workspace;
	disabled: boolean;
	onStop?: () => void;
	isStopping?: boolean;
	onRestart?: () => void;
	isRestarting?: boolean;
	onActionSuccess?: () => Promise<void> | void;
	/**
	 * Platform: "arrow" on the workspace page - the arrow beside Start or
	 * Restart (or on its own), holding every action, its first item the build
	 * parameters; "ellipsis" (the default) elsewhere, as in the Workspaces list.
	 */
	variant?: "ellipsis" | "arrow";
};

export const WorkspaceMoreActions: React.FC<WorkspaceMoreActionsProps> = ({
	workspace,
	disabled,
	onStop,
	isStopping,
	onRestart,
	isRestarting,
	onActionSuccess,
	variant = "ellipsis",
}) => {
	const queryClient = useQueryClient();

	const [workspaceErrorDialog, setWorkspaceErrorDialog] = useState<{
		open: boolean;
		error?: ApiError;
	}>({ open: false });

	// Permissions
	const { data: permissions } = useQuery(workspacePermissions(workspace));

	// Download logs
	const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
	// Home volume: back up, expand
	const [volumeDialog, setVolumeDialog] = useState<"backup" | "expand" | null>(
		null,
	);

	// Change version
	const [changeVersionDialogOpen, setChangeVersionDialogOpen] = useState(false);
	const changeVersionMutation = useMutation(
		changeVersion(workspace, queryClient),
	);

	const handleError = (error: unknown) => {
		if (isApiError(error) && error.code === "ERR_BAD_REQUEST") {
			setWorkspaceErrorDialog({
				open: true,
				error: error,
			});
		} else {
			toast.error(
				getErrorMessage(
					error,
					`Failed to delete workspace "${workspace.name}".`,
				),
				{
					description: getErrorDetail(error),
				},
			);
		}
	};

	// Delete
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const deleteWorkspaceOptions = deleteWorkspace(workspace, queryClient);
	const deleteWorkspaceMutation = useMutation({
		...deleteWorkspaceOptions,
		onSuccess: async (build) => {
			await deleteWorkspaceOptions.onSuccess?.(build);
			await onActionSuccess?.();
		},
		onError: (error: unknown) => {
			handleError(error);
		},
	});

	// Duplicate
	const { duplicateWorkspace, isDuplicationReady } =
		useWorkspaceDuplication(workspace);

	// Since the workspace state is not updated immediately after the mutation, we
	// need to be sure the menu is closed when the action gets disabled.
	// Reference: https://github.com/coder/coder/pull/17775#discussion_r2087273706
	const [open, setOpen] = useState(false);
	useEffect(() => {
		setOpen((open) => (disabled ? false : open));
	});

	return (
		<>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger asChild>
					{variant === "arrow" ? (
						<TopbarButton
							data-testid="workspace-options-button"
							aria-controls="workspace-options"
							disabled={disabled}
							className="min-w-fit"
						>
							<ChevronDownIcon />
							<span className="sr-only">Workspace actions</span>
						</TopbarButton>
					) : (
						<Button
							size="icon-lg"
							variant="subtle"
							data-testid="workspace-options-button"
							aria-controls="workspace-options"
							disabled={disabled}
						>
							<EllipsisVerticalIcon aria-hidden="true" />
							<span className="sr-only">Workspace actions</span>
						</Button>
					)}
				</DropdownMenuTrigger>

				<DropdownMenuContent id="workspace-options" align="end">
					{variant === "arrow" && (
						<>
							{/* What the arrow showed before: the parameters to build with. */}
							<DropdownMenuItem asChild>
								<RouterLink
									to={`/@${workspace.owner_name}/${workspace.name}/settings#parameters`}
								>
									<SlidersHorizontalIcon />
									Build parameters&hellip;
								</RouterLink>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					{onStop && (
						<DropdownMenuItem onClick={onStop} disabled={isStopping}>
							<SquareIcon />
							Stop&hellip;
						</DropdownMenuItem>
					)}

					{onRestart && (
						<DropdownMenuItem onClick={onRestart} disabled={isRestarting}>
							<RotateCcwIcon />
							Restart&hellip;
						</DropdownMenuItem>
					)}

					<DropdownMenuItem asChild>
						<RouterLink
							to={`/@${workspace.owner_name}/${workspace.name}/settings`}
						>
							<SettingsIcon />
							Settings
						</RouterLink>
					</DropdownMenuItem>

					{permissions?.updateWorkspaceVersion && (
						<DropdownMenuItem
							onClick={() => {
								setChangeVersionDialogOpen(true);
							}}
						>
							<HistoryIcon />
							Change version&hellip;
						</DropdownMenuItem>
					)}

					<DropdownMenuItem
						onClick={duplicateWorkspace}
						disabled={!isDuplicationReady}
					>
						<CopyIcon />
						Duplicate&hellip;
					</DropdownMenuItem>

					<DropdownMenuItem onClick={() => setIsDownloadDialogOpen(true)}>
						<DownloadIcon />
						Download logs&hellip;
					</DropdownMenuItem>

					{permissions?.updateWorkspace && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => setVolumeDialog("backup")}>
								<ArchiveIcon />
								Back up home&hellip;
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setVolumeDialog("expand")}>
								<HardDriveIcon />
								Expand disk&hellip;
							</DropdownMenuItem>
						</>
					)}

					<DropdownMenuSeparator />

					<DropdownMenuItem
						className="text-content-destructive focus:text-content-destructive"
						onClick={() => {
							setIsConfirmingDelete(true);
						}}
						data-testid="delete-button"
					>
						<TrashIcon />
						Delete&hellip;
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<DownloadLogsDialog
				workspace={workspace}
				open={isDownloadDialogOpen}
				onClose={() => setIsDownloadDialogOpen(false)}
			/>

			<BackupHomeDialog
				workspace={workspace}
				open={volumeDialog === "backup"}
				onClose={() => setVolumeDialog(null)}
			/>
			<ExpandDiskDialog
				workspace={workspace}
				open={volumeDialog === "expand"}
				onClose={() => setVolumeDialog(null)}
			/>

			{changeVersionMutation.error instanceof ParameterValidationError && (
				<UpdateBuildParametersDialog
					workspace={workspace}
					error={changeVersionMutation.error}
					onClose={() => {
						changeVersionMutation.reset();
					}}
				/>
			)}

			<ChangeWorkspaceVersionDialog
				workspace={workspace}
				open={changeVersionDialogOpen}
				onClose={() => {
					setChangeVersionDialogOpen(false);
				}}
				onConfirm={(version) => {
					setChangeVersionDialogOpen(false);
					changeVersionMutation.mutate({ versionId: version.id });
				}}
			/>

			<WorkspaceDeleteDialog
				workspace={workspace}
				canDeleteFailedWorkspace={Boolean(permissions?.deleteFailedWorkspace)}
				isOpen={isConfirmingDelete}
				onCancel={() => {
					setIsConfirmingDelete(false);
				}}
				onConfirm={(orphan) => {
					deleteWorkspaceMutation.mutate({ orphan });
					setIsConfirmingDelete(false);
				}}
			/>

			<WorkspaceErrorDialog
				open={workspaceErrorDialog.open}
				error={workspaceErrorDialog.error}
				onClose={() => setWorkspaceErrorDialog({ open: false })}
				workspaceOwner={workspace.owner_name}
				workspaceName={workspace.name}
				templateVersionId={workspace.latest_build.template_version_id}
				isDeleting
			/>
		</>
	);
};
