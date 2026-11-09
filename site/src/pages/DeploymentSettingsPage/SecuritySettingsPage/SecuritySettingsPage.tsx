import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useDeploymentConfig } from "#/modules/management/DeploymentConfigProvider";
import { CertificateOverview } from "#/modules/platform/CertificateOverview";
import { GlobalLockdownCard } from "#/modules/platform/globalLockdown/GlobalLockdown";
import { WorkspaceQuarantineCard } from "#/modules/platform/quarantine/WorkspaceQuarantine";
import { SecurityActivity } from "#/modules/platform/security/SecurityActivity";
import { pageTitle } from "#/utils/page";
import { CollapsibleSecurityCard } from "./CollapsibleSecurityCard";
import { SecuritySettingsPageView } from "./SecuritySettingsPageView";

const SecuritySettingsPage: React.FC = () => {
	const { deploymentConfig } = useDeploymentConfig();
	const { permissions, user } = useAuthenticated();

	return (
		<>
			<title>{pageTitle("Security Settings")}</title>

			<SecuritySettingsPageView
				options={deploymentConfig.options}
				activity={
					permissions.viewAnyAuditLog ? (
						<CollapsibleSecurityCard id="activity" title="Coder security logs">
							<SecurityActivity />
						</CollapsibleSecurityCard>
					) : undefined
				}
				lockdown={
					user.roles.some((role) => role.name === "owner") ? (
						<div className="flex flex-col gap-6">
							{/* Global Command & Control always stays open */}
							<GlobalLockdownCard />
							<CollapsibleSecurityCard
								id="quarantine"
								title="Workspace quarantine"
							>
								<WorkspaceQuarantineCard />
							</CollapsibleSecurityCard>
						</div>
					) : undefined
				}
				certificates={
					permissions.editDeploymentConfig ? (
						<CollapsibleSecurityCard id="certificates" title="Certificates">
							<CertificateOverview />
						</CollapsibleSecurityCard>
					) : undefined
				}
			/>
		</>
	);
};

export default SecuritySettingsPage;
