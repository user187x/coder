import { useMutation, useQueryClient } from "react-query";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { toast } from "sonner";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import { patchGroup } from "#/api/queries/groups";
import { RequirePermission } from "#/modules/permissions/RequirePermission";
import type { GroupPageOutletContext } from "./GroupPage";
import GroupSettingsPageView from "./GroupSettingsPageView";

const GroupSettingsPage: React.FC = () => {
	const { organization = "default", groupName } = useParams() as {
		organization?: string;
		groupName: string;
	};
	const { group: groupData, permissions } =
		useOutletContext<GroupPageOutletContext>();
	const queryClient = useQueryClient();
	const patchGroupMutation = useMutation(patchGroup(queryClient, organization));
	const navigate = useNavigate();

	const canUpdateGroup = permissions.canUpdateGroup;
	if (!canUpdateGroup) {
		return <RequirePermission isFeatureVisible={false} />;
	}

	const isUpdating = patchGroupMutation.isPending;

	return (
		<GroupSettingsPageView
			onSubmit={async (data) => {
				try {
					await patchGroupMutation.mutateAsync({
						groupId: groupData.id,
						...data,
						add_users: [],
						remove_users: [],
					});
				} catch (error) {
					toast.error(
						getErrorMessage(error, `Failed to update group "${groupName}".`),
						{ description: getErrorDetail(error) },
					);
					return;
				}

				navigate(`/organizations/${organization}/groups/${data.name}`);
			}}
			group={groupData}
			formErrors={undefined}
			isUpdating={isUpdating}
		/>
	);
};

export default GroupSettingsPage;
