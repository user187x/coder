import {
	GlobeIcon,
	LayoutGridIcon,
	PlusIcon,
	SquareTerminalIcon,
} from "lucide-react";
import type { WorkspaceApp } from "#/api/typesGenerated";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import type { PanelContent } from "./agentPanelsStore";

type AddPanelTabProps = {
	/** The apps that can go in a panel (canBePanel). */
	apps: readonly WorkspaceApp[];
	/** The workspace is not ready yet (agentAppsReady). */
	disabled: boolean;
	onAdd: (content: PanelContent) => void;
};

/** A circular add control inside an inward notch along the panel's top edge. */
export const AddPanelTab: React.FC<AddPanelTabProps> = ({
	apps,
	disabled,
	onAdd,
}) => {
	return (
		<div
			className="pointer-events-none absolute right-6 top-0 z-20 -translate-y-px"
			data-testid="add-panel-tab"
		>
			<div className="pointer-events-auto relative h-4 w-8 rounded-b-full border border-t-0 border-solid border-border bg-surface-primary">
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
							className="absolute left-1/2 top-0 z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-content-success p-0 text-content-invert shadow-[0_0_0_2px_hsl(var(--content-success)/0.18)] transition-[filter,box-shadow] hover:brightness-110 hover:shadow-[0_0_0_3px_hsl(var(--content-success)/0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-success disabled:cursor-not-allowed disabled:opacity-50"
							data-testid="add-panel-button"
						>
							<PlusIcon className="size-4" strokeWidth={3} aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="max-h-[70vh] min-w-56 overflow-y-auto"
					>
						<DropdownMenuLabel>Add a panel with</DropdownMenuLabel>
						{apps.map((app) => (
							<DropdownMenuItem
								key={app.id}
								onSelect={() => onAdd({ kind: "app", slug: app.slug })}
							>
								{app.icon ? (
									<ExternalImage src={app.icon} className="size-4" />
								) : app.command ? (
									<SquareTerminalIcon />
								) : app.external ? (
									<GlobeIcon />
								) : (
									<LayoutGridIcon />
								)}
								<span>{app.display_name || app.slug}</span>
								{app.command && (
									<span className="ml-auto text-2xs text-content-secondary">
										terminal
									</span>
								)}
								{app.external && !app.command && (
									<span className="ml-auto text-2xs text-content-secondary">
										external
									</span>
								)}
							</DropdownMenuItem>
						))}
						{apps.length === 0 && (
							<DropdownMenuItem disabled>No apps</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
};
