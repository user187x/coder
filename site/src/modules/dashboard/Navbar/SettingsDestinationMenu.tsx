import { cn } from "cn";
import { FileTextIcon, MonitorIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { Link, useLocation, useNavigate } from "react-router";
import { deploymentConfig } from "#/api/queries/deployment";
import { userUIPreferences } from "#/api/queries/platform";
import { templates } from "#/api/queries/templates";
import { workspaces } from "#/api/queries/workspaces";
import { Avatar } from "#/components/Avatar/Avatar";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
} from "#/components/Combobox/Combobox";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "#/components/DropdownMenu/DropdownMenu";
import { useOptionalAuthContext } from "#/contexts/auth/AuthProvider";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import {
	createWorkspaceSearchParam,
	linkToTemplate,
	useLinks,
} from "#/modules/navigation";
import { useWorkspaceIcons } from "#/modules/workspaces/WorkspaceIcon/useWorkspaceIcon";
import type { AdminPage } from "./adminQuickLinks";
import { BreadcrumbMenuPanel, breadcrumbMenuClass } from "./BreadcrumbMenu";
import { InlineMenuPanel, MenuLabel, useInlineMenu } from "./InlineMenu";
import { navbarSettingsSide } from "./settingsMenuHost";

export function SettingsDestinationMenu({
	link,
	className,
	options,
	labelBadge,
}: {
	link: AdminPage;
	className?: string;
	labelBadge?: React.ReactNode;
	/** More right-click options, after its destinations. */
	options?: React.ReactNode;
}) {
	const menu = useInlineMenu({ arrowRight: true });
	return (
		<>
			<DropdownMenuItem
				asChild
				{...menu.trigger}
				className={cn("min-w-0 flex-1", className)}
				title={`Right-click to show or hide ${link.label.toLowerCase()}`}
			>
				<Link to={link.path}>
					<link.icon aria-hidden />
					<MenuLabel badge={labelBadge}>{link.label}</MenuLabel>
				</Link>
			</DropdownMenuItem>
			{menu.open && (
				<InlineMenuPanel
					id={menu.id}
					quickLinkMenu={menu}
					label={
						link.id === "workspaces" ? "Your workspaces" : "Available templates"
					}
					className="order-last"
				>
					{link.id === "workspaces" ? (
						<WorkspaceDestinations />
					) : (
						<TemplateDestinations />
					)}
					{options}
				</InlineMenuPanel>
			)}
		</>
	);
}

function useWorkspaceDestinations(enabled = true) {
	const canCreateWorkspace =
		useOptionalAuthContext()?.permissions?.createWorkspace;
	const query = useQuery({ ...workspaces({ q: "owner:me" }), enabled });
	const { data: icons } = useWorkspaceIcons();
	const { pathname, search } = useLocation();
	const createSearch = new URLSearchParams(
		pathname === "/workspaces" ? search : "",
	);
	createSearch.set(createWorkspaceSearchParam, "1");
	const ownedWorkspaces = query.data?.workspaces ?? [];
	return { canCreateWorkspace, query, icons, createSearch, ownedWorkspaces };
}

export function WorkspacePicker({
	label,
	trigger,
}: {
	label: string;
	trigger?: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const { canCreateWorkspace, query, icons, createSearch, ownedWorkspaces } =
		useWorkspaceDestinations(open);
	const preferences = useQuery(userUIPreferences());
	const navigate = useNavigate();

	return (
		<Combobox open={open} onOpenChange={setOpen}>
			<ComboboxTrigger asChild>
				<button type="button" aria-label={label} title={label}>
					{trigger ?? label}
				</button>
			</ComboboxTrigger>
			<ComboboxContent
				align={
					navbarSettingsSide(preferences.data) === "right" ? "end" : "start"
				}
				sideOffset={8}
				collisionPadding={8}
				className={`${breadcrumbMenuClass} workspace-template-picker w-80 max-w-[calc(100vw-1rem)]`}
				aria-label="Switch workspace"
				commandClassName="bg-transparent"
				commandLabel="Search workspaces"
			>
				<BreadcrumbMenuPanel>
					<ComboboxInput placeholder="Type/select a workspace" />
					<ComboboxList className="max-h-[min(380px,calc(var(--radix-popper-available-height,80vh)/var(--app-zoom,1)_-_8rem))]">
						{query.isLoading && <p role="status">Loading workspaces…</p>}
						{!ownedWorkspaces.length && query.isError && (
							<p role="alert">Could not load workspaces</p>
						)}
						{ownedWorkspaces.map((item) => {
							const icon = icons?.[item.id] || item.template_icon;
							return (
								<ComboboxItem
									key={item.id}
									value={item.id}
									keywords={[item.name]}
									className="workspace-template-option gap-3 px-3 font-medium [&>svg:last-child]:hidden"
									onSelect={() =>
										navigate(
											`/@${encodeURIComponent(item.owner_name)}/${encodeURIComponent(item.name)}`,
										)
									}
								>
									{icon ? (
										<Avatar
											variant="icon"
											size="sm"
											src={icon}
											fallback={item.name}
											aria-hidden
										/>
									) : (
										<MonitorIcon aria-hidden />
									)}
									<span className="truncate">{item.name}</span>
								</ComboboxItem>
							);
						})}
					</ComboboxList>
					{query.isSuccess && (
						<ComboboxEmpty>
							{ownedWorkspaces.length ? "No workspaces found" : "No workspaces"}
						</ComboboxEmpty>
					)}
					{canCreateWorkspace && (
						<div className="shrink-0 border-0 border-t border-solid border-border bg-surface-tertiary py-1">
							<Link
								to={{
									pathname: "/workspaces",
									search: createSearch.toString(),
								}}
								onClick={() => setOpen(false)}
								className="workspace-template-option flex items-center gap-3 px-3 py-2 text-sm font-medium no-underline outline-hidden"
							>
								<PlusIcon aria-hidden className="size-icon-xs" />
								Create Workspace
							</Link>
						</div>
					)}
				</BreadcrumbMenuPanel>
			</ComboboxContent>
		</Combobox>
	);
}

function WorkspaceDestinations() {
	const { canCreateWorkspace, query, icons, createSearch, ownedWorkspaces } =
		useWorkspaceDestinations();
	return (
		<>
			{ownedWorkspaces.map((item) => {
				const icon = icons?.[item.id] || item.template_icon;
				return (
					<DropdownMenuItem key={item.id} asChild>
						<Link
							to={`/@${encodeURIComponent(item.owner_name)}/${encodeURIComponent(item.name)}`}
						>
							{icon ? (
								<Avatar
									variant="icon"
									size="sm"
									src={icon}
									fallback={item.name}
									aria-hidden
								/>
							) : (
								<MonitorIcon aria-hidden />
							)}
							{item.name}
						</Link>
					</DropdownMenuItem>
				);
			})}
			{query.isLoading && (
				<DropdownMenuItem disabled>Loading workspaces…</DropdownMenuItem>
			)}
			{!ownedWorkspaces.length && query.isError && (
				<DropdownMenuItem disabled>Could not load workspaces</DropdownMenuItem>
			)}
			{query.isSuccess && !ownedWorkspaces.length && !canCreateWorkspace && (
				<DropdownMenuItem disabled>No workspaces</DropdownMenuItem>
			)}
			{canCreateWorkspace && (
				<>
					{ownedWorkspaces.length > 0 && <DropdownMenuSeparator />}
					<DropdownMenuItem asChild>
						<Link
							to={{ pathname: "/workspaces", search: createSearch.toString() }}
						>
							<PlusIcon aria-hidden />
							Create Workspace
						</Link>
					</DropdownMenuItem>
				</>
			)}
		</>
	);
}

export function TemplateDestinations() {
	const { permissions } = useAuthenticated();
	const getLink = useLinks();
	const query = useQuery(templates());
	const config = useQuery({
		...deploymentConfig(),
		enabled: permissions.createTemplates,
	});
	return (
		<>
			{query.data?.map((item) => (
				<DropdownMenuItem key={item.id} asChild>
					<Link to={getLink(linkToTemplate(item.organization_name, item.name))}>
						<FileTextIcon aria-hidden />
						{item.display_name || item.name}{" "}
						<small className="ml-auto text-content-secondary">
							{item.organization_display_name || item.organization_name}
						</small>
					</Link>
				</DropdownMenuItem>
			))}
			{!query.data?.length && (
				<DropdownMenuItem disabled>
					{query.isLoading
						? "Loading templates…"
						: query.isError
							? "Could not load templates"
							: "No templates available"}
				</DropdownMenuItem>
			)}
			{permissions.createTemplates && (
				<DropdownMenuItem
					asChild
					className="mt-1 h-8 min-h-0 justify-center rounded-full border border-solid border-border px-3 py-0 text-xs"
				>
					<Link
						to={
							config.isSuccess && !config.data.config.template_builder?.disabled
								? "/templates/new/builder"
								: "/starter-templates"
						}
					>
						<PlusIcon />
						Create template
					</Link>
				</DropdownMenuItem>
			)}
		</>
	);
}
