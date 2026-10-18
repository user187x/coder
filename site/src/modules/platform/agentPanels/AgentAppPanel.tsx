import { GlobeIcon, SquareTerminalIcon } from "lucide-react";
import type {
	Workspace,
	WorkspaceAgent,
	WorkspaceApp,
} from "#/api/typesGenerated";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { isExternalApp, needsSessionToken } from "#/modules/apps/apps";
import { useAppLink } from "#/modules/apps/useAppLink";
import { WorkspaceAppFrame } from "#/modules/apps/WorkspaceAppFrame";
import { AccordionPanel } from "./AccordionPanel";

export { MAX_APP_HEIGHT, MIN_APP_HEIGHT } from "./AccordionPanel";

/**
 * The apps that grow to fit their page. Not the desktop or code-server:
 * they size themselves to the box (noVNC even resizes the remote desktop to
 * it), so growing the box to their page would never stop.
 */
const FIT_TO_PAGE = new Set(["filebrowser"]);

/** The apps whose panel shows the port and protocol their service runs on: the dataflow template's. */
const SERVICE_APPS = new Set(["nifi", "airflow"]);

/**
 * Whether an app can go in a panel: any app shown on the workspace page - one served from the workspace, a command
 * (in a terminal), an external web page - but a custom-protocol app (an IDE on the computer: not a page) or one whose
 * address carries a session token (made when it is clicked).
 */
export const canBePanel = (app: WorkspaceApp): boolean =>
	!app.hidden &&
	(!isExternalApp(app) ||
		(/^https?:\/\//i.test(app.url) && !needsSessionToken(app)));

/**
 * The protocol and port an app's service runs on, inside the workspace: its
 * health check's (the service itself; NiFi's app URL is the nginx in front of
 * it), else its URL's. Null without either, or for an address that is not one.
 */
export const servicePort = (
	app: Pick<WorkspaceApp, "url" | "healthcheck">,
): { protocol: "HTTP" | "HTTPS"; port: number } | null => {
	const address = app.healthcheck?.url || app.url;
	if (!address) {
		return null;
	}
	try {
		const url = new URL(address);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}
		const secure = url.protocol === "https:";
		return {
			protocol: secure ? "HTTPS" : "HTTP",
			port: url.port ? Number(url.port) : secure ? 443 : 80,
		};
	} catch {
		return null;
	}
};

type AgentAppPanelProps = {
	/** The panel's id (its browser window is named after it). */
	id: string;
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
	/** The height the user gave it before, if any. */
	height: number | undefined;
	onHeightChange: (height: number) => void;
	onRemove: () => void;
};

/**
 * A panel with one of the workspace's apps (AddPanelTab), like the Terminal panel: one served from the workspace, a
 * command app in a terminal, or an external web page (one that refuses to be shown in a page stays blank: Pop out
 * opens it). The dataflow apps show the port and protocol their service runs on.
 */
export const AgentAppPanel: React.FC<AgentAppPanelProps> = (props) =>
	props.app ? (
		<PanelWithApp {...props} app={props.app} />
	) : (
		<AccordionPanel
			id={props.id}
			title={props.slug}
			handle={props.handle}
			unavailable="No longer in this workspace"
			initiallyOpen={false}
			height={props.height}
			onHeightChange={props.onHeightChange}
			onRemove={props.onRemove}
			kind="app"
			slug={props.slug}
		>
			{null}
		</AccordionPanel>
	);

const PanelWithApp: React.FC<AgentAppPanelProps & { app: WorkspaceApp }> = ({
	id,
	workspace,
	agent,
	app,
	slug,
	handle,
	ready,
	initiallyOpen,
	height,
	onHeightChange,
	onRemove,
}) => {
	const link = useAppLink(app, { agent, workspace });
	const name = app.display_name || slug;
	const service = SERVICE_APPS.has(slug) ? servicePort(app) : null;
	const external = isExternalApp(app);
	return (
		<AccordionPanel
			id={id}
			title={name}
			icon={
				app.icon ? (
					<ExternalImage src={app.icon} className="size-4" />
				) : app.command ? (
					<SquareTerminalIcon className="size-4" />
				) : external ? (
					<GlobeIcon className="size-4" />
				) : undefined
			}
			handle={handle}
			unavailable={ready ? undefined : "Opens when the workspace is ready"}
			initiallyOpen={initiallyOpen}
			href={link.href}
			fitToPage={FIT_TO_PAGE.has(slug)}
			height={height}
			onHeightChange={onHeightChange}
			onRemove={onRemove}
			kind={app.command ? "command" : external ? "external" : "app"}
			slug={slug}
			extras={
				<>
					{/* Platform: the port and protocol the app's service runs on, at the right, before Pop out. */}
					{service && (
						<span
							className="mr-1 rounded-full border border-solid border-border-default bg-surface-secondary px-2 py-px font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-content-secondary"
							title={`${name} runs on port ${service.port} (${service.protocol}) inside the workspace`}
							data-testid="agent-app-service-port"
						>
							{service.protocol} :{service.port}
						</span>
					)}
					{external && (
						<span
							className="mr-1 text-xs text-content-secondary"
							title="A page outside the workspace: one that does not allow being shown inside another page stays blank here - Pop out opens it."
						>
							External
						</span>
					)}
				</>
			}
		>
			<WorkspaceAppFrame workspace={workspace} app={{ ...app, agent }} active />
		</AccordionPanel>
	);
};
