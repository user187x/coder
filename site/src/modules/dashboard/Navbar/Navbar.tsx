import { useQuery } from "react-query";
import { aiSpendOrganizations } from "#/api/queries/aiBridge";
import { buildInfo } from "#/api/queries/buildInfo";
import type { LinkConfig } from "#/api/typesGenerated";
import { useProxy } from "#/contexts/ProxyContext";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import {
	canAccessAnyChatModelConfig,
	canViewDeploymentSettings,
} from "#/modules/permissions";
import { isOfferedSupportLink } from "#/modules/platform/supportLinks";
import { useCanShareOrganizationMCPServers } from "#/pages/AISettingsPage/MCPServersPage/organizationSharing";
import { canViewAISpend } from "#/pages/AISettingsPage/SpendPage/spendAccess";
import { useFeatureVisibility } from "../useFeatureVisibility";
import { NavbarView } from "./NavbarView";

export const Navbar: React.FC = () => {
	const { metadata } = useEmbeddedMetadata();
	const buildInfoQuery = useQuery(buildInfo(metadata["build-info"]));
	const {
		appearance,
		canViewOrganizationSettings,
		entitlements,
		organizations,
	} = useDashboard();
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
	const canViewAIBridge =
		featureVisibility.aibridge && permissions.viewAnyAIBridgeInterception;
	const canViewSiteWideAISettings =
		permissions.viewAnyAIProvider ||
		permissions.viewAIGatewayKeys ||
		permissions.editDeploymentConfig ||
		permissions.viewAnyMCPServerConfigs ||
		permissions.createAnyMCPServerConfig ||
		permissions.updateAnyMCPServerConfig ||
		permissions.deleteAnyMCPServerConfig ||
		permissions.updateAnyTemplate ||
		canAccessAnyChatModelConfig(permissions);
	const organizationMCPSharing = useCanShareOrganizationMCPServers(
		organizations,
		{ enabled: !canViewSiteWideAISettings },
	);
	const spendOrganizationsQuery = useQuery({
		...aiSpendOrganizations(),
		enabled:
			entitlements.features.aibridge.enabled && !canViewSiteWideAISettings,
	});
	const canViewAISettings =
		canViewSiteWideAISettings ||
		organizationMCPSharing.canShare ||
		canViewAISpend(entitlements, spendOrganizationsQuery.data);

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
				canViewAISettings,
				canViewAuditLog,
				canViewConnectionLog,
				canViewAIBridge,
				canViewHealth,
			}}
			canViewLicenses={permissions.viewAllLicenses}
			proxyContextValue={proxyContextValue}
		/>
	);
};
