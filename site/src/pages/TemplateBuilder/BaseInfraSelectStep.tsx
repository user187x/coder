import { useEffect } from "react";
import { useQuery } from "react-query";
import { templateBuilderBases } from "#/api/queries/templateBuilder";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import {
	TemplateBuilderSubtitle,
	TemplateBuilderTitle,
} from "#/pages/TemplateBuilder/TemplateBuilderHeader";
import { sortByPriority } from "./sortByPriority";
import { TemplateCard } from "./TemplateCard";
import { type SelectedBaseMeta, toSelectedBaseMeta } from "./wizardState";

type BaseInfraSelectStepProps = {
	selectedBaseId: string | null;
	onSelectBase: (base: SelectedBaseMeta) => void;
};

// Platform: the deployment's own base template (Coder's TemplateBuilder.BaseTemplate) - its only base, so every new
// template keeps what the platform builds into it (the Cloud Drive, Lock Down, the user's certificate, the metrics).
export const PLATFORM_BASE_ID = "platform";

function detailsUrl(baseId: string): string | undefined {
	return baseId === PLATFORM_BASE_ID
		? undefined
		: `https://registry.coder.com/templates/${baseId}`;
}

// Preferred display order for base templates. Bases listed here appear first, in
// this order; unlisted bases follow in the order the API returns them (sorted by
// display name). Quickstart and Docker are the featured Docker-based starters,
// mirroring the client-side module prioritization in ModuleSelectStep.
const BASE_PRIORITY: readonly string[] = ["quickstart", "docker"];

export const BaseInfraSelectStep: React.FC<BaseInfraSelectStepProps> = ({
	selectedBaseId,
	onSelectBase,
}) => {
	const { data, error, isLoading } = useQuery(templateBuilderBases());
	const only = data?.bases.length === 1 ? data.bases[0] : undefined;
	// The deployment's base alone: chosen already.
	useEffect(() => {
		if (only && selectedBaseId === null) {
			onSelectBase(toSelectedBaseMeta(only));
		}
	}, [only, selectedBaseId, onSelectBase]);

	if (isLoading) {
		return <Loader />;
	}

	if (error) {
		return <ErrorAlert error={error} />;
	}

	const bases = sortByPriority(data?.bases ?? [], BASE_PRIORITY);

	return (
		<div role="radiogroup" aria-label="Base infrastructure templates">
			<TemplateBuilderTitle>
				{only ? "Your base template" : "Pick a base template"}
			</TemplateBuilderTitle>
			<TemplateBuilderSubtitle>
				{only
					? "Every new template starts from it, with your Cloud Drive and the rest of the platform in place."
					: "Select your infrastructure foundation."}
			</TemplateBuilderSubtitle>

			{/* Show three rows of cards (sized to the common 214px card height plus
			    the row gaps) and let any extra rows scroll, so the Continue button
			    stays high and is easy to discover. */}
			<div className="max-h-[682px] overflow-y-auto p-1 -m-1">
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{bases.map((base) => (
						<TemplateCard
							key={base.id}
							name={base.name}
							description={base.description}
							iconUrl={base.icon}
							detailsUrl={detailsUrl(base.id)}
							selected={base.id === selectedBaseId}
							onSelect={() => onSelectBase(toSelectedBaseMeta(base))}
						/>
					))}
				</div>
			</div>
		</div>
	);
};
