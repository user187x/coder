import { createContext, Suspense, useContext } from "react";
import { useQuery } from "react-query";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { API } from "#/api/api";
import { checkAuthorization } from "#/api/queries/authCheck";
import type { AuthorizationRequest } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Loader } from "#/components/Loader/Loader";
import { Margins } from "#/components/Margins/Margins";
import { LinkTabs, LinkTabsList, TabLink } from "#/components/Tabs/Tabs";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import {
	type WorkspacePermissions,
	workspacePermissionChecks,
} from "#/modules/permissions/workspaces";
import { TemplatePageHeader } from "./TemplatePageHeader";

const templatePermissions = (
	templateId: string,
): AuthorizationRequest["checks"] => ({
	canUpdateTemplate: {
		object: {
			resource_type: "template",
			resource_id: templateId,
		},
		action: "update",
	},
	canReadInsights: {
		object: {
			resource_type: "template",
			resource_id: templateId,
		},
		action: "view_insights",
	},
});

const fetchTemplate = async (organizationId: string, templateName: string) => {
	const template = await API.getTemplateByName(organizationId, templateName);

	const [activeVersion, permissions] = await Promise.all([
		API.getTemplateVersion(template.active_version_id),
		API.checkAuthorization({
			checks: templatePermissions(template.id),
		}),
	]);

	return {
		template,
		activeVersion,
		permissions,
	};
};

type TemplateLayoutContextValue = Awaited<ReturnType<typeof fetchTemplate>>;

const TemplateLayoutContext = createContext<
	TemplateLayoutContextValue | undefined
>(undefined);

export const useTemplateLayoutContext = (): TemplateLayoutContextValue => {
	const context = useContext(TemplateLayoutContext);
	if (!context) {
		throw new Error(
			"useTemplateLayoutContext only can be used inside of TemplateLayout",
		);
	}
	return context;
};

export const TemplateLayout: React.FC<React.PropsWithChildren> = ({
	children = <Outlet />,
}) => {
	const navigate = useNavigate();
	const { user: me } = useAuthenticated();
	const { organization: organizationName = "default", template: templateName } =
		useParams() as { organization?: string; template: string };
	const { data, error, isLoading } = useQuery({
		queryKey: ["template", templateName],
		queryFn: () => fetchTemplate(organizationName, templateName),
	});
	const workspacePermissionsQuery = useQuery({
		...checkAuthorization({
			checks: workspacePermissionChecks(
				data?.template.organization_id ?? "",
				me.id,
			),
		}),
		enabled: Boolean(data),
	});

	const location = useLocation();
	const paths = location.pathname.split("/");
	const templateNamePath = paths.at(-1);
	const activeTab =
		templateNamePath === templateName
			? "summary"
			: (templateNamePath as string);
	const { workspace_prebuilds: isWorkspacePrebuildsEnabled } =
		useFeatureVisibility();
	const showPrebuilds =
		isWorkspacePrebuildsEnabled && Boolean(data?.permissions.canUpdateTemplate);

	if (error || workspacePermissionsQuery.error) {
		return (
			<div className="p-4">
				<ErrorAlert error={error} />
			</div>
		);
	}

	if (isLoading || !data || !workspacePermissionsQuery.data) {
		return <Loader />;
	}

	return (
		<div className="pb-12">
			<TemplatePageHeader
				template={data.template}
				activeVersion={data.activeVersion}
				permissions={data.permissions}
				workspacePermissions={
					workspacePermissionsQuery.data as WorkspacePermissions
				}
				onDeleteTemplate={() => {
					navigate("/templates");
				}}
			/>

			{/* Platform: Source Code is the template page's one view (Overview is gone); tabs only with Prebuilds beside it */}
			{showPrebuilds ? (
				<LinkTabs active={activeTab} className="mb-10 -mt-3">
					<Margins>
						<LinkTabsList>
							<TabLink to="files" value="files">
								Source Code
							</TabLink>
							<TabLink to="prebuilds" value="prebuilds">
								Prebuilds
							</TabLink>
						</LinkTabsList>
					</Margins>
				</LinkTabs>
			) : (
				<div className="mt-1" />
			)}

			<Margins>
				<TemplateLayoutContext.Provider value={data}>
					<Suspense fallback={<Loader />}>{children}</Suspense>
				</TemplateLayoutContext.Provider>
			</Margins>
		</div>
	);
};
