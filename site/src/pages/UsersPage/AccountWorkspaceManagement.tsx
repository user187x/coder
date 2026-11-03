import type { Workspace } from "#/api/typesGenerated";
import { useWorkspaceRestricted } from "#/modules/platform/quarantine/WorkspaceRestriction";
import { AccountWorkspaceActions } from "./AccountWorkspaceActions";
import { AccountWorkspaceUpdate } from "./AccountWorkspaceUpdate";

/** Admin cleanup remains available while quarantine blocks starting or entering a workspace. */
export const AccountWorkspaceManagement = ({
	workspace,
}: {
	workspace: Workspace;
}) => {
	const restricted = useWorkspaceRestricted(workspace);
	return (
		<AccountWorkspaceActions
			targets={[workspace]}
			compact
			restartDisabled={restricted}
		>
			{!restricted && <AccountWorkspaceUpdate workspace={workspace} />}
		</AccountWorkspaceActions>
	);
};
