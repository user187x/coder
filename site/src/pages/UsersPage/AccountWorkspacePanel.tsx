import { ArrowUpRightIcon } from "lucide-react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { workspaces as workspaceQuery } from "#/api/queries/workspaces";
import type { User, Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Avatar } from "#/components/Avatar/Avatar";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { linkToTemplate, useLinks } from "#/modules/navigation";
import {
	RestrictedWorkspaceRow,
	WorkspaceRestrictionAvatar,
} from "#/modules/platform/quarantine/WorkspaceRestriction";
import { QuotaAdjustments } from "#/modules/platform/quotaRequests/QuotaAdjustments";
import { WorkspaceStatusIndicator } from "#/modules/workspaces/WorkspaceStatusIndicator/WorkspaceStatusIndicator";
import { AccountWorkspaceActions } from "./AccountWorkspaceActions";
import { AccountWorkspaceUpdate } from "./AccountWorkspaceUpdate";

type PanelProps = {
	user: User;
	canManage: boolean;
	selected: ReadonlyMap<string, Workspace>;
	onSelect: (workspace: Workspace, checked: boolean) => void;
};
export const AccountWorkspacePanel: React.FC<PanelProps> = (props) => {
	const query = useQuery({
		...workspaceQuery({ q: `owner:${props.user.username}`, limit: 0 }),
		refetchInterval: 5000,
	});
	return (
		<AccountWorkspacePanelView
			{...props}
			workspaces={query.data?.workspaces ?? []}
			loading={query.isLoading}
			error={query.error}
			onRetry={() => {
				void query.refetch();
			}}
		/>
	);
};
export const AccountWorkspacePanelView: React.FC<
	PanelProps & {
		workspaces: readonly Workspace[];
		loading?: boolean;
		error?: unknown;
		onRetry?: () => void;
	}
> = ({
	user,
	canManage,
	selected,
	onSelect,
	workspaces: list,
	loading = false,
	error,
	onRetry,
}) => {
	const links = useLinks();
	const all = list.filter(
		(w) => !w.is_prebuild && w.latest_build.status !== "deleted",
	);
	const checked = all.length > 0 && all.every((w) => selected.has(w.id));
	return (
		<section
			aria-label={`Workspaces for ${user.username}`}
			className="flex flex-col gap-3 p-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="m-0 text-sm font-semibold">
					{user.username}'s workspaces
				</h3>
				{canManage && <QuotaAdjustments user={user} />}
				<Button asChild size="sm" variant="outline">
					<Link
						to={`/workspaces?filter=${encodeURIComponent(`owner:${user.username}`)}`}
					>
						All workspaces
						<ArrowUpRightIcon aria-hidden />
					</Link>
				</Button>
			</div>
			{error ? (
				<>
					<ErrorAlert error={error} />
					{onRetry && (
						<Button
							variant="outline"
							size="sm"
							className="self-start"
							onClick={onRetry}
						>
							Retry workspace list
						</Button>
					)}
				</>
			) : null}
			{loading && list.length === 0 ? (
				<p role="status" className="m-0 text-sm text-content-secondary">
					Loading workspaces…
				</p>
			) : list.length === 0 && !error ? (
				<p className="m-0 text-sm text-content-secondary">No workspaces.</p>
			) : list.length > 0 ? (
				<Table
					aria-label={`${user.username}'s workspaces`}
					className="account-workspaces-table"
					wrapperClassName="min-w-0 overflow-x-hidden"
				>
					<colgroup>
						{canManage && <col style={{ width: "6%" }} />}
						<col style={{ width: canManage ? "22%" : "28%" }} />
						<col style={{ width: "23%" }} />
						<col style={{ width: "21%" }} />
						<col style={{ width: "28%" }} />
					</colgroup>
					<TableHeader>
						<TableRow>
							{canManage && (
								<TableHead>
									<Checkbox
										aria-label={`Choose all workspaces for ${user.username}`}
										checked={
											checked
												? true
												: all.some((w) => selected.has(w.id))
													? "indeterminate"
													: false
										}
										disabled={all.length === 0}
										onCheckedChange={(v) => {
											for (const w of all) onSelect(w, v === true);
										}}
									/>
								</TableHead>
							)}
							<TableHead>Workspace</TableHead>
							<TableHead>Template</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{list.map((w) => (
							<RestrictedWorkspaceRow workspace={w} key={w.id}>
								{canManage && (
									<TableCell data-account-field="selection">
										<Checkbox
											aria-label={`Choose workspace ${user.username}/${w.name}`}
											checked={selected.has(w.id)}
											disabled={
												w.is_prebuild || w.latest_build.status === "deleted"
											}
											onCheckedChange={(v) => onSelect(w, v === true)}
										/>
									</TableCell>
								)}
								<TableCell data-label="Workspace">
									<Button
										asChild
										variant="subtle"
										size="sm"
										className="min-w-0 max-w-full"
									>
										<Link
											to={`/@${encodeURIComponent(w.owner_name)}/${encodeURIComponent(w.name)}`}
											aria-label={`Open dashboard for ${w.name}`}
										>
											<WorkspaceRestrictionAvatar workspace={w}>
												<Avatar
													src={w.owner_avatar_url}
													fallback={w.owner_name}
													size="sm"
												/>
											</WorkspaceRestrictionAvatar>
											<span className="truncate">{w.name}</span>
											<ArrowUpRightIcon aria-hidden />
										</Link>
									</Button>
									{w.is_prebuild && (
										<span className="ml-2 text-xs text-content-secondary">
											System prebuild
										</span>
									)}
								</TableCell>
								<TableCell data-label="Template">
									<Button
										asChild
										variant="outline"
										size="sm"
										className="max-w-full min-w-0 gap-1 rounded-[10px] py-1 pl-1 pr-2"
									>
										<Link
											to={links(
												linkToTemplate(w.organization_name, w.template_name),
											)}
										>
											<Avatar
												variant="icon"
												src={w.template_icon}
												fallback={w.template_display_name || w.template_name}
												size="md"
												className="rounded-[7px]"
											/>
											<span className="truncate">
												{w.template_display_name ||
													w.template_name ||
													"Unknown template"}
											</span>
										</Link>
									</Button>
								</TableCell>
								<TableCell data-label="Status">
									<WorkspaceStatusIndicator
										workspace={w}
										runningLight
										className="workspace-topbar-running-status gap-1.5 rounded-full border border-solid border-current/20 bg-surface-secondary px-2 py-1 text-xs"
									/>
								</TableCell>
								<TableCell data-label="Actions">
									{canManage && !w.is_prebuild ? (
										<AccountWorkspaceActions targets={[w]} compact>
											<Button
												asChild
												size="icon"
												variant="outline"
												className="size-7 shrink-0"
											>
												<Link
													to={`/@${encodeURIComponent(w.owner_name)}/${encodeURIComponent(w.name)}`}
													aria-label={`View ${w.name}`}
													title="View workspace"
												>
													<ArrowUpRightIcon aria-hidden />
												</Link>
											</Button>
											<AccountWorkspaceUpdate workspace={w} />
										</AccountWorkspaceActions>
									) : (
										<span className="text-xs text-content-secondary">
											View only
										</span>
									)}
								</TableCell>
							</RestrictedWorkspaceRow>
						))}
					</TableBody>
				</Table>
			) : null}
		</section>
	);
};
