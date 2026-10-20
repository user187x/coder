import { cn } from "cn";
import {
	KeyRoundIcon,
	LayoutGridIcon,
	NetworkIcon,
	SquareTerminalIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceAgent, WorkspaceResource } from "#/api/typesGenerated";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { DisplayAppNameMap } from "#/modules/resources/AppLink/AppLink";
import { BaseIcon } from "#/modules/resources/AppLink/BaseIcon";

type Tile = { key: string; name: string; icon: ReactNode };

/** An agent's apps as tiles: its own (coder_app), then Coder's built-in ones it shows (terminal, VS Code, SSH, ports). */
const tilesOf = (agent: WorkspaceAgent): Tile[] => {
	const tiles: Tile[] = agent.apps
		.filter((app) => !app.hidden)
		.map((app) => ({
			key: app.slug,
			name: app.display_name || app.slug,
			icon: <BaseIcon app={app} />,
		}));
	const shown = new Set(agent.display_apps);
	if (shown.has("web_terminal")) {
		tiles.push({
			key: "web_terminal",
			name: DisplayAppNameMap.web_terminal,
			icon: <SquareTerminalIcon />,
		});
	}
	if (shown.has("vscode") || shown.has("vscode_insiders")) {
		const insiders = !shown.has("vscode");
		tiles.push({
			key: "vscode",
			name: DisplayAppNameMap[insiders ? "vscode_insiders" : "vscode"],
			icon: (
				<ExternalImage
					src={insiders ? "/icon/code-insiders.svg" : "/icon/code.svg"}
					alt=""
				/>
			),
		});
	}
	if (shown.has("ssh_helper")) {
		tiles.push({
			key: "ssh_helper",
			name: DisplayAppNameMap.ssh_helper,
			icon: <KeyRoundIcon />,
		});
	}
	if (shown.has("port_forwarding_helper")) {
		tiles.push({
			key: "port_forwarding_helper",
			name: DisplayAppNameMap.port_forwarding_helper,
			icon: <NetworkIcon />,
		});
	}
	return tiles;
};

/**
 * Platform: the apps a workspace of the template gets, at the top of its Source Code (what was the Overview's
 * resources table): a panel like the source files beneath it - its header the agent (name, OS) and the resource it
 * runs in, the apps under it as tiles, centered. A block per agent (most templates have one); nothing without one.
 */
export const TemplateAppsPanel: React.FC<{
	resources: readonly WorkspaceResource[];
	className?: string;
}> = ({ resources, className }) => {
	const agents = resources
		.filter((r) => r.workspace_transition === "start")
		.flatMap((resource) =>
			(resource.agents ?? []).map((agent) => ({ resource, agent })),
		);
	if (agents.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Workspace apps"
			data-testid="template-apps"
			className={cn(
				"overflow-hidden rounded-lg border border-solid border-surface-quaternary",
				className,
			)}
		>
			{agents.map(({ resource, agent }, i) => {
				const tiles = tilesOf(agent);
				return (
					<div
						key={agent.id}
						className={cn(
							i > 0 &&
								"border-0 border-t border-solid border-surface-quaternary",
						)}
					>
						<header className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-surface-quaternary px-4 py-2 text-sm font-medium">
							<LayoutGridIcon className="size-icon-xs text-content-secondary" />
							<span>Apps</span>
							<span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-normal text-content-secondary">
								<span>
									Agent{" "}
									<span className="font-medium text-content-primary">
										{agent.name}
									</span>
								</span>
								<span className="capitalize">{agent.operating_system}</span>
								<span className="font-mono">
									{resource.type}.{resource.name}
								</span>
							</span>
						</header>
						{tiles.length > 0 ? (
							<ul
								className="m-0 flex list-none flex-wrap justify-center gap-3 p-4"
								data-testid="template-apps-list"
							>
								{tiles.map((tile) => (
									<li
										key={tile.key}
										data-testid="template-app"
										className="flex w-28 flex-col items-center gap-2 rounded-lg border border-solid border-surface-quaternary bg-surface-secondary px-2 py-3 text-center text-xs text-content-primary transition-colors hover:border-border-secondary [&>svg]:size-6 [&>img]:size-6 [&_svg]:text-content-secondary"
									>
										{tile.icon}
										<span className="line-clamp-2 break-words">
											{tile.name}
										</span>
									</li>
								))}
							</ul>
						) : (
							<p className="m-0 p-4 text-center text-sm text-content-secondary">
								No apps.
							</p>
						)}
					</div>
				);
			})}
		</section>
	);
};
