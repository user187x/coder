import { useEffect } from "react";
import { useQuery } from "react-query";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import { paginatedGroupsByOrganization } from "#/api/queries/groups";
import { organizationsPermissions } from "#/api/queries/organizations";
import { EmptyState } from "#/components/EmptyState/EmptyState";
import { useFilter } from "#/components/Filter/Filter";
import { Loader } from "#/components/Loader/Loader";
import { usePaginatedQuery } from "#/hooks/usePaginatedQuery";
import { useFeatureVisibility } from "#/modules/dashboard/useFeatureVisibility";
import { RequirePermission } from "#/modules/permissions/RequirePermission";
import { pageTitle } from "#/utils/page";
import { useGroupsSettings } from "./GroupsPageProvider";
import { GroupsPageView } from "./GroupsPageView";

const GroupsPage: React.FC = () => {
	const { template_rbac: groupsEnabled } = useFeatureVisibility();
	const { organization, showOrganizations } = useGroupsSettings();
	const [searchParams, setSearchParams] = useSearchParams();
	const groupsQuery = usePaginatedQuery({
		...paginatedGroupsByOrganization(organization?.name ?? "", searchParams),
		enabled: Boolean(groupsEnabled && organization),
	});
	const filter = useFilter({
		searchParams,
		onSearchParamsChange: setSearchParams,
		onUpdate: groupsQuery.goToFirstPage,
	});
	const permissionsQuery = useQuery({
		...organizationsPermissions([organization?.id ?? ""]),
		enabled: Boolean(organization),
	});

	useEffect(() => {
		if (groupsQuery.error) {
			toast.error(
				getErrorMessage(groupsQuery.error, "Unable to load groups."),
				{
					description: getErrorDetail(groupsQuery.error),
				},
			);
		}
	}, [groupsQuery.error]);

	useEffect(() => {
		if (permissionsQuery.error) {
			toast.error(
				getErrorMessage(permissionsQuery.error, "Unable to load permissions."),
				{
					description: getErrorDetail(permissionsQuery.error),
				},
			);
		}
	}, [permissionsQuery.error]);

	if (!organization) {
		return <EmptyState message="Organization not found" />;
	}

	if (permissionsQuery.isLoading) {
		return <Loader />;
	}

	const title = <title>{pageTitle("Groups")}</title>;

	const permissions = permissionsQuery.data?.[organization.id];

	if (!permissions?.viewGroups) {
		return (
			<>
				{title}
				<RequirePermission isFeatureVisible={false} />
			</>
		);
	}

	return (
		<div className="w-full max-w-(--breakpoint-2xl) pb-10">
			{title}

			<GroupsPageView
				groups={groupsQuery.data?.groups}
				canCreateGroup={permissions.createGroup}
				groupsEnabled={groupsEnabled}
				showOrganizations={showOrganizations}
				filterProps={{ filter }}
				groupsQuery={groupsQuery}
			/>
		</div>
	);
};

export default GroupsPage;
