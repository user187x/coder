import "#/modules/platform/settingsPage/settingsPage.css";
import { createContext, Suspense, useContext } from "react";
import { useQuery } from "react-query";
import { Outlet, useParams } from "react-router";
import { checkAuthorization } from "#/api/queries/authCheck";
import { templateByName } from "#/api/queries/templates";
import type { AuthorizationResponse, Template } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { Loader } from "#/components/Loader/Loader";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import {
	type Crumb,
	SettingsPageHeader,
} from "#/modules/platform/settingsPage/SettingsPageHeader";
import { TerminalGlyph } from "#/modules/platform/settingsPage/settingsIcons";
import { pageTitle } from "#/utils/page";

const TemplateSettings = createContext<
	{ template: Template; permissions: AuthorizationResponse } | undefined
>(undefined);

export function useTemplateSettings() {
	const value = useContext(TemplateSettings);
	if (!value) {
		throw new Error("This hook can only be used from a template settings page");
	}

	return value;
}

/**
 * Platform: the template settings page's frame, in the workspace settings page's look (settingsPage.css) - its
 * header (the way back to Templates and the template, the title, the active version) over the page
 * (TemplateSettingsCardsPage).
 */
export const TemplateSettingsLayout: React.FC = () => {
	const { showOrganizations } = useDashboard();
	const getLink = useLinks();
	const { organization: organizationName = "default", template: templateName } =
		useParams() as { organization?: string; template: string };
	const templateQuery = useQuery(
		templateByName(organizationName, templateName),
	);

	const permissionsQuery = useQuery({
		...checkAuthorization({
			checks: {
				canUpdateTemplate: {
					object: {
						resource_type: "template",
						resource_id: templateQuery.data?.id ?? "",
					},
					action: "update",
				},
			},
		}),
		enabled: templateQuery.isSuccess,
	});

	if (!templateQuery.data || !permissionsQuery.data) {
		return <Loader />;
	}

	const error = templateQuery.isError || permissionsQuery.isError;
	// We override `organization_name` here because we may have fallen back to
	// `"default"` while fetching if the deployment does not have the
	// organizations feature enabled, and so we need to make sure consumers do the
	// same when invalidating queries.
	const template = {
		...templateQuery.data,
		organization_name: organizationName,
	};
	const crumbs: Crumb[] = [
		{ label: "Templates", to: "/templates" },
		...(showOrganizations
			? [
					{
						label:
							template.organization_display_name || template.organization_name,
						to: `/organizations/${template.organization_name}`,
					},
				]
			: []),
		{
			label: template.display_name || template.name,
			to: getLink(linkToTemplate(template.organization_name, template.name)),
		},
	];

	return (
		<div className="ws-settings min-h-full">
			<title>
				{pageTitle(template.display_name || templateName, "Template Settings")}
			</title>
			<SettingsPageHeader
				icon={
					template.icon ? (
						<ExternalImage
							src={template.icon}
							alt=""
							className="size-6 object-contain"
						/>
					) : (
						<TerminalGlyph />
					)
				}
				crumbs={crumbs}
				title="Template settings"
				versionId={template.active_version_id}
			/>
			{error ? (
				<div className="mx-auto max-w-(--ws-content) p-8">
					<ErrorAlert error={error} />
				</div>
			) : (
				<TemplateSettings.Provider
					value={{
						template: templateQuery.data,
						permissions: permissionsQuery.data,
					}}
				>
					<Suspense fallback={<Loader />}>
						<Outlet />
					</Suspense>
				</TemplateSettings.Provider>
			)}
		</div>
	);
};
