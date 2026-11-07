import { EyeIcon, MousePointer2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "react-query";
import { workspaceById } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import { useProxy } from "#/contexts/ProxyContext";
import { useAppLink } from "#/modules/apps/useAppLink";
import { WorkspaceIframe } from "#/modules/apps/WorkspaceAppFrame";
import { WorkspaceWildcardWarning } from "#/modules/apps/WorkspaceWildcardWarning";
import {
	getAllAppsWithAgent,
	type WorkspaceAppWithAgent,
} from "#/modules/apps/workspaceApps";

/** Uses the workspace app proxy's owner/admin authorization and native input transport. */
export const WorkspaceControlScreen = ({
	workspaceId,
	onEnded,
}: {
	workspaceId: string;
	onEnded: () => void;
}) => {
	const query = useQuery({
		...workspaceById(workspaceId),
		refetchInterval: 10000,
	});
	const [appId, setAppId] = useState("");
	const workspace = query.data;
	if (query.error) return <ErrorAlert error={query.error} />;
	if (!workspace) return <Loader />;
	const apps = getAllAppsWithAgent(workspace).filter(
		(app) =>
			["desktop", "novnc", "neko-browser", "neko"].includes(app.slug) &&
			!app.external &&
			!app.command &&
			!app.hidden,
	);
	const app = apps.find((entry) => entry.id === appId) ?? apps[0];
	if (workspace.latest_build.status !== "running")
		return (
			<p className="p-6 text-center">
				Start this workspace before connecting to its screen.
			</p>
		);
	if (!app)
		return (
			<p className="p-6 text-center">
				This workspace has no Desktop or Browser app. Request screen sharing to
				view a window chosen by its owner.
			</p>
		);
	return (
		<div className="flex h-full min-h-0 flex-col">
			{apps.length > 1 && (
				<div
					role="group"
					aria-label="Workspace screens"
					className="flex gap-2 p-2"
				>
					{apps.map((entry) => (
						<Button
							key={entry.id}
							size="sm"
							variant="outline"
							aria-pressed={app.id === entry.id}
							onClick={() => setAppId(entry.id)}
						>
							{entry.display_name || entry.slug}
						</Button>
					))}
				</div>
			)}
			<ControlApp
				key={app.id}
				workspace={workspace}
				app={app}
				onEnded={onEnded}
			/>
		</div>
	);
};

const ControlApp = ({
	workspace,
	app,
	onEnded,
}: {
	workspace: Workspace;
	app: WorkspaceAppWithAgent;
	onEnded: () => void;
}) => {
	const { proxy } = useProxy();
	// Isolate workspace content from the dashboard origin, including apps whose
	// normal owner-facing entry point uses a path URL.
	const link = useAppLink(
		{
			...app,
			subdomain: true,
			subdomain_name:
				app.subdomain_name ||
				`${app.slug}--${workspace.name}--${workspace.owner_name}`,
		},
		{ workspace, agent: app.agent },
	);
	const [control, setControl] = useState(false);
	const [confirmedControl, setConfirmedControl] = useState<boolean>();
	const [connectionError, setConnectionError] = useState("");
	const frame = useRef<HTMLIFrameElement>(null);
	const url = link.href ? new URL(link.href, location.origin) : undefined;
	if (url) {
		if (app.slug === "neko-browser") url.pathname = "/support";
		if (app.slug === "novnc" || app.slug === "desktop") {
			url.searchParams.set("autoconnect", "true");
			url.searchParams.set("path", "websockify");
			// noVNC defaults to JPEG quality 6, which smears text when scaled up.
			url.searchParams.set("quality", "9");
		}
		url.searchParams.set("support", "1");
		url.searchParams.set("support_build", workspace.latest_build.id);
		url.searchParams.set("resize", "scale");
		url.searchParams.set("view_only", "true");
	}
	const src = url?.href;
	const origin = url?.origin;
	const sendControl = useCallback(() => {
		if (origin)
			frame.current?.contentWindow?.postMessage(
				{ type: "coder:support-control", enabled: control },
				origin,
			);
	}, [origin, control]);
	useEffect(() => {
		const receive = (event: MessageEvent) => {
			if (
				event.source !== frame.current?.contentWindow ||
				event.origin !== origin
			)
				return;
			if (event.data?.type === "coder:support-ready") sendControl();
			if (
				event.data?.type === "coder:support-control-state" &&
				typeof event.data.enabled === "boolean" &&
				event.data.enabled === control
			) {
				setConfirmedControl(event.data.enabled);
				setConnectionError("");
			}
			if (event.data?.type === "coder:support-ended") onEnded();
		};
		window.addEventListener("message", receive);
		sendControl();
		return () => window.removeEventListener("message", receive);
	}, [sendControl, origin, onEnded, control]);
	useEffect(() => {
		if (confirmedControl === control) return;
		const timeout = window.setTimeout(() => {
			setControl(false);
			if (origin)
				frame.current?.contentWindow?.postMessage(
					{ type: "coder:support-control", enabled: false },
					origin,
				);
			setConnectionError(
				"The workspace viewer has not confirmed the connection. Open it to sign in if needed, then reconnect.",
			);
		}, 15000);
		return () => window.clearTimeout(timeout);
	}, [confirmedControl, control, origin]);
	const inputEnabled = control && confirmedControl === true && !connectionError;
	if (!proxy.preferredWildcardHostname) return <WorkspaceWildcardWarning />;
	if (url?.protocol !== "https:" || url.origin === location.origin)
		return (
			<p className="p-6 text-center">
				Workspace support requires an isolated HTTPS app host.
			</p>
		);
	if (
		app.agent.status !== "connected" ||
		!["healthy", "disabled"].includes(app.health)
	)
		return (
			<p className="p-6 text-center">
				The workspace screen is not ready. Waiting for its agent and app.
			</p>
		);
	return (
		<>
			<div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-border p-2">
				<Button
					size="sm"
					variant="outline"
					aria-pressed={inputEnabled}
					disabled={
						confirmedControl === undefined ||
						control !== confirmedControl ||
						Boolean(connectionError)
					}
					onClick={() => setControl(!control)}
				>
					{inputEnabled ? <EyeIcon /> : <MousePointer2Icon />}
					{inputEnabled ? "View only" : "Enable mouse and keyboard"}
				</Button>
				<span className="text-xs text-content-secondary">
					{confirmedControl === undefined
						? "Connecting to workspace viewer…"
						: control !== confirmedControl
							? "Updating input controls…"
							: inputEnabled
								? "Mouse and keyboard enabled. Click inside the screen to type."
								: "View only"}
				</span>
			</div>
			{connectionError && (
				<div className="flex flex-wrap items-center gap-2 p-2">
					<p role="alert" className="m-0 text-xs text-content-destructive">
						{connectionError}
					</p>
					<Button asChild size="sm" variant="outline">
						<a href={src} target="_blank" rel="noopener noreferrer">
							Open workspace viewer
						</a>
					</Button>
				</div>
			)}
			<div
				className="min-h-0 flex-1"
				inert={!inputEnabled && app.slug !== "neko-browser"}
				style={{
					pointerEvents:
						inputEnabled || app.slug === "neko-browser" ? "auto" : "none",
				}}
			>
				<WorkspaceIframe
					ref={frame}
					src={src}
					onLoad={sendControl}
					allow=""
					referrerPolicy="origin"
					title={`${workspace.owner_name}/${workspace.name} ${app.display_name || app.slug}`}
				/>
			</div>
		</>
	);
};
