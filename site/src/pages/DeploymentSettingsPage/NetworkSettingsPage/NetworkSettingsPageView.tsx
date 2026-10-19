import type { Experiment, SerpentOption } from "#/api/typesGenerated";
import { Alert, AlertTitle } from "#/components/Alert/Alert";
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
	/** The experiments Coder knows (Experiments' row lists them), and those configured it does not know. */
	safeExperiments?: readonly Experiment[];
	invalidExperiments?: readonly string[];
};

/** The rows Overview had, first in Network's table (Overview is gone). */
const FROM_OVERVIEW = ["Access URL", "Wildcard Access URL", "Experiments"];

export const NetworkSettingsPageView: React.FC<
	NetworkSettingsPageViewProps
> = ({ options, safeExperiments = [], invalidExperiments = [] }) => (
	<div className="flex flex-col gap-12">
		<div>
			<SettingsHeader>
				<SettingsHeaderTitle>Network</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Configure your deployment connectivity.{" "}
				</SettingsHeaderDescription>
			</SettingsHeader>

			{invalidExperiments.length > 0 && (
				<Alert severity="warning" className="mb-4">
					<AlertTitle>Invalid experiments in use:</AlertTitle>
					<ul>
						{invalidExperiments.map((it) => (
							<li key={it}>
								<pre>{it}</pre>
							</li>
						))}
					</ul>
					It is recommended that you remove these experiments from your
					configuration as they have no effect.
				</Alert>
			)}
			<OptionsTable
				options={[
					...useDeploymentOptions(options, ...FROM_OVERVIEW),
					...options.filter(
						(o) =>
							deploymentGroupHasParent(o.group, "Networking") &&
							!FROM_OVERVIEW.includes(o.name ?? ""),
					),
				]}
				additionalValues={safeExperiments}
			/>
			<p className="m-0 mt-3 text-sm text-content-secondary">
				Experiments lists the startup defaults. Runtime experiment rules can
				override them per user without a restart.
			</p>
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
