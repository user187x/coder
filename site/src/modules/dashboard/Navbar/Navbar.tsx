import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import { buildInfo } from "#/api/queries/buildInfo";
import {
	preferenceSettings,
	preferenceSettingsKey,
	updatePreferenceSettings,
} from "#/api/queries/users";
import type { LinkConfig, UserPreferenceSettings } from "#/api/typesGenerated";
import { useProxy } from "#/contexts/ProxyContext";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { canViewDeploymentSettings } from "#/modules/permissions";
import { isOfferedSupportLink } from "#/modules/platform/supportLinks";
import { useFeatureVisibility } from "../useFeatureVisibility";
import { adminPagesFor, resolveAdminQuickLinks } from "./adminQuickLinks";
import { NavbarView } from "./NavbarView";

export const Navbar: React.FC = () => {
	const { metadata } = useEmbeddedMetadata();
	const buildInfoQuery = useQuery(buildInfo(metadata["build-info"]));
	const { appearance, canViewOrganizationSettings } = useDashboard();
	const { user: me, permissions, signOut } = useAuthenticated();
	const featureVisibility = useFeatureVisibility();
	const proxyContextValue = useProxy();

	const canViewDeployment = canViewDeploymentSettings(permissions);
	const canViewOrganizations = canViewOrganizationSettings;
	const canViewHealth = permissions.viewDebugInfo;
	const canViewAuditLog =
		featureVisibility.audit_log && permissions.viewAnyAuditLog;
	const canViewConnectionLog =
		featureVisibility.connection_log && permissions.viewAnyConnectionLog;
	const adminPages = adminPagesFor({
		permissions,
		oauth2Provider: Boolean(buildInfoQuery.data?.oauth2_provider),
	});
	const queryClient = useQueryClient();
	const preferencesQuery = useQuery({
		...preferenceSettings(),
		enabled: adminPages.length > 0,
	});
	const savePreferences = useMutation(updatePreferenceSettings(queryClient));

	const uniqueLinks = new Map<string, LinkConfig>();
	for (const link of appearance.support_links ?? []) {
		if (!uniqueLinks.has(link.name) && isOfferedSupportLink(link)) {
			uniqueLinks.set(link.name, link);
		}
	}
	return (
		<NavbarView
			user={me}
			buildInfo={buildInfoQuery.data}
			supportLinks={Array.from(uniqueLinks.values())}
			onSignOut={signOut}
			adminPermissions={{
				canViewDeployment,
				canViewUsers: permissions.viewAllUsers,
				canViewOrganizations,
				canViewAuditLog,
				canViewConnectionLog,
				canViewHealth,
				canEditDeployment: permissions.editDeploymentConfig,
			}}
			adminQuickLinks={{
				pages: adminPages,
				links: resolveAdminQuickLinks(
					preferencesQuery.data?.admin_quick_links ?? [],
					adminPages,
				),
				// The menu changes at once; the save follows, and a failed one puts
				// back what the server has.
				onChange: (ids) => {
					queryClient.setQueryData<UserPreferenceSettings>(
						preferenceSettingsKey,
						(old) => (old ? { ...old, admin_quick_links: ids } : old),
					);
					savePreferences.mutate(
						{ admin_quick_links: ids },
						{
							onError: (error) => {
								void queryClient.invalidateQueries({
									queryKey: preferenceSettingsKey,
								});
								toast.error(
									getErrorMessage(error, "Could not save your quick links."),
								);
							},
						},
					);
				},
			}}
			proxyContextValue={proxyContextValue}
		/>
	);
};
