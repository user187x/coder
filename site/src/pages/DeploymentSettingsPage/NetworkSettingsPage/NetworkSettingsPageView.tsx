import { ChevronDownIcon } from "lucide-react";
import type { Experiment, SerpentOption } from "#/api/typesGenerated";
import { Alert, AlertTitle } from "#/components/Alert/Alert";
import { BadgeGroup } from "#/components/Badge/Badge";
import { DisabledBadge, EnabledBadge } from "#/components/Badge/PresetBadges";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { deploymentGroupHasParent } from "#/utils/deployOptions";
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
	<Collapsible className="rounded-lg border border-solid border-border bg-surface-primary/40">
		<h2 className="m-0">
			<CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg border-0 bg-transparent p-6 text-left text-content-primary hover:bg-surface-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content-link">
				<span className="flex min-w-0 flex-col gap-1">
					<span className="text-lg font-semibold">Coder Configurations</span>
					<span className="text-sm font-normal text-content-secondary">
						Deployment connectivity, TLS, experiments and port forwarding.
					</span>
					{invalidExperiments.length > 0 && (
						<span className="text-sm font-normal text-content-warning">
							{invalidExperiments.length} invalid experiment
							{invalidExperiments.length === 1 ? "" : "s"}
						</span>
					)}
				</span>
				<ChevronDownIcon
					aria-hidden
					className="size-5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
				/>
			</CollapsibleTrigger>
		</h2>
		<CollapsibleContent className="flex flex-col gap-8 px-6 pb-6 data-[state=closed]:hidden">
			<div>
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
						...FROM_OVERVIEW.flatMap((name) =>
							options.filter((option) => option.name === name),
						),
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
					{options.some(
						(option) =>
							option.name === "Wildcard Access URL" && Boolean(option.value),
					) ? (
						<EnabledBadge />
					) : (
						<DisabledBadge />
					)}
				</BadgeGroup>
			</div>
		</CollapsibleContent>
	</Collapsible>
);
