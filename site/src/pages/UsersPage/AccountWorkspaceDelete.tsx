import { TrashIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { deleteAccountWorkspace } from "#/api/queries/accountWorkspaceActions";
import { workspacePermissions } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { WorkspaceDeleteDialog } from "#/modules/workspaces/WorkspaceMoreActions/WorkspaceDeleteDialog";

export const AccountWorkspaceDelete = ({
	workspaces,
	compact,
	onDeleted,
}: {
	workspaces: readonly Workspace[];
	compact: boolean;
	onDeleted?: (workspace: Workspace) => void;
}) => {
	const [review, setReview] = useState<readonly Workspace[]>([]);
	const target = review[0];
	const label =
		workspaces.length === 1 ? "Delete workspace" : "Delete workspaces";
	return (
		<>
			<Button
				size={compact ? "icon" : "sm"}
				variant="outline"
				className={compact ? "size-7 shrink-0" : undefined}
				title={label}
				aria-label={
					compact ? `Delete ${workspaces[0]?.name ?? "workspace"}` : undefined
				}
				disabled={!workspaces.length}
				onClick={() => setReview([...workspaces])}
			>
				<TrashIcon aria-hidden />
				{!compact && label}
			</Button>
			{target && (
				<ReviewWorkspaceDelete
					key={target.id}
					workspace={target}
					onCancel={() => setReview([])}
					onDeleted={() => {
						setReview((queue) => queue.slice(1));
						onDeleted?.(target);
					}}
				/>
			)}
		</>
	);
};

const ReviewWorkspaceDelete = ({
	workspace,
	onCancel,
	onDeleted,
}: {
	workspace: Workspace;
	onCancel: () => void;
	onDeleted: () => void;
}) => {
	const client = useQueryClient();
	const remove = useMutation(deleteAccountWorkspace(workspace, client));
	const permissions = useQuery(workspacePermissions(workspace));
	const build = workspace.latest_build;
	return (
		<WorkspaceDeleteDialog
			workspace={workspace}
			canDeleteFailedWorkspace={
				permissions.data?.deleteFailedWorkspace ?? false
			}
			buildNotice={
				["pending", "running", "canceling"].includes(build.job.status) &&
				build.transition !== "delete"
					? "Deletion waits for the current build to be canceled."
					: undefined
			}
			pending={remove.isPending}
			error={remove.error}
			isOpen
			onCancel={onCancel}
			onConfirm={(orphan) =>
				remove.mutate({ orphan }, { onSuccess: onDeleted })
			}
		/>
	);
};
