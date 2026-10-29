import {
	CopyIcon,
	ExternalLinkIcon,
	FolderOpenIcon,
	SettingsIcon,
	Share2Icon,
	SquareTerminalIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { Workspace } from "#/api/typesGenerated";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "#/components/ContextMenu/ContextMenu";
import { useClipboard } from "#/hooks/useClipboard";

export const WorkspaceContextMenu: React.FC<{
	workspace: Workspace;
	children: React.ReactNode;
}> = ({ workspace, children }) => {
	const clipboard = useClipboard();
	const path = `/@${workspace.owner_name}/${workspace.name}`;
	const agent = workspace.latest_build.resources
		.flatMap((resource) => resource.agents ?? [])
		.find((item) => item.status === "connected");
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div>{children}</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem asChild>
					<Link to={path}>
						<FolderOpenIcon />
						Open workspace
					</Link>
				</ContextMenuItem>
				<ContextMenuItem asChild>
					<Link to={path} target="_blank" rel="noreferrer">
						<ExternalLinkIcon />
						Open in new tab
					</Link>
				</ContextMenuItem>
				{agent && (
					<ContextMenuItem asChild>
						<Link to={`${path}.${agent.name}/terminal`}>
							<SquareTerminalIcon />
							Open terminal
						</Link>
					</ContextMenuItem>
				)}
				<ContextMenuSeparator />
				<ContextMenuItem asChild>
					<Link to={`${path}/settings`}>
						<SettingsIcon />
						Workspace settings
					</Link>
				</ContextMenuItem>
				<ContextMenuItem asChild>
					<Link to={`${path}/settings/sharing`}>
						<Share2Icon />
						Sharing
					</Link>
				</ContextMenuItem>
				<ContextMenuItem
					onSelect={() =>
						clipboard.copyToClipboard(new URL(path, location.origin).href)
					}
				>
					<CopyIcon />
					Copy workspace link
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};
