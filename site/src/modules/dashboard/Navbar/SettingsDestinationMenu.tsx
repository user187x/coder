import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { Link } from "react-router";
import { deploymentConfig } from "#/api/queries/deployment";
import { templates } from "#/api/queries/templates";
import { workspaces } from "#/api/queries/workspaces";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { linkToTemplate, useLinks } from "#/modules/navigation";

export function SettingsDestinationMenu({
	kind,
	children,
}: {
	kind: "workspaces" | "templates";
	children: React.ReactElement;
}) {
	const [open, setOpen] = useState(false);
	return (
		<ContextMenu onOpenChange={setOpen}>
			<ContextMenuTrigger
				asChild
				onContextMenu={(event) => event.stopPropagation()}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent
				aria-label={
					kind === "templates" ? "Available templates" : "Your workspaces"
				}
				className="max-h-[min(24rem,70dvh)] overflow-y-auto"
			>
				{open &&
					(kind === "workspaces" ? (
						<WorkspaceDestinations />
					) : (
						<TemplateDestinations />
					))}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function WorkspaceDestinations() {
	const query = useQuery(workspaces({ q: "owner:me" }));
	return (
		<>
			{query.data?.workspaces.map((item) => (
				<ContextMenuItem key={item.id} asChild>
					<Link
						to={`/@${encodeURIComponent(item.owner_name)}/${encodeURIComponent(item.name)}`}
					>
						{item.name}
					</Link>
				</ContextMenuItem>
			))}
			{!query.data?.workspaces.length && (
				<ContextMenuItem disabled>
					{query.isLoading
						? "Loading workspaces…"
						: query.isError
							? "Could not load workspaces"
							: "No workspaces"}
				</ContextMenuItem>
			)}
		</>
	);
}

function TemplateDestinations() {
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
				<ContextMenuItem key={item.id} asChild>
					<Link to={getLink(linkToTemplate(item.organization_name, item.name))}>
						{item.display_name || item.name}{" "}
						<small className="ml-auto text-content-secondary">
							{item.organization_display_name || item.organization_name}
						</small>
					</Link>
				</ContextMenuItem>
			))}
			{!query.data?.length && (
				<ContextMenuItem disabled>
					{query.isLoading
						? "Loading templates…"
						: query.isError
							? "Could not load templates"
							: "No templates available"}
				</ContextMenuItem>
			)}
			{permissions.createTemplates && (
				<ContextMenuItem
					asChild
					className="mt-2 justify-center rounded-full bg-surface-invert-primary p-3 text-content-invert"
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
				</ContextMenuItem>
			)}
		</>
	);
}
