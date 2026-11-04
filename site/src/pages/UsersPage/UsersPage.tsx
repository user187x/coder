import { useState } from "react";
import { useQuery } from "react-query";
import { useSearchParams } from "react-router";
import { deploymentConfig } from "#/api/queries/deployment";
import { groupsByUserId } from "#/api/queries/groups";
import { paginatedUsers } from "#/api/queries/users";
import { useFilter } from "#/components/Filter/Filter";
import { useStatusFilterMenu } from "#/components/Filter/UsersFilter";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { usePaginatedQuery } from "#/hooks/usePaginatedQuery";
import { useDashboard } from "#/modules/dashboard/useDashboard";
import { ShortTermLeases } from "#/modules/platform/shortTermLeases/ShortTermLeases";
import { pageTitle } from "#/utils/page";
import { UserQuotaProvider, UserQuotaSection } from "./UserQuotaSection";
import { UsersPageView } from "./UsersPageView";

const UsersPage: React.FC = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const [createLeaseOpen, setCreateLeaseOpen] = useState(false);
	const { entitlements } = useDashboard();

	const groupsByUserIdQuery = useQuery(groupsByUserId());

	const { permissions, user: me } = useAuthenticated();
	const {
		createUser: canCreateUser,
		updateUsers: canEditUsers,
		viewDeploymentConfig,
	} = permissions;
	const { data: deploymentValues } = useQuery({
		...deploymentConfig(),
		enabled: viewDeploymentConfig,
	});

	const focused = searchParams.get("focus") === "1";
	const sizeParam = focused ? "focus_limit" : "limit";
	const requestedSize = Number(searchParams.get(sizeParam));
	const sizes = focused ? [10, 25, 50, 100] : [10, 25, 50];
	const limit = sizes.includes(requestedSize)
		? requestedSize
		: focused
			? 100
			: 10;
	const updateView = (key: string, value: string | undefined) => {
		const next = new URLSearchParams(searchParams);
		if (value === undefined) next.delete(key);
		else next.set(key, value);
		next.delete("page");
		setSearchParams(next);
	};
	const usersQuery = usePaginatedQuery({
		...paginatedUsers(searchParams),
		recordsPerPage: limit,
	});
	const useFilterResult = useFilter({
		searchParams,
		onSearchParamsChange: (params) => {
			const next = new URLSearchParams(params);
			next.delete("page");
			setSearchParams(next);
		},
	});

	const statusMenu = useStatusFilterMenu({
		value: useFilterResult.values.status,
		onChange: (option) =>
			useFilterResult.update({
				...useFilterResult.values,
				status: option?.value,
			}),
	});

	// Indicates if oidc roles are synced from the oidc idp.
	// Assign 'false' if unknown.
	const oidcRoleSyncEnabled =
		viewDeploymentConfig &&
		deploymentValues?.config.oidc?.user_role_field !== "";

	const isLoading = usersQuery.isLoading || groupsByUserIdQuery.isLoading;

	return (
		<>
			<title>{pageTitle("Accounts")}</title>

			<UserQuotaProvider enabled={permissions.editDeploymentConfig}>
				<UsersPageView
					isLoading={isLoading}
					filterProps={{
						filter: useFilterResult,
						error: usersQuery.error,
						menus: { status: statusMenu },
					}}
					usersQuery={usersQuery}
					focused={focused}
					onFocusChange={(open) => updateView("focus", open ? "1" : undefined)}
					onPageSizeChange={(size) => updateView(sizeParam, String(size))}
					groupsByUserId={groupsByUserIdQuery.data}
					me={me.id}
					canCreateUser={canCreateUser}
					onCreateLease={
						permissions.editDeploymentConfig
							? () => setCreateLeaseOpen(true)
							: undefined
					}
					leases={
						permissions.editDeploymentConfig && (
							<ShortTermLeases
								creating={createLeaseOpen}
								onCreatingChange={setCreateLeaseOpen}
							/>
						)
					}
					canEditUsers={canEditUsers}
					canManageWorkspaces={permissions.editDeploymentConfig}
					canViewActivity={entitlements.features.audit_log.enabled}
					oidcRoleSyncEnabled={oidcRoleSyncEnabled}
					quota={
						permissions.editDeploymentConfig ? <UserQuotaSection /> : undefined
					}
				/>
			</UserQuotaProvider>
		</>
	);
};

export default UsersPage;
