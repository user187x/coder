import { RefreshCcwIcon } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import { updateWorkspace } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";

/** Reviews a template update before rebuilding another account's workspace. */
export const AccountWorkspaceUpdate: React.FC<{ workspace: Workspace }> = ({
	workspace,
}) => {
	const client = useQueryClient();
	const change = useMutation(updateWorkspace(workspace, client));
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				size="icon"
				variant="outline"
				className="size-7 shrink-0"
				aria-label={`Update ${workspace.name}`}
				title={
					workspace.outdated ? "Update workspace" : "Workspace is up to date"
				}
				disabled={
					!workspace.outdated ||
					change.isPending ||
					!["running", "stopped", "failed", "canceled"].includes(
						workspace.latest_build.status,
					)
				}
				onClick={() => setOpen(true)}
			>
				<RefreshCcwIcon aria-hidden />
			</Button>
			<ConfirmDialog
				open={open}
				onClose={() => setOpen(false)}
				title="Update workspace"
				confirmText="Update"
				type="info"
				hideCancel={false}
				disabled={change.isPending}
				onConfirm={() => change.mutate({}, { onSuccess: () => setOpen(false) })}
				description={
					<div className="flex flex-col gap-3">
						<p>
							Update {workspace.owner_name}/{workspace.name} to its active
							template version. Running workspace sessions will disconnect.
							Review required build parameters on the workspace dashboard if the
							update requests them.
						</p>
						{change.error && <ErrorAlert error={change.error} />}
					</div>
				}
			/>
		</>
	);
};
