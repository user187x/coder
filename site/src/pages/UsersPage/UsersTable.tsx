import { cn } from "cn";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import type { GroupsByUserId } from "#/api/queries/groups";
import { workspaces } from "#/api/queries/workspaces";
import type * as TypesGen from "#/api/typesGenerated";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { AvatarDataSkeleton } from "#/components/Avatar/AvatarDataSkeleton";
import { LastSeen } from "#/components/LastSeen/LastSeen";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import {
	TableLoaderSkeleton,
	TableRowSkeleton,
} from "#/components/TableLoader/TableLoader";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import { ChatUserButton } from "#/modules/platform/chat/ChatUserButton";
import type { UserAdminAction } from "#/modules/users/UserActionDialogs";
import { UserGroupsCell } from "#/modules/users/UserGroupsCell";
import {
	GroupsHelpPopover,
	RolesHelpPopover,
} from "#/modules/users/UserHelpPopovers";
import { UserMoreActions } from "#/modules/users/UserMoreActions";
import { UserRoleCell } from "#/modules/users/UserRoleCell";

dayjs.extend(relativeTime);

export type UsersTableProps = {
	isLoading: boolean;
	users: readonly TypesGen.User[] | undefined;
	groupsByUserId: GroupsByUserId | undefined;
	/**
	 * Used to disable the UI of actions that users cannot perform on themselves,
	 * like delete.
	 */
	me: string;
	canEditUsers: boolean;
	canViewActivity?: boolean;
	/** User roles cannot be edited if OIDC Role Sync is enabled. */
	oidcRoleSyncEnabled?: boolean;
	onAction: (action: UserAdminAction) => void;
};

export const UsersTable: React.FC<UsersTableProps> = (props) => {
	return (
		<Table data-testid="users-table" aria-label="Accounts">
			<TableHeader>
				<TableRow>
					<TableHead className="w-max">User</TableHead>
					<TableHead className="w-1/6">
						<div className="flex flex-row gap-2 items-center">
							<span>Roles</span>
							<RolesHelpPopover />
						</div>
					</TableHead>
					<TableHead className="w-1/6">
						<div className="flex flex-row gap-2 items-center">
							<span>Groups</span>
							<GroupsHelpPopover />
						</div>
					</TableHead>
					<TableHead className="w-1/6">Status</TableHead>
				</TableRow>
			</TableHeader>

			<TableBody>
				<UsersTableBody {...props} />
			</TableBody>
		</Table>
	);
};

const UsersTableBody: React.FC<UsersTableProps> = ({
	isLoading,
	users,
	groupsByUserId,
	me,
	canEditUsers,
	canViewActivity,
	oidcRoleSyncEnabled,
	onAction,
}) => {
	if (isLoading) {
		return <UsersTableSkeleton canEditUsers={canEditUsers} />;
	}

	if (!users || users.length === 0) {
		return <TableEmpty message="No users found" />;
	}

	return users.map((user) => (
		<UsersTableRow
			key={user.id}
			user={user}
			groupsByUserId={groupsByUserId}
			me={me}
			canEditUsers={canEditUsers}
			canViewActivity={canViewActivity}
			oidcRoleSyncEnabled={oidcRoleSyncEnabled}
			onAction={onAction}
		/>
	));
};

// Clicks meant for something inside the row (Chat, the menu, the groups and
// roles pop-overs) are left to it.
const ROW_CONTROLS =
	"a, button, input, select, textarea, label, [role=menuitem], [role=menu], [role=dialog], [role=checkbox]";

type UsersTableRowProps = Omit<UsersTableProps, "isLoading" | "users"> & {
	user: TypesGen.User;
};

/**
 * A click on a user's row opens their workspace when they have exactly one,
 * else their workspaces list (what the row menu's "View workspaces" opens).
 * Ctrl / Cmd-click opens it in a new tab.
 */
const UsersTableRow: React.FC<UsersTableRowProps> = ({
	user,
	groupsByUserId,
	me,
	canEditUsers,
	canViewActivity,
	oidcRoleSyncEnabled,
	onAction,
}) => {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	const open = async (href: () => Promise<string>, newTab: boolean) => {
		const target = await href();
		if (newTab) {
			window.open(target, "_blank", "noopener");
		} else {
			navigate(target);
		}
	};

	const userWorkspaceHref = async () => {
		const list = `/workspaces?filter=${encodeURIComponent(`owner:${user.username}`)}`;
		try {
			const result = await queryClient.fetchQuery(
				workspaces({ q: `owner:${user.username}`, limit: 2 }),
			);
			const [only] = result.workspaces;
			return result.count === 1 && only
				? `/@${encodeURIComponent(only.owner_name)}/${encodeURIComponent(only.name)}`
				: list;
		} catch {
			return list;
		}
	};

	const clickable = useClickableTableRow({
		onClick: (event) => {
			const target = event.target;
			if (
				target instanceof Element &&
				target !== event.currentTarget &&
				target.closest(ROW_CONTROLS)
			) {
				return;
			}
			if (window.getSelection()?.toString().trim()) {
				return;
			}
			void open(userWorkspaceHref, event.ctrlKey || event.metaKey);
		},
		onMiddleClick: () => {
			void open(userWorkspaceHref, true);
		},
	});

	return (
		<TableRow {...clickable} data-testid={`user-${user.id}`}>
			<TableCell>
				<div className="flex items-center justify-between gap-3">
					<AvatarData
						title={user.username}
						subtitle={user.is_service_account ? "Service Account" : user.email}
						src={user.avatar_url}
					/>
					<ChatUserButton user={user} />
				</div>
			</TableCell>

			<UserRoleCell roles={user.roles} />

			<UserGroupsCell userGroups={groupsByUserId?.get(user.id)} />

			<TableCell
				className={cn(
					"capitalize",
					user.status === "suspended" && "text-content-secondary",
				)}
			>
				<div>{user.status}</div>
				{(user.status === "active" || user.status === "dormant") && (
					<LastSeen at={user.last_seen_at} exactDays className="text-xs" />
				)}
			</TableCell>

			{canEditUsers && (
				<TableCell className="w-px whitespace-nowrap text-right">
					<div className="flex justify-end">
						<UserMoreActions
							user={user}
							me={me}
							canViewActivity={canViewActivity}
							oidcRoleSyncEnabled={oidcRoleSyncEnabled}
							onAction={onAction}
						/>
					</div>
				</TableCell>
			)}
		</TableRow>
	);
};

type UsersTableSkeletonProps = {
	canEditUsers: boolean;
};

const UsersTableSkeleton: React.FC<UsersTableSkeletonProps> = ({
	canEditUsers,
}) => {
	return (
		<TableLoaderSkeleton>
			<TableRowSkeleton>
				<TableCell>
					<AvatarDataSkeleton />
				</TableCell>

				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>

				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>

				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>

				{canEditUsers && (
					<TableCell className="w-px whitespace-nowrap text-right">
						<div className="flex justify-end">
							<Skeleton variant="text" width="25%" />
						</div>
					</TableCell>
				)}
			</TableRowSkeleton>
		</TableLoaderSkeleton>
	);
};
