import type { Workspace } from "#/api/typesGenerated";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";

type BatchRestartConfirmationProps = {
	workspacesToRestart: readonly Workspace[];
	open: boolean;
	isLoading: boolean;
	onClose: () => void;
	onConfirm: () => void;
};

export const BatchRestartConfirmation: React.FC<
	BatchRestartConfirmationProps
> = ({ workspacesToRestart, open, onClose, onConfirm, isLoading }) => {
	const workspaceCount = `${workspacesToRestart.length} ${
		workspacesToRestart.length === 1 ? "workspace" : "workspaces"
	}`;

	return (
		<ConfirmDialog
			type="delete"
			open={open}
			onClose={onClose}
			title={`Restart ${workspaceCount}`}
			confirmLoading={isLoading}
			confirmText="Restart"
			onConfirm={onConfirm}
			description={`Are you sure you want to restart ${workspaceCount}? This will terminate all running processes and disconnect any active sessions.`}
		/>
	);
};
