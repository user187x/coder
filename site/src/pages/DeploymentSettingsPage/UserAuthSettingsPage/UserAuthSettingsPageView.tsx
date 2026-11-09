import { ChevronRightIcon } from "lucide-react";
import type { SerpentOption } from "#/api/typesGenerated";
import { DisabledBadge, EnabledBadge } from "#/components/Badge/PresetBadges";
import {
	deploymentGroupHasParent,
	useDeploymentOptions,
} from "#/utils/deployOptions";
import OptionsTable from "../OptionsTable";

type UserAuthSettingsPageViewProps = {
	options: SerpentOption[];
};

export const UserAuthSettingsPageView = ({
	options,
}: UserAuthSettingsPageViewProps): React.JSX.Element => {
	const oidcEnabled = Boolean(
		useDeploymentOptions(options, "OIDC Client ID")[0].value,
	);

	return (
		<div className="flex flex-col gap-12">
			<div>
				<h1 className="sr-only">User Authentication</h1>

				{/* Folded by default: its title and Enabled/Disabled stay in view, the settings open on a click */}
				<details className="rounded-xl border border-solid border-border bg-surface-primary p-6 [&[open]>summary]:mb-4">
					<summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
						<ChevronRightIcon
							aria-hidden
							className="size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none [details[open]>summary_&]:rotate-90"
						/>
						<span className="flex flex-col">
							<span className="text-lg font-semibold">
								OpenID Configurations
							</span>
							<span className="text-sm text-content-secondary">
								Set up authentication to login with OpenID Connect.
							</span>
						</span>
						<span className="ml-auto flex items-center gap-2">
							{oidcEnabled ? <EnabledBadge /> : <DisabledBadge />}
						</span>
					</summary>
					{oidcEnabled ? (
						<OptionsTable
							options={options.filter((o) =>
								deploymentGroupHasParent(o.group, "OIDC"),
							)}
						/>
					) : (
						<p className="m-0 text-sm text-content-secondary">
							OpenID Connect is not configured.
						</p>
					)}
				</details>
			</div>
		</div>
	);
};
