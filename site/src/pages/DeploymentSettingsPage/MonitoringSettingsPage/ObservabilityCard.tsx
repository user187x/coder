import { useEffect, useId, useRef } from "react";
import { useQuery } from "react-query";
import { useLocation } from "react-router";
import { deploymentConfig } from "#/api/queries/deployment";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { deploymentGroupHasParent } from "#/utils/deployOptions";
import OptionsTable from "../OptionsTable";

export const ObservabilityCard = ({
	scrollReady = true,
}: {
	scrollReady?: boolean;
}) => {
	const headingId = useId();
	const query = useQuery(deploymentConfig());
	const { hash } = useLocation();
	const section = useRef<HTMLElement>(null);
	useEffect(() => {
		if (hash === "#observability" && scrollReady)
			section.current?.scrollIntoView({ block: "start" });
	}, [hash, scrollReady]);
	return (
		<section
			ref={section}
			id="observability"
			aria-labelledby={headingId}
			className="mt-6 scroll-mt-40 rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<h2 id={headingId} className="m-0 mb-5 text-lg font-semibold">
				Observability
			</h2>
			{query.error && <ErrorAlert error={query.error} />}
			{query.isLoading ? (
				<Loader />
			) : (
				query.data && (
					<OptionsTable
						options={query.data.options.filter((option) =>
							deploymentGroupHasParent(option.group, "Introspection"),
						)}
					/>
				)
			)}
		</section>
	);
};
