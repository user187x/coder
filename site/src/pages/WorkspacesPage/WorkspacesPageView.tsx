import {
	PlayIcon,
	PlusIcon,
	RotateCcwIcon,
	SquareIcon,
	TrashIcon,
} from "lucide-react";
import { useMemo } from "react";
import type { UseQueryResult } from "react-query";
import { hasError, isApiValidationError } from "#/api/errors";
import type { Template, Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { EmptyState } from "#/components/EmptyState/EmptyState";
import type { UseFilterResult } from "#/components/Filter/Filter";
import { Margins } from "#/components/Margins/Margins";
import {
	PageHeader,
	PageHeaderTitle,
} from "#/components/PageHeader/PageHeader";
import { PaginationWidgetBase } from "#/components/PaginationWidget/PaginationWidgetBase";
import { Spinner } from "#/components/Spinner/Spinner";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { CloudDrive } from "#/modules/platform/cloudDrive/CloudDrive";
import {
	isLinked,
	useCloudDriveLinks,
} from "#/modules/platform/cloudDrive/CloudDriveSocket";
import { TableCard } from "#/modules/platform/tableCard/TableCard";
import { WorkspaceQuotaPill } from "#/modules/platform/workspaceQuota/WorkspaceQuotaPill";
import { WorkspacesTable } from "#/pages/WorkspacesPage/WorkspacesTable";
import { mustUpdateWorkspace } from "#/utils/workspace";
import { WorkspacesFilter } from "./filter/WorkspacesFilter";
import { isDeleting } from "./startingRows";
import { WorkspaceHelpPopover } from "./WorkspaceHelpPopover";
import { WorkspacesButton } from "./WorkspacesButton";

type TemplateQuery = UseQueryResult<Template[]>;
type WorkspacesPageViewProps = {
	error: unknown;
	workspaces?: readonly Workspace[];
	checkedWorkspaces: readonly Workspace[];
	count?: number;
	filter: UseFilterResult;
	page: number;
	limit: number;
	onPageChange: (page: number) => void;
	onCheckChange: (checkedWorkspaces: readonly Workspace[]) => void;
	isRunningBatchAction: boolean;
	onBatchDeleteTransition: () => void;
	onBatchUpdateTransition: () => void;
	onBatchStartTransition: () => void;
	onBatchStopTransition: () => void;
	templatesFetchStatus: TemplateQuery["status"];
	templates: TemplateQuery["data"];
	canCreateTemplate: boolean;
	canCreateWorkspace: boolean;
	canChangeVersions: boolean;
	onActionSuccess: () => Promise<void>;
	onActionError: (error: unknown) => void;
};

export const WorkspacesPageView: React.FC<WorkspacesPageViewProps> = ({
	workspaces,
	error,
	limit,
	count,
	filter,
	onPageChange,
	page,
	checkedWorkspaces,
	onCheckChange,
	onBatchDeleteTransition,
	onBatchUpdateTransition,
	onBatchStopTransition,
	onBatchStartTransition,
	isRunningBatchAction,
	templates,
	templatesFetchStatus,
	canCreateTemplate,
	canCreateWorkspace,
	canChangeVersions,
	onActionSuccess,
	onActionError,
}) => {
	// Let's say the user has 5 workspaces, but tried to hit page 100, which
	// does not exist. In this case, the page is not valid and we want to show a
	// better error message.
	const pageNumberIsInvalid = page !== 1 && workspaces?.length === 0;
	// Platform: the signed-in user's own workspaces on this page, each roped to the Cloud Drive.
	const { user: me } = useAuthenticated();
	const mine = useMemo(
		() =>
			(workspaces ?? []).filter((w) => w.owner_id === me.id).map((w) => w.id),
		[workspaces, me.id],
	);
	// Platform: being deleted - a cable to one pops off its row and reels back into the Cloud Drive before the row goes
	const deleting = useMemo(
		() => (workspaces ?? []).filter(isDeleting).map((w) => w.id),
		[workspaces],
	);
	// Platform: the table's footer - what the page shows, how many run, how many have the Cloud Drive
	const drive = useCloudDriveLinks();
	const shown = workspaces?.length ?? 0;
	const running = (workspaces ?? []).filter(
		(w) => w.latest_build.status === "running",
	).length;
	const mounted = mine.filter((id) => isLinked(drive, id)).length;
	const first = (page - 1) * limit + 1;
	const summary =
		workspaces && shown > 0 && count !== undefined ? (
			<span data-testid="workspaces-summary">
				Showing{" "}
				<strong className="font-semibold text-content-primary">
					{count > shown ? `${first}–${first + shown - 1}` : shown}
				</strong>{" "}
				of{" "}
				<strong className="font-semibold text-content-primary">{count}</strong>{" "}
				{count === 1 ? "workspace" : "workspaces"}
				{filter.query.trim() !== "" && " (filtered)"} · {running} running
				{drive.enabled && ` · ${mounted} with Cloud Drive mounted`}
			</span>
		) : undefined;

	return (
		// Platform: relative for the Cloud Drive's ropes over the table.
		<Margins className="relative pb-12" data-cloud-drive-area>
			{/* Platform: Workspaces | Templates | Images. */}
			<PageHeader
				actions={
					canCreateWorkspace && (
						<WorkspacesButton
							templates={templates}
							templatesFetchStatus={templatesFetchStatus}
						>
							{/* Platform: the plus glyph says "new" */}
							<PlusIcon aria-hidden />
							Workspace
						</WorkspacesButton>
					)
				}
			>
				<PageHeaderTitle>
					<div className="flex flex-row gap-2 items-center">
						<span>Workspaces</span>
						<WorkspaceHelpPopover />
					</div>
				</PageHeaderTitle>
			</PageHeader>

			{hasError(error) && !isApiValidationError(error) && (
				<div className="mb-4">
					<ErrorAlert error={error} />
				</div>
			)}

			{/* Platform: the search and the Cloud Drive (and, with rows selected, their bulk actions) in one rounded
			    bar right above the table, no border lines and see-through, padded above and below as far as the Chats card
			    floats above the page's bottom bar - not at its sides: the search's left edge and the Cloud Drive's right
			    edge on the table card's */}
			{/* Platform: the user's quota, where an admin set one for them (Health > User Quota) */}
			<WorkspaceQuotaPill workspaceCount={workspaces?.length} />
			<div
				className="mb-2.5 flex flex-wrap items-center gap-3 rounded-[18px] bg-transparent py-2.5 text-sm text-content-secondary"
				data-testid="workspaces-bar"
			>
				<div className="min-w-0 flex-1">
					<WorkspacesFilter filter={filter} error={error} />
				</div>
				{checkedWorkspaces.length > 0 ? (
					<>
						<div className="whitespace-nowrap">
							Selected <strong>{checkedWorkspaces.length}</strong> of{" "}
							<strong>{workspaces?.length}</strong>{" "}
							{workspaces?.length === 1 ? "workspace" : "workspaces"}
						</div>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									disabled={isRunningBatchAction}
									variant="outline"
									size="sm"
								>
									Bulk actions
									<Spinner loading={isRunningBatchAction}>
										<ChevronDownIcon />
									</Spinner>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									disabled={
										!checkedWorkspaces?.some(
											(w) =>
												w.latest_build.status === "stopped" &&
												!mustUpdateWorkspace(w, canChangeVersions),
										)
									}
									onClick={onBatchStartTransition}
								>
									<PlayIcon /> Start
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={
										!checkedWorkspaces?.some(
											(w) => w.latest_build.status === "running",
										)
									}
									onClick={onBatchStopTransition}
								>
									<SquareIcon /> Stop
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={onBatchUpdateTransition}>
									<RotateCcwIcon
										className="size-icon-sm"
										data-testid="bulk-action-update"
									/>{" "}
									Update&hellip;
								</DropdownMenuItem>
								<DropdownMenuItem
									className="text-content-destructive focus:text-content-destructive"
									onClick={onBatchDeleteTransition}
								>
									<TrashIcon /> Delete&hellip;
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				) : null}
				{/* Platform: the account's Cloud Drive, once, above the rows' apps. */}
				<CloudDrive
					workspaceIds={mine}
					deleting={deleting}
					className="ml-auto"
				/>
			</div>

			{pageNumberIsInvalid ? (
				<EmptyState
					className="border border-solid border-border rounded-lg"
					message="Page not found"
					description="The page you are trying to access does not exist."
					cta={
						<Button
							onClick={() => {
								onPageChange(1);
							}}
						>
							Back to the first page
						</Button>
					}
				/>
			) : (
				// Platform: in a rounded card, its footer saying what it holds and what anything in it does
				<TableCard
					data-testid="workspaces-card"
					summary={summary}
					hint={
						drive.enabled && mine.length > 0
							? "Drag the Cloud Drive plug onto a row to mount it, or pull a plug off a row to unmount"
							: "Point at anything in the table to read what it does"
					}
				>
					<WorkspacesTable
						canCreateTemplate={canCreateTemplate}
						canCreateWorkspace={canCreateWorkspace}
						workspaces={workspaces}
						isUsingFilter={filter.used}
						onClearFilter={() => filter.update("")}
						checkedWorkspaces={checkedWorkspaces}
						onCheckChange={onCheckChange}
						templates={templates}
						onActionSuccess={onActionSuccess}
						onActionError={onActionError}
					/>
				</TableCard>
			)}

			{count !== undefined && (
				// Temporary styling stopgap before component is migrated to using
				// PaginationContainer (which renders PaginationWidgetBase using CSS
				// flexbox gaps)
				<div className="pt-4">
					<PaginationWidgetBase
						totalRecords={count}
						pageSize={limit}
						onPageChange={onPageChange}
						currentPage={page}
					/>
				</div>
			)}
		</Margins>
	);
};
