import { UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type * as TypesGen from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { UsersFilter } from "#/components/Filter/UsersFilter";
import {
	PaginationContainer,
	type PaginationResult,
} from "#/components/PaginationWidget/PaginationContainer";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import { AccountShareCables } from "#/modules/platform/cloudDrive/AccountShareCables";
import { BulkUserActions } from "#/modules/users/BulkUserActions";
import {
	UserActionDialogs,
	type UserAdminAction,
} from "#/modules/users/UserActionDialogs";
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
	const userIds = useMemo(
		() => (pageUsers ?? []).map((u) => u.id),
		[pageUsers],
	);
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

			{/* Platform: the accounts - their filter, the bulk actions and the table - in a card of their own, the first. */}
			<AccountShareCables userIds={userIds} accounts={pageUsers}>
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

					<PaginationContainer
						query={usersQuery}
						paginationUnitLabel="accounts"
					>
						{/* Platform: who shares their Cloud Drive with whom, as the Cloud Drive's cables between the rows. */}
						<UsersTable
							{...props}
							users={pageUsers}
							onAction={setAction}
							selected={props.canEditUsers ? selectedIds : undefined}
							onSelect={setSelectedIds}
						/>
					</PaginationContainer>
				</section>
			</AccountShareCables>

			{quota && (
				<section
					aria-label="User Quota"
					data-testid="user-quota"
					className="mb-6 rounded-lg border border-solid border-border px-6 pt-3"
				>
					{quota}
				</section>
			)}

			<UserActionDialogs action={action} onClose={() => setAction(undefined)} />
		</>
	);
};
