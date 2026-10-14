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
 * A half-moon tab peeking out above the top panel's right end, over the card's
 * content above it (whichever panel is on top), with a round "+" inside it in
 * the theme's accent colour: it adds a panel with one of the workspace's apps
 * (File Browser, the desktop, marimo, code-server, ...) embedded, like the
 * Terminal panel.
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
			{/* A semicircle (twice as wide as it is tall, rounded on top); -mb-px: it covers the panel's top border, so
			    the two are one. The "+" sits at its foot, centred on the panel's border. */}
			<div className="pointer-events-auto -mb-px flex h-[19px] w-[38px] items-end justify-center rounded-t-full border border-b-0 border-solid border-border bg-surface-primary">
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
							className="relative z-10 flex size-[15px] translate-y-[7px] cursor-pointer items-center justify-center rounded-full border-0 bg-content-link p-0 text-content-invert shadow-[0_0_0_2px_hsl(var(--content-link)/0.18)] transition-[filter,box-shadow] hover:brightness-110 hover:shadow-[0_0_0_3px_hsl(var(--content-link)/0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link disabled:cursor-not-allowed disabled:opacity-50"
							data-testid="add-panel-button"
						>
							<PlusIcon className="size-[11px]" strokeWidth={3} aria-hidden />
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
