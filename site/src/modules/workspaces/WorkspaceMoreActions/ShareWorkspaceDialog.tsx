import type { Workspace } from "#/api/typesGenerated";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { isGroup } from "#/modules/groups";
import { AddWorkspaceUserOrGroup } from "#/modules/workspaces/WorkspaceSharingForm/AddWorkspaceUserOrGroup";
import { useWorkspaceSharing } from "#/modules/workspaces/WorkspaceSharingForm/useWorkspaceSharing";
import { WorkspaceSharingForm } from "#/modules/workspaces/WorkspaceSharingForm/WorkspaceSharingForm";

type ShareWorkspaceDialogProps = {
	workspace: Workspace;
	canUpdatePermissions: boolean;
	open: boolean;
	onClose: () => void;
};

/**
 * Platform: Workspace Sharing (what the Share button opened), from Share in
 * the workspace page's actions menu: who else may use the workspace.
 */
export const ShareWorkspaceDialog: React.FC<ShareWorkspaceDialogProps> = ({
	workspace,
	canUpdatePermissions,
	open,
	onClose,
}) => (
	<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
		<DialogContent
			// As wide as the form needs (search, role and Add member on one line).
			className="flex max-w-[720px] flex-col gap-4 p-6"
			data-testid="workspace-share-dialog"
		>
			<DialogHeader>
				<DialogTitle>Workspace Sharing</DialogTitle>
				<DialogDescription className="sr-only">
					Who else may use the workspace {workspace.name}.
				</DialogDescription>
			</DialogHeader>
			{/* Only while open: the form loads the workspace's sharing then. */}
			{open && (
				<SharingForm
					workspace={workspace}
					canUpdatePermissions={canUpdatePermissions}
				/>
			)}
		</DialogContent>
	</Dialog>
);

const SharingForm: React.FC<
	Pick<ShareWorkspaceDialogProps, "workspace" | "canUpdatePermissions">
> = ({ workspace, canUpdatePermissions }) => {
	const sharing = useWorkspaceSharing(workspace);
	return (
		<WorkspaceSharingForm
			organizationId={workspace.organization_id}
			workspaceACL={sharing.workspaceACL}
			canUpdatePermissions={canUpdatePermissions}
			error={sharing.error ?? sharing.mutationError}
			updatingUserId={sharing.updatingUserId}
			onUpdateUser={sharing.updateUser}
			onRemoveUser={sharing.removeUser}
			updatingGroupId={sharing.updatingGroupId}
			onUpdateGroup={sharing.updateGroup}
			onRemoveGroup={sharing.removeGroup}
			showRestartWarning={sharing.hasRemovedMember}
			isCompact
			addMemberForm={
				<AddWorkspaceUserOrGroup
					organizationID={workspace.organization_id}
					workspaceACL={sharing.workspaceACL}
					isLoading={sharing.isAddingUser || sharing.isAddingGroup}
					onSubmit={(value, role, resetAutocomplete) =>
						isGroup(value)
							? sharing.addGroup(value, role, resetAutocomplete)
							: sharing.addUser(value, role, resetAutocomplete)
					}
				/>
			}
		/>
	);
};
