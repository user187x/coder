import { useMutation, useQueryClient } from "react-query";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { API } from "#/api/api";
import { WorkspaceExtrasAPI, workspaceIconsKey } from "#/api/workspaceVolumes";
import { Loader } from "#/components/Loader/Loader";
import { useWorkspaceIcons } from "#/modules/workspaces/WorkspaceIcon/useWorkspaceIcon";
import { pageTitle } from "#/utils/page";
import { useWorkspaceSettings } from "./useWorkspaceSettings";
import type { WorkspaceSettingsFormValues } from "./WorkspaceSettingsForm";
import { WorkspaceSettingsPageView } from "./WorkspaceSettingsPageView";

const WorkspaceSettingsPage: React.FC = () => {
	const params = useParams() as {
		workspace: string;
		username: string;
	};
	const workspaceName = params.workspace;
	const username = params.username.replace("@", "");
	const { workspace } = useWorkspaceSettings();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const icons = useWorkspaceIcons();
	const icon = icons.data?.[workspace.id] ?? "";

	const mutation = useMutation({
		mutationFn: async (formValues: WorkspaceSettingsFormValues) => {
			await Promise.all([
				formValues.name !== workspace.name &&
					API.patchWorkspace(workspace.id, { name: formValues.name }),
				formValues.automatic_updates !== workspace.automatic_updates &&
					API.updateWorkspaceAutomaticUpdates(
						workspace.id,
						formValues.automatic_updates,
					),
				formValues.icon !== icon &&
					WorkspaceExtrasAPI.setIcon(workspace.id, formValues.icon).then(() =>
						queryClient.invalidateQueries({ queryKey: workspaceIconsKey }),
					),
			]);
		},
		onSuccess: (_, formValues) => {
			toast.success(`Workspace "${formValues.name}" updated successfully.`);
			navigate(`/@${username}/${formValues.name}/settings`);
		},
	});

	return (
		<>
			<title>{pageTitle(workspaceName, "Settings")}</title>

			{icons.isLoading ? (
				<Loader />
			) : (
				<WorkspaceSettingsPageView
					error={mutation.error}
					workspace={workspace}
					icon={icon}
					onCancel={() => navigate(`/@${username}/${workspaceName}`)}
					onSubmit={mutation.mutateAsync}
				/>
			)}
		</>
	);
};

export default WorkspaceSettingsPage;
