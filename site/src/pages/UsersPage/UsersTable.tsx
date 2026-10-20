import { cn } from "cn";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useQuery, useQueryClient } from "react-query";
import { useNavigate } from "react-router";
import { PlatformAPI, type WorkspaceNote } from "#/api/platform";
import type { GroupsByUserId } from "#/api/queries/groups";
import type * as TypesGen from "#/api/typesGenerated";
import { AvatarData } from "#/components/Avatar/AvatarData";
import { AvatarDataSkeleton } from "#/components/Avatar/AvatarDataSkeleton";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
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
import { TooltipMessage, TooltipTitle } from "#/components/Tooltip/Tooltip";
import { useClickableTableRow } from "#/hooks/useClickableTableRow";
import { ChatUserButton } from "#/modules/platform/chat/ChatUserButton";
import { ShareApprovalButton } from "#/modules/platform/cloudDrive/ShareApprovalButton";
import {
	formatActivity,
	formatLatency,
	INSIGHTS_DAYS,
	type UserInsight,
	useUserInsights,
} from "#/modules/platform/userInsights/userInsights";
import { UserNotesCell } from "#/modules/platform/workspaceNotes/UserNotesCell";
import type { UserAdminAction } from "#/modules/users/UserActionDialogs";
import { RolesHelpPopover } from "#/modules/users/UserHelpPopovers";
import { UserMoreActions } from "#/modules/users/UserMoreActions";
import { UserRoleCell } from "#/modules/users/UserRoleCell";
import { userWorkspaceHref as workspaceHrefOf } from "#/modules/users/userPlaces";
import { getLatencyColor } from "#/utils/latency";

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
	/** Platform: the accounts chosen for a bulk action (admins); undefined: no choosing. */
	selected?: ReadonlySet<string>;
	onSelect?: (ids: ReadonlySet<string>) => void;
};

export const UsersTable: React.FC<UsersTableProps> = (props) => {
	const { users = [], selected, onSelect } = props;
	// Platform: each user's latency and activity over the last seven days (what a template's Overview showed)
	const insights = useUserInsights(true);
	const choosable = users.filter((u) => u.id !== props.me);
	const all =
		choosable.length > 0 && choosable.every((u) => selected?.has(u.id));
	const some = choosable.some((u) => selected?.has(u.id));
	return (
		<Table data-testid="users-table" aria-label="Accounts">
			<TableHeader>
				<TableRow>
					{selected && onSelect && (
						<TableHead className="w-px pr-0">
							<Checkbox
								aria-label="Choose every account on this page"
								checked={all ? true : some ? "indeterminate" : false}
								disabled={choosable.length === 0}
								onCheckedChange={(v) =>
									onSelect(
										new Set(v === true ? choosable.map((u) => u.id) : []),
									)
								}
							/>
						</TableHead>
					)}
					<TableHead className="w-max">User</TableHead>
					<TableHead className="w-1/6">
						<div className="flex flex-row gap-2 items-center">
							<span>Roles</span>
							<RolesHelpPopover />
						</div>
					</TableHead>
					{/* Platform: admins' post-it notes on the user's workspaces, instead of Groups. */}
					<TableHead className="w-1/6">Notes</TableHead>
					{/* Platform: how the user's connections to their workspaces went, beside when they were last seen */}
					{insights.shown && (
						<>
							<TableHead className="w-[1%] whitespace-nowrap">
								<span className="flex items-center gap-1">
									Latency
									<InfoTooltip size="small">
										<TooltipTitle>Latency</TooltipTitle>
										<TooltipMessage>{`The median round trip of the user's connections to their workspaces over the last ${INSIGHTS_DAYS} days, every template.`}</TooltipMessage>
									</InfoTooltip>
								</span>
							</TableHead>
							<TableHead className="w-[1%] whitespace-nowrap">
								<span className="flex items-center gap-1">
									Activity
									<InfoTooltip size="small">
										<TooltipTitle>Activity</TooltipTitle>
										<TooltipMessage>{`How long the user was connected to their workspaces (apps, the terminal, SSH) over the last ${INSIGHTS_DAYS} days, every template.`}</TooltipMessage>
									</InfoTooltip>
								</span>
							</TableHead>
						</>
					)}
					<TableHead className="w-1/6">Status</TableHead>
				</TableRow>
			</TableHeader>

			<TableBody>
				<UsersTableBody {...props} insights={insights} />
			</TableBody>
		</Table>
	);
};

const UsersTableBody: React.FC<
	UsersTableProps & { insights: ReturnType<typeof useUserInsights> }
> = ({
	insights,
	isLoading,
	users,
	me,
	canEditUsers,
	canViewActivity,
	oidcRoleSyncEnabled,
	onAction,
	selected,
	onSelect,
}) => {
	const notesQuery = useQuery({
		queryKey: ["platform", "notes", "by-user"],
		queryFn: PlatformAPI.getNotesByUser,
		refetchInterval: 60_000,
		retry: false,
	});
	if (isLoading) {
		return (
			<UsersTableSkeleton
				canEditUsers={canEditUsers}
				insights={insights.shown}
			/>
		);
	}

	if (!users || users.length === 0) {
		return <TableEmpty message="No users found" />;
	}

	return users.map((user) => (
		<UsersTableRow
			key={user.id}
			user={user}
			selected={selected}
			onSelect={onSelect}
			notes={notesQuery.data?.users[user.id]}
			insight={
				insights.shown ? (insights.byUser.get(user.id) ?? {}) : undefined
			}
			most={insights.most}
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

type UsersTableRowProps = Omit<
	UsersTableProps,
	"isLoading" | "users" | "groupsByUserId"
> & {
	user: TypesGen.User;
	notes: readonly WorkspaceNote[] | undefined;
	/** Platform: their latency and activity (undefined: the columns are not shown). */
	insight?: UserInsight;
	/** The most time any user connected: the activity bars' scale. */
	most?: number;
};

/**
 * A click on a user's row opens their workspace when they have exactly one,
 * else their workspaces list (what the row menu's "View workspaces" opens).
 * Ctrl / Cmd-click opens it in a new tab.
 */
const UsersTableRow: React.FC<UsersTableRowProps> = ({
	user,
	notes,
	insight,
	most = 0,
	me,
	canEditUsers,
	canViewActivity,
	oidcRoleSyncEnabled,
	onAction,
	selected,
	onSelect,
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

	const userWorkspaceHref = () => workspaceHrefOf(queryClient, user.username);

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
			{selected && onSelect && (
				<TableCell className="w-px pr-0">
					<Checkbox
						aria-label={`Choose ${user.username}`}
						data-testid={`choose-${user.username}`}
						checked={selected.has(user.id)}
						disabled={user.id === me}
						onCheckedChange={(v) => {
							const next = new Set(selected);
							if (v === true) {
								next.add(user.id);
							} else {
								next.delete(user.id);
							}
							onSelect(next);
						}}
					/>
				</TableCell>
			)}
			<TableCell>
				<div className="flex items-center justify-between gap-3">
					<AvatarData
						title={user.username}
						subtitle={user.is_service_account ? "Service Account" : user.email}
						src={user.avatar_url}
					/>
					{/* Platform: a Cloud Drive share waiting for an admin, approved from here, before the chat button */}
					<div className="flex shrink-0 items-center gap-2">
						<ShareApprovalButton user={user} />
						<ChatUserButton user={user} />
					</div>
				</div>
			</TableCell>

			<UserRoleCell roles={user.roles} />

			<UserNotesCell username={user.username} notes={notes} />

			{insight && (
				<>
					<TableCell className="whitespace-nowrap" data-testid="user-latency">
						{insight.latency ? (
							<span
								className={cn(
									"text-sm font-medium tabular-nums",
									getLatencyColor(insight.latency.p50),
								)}
								title={`Median ${formatLatency(insight.latency.p50)}, 95th percentile ${formatLatency(insight.latency.p95)}`}
							>
								{formatLatency(insight.latency.p50)}
							</span>
						) : (
							<span className="text-sm text-content-disabled">—</span>
						)}
					</TableCell>
					<TableCell className="whitespace-nowrap" data-testid="user-activity">
						{insight.seconds ? (
							<div className="flex min-w-20 flex-col gap-1">
								<span className="text-sm tabular-nums text-content-primary">
									{formatActivity(insight.seconds)}
								</span>
								<span
									aria-hidden
									className="h-1 w-full overflow-hidden rounded-full bg-surface-tertiary"
								>
									<span
										className="block h-full rounded-full bg-content-link"
										style={{
											width: `${Math.max(4, (insight.seconds / Math.max(most, 1)) * 100)}%`,
										}}
									/>
								</span>
							</div>
						) : (
							<span className="text-sm text-content-disabled">—</span>
						)}
					</TableCell>
				</>
			)}

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
	insights?: boolean;
};

const UsersTableSkeleton: React.FC<UsersTableSkeletonProps> = ({
	canEditUsers,
	insights,
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

				{insights && (
					<>
						<TableCell>
							<Skeleton variant="text" width="40px" />
						</TableCell>
						<TableCell>
							<Skeleton variant="text" width="60px" />
						</TableCell>
					</>
				)}

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
