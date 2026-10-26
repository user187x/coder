import { cn } from "cn";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useContext, useId, useState } from "react";
import { useQuery } from "react-query";
import type { WorkspaceNote } from "#/api/platform";
import type { GroupsByUserId } from "#/api/queries/groups";
import { notesByUser } from "#/api/queries/platform";
import type * as TypesGen from "#/api/typesGenerated";
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
import { getLatencyColor } from "#/utils/latency";
import { AccountIdentity } from "./AccountIdentity";
import { AccountResourcesCell } from "./AccountResourcesCell";
import { AccountWorkspaceActions } from "./AccountWorkspaceActions";
import { AccountWorkspacePanel } from "./AccountWorkspacePanel";
import "./usersTable.css";
import { QuotaEditorContext } from "./UserQuotaSection";

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
	canManageWorkspaces?: boolean;
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
	const quota = useContext(QuotaEditorContext);
	const [selectedWorkspaces, setSelectedWorkspaces] = useState<
		ReadonlyMap<string, TypesGen.Workspace>
	>(new Map());
	const onWorkspaceSelect = (workspace: TypesGen.Workspace, checked: boolean) =>
		setSelectedWorkspaces((before) => {
			const next = new Map(before);
			if (checked) next.set(workspace.id, workspace);
			else next.delete(workspace.id);
			return next;
		});
	// Platform: each user's latency and activity over the last seven days (what a template's Overview showed)
	const insights = useUserInsights(true);
	const choosable = users.filter((u) => u.id !== props.me);
	const all =
		choosable.length > 0 && choosable.every((u) => selected?.has(u.id));
	const some = choosable.some((u) => selected?.has(u.id));
	return (
		<>
			{props.canManageWorkspaces && selectedWorkspaces.size > 0 && (
				<AccountWorkspaceActions
					targets={[...selectedWorkspaces.values()]}
					onClear={() => setSelectedWorkspaces(new Map())}
				/>
			)}
			<Table
				data-testid="users-table"
				aria-label="Accounts"
				className="accounts-table"
				wrapperClassName="accounts-table-surface"
			>
				<colgroup>
					{selected && onSelect && <col style={{ width: "3%" }} />}
					<col
						style={{
							width: `${100 - 9 - 11 - 10 - (quota ? 18 : 0) - (insights.shown ? 18 : 0) - (props.canEditUsers ? 5 : 0) - (selected && onSelect ? 3 : 0)}%`,
						}}
					/>
					<col style={{ width: "9%" }} />
					<col style={{ width: "11%" }} />
					{quota && <col style={{ width: "18%" }} />}
					{insights.shown && (
						<>
							<col style={{ width: "9%" }} />
							<col style={{ width: "9%" }} />
						</>
					)}
					<col style={{ width: "10%" }} />
					{props.canEditUsers && <col style={{ width: "5%" }} />}
				</colgroup>
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
						<TableHead>User</TableHead>
						<TableHead>
							<div className="flex flex-row gap-2 items-center">
								<span>Roles</span>
								<RolesHelpPopover />
							</div>
						</TableHead>
						{/* Platform: admins' post-it notes on the user's workspaces, instead of Groups. */}
						<TableHead>Notes</TableHead>
						{quota && <TableHead>Resources</TableHead>}
						{/* Platform: how the user's connections to their workspaces went, beside when they were last seen */}
						{insights.shown && (
							<>
								<TableHead className="whitespace-nowrap text-center">
									<span className="flex items-center justify-center gap-1">
										Latency
										<InfoTooltip size="small">
											<TooltipTitle>Latency</TooltipTitle>
											<TooltipMessage>{`The median round trip of the user's connections to their workspaces over the last ${INSIGHTS_DAYS} days, every template.`}</TooltipMessage>
										</InfoTooltip>
									</span>
								</TableHead>
								<TableHead className="whitespace-nowrap text-center">
									<span className="flex items-center justify-center gap-1">
										Activity
										<InfoTooltip size="small">
											<TooltipTitle>Activity</TooltipTitle>
											<TooltipMessage>{`How long the user was connected to their workspaces (apps, the terminal, SSH) over the last ${INSIGHTS_DAYS} days, every template.`}</TooltipMessage>
										</InfoTooltip>
									</span>
								</TableHead>
							</>
						)}
						<TableHead className="text-center">Status</TableHead>
						{props.canEditUsers && (
							<TableHead>
								<span className="sr-only">Account actions</span>
							</TableHead>
						)}
					</TableRow>
				</TableHeader>

				<TableBody>
					<UsersTableBody
						{...props}
						insights={insights}
						selectedWorkspaces={selectedWorkspaces}
						onWorkspaceSelect={onWorkspaceSelect}
					/>
				</TableBody>
			</Table>
		</>
	);
};

const UsersTableBody: React.FC<
	UsersTableProps & {
		insights: ReturnType<typeof useUserInsights>;
		selectedWorkspaces: ReadonlyMap<string, TypesGen.Workspace>;
		onWorkspaceSelect: (
			workspace: TypesGen.Workspace,
			checked: boolean,
		) => void;
	}
> = ({
	insights,
	selectedWorkspaces,
	onWorkspaceSelect,
	canManageWorkspaces,
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
	const notesQuery = useQuery(notesByUser());
	if (isLoading) {
		return (
			<UsersTableSkeleton
				canEditUsers={canEditUsers}
				selectable={Boolean(selected && onSelect)}
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
			selectedWorkspaces={selectedWorkspaces}
			onWorkspaceSelect={onWorkspaceSelect}
			canManageWorkspaces={canManageWorkspaces}
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
	selectedWorkspaces: ReadonlyMap<string, TypesGen.Workspace>;
	onWorkspaceSelect: (workspace: TypesGen.Workspace, checked: boolean) => void;
	notes: readonly WorkspaceNote[] | undefined;
	/** Platform: their latency and activity (undefined: the columns are not shown). */
	insight?: UserInsight;
	/** The most time any user connected: the activity bars' scale. */
	most?: number;
};

/**
 * A user row expands in place; workspace dashboards remain explicit links.
 */
const UsersTableRow: React.FC<UsersTableRowProps> = ({
	user,
	selectedWorkspaces,
	onWorkspaceSelect,
	canManageWorkspaces,
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
	const [expanded, setExpanded] = useState(false);
	const panelId = useId();
	const quota = useContext(QuotaEditorContext);
	const columns =
		4 +
		(insight ? 2 : 0) +
		(quota ? 1 : 0) +
		(canEditUsers ? 1 : 0) +
		(selected && onSelect ? 1 : 0);
	const toggle = (event: React.MouseEvent<HTMLTableRowElement>) => {
		const target = event.target;
		if (
			target instanceof Element &&
			(!event.currentTarget.contains(target) || target.closest(ROW_CONTROLS))
		)
			return;
		if (window.getSelection()?.toString().trim()) return;
		setExpanded((value) => !value);
	};

	return (
		<>
			<TableRow
				onClick={toggle}
				className="cursor-pointer"
				data-testid={`user-${user.id}`}
			>
				{selected && onSelect && (
					<TableCell data-account-field="selection" className="w-px pr-0">
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
				<TableCell data-account-field="identity">
					<AccountIdentity
						user={user}
						expanded={expanded}
						panelId={panelId}
						onToggle={() => setExpanded((value) => !value)}
					>
						<ShareApprovalButton user={user} />
						<ChatUserButton user={user} />
					</AccountIdentity>
				</TableCell>

				<UserRoleCell roles={user.roles} className="account-roles" />

				<UserNotesCell
					username={user.username}
					notes={notes}
					className="account-notes"
				/>
				{quota && <AccountResourcesCell user={user} />}

				{insight && (
					<>
						<TableCell
							className="whitespace-nowrap text-center"
							data-testid="user-latency"
							data-label="Latency"
						>
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
						<TableCell
							className="whitespace-nowrap text-center"
							data-testid="user-activity"
							data-label="Activity"
						>
							{insight.seconds ? (
								<div className="mx-auto flex min-w-0 max-w-20 flex-col items-center gap-1">
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
					data-label="Status"
					className={cn(
						"capitalize text-center",
						user.status === "suspended" && "text-content-secondary",
					)}
				>
					<div>{user.status}</div>
					{(user.status === "active" || user.status === "dormant") && (
						<LastSeen at={user.last_seen_at} exactDays className="text-xs" />
					)}
				</TableCell>

				{canEditUsers && (
					<TableCell
						data-account-field="actions"
						className="whitespace-nowrap text-center"
					>
						<div className="flex justify-center">
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
			{expanded && (
				<TableRow className="account-workspaces-expanded">
					<TableCell colSpan={columns} className="bg-surface-secondary/50 p-0">
						<div id={panelId}>
							<AccountWorkspacePanel
								user={user}
								canManage={Boolean(canManageWorkspaces)}
								selected={selectedWorkspaces}
								onSelect={onWorkspaceSelect}
							/>
						</div>
					</TableCell>
				</TableRow>
			)}
		</>
	);
};

type UsersTableSkeletonProps = {
	canEditUsers: boolean;
	insights?: boolean;
	selectable?: boolean;
};
const UsersTableSkeleton: React.FC<UsersTableSkeletonProps> = ({
	canEditUsers,
	insights,
	selectable,
}) => {
	const quota = useContext(QuotaEditorContext);
	return (
		<TableLoaderSkeleton>
			<TableRowSkeleton>
				{selectable && (
					<TableCell>
						<Skeleton variant="text" width="20px" />
					</TableCell>
				)}
				<TableCell>
					<AvatarDataSkeleton />
				</TableCell>
				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>
				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>
				{quota && (
					<TableCell>
						<Skeleton variant="text" width="140px" />
					</TableCell>
				)}
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
				<TableCell>
					<Skeleton variant="text" width="25%" />
				</TableCell>
				{canEditUsers && (
					<TableCell className="w-px text-right">
						<Skeleton variant="text" width="25%" />
					</TableCell>
				)}
			</TableRowSkeleton>
		</TableLoaderSkeleton>
	);
};
