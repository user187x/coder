import { cn } from "cn";
import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import { useQuery } from "react-query";
import { Link, useLocation } from "react-router";
import { deploymentConfig } from "#/api/queries/deployment";
import { templates } from "#/api/queries/templates";
import { workspaces } from "#/api/queries/workspaces";
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
import type { AdminPage } from "./adminQuickLinks";

export function SettingsDestinationMenu({
	link,
	className,
	options,
}: {
	link: AdminPage;
	className?: string;
	/** More right-click options, after its destinations. */
	options?: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const id = useId();
	const toggle = (event: React.SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setOpen((previous) => !previous);
	};
	return (
		<>
			<DropdownMenuItem
				asChild
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				className={cn("min-w-0 flex-1", className)}
				onContextMenu={toggle}
				onKeyDown={(event) => {
					if (
						event.key === "ContextMenu" ||
						(event.shiftKey && event.key === "F10") ||
						event.key === "ArrowRight"
					) {
						toggle(event);
					}
				}}
				title={`Right-click to show or hide ${link.label.toLowerCase()}`}
			>
				<Link to={link.path}>
					<link.icon aria-hidden />
					<span className="truncate">{link.label}</span>
				</Link>
			</DropdownMenuItem>
			{open && (
				<div
					id={id}
					role="group"
					aria-label={
						link.id === "workspaces" ? "Your workspaces" : "Available templates"
					}
					className="order-last my-1 w-full min-w-0 rounded-md border border-solid border-border bg-surface-secondary p-1"
				>
					{link.id === "workspaces" ? (
						<WorkspaceDestinations />
					) : (
						<TemplateDestinations />
					)}
					{options}
				</div>
			)}
		</>
	);
}

export function WorkspaceDestinations() {
	const canCreateWorkspace =
		useOptionalAuthContext()?.permissions?.createWorkspace;
	const query = useQuery(workspaces({ q: "owner:me" }));
	const { pathname, search } = useLocation();
	const createSearch = new URLSearchParams(
		pathname === "/workspaces" ? search : "",
	);
	createSearch.set(createWorkspaceSearchParam, "1");
	const ownedWorkspaces = query.data?.workspaces ?? [];
	return (
		<>
			{ownedWorkspaces.map((item) => (
				<DropdownMenuItem key={item.id} asChild>
					<Link
						to={`/@${encodeURIComponent(item.owner_name)}/${encodeURIComponent(item.name)}`}
					>
						{item.name}
					</Link>
				</DropdownMenuItem>
			))}
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
