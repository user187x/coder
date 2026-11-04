import {
	ChevronDownIcon,
	HourglassIcon,
	Maximize2Icon,
	Minimize2Icon,
	UserPlusIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type * as TypesGen from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import { Dialog, DialogContent, DialogTitle } from "#/components/Dialog/Dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { UsersFilter } from "#/components/Filter/UsersFilter";
import { PaginationAmount } from "#/components/PaginationWidget/PaginationAmount";
import type { PaginationResult } from "#/components/PaginationWidget/PaginationContainer";
import { PaginationWidgetBase } from "#/components/PaginationWidget/PaginationWidgetBase";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { NavbarAction } from "#/modules/dashboard/Navbar/NavbarAction";
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
	focused: boolean;
	onFocusChange: (open: boolean) => void;
	onPageSizeChange: (size: number) => void;
	canCreateUser?: boolean;
	leases?: React.ReactNode;
	onCreateLease?: () => void;
	/** User Quota (UserQuotaSection), for admins: shared controls below the merged accounts table. */
	quota?: React.ReactNode;
};

export const UsersPageView: React.FC<UsersPageViewProps> = ({
	filterProps,
	usersQuery,
	focused,
	onFocusChange,
	onPageSizeChange,
	canCreateUser,
	leases,
	onCreateLease,
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

	const focusTrigger = useRef<HTMLButtonElement>(null);
	const card = (
		<section
			aria-label="Accounts"
			data-testid="accounts-card"
			className={
				focused
					? "flex min-w-0 flex-col gap-3"
					: "mb-6 flex min-w-0 flex-col gap-3 rounded-lg border border-solid border-border p-2 sm:p-6"
			}
		>
			<div className="flex flex-wrap items-start gap-2">
				<div className="min-w-48 flex-1 [&>div]:mb-0">
					<UsersFilter {...filterProps} />
				</div>
				<Select
					value={String(usersQuery.limit)}
					onValueChange={(value) => onPageSizeChange(Number(value))}
				>
					<SelectTrigger
						aria-label="Accounts per page"
						className="w-auto gap-2"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{(focused ? [10, 25, 50, 100] : [10, 25, 50]).map((size) => (
							<SelectItem key={size} value={String(size)}>
								{size} per page
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					ref={focused ? undefined : focusTrigger}
					variant="outline"
					onClick={() => onFocusChange(!focused)}
				>
					{focused ? <Minimize2Icon /> : <Maximize2Icon />}{" "}
					{focused ? "Exit focus" : "Focus"}
				</Button>
			</div>

			{props.canEditUsers && (
				<BulkUserActions
					selected={selected}
					me={props.me}
					oidcRoleSyncEnabled={props.oidcRoleSyncEnabled}
					onClear={() => setSelectedIds(new Set())}
				/>
			)}

			<div className="min-w-0">
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
						key={JSON.stringify([
							usersQuery.currentPage,
							usersQuery.limit,
							filterProps.filter.query,
						])}
						{...props}
						users={pageUsers}
						onAction={setAction}
						selected={props.canEditUsers ? selectedIds : undefined}
						onSelect={setSelectedIds}
					/>
				</TableCard>
			</div>
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
	);

	return (
		<>
			<h1 className="sr-only">Accounts</h1>
			{canCreateUser && (
				<NavbarAction>
					<div className="inline-flex">
						<Button
							asChild
							className={onCreateLease ? "rounded-r-none" : undefined}
						>
							<Link to="create">
								<UserPlusIcon />
								New account
							</Link>
						</Button>
						{onCreateLease && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										aria-label="More account actions"
										className="min-w-0 rounded-l-none border-0 border-l border-solid border-l-content-invert/25 px-2"
									>
										<ChevronDownIcon aria-hidden />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={onCreateLease}>
										<HourglassIcon aria-hidden />
										Create Lease
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</NavbarAction>
			)}

			{focused ? (
				<Dialog open onOpenChange={onFocusChange}>
					<DialogContent
						className="accounts-focus inset-x-0 top-[var(--coder-classification-h,0px)] bottom-[var(--coder-classification-h,0px)] flex max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 p-4 sm:rounded-none sm:p-6"
						aria-describedby={undefined}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							focusTrigger.current?.focus();
						}}
					>
						<DialogTitle>Accounts</DialogTitle>
						{card}
					</DialogContent>
				</Dialog>
			) : (
				card
			)}
			{leases}

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
