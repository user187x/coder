import { LayoutGridIcon, PlusIcon } from "lucide-react";
import type { WorkspaceApp } from "#/api/typesGenerated";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";

type AddPanelTabProps = {
	/** The apps that can be embedded in a panel. */
	apps: readonly WorkspaceApp[];
	/** The workspace is not ready yet (agentAppsReady). */
	disabled: boolean;
	onAdd: (app: WorkspaceApp) => void;
};

/**
 * A folder tab with a round "+" peeking out above the top panel's right end,
 * over the card's content above it (whichever panel is on top): it adds a
 * panel with one of the workspace's apps (File Browser, the desktop, marimo,
 * code-server, ...) embedded, like the Terminal panel.
 */
export const AddPanelTab: React.FC<AddPanelTabProps> = ({
	apps,
	disabled,
	onAdd,
}) => {
	return (
		<div
			className="pointer-events-none absolute right-6 top-0 z-20 -translate-y-full"
			data-testid="add-panel-tab"
		>
			{/* -mb-px: the tab covers the panel's top border, so the two are one. */}
			<div className="pointer-events-auto -mb-px flex items-center rounded-t-md border border-b-0 border-solid border-border bg-surface-primary px-1.5 pt-0.5 pb-[3px]">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							disabled={disabled}
							aria-label="Add a panel"
							title={
								disabled
									? "Opens when the workspace is ready"
									: "Add a panel with an app"
							}
							className="flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-solid border-border bg-surface-secondary p-0 text-content-secondary transition-colors hover:border-content-secondary hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-content-link disabled:cursor-not-allowed disabled:opacity-50"
						>
							<PlusIcon className="size-3" aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-52">
						<DropdownMenuLabel>Add a panel with</DropdownMenuLabel>
						{apps.map((app) => (
							<DropdownMenuItem key={app.id} onSelect={() => onAdd(app)}>
								{app.icon ? (
									<ExternalImage src={app.icon} className="size-4" />
								) : (
									<LayoutGridIcon />
								)}
								<span>{app.display_name || app.slug}</span>
							</DropdownMenuItem>
						))}
						{apps.length === 0 && (
							<DropdownMenuItem disabled>No apps to embed</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
};
