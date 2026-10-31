import { TrashIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { deleteWorkspace } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { useWorkspaceRestricted } from "#/modules/platform/quarantine/WorkspaceRestriction";
import { WorkspaceDeleteDialog } from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceDeleteDialog";
import { AccountWorkspaceActions } from "./AccountWorkspaceActions";
import { AccountWorkspaceUpdate } from "./AccountWorkspaceUpdate";

/** Admin cleanup remains available while quarantine blocks starting or entering a workspace. */
export const AccountWorkspaceManagement = ({
	workspace,
}: {
	workspace: Workspace;
}) => {
	const client = useQueryClient();
	const restricted = useWorkspaceRestricted(workspace);
	const [confirming, setConfirming] = useState(false);
	const remove = useMutation(deleteWorkspace(workspace, client));
	const busy = [
		"pending",
		"starting",
		"stopping",
		"canceling",
		"deleting",
		"deleted",
	].includes(workspace.latest_build.status);
	return (
		<>
			<AccountWorkspaceActions
				targets={[workspace]}
				compact
				restartDisabled={restricted}
			>
				{!restricted && <AccountWorkspaceUpdate workspace={workspace} />}
				<Button
					size="icon"
					variant="outline"
					className="size-7 shrink-0"
					aria-label={`Delete ${workspace.name}`}
					title="Delete workspace"
					disabled={busy || remove.isPending}
					onClick={() => setConfirming(true)}
				>
					<TrashIcon aria-hidden />
				</Button>
			</AccountWorkspaceActions>
			{remove.error && <ErrorAlert error={remove.error} />}
			<WorkspaceDeleteDialog
				workspace={workspace}
				canDeleteFailedWorkspace={false}
				isOpen={confirming}
				onCancel={() => setConfirming(false)}
				onConfirm={(orphan) =>
					remove.mutate({ orphan }, { onSuccess: () => setConfirming(false) })
				}
			/>
		</>
	);
};
