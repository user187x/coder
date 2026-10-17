import { GlobeIcon, RadioIcon } from "lucide-react";
import type { Workspace, WorkspaceAgent } from "#/api/typesGenerated";
import { portForwardURL } from "#/utils/portForward";
import { AccordionPanel } from "./AccordionPanel";

type LinkPanelProps = {
	id: string;
	workspace: Workspace;
	agent: WorkspaceAgent;
	handle: React.ReactNode;
	ready: boolean;
	initiallyOpen: boolean;
	height: number | undefined;
	onHeightChange: (height: number) => void;
	onRemove: () => void;
};

/**
 * A panel with a port listening in the workspace (Open ports), shown through Coder's port forwarding - only its owner
 * reaches it, as from Open ports. Needs the deployment's wildcard host (*.coder.example.com).
 */
export const AgentPortPanel: React.FC<
	LinkPanelProps & {
		host: string;
		port: number;
		protocol: "http" | "https";
		/** What listens there, if known. */
		process?: string;
	}
> = ({ host, port, protocol, process, workspace, agent, ready, ...panel }) => {
	const href = host
		? portForwardURL(
				host,
				port,
				agent.name,
				workspace.name,
				workspace.owner_name,
				protocol,
			)
		: undefined;
	const title = process ? `${process} :${port}` : `Port ${port}`;
	return (
		<AccordionPanel
			{...panel}
			title={title}
			icon={<RadioIcon className="size-4" />}
			unavailable={
				!host
					? "Needs the deployment's wildcard host"
					: ready
						? undefined
						: "Opens when the workspace is ready"
			}
			href={href}
			kind="port"
			slug={String(port)}
			extras={
				<span
					className="mr-1 rounded-full border border-solid border-border-default bg-surface-secondary px-2 py-px font-mono text-[11px] leading-4 font-medium whitespace-nowrap text-content-secondary"
					title={`Port ${port} in the workspace, over ${protocol.toUpperCase()}`}
				>
					{protocol.toUpperCase()} :{port}
				</span>
			}
		>
			<iframe
				src={href}
				title={title}
				className="block size-full border-0 bg-surface-primary"
			/>
		</AccordionPanel>
	);
};

/** Whether an address is a web page the panel can show: http or https. */
export const webAddress = (value: string): URL | null => {
	try {
		const url = new URL(value.trim());
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
};

/**
 * A panel with any web page (A web address…). A page on Coder's own host (an app's or a port's address) is shown
 * sandboxed, without access to the dashboard; a page that does not allow being shown inside another page stays
 * blank: Pop out opens it.
 */
export const AgentWebPanel: React.FC<
	Omit<LinkPanelProps, "workspace" | "agent" | "ready"> & {
		url: string;
		/** What the user called it; else its host. */
		name?: string;
	}
> = ({ url, name, ...panel }) => {
	const address = webAddress(url);
	const title = name || address?.host || url;
	const sameOrigin = address?.origin === window.location.origin;
	return (
		<AccordionPanel
			{...panel}
			title={title}
			icon={<GlobeIcon className="size-4" />}
			unavailable={address ? undefined : "Not a web address"}
			href={address?.href}
			kind="web"
			slug={address?.host ?? ""}
			extras={
				<span
					className="mr-1 max-w-56 truncate text-xs text-content-secondary"
					title={url}
				>
					{address?.host}
				</span>
			}
		>
			<iframe
				src={address?.href}
				title={title}
				// Coder's own host: no access to the dashboard (no same origin for it)
				sandbox={
					sameOrigin
						? "allow-scripts allow-forms allow-popups allow-downloads allow-modals"
						: "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
				}
				referrerPolicy="no-referrer"
				className="block size-full border-0 bg-surface-primary"
			/>
		</AccordionPanel>
	);
};
