import { UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type * as TypesGen from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { UsersFilter } from "#/components/Filter/UsersFilter";
import { PaginationAmount } from "#/components/PaginationWidget/PaginationAmount";
import type { PaginationResult } from "#/components/PaginationWidget/PaginationContainer";
import { PaginationWidgetBase } from "#/components/PaginationWidget/PaginationWidgetBase";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { ShortTermLeases } from "#/modules/platform/shortTermLeases/ShortTermLeases";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import { BulkUserActions } from "#/modules/users/BulkUserActions";
import {
	UserActionDialogs,
	type UserAdminAction,
} from "#/modules/users/UserActionDialogs";
import { WorkspaceSchedulerSection } from "#/pages/HealthPage/WorkspaceSchedulerSection";
import { UsersTable, type UsersTableProps } from "./UsersTable";

type UsersPageViewProps = Omit<
	UsersTableProps,
	"users" | "onAction" | "selected" | "onSelect"
> & {
	filterProps: React.ComponentProps<typeof UsersFilter>;
	usersQuery: PaginationResult<TypesGen.GetUsersResponse>;
	canCreateUser?: boolean;
	/** User Quota (UserQuotaSection), for admins: shared controls below the merged accounts table. */
	quota?: React.ReactNode;
};

export const UsersPageView: React.FC<UsersPageViewProps> = ({
	filterProps,
	usersQuery,
	canCreateUser,
	quota,
	...props
}) => {
	const [action, setAction] = useState<UserAdminAction | undefined>();
	// Platform: accounts chosen for Edit Roles, Suspend, Delete or Chat at once (on this page).
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const pageUsers = usersQuery.data?.users;
	const selected = useMemo(
		() => (pageUsers ?? []).filter((u) => selectedIds.has(u.id)),
		[pageUsers, selectedIds],
	);

	return (
		<>
			<SettingsHeader
				actions={
					canCreateUser && (
						<Button asChild>
							<Link to="create">
								<UserPlusIcon />
								New account
							</Link>
						</Button>
					)
				}
			>
				<SettingsHeaderTitle>Accounts</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Manage user accounts, permissions and resource quotas. Expand an
					account to manage its workspaces.
				</SettingsHeaderDescription>
			</SettingsHeader>

			<section
				aria-label="Accounts"
				data-testid="accounts-card"
				className="mb-6 flex flex-col gap-3 rounded-lg border border-solid border-border p-6"
			>
				<UsersFilter {...filterProps} />

				{props.canEditUsers && (
					<BulkUserActions
						selected={selected}
						me={props.me}
						oidcRoleSyncEnabled={props.oidcRoleSyncEnabled}
						onClear={() => setSelectedIds(new Set())}
					/>
				)}

				<TableCard
					summary={
						<PaginationAmount
							limit={usersQuery.limit}
							totalRecords={usersQuery.totalRecords}
							currentOffsetStart={usersQuery.currentOffsetStart}
							countIsCapped={usersQuery.countIsCapped}
							paginationUnitLabel="accounts"
							className="h-auto"
						/>
					}
				>
					<UsersTable
						{...props}
						users={pageUsers}
						onAction={setAction}
						selected={props.canEditUsers ? selectedIds : undefined}
						onSelect={setSelectedIds}
					/>
				</TableCard>
				{usersQuery.totalRecords !== undefined && (
					<PaginationWidgetBase
						totalRecords={usersQuery.totalRecords}
						totalPages={usersQuery.totalPages}
						currentPage={usersQuery.currentPage}
						pageSize={usersQuery.limit}
						onPageChange={usersQuery.onPageChange}
						hasPreviousPage={usersQuery.hasPreviousPage}
						hasNextPage={usersQuery.hasNextPage}
					/>
				)}
			</section>
			{canCreateUser && <ShortTermLeases />}

			{quota && (
				<section
					aria-label="User Quota"
					data-testid="user-quota"
					className="mb-6 rounded-lg border border-solid border-border p-6"
				>
					{quota}
				</section>
			)}

			{quota && (
				<section
					aria-label="Global Workspace Scheduler"
					className="mb-6 rounded-lg border border-solid border-border p-6"
				>
					<WorkspaceSchedulerSection />
				</section>
			)}

			<UserActionDialogs action={action} onClose={() => setAction(undefined)} />
		</>
	);
};
