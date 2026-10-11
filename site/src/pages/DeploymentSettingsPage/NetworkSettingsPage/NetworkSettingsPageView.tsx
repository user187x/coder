import type { SerpentOption } from "#/api/typesGenerated";
import { BadgeGroup } from "#/components/Badge/Badge";
import { DisabledBadge, EnabledBadge } from "#/components/Badge/PresetBadges";
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

type NetworkSettingsPageViewProps = {
	options: SerpentOption[];
};

export const NetworkSettingsPageView: React.FC<
	NetworkSettingsPageViewProps
> = ({ options }) => (
	<div className="flex flex-col gap-12">
		<div>
			<SettingsHeader>
				<SettingsHeaderTitle>Network</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Configure your deployment connectivity.{" "}
				</SettingsHeaderDescription>
			</SettingsHeader>

			<OptionsTable
				options={options.filter((o) =>
					deploymentGroupHasParent(o.group, "Networking"),
				)}
			/>
		</div>

		<div>
			<SettingsHeader>
				<SettingsHeaderTitle level="h2" hierarchy="secondary">
					Port Forwarding
				</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Port forwarding lets developers securely access processes on their
					Coder workspace from a local machine.{" "}
				</SettingsHeaderDescription>
			</SettingsHeader>

			<BadgeGroup>
				{useDeploymentOptions(options, "Wildcard Access URL")[0].value !==
				"" ? (
					<EnabledBadge />
				) : (
					<DisabledBadge />
				)}
			</BadgeGroup>
		</div>
	</div>
);
