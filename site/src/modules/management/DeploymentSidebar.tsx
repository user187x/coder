import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { keycloakStatus } from "#/api/queries/platform";
import {
	preferenceSettings,
	preferenceSettingsKey,
	updatePreferenceSettings,
} from "#/api/queries/users";
import type { UserPreferenceSettings } from "#/api/typesGenerated";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { DeploymentSidebarView } from "./DeploymentSidebarView";
import { HealthNavItem } from "./HealthNavItem";

/**
 * A sidebar for deployment settings, in the order the admin arranged it (a
 * preference of theirs, saved with Coder).
 */
export const DeploymentSidebar: React.FC = () => {
	const { permissions } = useAuthenticated();
	const { buildInfo } = useDashboard();
	const { data: keycloak } = useQuery({
		...keycloakStatus(),
		enabled: permissions.editDeploymentConfig,
	});
	const queryClient = useQueryClient();
	const preferences = useQuery(preferenceSettings());
	const savePreferences = useMutation(updatePreferenceSettings(queryClient));

	return (
		<DeploymentSidebarView
			permissions={permissions}
			buildInfo={buildInfo}
			health={permissions.viewDebugInfo ? <HealthNavItem /> : undefined}
			keycloakConnected={keycloak?.connected === true}
			order={preferences.data?.admin_sidebar_order ?? []}
			onReorder={(ids) => {
				// The sidebar changes at once; the save follows, and a failed one
				// puts back what the server has.
				queryClient.setQueryData<UserPreferenceSettings>(
					preferenceSettingsKey,
					(old) => (old ? { ...old, admin_sidebar_order: ids } : old),
				);
				savePreferences.mutate(
					{ admin_sidebar_order: ids },
					{
						onError: (error) => {
							void queryClient.invalidateQueries({
								queryKey: preferenceSettingsKey,
							});
							toast.error(
								getErrorMessage(error, "Could not save the categories' order."),
							);
						},
					},
				);
			}}
		/>
	);
};
