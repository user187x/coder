import { cn } from "cn";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import type { WorkspaceNote } from "#/api/platform";
import type { GroupsByUserId } from "#/api/queries/groups";
import { notesByUser } from "#/api/queries/platform";
import type * as TypesGen from "#/api/typesGenerated";
import { AvatarDataSkeleton } from "#/components/Avatar/AvatarDataSkeleton";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { InfoTooltip } from "#/components/InfoTooltip/InfoTooltip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
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
import { AccountPresence, useAccountPresence } from "./AccountPresence";
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

const fieldWidths = {
	Roles: 9,
	Notes: 11,
	Resources: 18,
	Latency: 9,
	Activity: 9,
	Status: 10,
};
type AccountField = keyof typeof fieldWidths;

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
	const region = useRef<HTMLDivElement>(null);
	const [layout, setLayout] = useState<"wide" | "compact" | "narrow">("wide");
	useLayoutEffect(() => {
		const element = region.current;
		if (!element) return;
		const measure = (width: number) =>
			setLayout(width < 620 ? "narrow" : width < 960 ? "compact" : "wide");
		measure(element.getBoundingClientRect().width || 960);
		const observer = new ResizeObserver(([entry]) => {
			if (entry) measure(entry.contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const [picked, setPicked] = useState("");
	const fields: AccountField[] = ["Roles", "Notes"];
	if (quota) fields.push("Resources");
	if (insights.shown) fields.push("Latency");
	if (insights.shown || props.canManageWorkspaces) fields.push("Activity");
	fields.push("Status");
	const fixed = layout === "compact" ? ["Roles", "Notes", "Status"] : [];
	const choices = fields.filter((field) => !fixed.includes(field));
	const current =
		choices.find((field) => field === picked) ??
		(layout === "narrow" ? "Status" : choices[0]);
	const visible = new Set(
		fields.filter(
			(field) =>
				layout === "wide" || fixed.includes(field) || field === current,
		),
	);
	const choosable = users.filter((u) => u.id !== props.me);
	const all =
		choosable.length > 0 && choosable.every((u) => selected?.has(u.id));
	const some = choosable.some((u) => selected?.has(u.id));
	return (
		<div ref={region} className="accounts-table-region">
			{props.canManageWorkspaces && selectedWorkspaces.size > 0 && (
				<AccountWorkspaceActions
					targets={[...selectedWorkspaces.values()]}
					onClear={() => setSelectedWorkspaces(new Map())}
					onDeleted={(workspace) => onWorkspaceSelect(workspace, false)}
				/>
			)}
			{layout !== "wide" && choices.length > 1 && (
				<div className="flex items-center justify-end gap-2 px-3 py-1 text-xs text-content-secondary">
					<span>Show column</span>
					<Select value={current} onValueChange={setPicked}>
						<SelectTrigger
							aria-label="Account detail column"
							className="h-7 w-auto gap-2"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{choices.map((field) => (
								<SelectItem key={field} value={field}>
									{field}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			<Table
				data-testid="users-table"
				aria-label="Accounts"
				className="accounts-table"
				wrapperClassName="accounts-table-surface"
			>
				<colgroup>
					{selected && onSelect && <col style={{ width: 32 }} />}
					<col />
					{[...visible].map((field) => (
						<col
							key={field}
							style={{
								width: layout === "narrow" ? "30%" : `${fieldWidths[field]}%`,
							}}
						/>
					))}
					{props.canEditUsers && <col style={{ width: 40 }} />}
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
						{visible.has("Roles") && (
							<TableHead>
								<div className="flex flex-row gap-2 items-center">
									<span>Roles</span>
									<RolesHelpPopover />
								</div>
							</TableHead>
						)}
						{/* Platform: admins' post-it notes on the user's workspaces, instead of Groups. */}
						{visible.has("Notes") && <TableHead>Notes</TableHead>}
						{visible.has("Resources") && <TableHead>Resources</TableHead>}
						{/* Platform: how the user's connections to their workspaces went, beside when they were last seen */}
						{visible.has("Latency") && (
							<TableHead className="whitespace-nowrap text-center">
								<span className="flex items-center justify-center gap-1">
									Latency
									<InfoTooltip size="small">
										<TooltipTitle>Latency</TooltipTitle>
										<TooltipMessage>{`The median round trip of the user's connections to their workspaces over the last ${INSIGHTS_DAYS} days, every template.`}</TooltipMessage>
									</InfoTooltip>
								</span>
							</TableHead>
						)}
						{visible.has("Activity") && (
							<TableHead className="whitespace-nowrap text-center">
								<span className="flex items-center justify-center gap-1">
									Activity
									<InfoTooltip size="small">
										<TooltipTitle>Activity</TooltipTitle>
										<TooltipMessage>{`Dashboard shows how long the current browser session has been open, including idle time. Workspace shows connection time over the last ${INSIGHTS_DAYS} days, every template.`}</TooltipMessage>
									</InfoTooltip>
								</span>
							</TableHead>
						)}
						{visible.has("Status") && (
							<TableHead className="text-center">Status</TableHead>
						)}
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
						narrow={layout === "narrow"}
						visible={visible}
						insights={insights}
						selectedWorkspaces={selectedWorkspaces}
						onWorkspaceSelect={onWorkspaceSelect}
					/>
				</TableBody>
			</Table>
		</div>
	);
};

const UsersTableBody: React.FC<
	UsersTableProps & {
		insights: ReturnType<typeof useUserInsights>;
		visible: ReadonlySet<AccountField>;
		narrow: boolean;
		selectedWorkspaces: ReadonlyMap<string, TypesGen.Workspace>;
		onWorkspaceSelect: (
			workspace: TypesGen.Workspace,
			checked: boolean,
		) => void;
	}
> = ({
	insights,
	visible,
	narrow,
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
	const presence = useAccountPresence(Boolean(canManageWorkspaces));
	const notesQuery = useQuery(notesByUser());
	if (isLoading) {
		return (
			<UsersTableSkeleton
				canEditUsers={canEditUsers}
				selectable={Boolean(selected && onSelect)}
				visible={visible}
			/>
		);
	}

	if (!users || users.length === 0) {
		return <TableEmpty message="No users found" />;
	}

	return users.map((user) => (
		<UsersTableRow
			key={user.id}
			presence={presence}
			narrow={narrow}
			visible={visible}
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
	presence: ReturnType<typeof useAccountPresence>;
	narrow: boolean;
	visible: ReadonlySet<AccountField>;
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
	presence,
	narrow,
	visible,
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
	const peer = presence.users.get(user.id);
	const dashboardSeconds =
		peer?.since && peer.status !== "offline" && presence.generatedAt
			? (Date.parse(presence.generatedAt) - Date.parse(peer.since)) / 1000
			: Number.NaN;
	const hasDashboard = Number.isFinite(dashboardSeconds);
	const [expanded, setExpanded] = useState(false);
	const panelId = useId();
	const columns =
		1 +
		visible.size +
		Number(Boolean(canEditUsers)) +
		Number(Boolean(selected && onSelect));
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

	const accountLinks = (
		<>
			<ShareApprovalButton user={user} />
			<ChatUserButton user={user} />
		</>
	);

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
						{!narrow && accountLinks}
					</AccountIdentity>
				</TableCell>

				{visible.has("Roles") && (
					<UserRoleCell roles={user.roles} className="account-roles" />
				)}

				{visible.has("Notes") && (
					<UserNotesCell
						username={user.username}
						notes={notes}
						className="account-notes"
					/>
				)}
				{visible.has("Resources") && <AccountResourcesCell user={user} />}

				{insight && visible.has("Latency") && (
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
							<span className="text-sm text-content-disabled">N/A</span>
						)}
					</TableCell>
				)}
				{visible.has("Activity") && (
					<TableCell
						className="whitespace-nowrap text-center"
						data-testid="user-activity"
						data-label="Activity"
					>
						{hasDashboard && (
							<div
								className="truncate text-xs tabular-nums"
								title={`Dashboard tab open since ${peer?.since}${presence.stale ? " (last reported)" : ""}`}
							>
								{presence.stale ? "Last tab" : "Dashboard"}{" "}
								{formatActivity(Math.max(0, dashboardSeconds))}
							</div>
						)}
						{insight?.seconds ? (
							<div className="mx-auto flex min-w-0 max-w-20 flex-col items-center gap-1">
								<span
									className="w-full truncate text-xs tabular-nums text-content-primary"
									title={`Workspace connection time: ${formatActivity(insight.seconds)}`}
								>
									<span className="text-[10px] text-content-secondary">
										Workspace{" "}
									</span>
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
							!hasDashboard && (
								<span className="text-sm text-content-disabled">N/A</span>
							)
						)}
					</TableCell>
				)}

				{visible.has("Status") && (
					<TableCell
						data-label="Status"
						className={cn(
							"capitalize text-center",
							user.status === "suspended" && "text-content-secondary",
						)}
					>
						<AccountPresence user={user} presence={presence} />
					</TableCell>
				)}

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
								canManageWorkspaces={canManageWorkspaces}
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
							{narrow && (
								<div className="flex items-center gap-2 px-3">
									{accountLinks}
								</div>
							)}
							<AccountWorkspacePanel
								compact={narrow}
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
	visible: ReadonlySet<AccountField>;
	selectable?: boolean;
};
const UsersTableSkeleton: React.FC<UsersTableSkeletonProps> = ({
	canEditUsers,
	visible,
	selectable,
}) => {
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
				{[...visible].map((field) => (
					<TableCell key={field}>
						<Skeleton variant="text" width="70%" />
					</TableCell>
				))}
				{canEditUsers && (
					<TableCell className="w-px text-right">
						<Skeleton variant="text" width="25%" />
					</TableCell>
				)}
			</TableRowSkeleton>
		</TableLoaderSkeleton>
	);
};
