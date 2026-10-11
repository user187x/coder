import { cn } from "cn";
import { Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "#/api/typesGenerated";
import { ChevronDownIcon } from "#/components/AnimatedIcons/ChevronDown";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import {
	Collapsible,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { WorkspaceAppFrame } from "#/modules/apps/WorkspaceAppFrame";

type AgentAppPanelProps = {
	workspace: Workspace;
	agent: WorkspaceAgent;
	/** The app, or undefined when the workspace no longer has it. */
	app: WorkspaceApp | undefined;
	slug: string;
	handle: React.ReactNode;
	/** The workspace is ready (agentAppsReady): until then the panel does not open. */
	ready: boolean;
	/** Just added: open it right away. */
	initiallyOpen: boolean;
	onRemove: () => void;
};

/**
 * A panel the user added (AddPanelTab): one of the workspace's apps embedded
 * in the page, like the Terminal panel. The app loads when the panel first
 * opens; collapsing the panel only hides it (the app keeps its state), the
 * bin removes the panel and closes the app. A workspace that stops takes the
 * app with it: the panel rolls up and starts over when it is next opened. The
 * app's box can be made taller or shorter by its bottom-right corner.
 */
export const AgentAppPanel: React.FC<AgentAppPanelProps> = ({
	workspace,
	agent,
	app,
	slug,
	handle,
	ready,
	initiallyOpen,
	onRemove,
}) => {
	const [open, setOpen] = useState(initiallyOpen && ready);
	const [loaded, setLoaded] = useState(initiallyOpen && ready);
	useEffect(() => {
		if (!ready) {
			setOpen(false);
			setLoaded(false);
		}
	}, [ready]);
	const name = app?.display_name || slug;

	return (
		<section
			className="border-0 border-t border-solid border-border"
			data-testid="agent-app-panel"
			data-app={slug}
		>
			<Collapsible
				open={open}
				disabled={!app || !ready}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						setLoaded(true);
					}
				}}
			>
				<div className="px-4 py-2 relative flex items-center gap-2">
					{handle}
					<CollapsibleTrigger asChild>
						<Button
							variant="subtle"
							className="after:content-[''] after:absolute after:inset-0"
						>
							<ChevronDownIcon open={open} />
							{app?.icon && <ExternalImage src={app.icon} className="size-4" />}
							<span>{name}</span>
						</Button>
					</CollapsibleTrigger>
					{!app && (
						<Badge size="xs" className="relative z-[1]">
							No longer in this workspace
						</Badge>
					)}
					{app && !ready && (
						<Badge size="xs" className="relative z-[1]">
							Opens when the workspace is ready
						</Badge>
					)}
					<Button
						size="icon"
						variant="subtle"
						className="relative z-[1] ml-auto text-content-secondary hover:text-content-destructive"
						aria-label={`Remove the ${name} panel`}
						title={`Remove this panel and close ${name}`}
						onClick={onRemove}
					>
						<Trash2Icon />
					</Button>
				</div>
				{loaded && app && (
					<div className={cn("px-4 pb-4", !open && "hidden")}>
						<div
							className="h-[640px] min-h-[240px] resize-y overflow-hidden rounded-md border border-solid border-border"
							data-testid="agent-app-frame"
						>
							<WorkspaceAppFrame
								workspace={workspace}
								app={{ ...app, agent }}
								active
							/>
						</div>
					</div>
				)}
			</Collapsible>
		</section>
	);
};
