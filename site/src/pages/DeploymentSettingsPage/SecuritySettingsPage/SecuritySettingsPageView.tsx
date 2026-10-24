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

type SecuritySettingsPageViewProps = {
	options: SerpentOption[];
	/** The certificate overview, at the top of the page (admins only). */
	certificates?: React.ReactNode;
	lockdown?: React.ReactNode;
};

export const SecuritySettingsPageView: React.FC<
	SecuritySettingsPageViewProps
> = ({ options, certificates, lockdown }) => {
	const tlsOptions = options.filter((o) =>
		deploymentGroupHasParent(o.group, "TLS"),
	);

	return (
		<div className="flex flex-col gap-12">
			<div>
				<SettingsHeader>
					<SettingsHeaderTitle>Security</SettingsHeaderTitle>
					<SettingsHeaderDescription>
						Ensure your Coder deployment is secure.{" "}
					</SettingsHeaderDescription>
				</SettingsHeader>

				{lockdown && <div className="mb-12">{lockdown}</div>}
				{certificates && <div className="mb-12">{certificates}</div>}

				<OptionsTable
					options={useDeploymentOptions(
						options,
						"SSH Keygen Algorithm",
						"Secure Auth Cookie",
						"Disable Owner Workspace Access",
					)}
				/>
			</div>

			{tlsOptions.length > 0 && (
				<div>
					<SettingsHeader>
						<SettingsHeaderTitle level="h2" hierarchy="secondary">
							TLS
						</SettingsHeaderTitle>
						<SettingsHeaderDescription>
							Ensure TLS is properly configured for your Coder deployment.
						</SettingsHeaderDescription>
					</SettingsHeader>

					<OptionsTable options={tlsOptions} />
				</div>
			)}
		</div>
	);
};
