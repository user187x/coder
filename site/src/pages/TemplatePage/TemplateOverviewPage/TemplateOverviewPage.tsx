import frontMatter from "front-matter";
import { lazy, Suspense } from "react";
import { useQuery } from "react-query";
import { Navigate } from "react-router";
import { API } from "#/api/api";
import { Loader } from "#/components/Loader/Loader";
import { MemoizedMarkdown } from "#/components/Markdown/Markdown";
import { TemplateResourcesTable } from "#/modules/templates/TemplateResourcesTable/TemplateResourcesTable";
import { useTemplateLayoutContext } from "#/pages/TemplatePage/TemplateLayout";
import { getTemplatePageTitle } from "../utils";

// Its charts load only with the Overview.
const TemplateDetailsSection = lazy(
	() => import("../TemplateInsightsPage/TemplateInsightsPage"),
);

/**
 * A template's Overview: the resources a workspace of it gets, its Details
 * (usage: active users, latency, apps, parameters; what was the Details tab),
 * then its docs (the active version's README) beneath them.
 */
const TemplateOverviewPage: React.FC = () => {
	const { template, activeVersion } = useTemplateLayoutContext();
	const { data: resources } = useQuery({
		queryKey: ["templates", template.id, "resources"],
		queryFn: () => API.getTemplateVersionResources(activeVersion.id),
	});
	const readme = frontMatter(activeVersion.readme);

	return (
		<>
			<title>{getTemplatePageTitle("Overview", template)}</title>
			<div className="flex flex-col gap-8">
				{resources ? (
					<TemplateResourcesTable
						resources={resources.filter(
							(r) => r.workspace_transition === "start",
						)}
					/>
				) : (
					<Loader />
				)}
				<Suspense fallback={<Loader />}>
					<TemplateDetailsSection />
				</Suspense>
				<section
					className="rounded-lg border border-solid border-border bg-surface-primary"
					id="readme"
					aria-label="Docs"
				>
					<div className="border-0 border-b border-solid border-border px-6 py-4 font-semibold text-content-secondary">
						README.md
					</div>
					<div className="max-w-[860px] px-8 pb-12 pt-2">
						{readme.body.trim() ? (
							<MemoizedMarkdown>{readme.body}</MemoizedMarkdown>
						) : (
							<p className="text-sm text-content-secondary">
								This template has no README.md. Add one to its files to describe
								it here.
							</p>
						)}
					</div>
				</section>
			</div>
		</>
	);
};

/** Versions now live in Source Code (editors) and the old tabs (Docs, Resources, Details) in Overview: their links still land. */
export const TemplateVersionsRedirect: React.FC = () => {
	const { permissions } = useTemplateLayoutContext();
	return (
		<Navigate
			to={permissions.canUpdateTemplate ? "../files" : "../overview"}
			replace
		/>
	);
};

export default TemplateOverviewPage;
