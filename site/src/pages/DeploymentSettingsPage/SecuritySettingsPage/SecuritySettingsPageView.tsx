import type { SerpentOption } from "#/api/typesGenerated";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import {
	deploymentGroupHasParent,
	useDeploymentOptions,
} from "#/utils/deployOptions";
import OptionsTable from "../OptionsTable";
import { CollapsibleSecurityCard } from "./CollapsibleSecurityCard";

type SecuritySettingsPageViewProps = {
	options: SerpentOption[];
	/** The certificate overview, at the top of the page (admins only). */
	certificates?: React.ReactNode;
	lockdown?: React.ReactNode;
	activity?: React.ReactNode;
};

export const SecuritySettingsPageView: React.FC<
	SecuritySettingsPageViewProps
> = ({ options, certificates, lockdown, activity }) => {
	const tlsOptions = options.filter((o) =>
		deploymentGroupHasParent(o.group, "TLS"),
	);

	const securityOptions = useDeploymentOptions(
		options,
		"SSH Keygen Algorithm",
		"Secure Auth Cookie",
		"Disable Owner Workspace Access",
	);

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<h1 className="sr-only">Security</h1>
			{lockdown}
			{certificates && <div className="dashboard-panel">{certificates}</div>}
			<div className="dashboard-panel">
				<CollapsibleSecurityCard
					id="tls"
					title="TLS Configurations"
					defaultOpen={false}
				>
					<SettingsHeader>
						<SettingsHeaderTitle level="h2" hierarchy="secondary">
							TLS Configurations
						</SettingsHeaderTitle>
						<SettingsHeaderDescription>
							Review TLS and related Coder security options.
						</SettingsHeaderDescription>
					</SettingsHeader>
					<OptionsTable
						options={[...new Set([...tlsOptions, ...securityOptions])]}
					/>
				</CollapsibleSecurityCard>
			</div>
			{activity && <div className="dashboard-panel">{activity}</div>}
		</div>
	);
};
