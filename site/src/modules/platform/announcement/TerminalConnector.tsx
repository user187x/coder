import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "react-query";
import { workspaceById } from "#/api/queries/workspaces";
import type { Workspace } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { WorkspaceTerminal } from "#/modules/terminal/WorkspaceTerminal";
import { generateConnectionSessionId, generateUUID } from "#/utils/random";
import { CloudDriveDragCable } from "../cloudDrive/CloudDriveCable";
import {
	resetConnector,
	updateConnector,
	useTerminalConnector,
} from "./terminalConnector";
import "./terminalConnector.css";

export const TerminalConnectorAvatar = ({
	workspace,
	children,
}: {
	workspace: Workspace;
	children: React.ReactNode;
}) => {
	const connector = useTerminalConnector();
	const [drag, setDrag] = useState(false);
	const connect = () => {
		updateConnector({ workspace, origin: null, pointer: null, armed: false });
		setDrag(false);
	};
	const onMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		if (!drag) return;
		const target = document
			.getElementById("coder-system-banner")
			?.getBoundingClientRect();
		updateConnector({ pointer: { x: event.clientX, y: event.clientY } });
		if (
			target &&
			event.clientX >= target.left &&
			event.clientX <= target.right &&
			event.clientY >= target.top &&
			event.clientY <= target.bottom
		)
			connect();
	};
	if (!connector.armed) return children;
	return (
		<button
			type="button"
			aria-label={`Connect ${workspace.name} to banner terminal`}
			className="cursor-grab rounded-xl border-2 border-solid border-content-link bg-transparent p-0"
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					connect();
				}
			}}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.setPointerCapture(event.pointerId);
				const r = event.currentTarget.getBoundingClientRect();
				setDrag(true);
				updateConnector({
					origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
					pointer: { x: event.clientX, y: event.clientY },
				});
			}}
			onPointerMove={onMove}
			onPointerUp={() => {
				setDrag(false);
				updateConnector({ origin: null, pointer: null });
			}}
			onPointerCancel={() => {
				setDrag(false);
				updateConnector({ origin: null, pointer: null });
			}}
		>
			{children}
		</button>
	);
};
export const TerminalConnectorCable = () => {
	const { origin, pointer, armed } = useTerminalConnector();
	useEffect(() => {
		if (!armed) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key === "Escape") resetConnector();
		};
		window.addEventListener("keydown", cancel);
		return () => window.removeEventListener("keydown", cancel);
	}, [armed]);
	if (!armed) return null;
	return createPortal(
		<>
			<div
				role="status"
				className="pointer-events-none fixed left-1/2 top-24 z-[100] -translate-x-1/2 rounded-xl bg-surface-primary p-3 text-sm shadow-lg"
			>
				Drag a workspace avatar to the banner, or focus it and press Enter.
			</div>
			<CloudDriveDragCable
				origin={origin}
				pointer={pointer}
				connectorTarget={() => {
					const banner = document
						.getElementById("coder-system-banner")
						?.getBoundingClientRect();
					return banner
						? {
								x: banner.left + banner.width / 2,
								y: banner.top + banner.height / 2,
							}
						: null;
				}}
			/>
		</>,
		document.body,
	);
};
export const BannerWorkspaceTerminal = ({
	workspace,
}: {
	workspace: Workspace;
}) => {
	const query = useQuery(workspaceById(workspace.id));
	const [reconnectionToken] = useState(generateUUID);
	const [sessionId] = useState(generateConnectionSessionId);
	const [error, setError] = useState<Error>();
	const [flash, setFlash] = useState(true);
	const agent = query.data?.latest_build.resources
		.flatMap((r) => r.agents ?? [])
		.find(
			(a) =>
				a.status === "connected" && a.display_apps.includes("web_terminal"),
		);
	const [apiMajor, apiMinor] = (agent?.api_version ?? "0.0")
		.split(".")
		.map(Number);
	const canTerminate = apiMajor > 2 || (apiMajor === 2 && apiMinor >= 13);
	useEffect(() => {
		const timer = setTimeout(() => setFlash(false), 1800);
		return () => clearTimeout(timer);
	}, []);
	return (
		<>
			{flash &&
				createPortal(
					<div aria-hidden className="banner-terminal-flash" />,
					document.body,
				)}
			<div className="min-h-0 min-w-0 flex-1 overflow-auto bg-black p-3">
				{query.error || error ? (
					<ErrorAlert error={query.error || error} />
				) : query.isLoading ? (
					<p>
						Connecting to {workspace.owner_name}/{workspace.name}…
					</p>
				) : !agent ? (
					<p>This workspace has no connected agent with web terminal access.</p>
				) : !canTerminate ? (
					<p>
						Update this workspace to a template with the latest Coder agent,
						then restart it to enable banner terminals that end when the panel
						closes.
					</p>
				) : (
					<WorkspaceTerminal
						key={agent.id}
						agentId={agent.id}
						operatingSystem={agent.operating_system}
						reconnectionToken={reconnectionToken}
						sessionId={sessionId}
						terminateOnUnmount
						onExit={resetConnector}
						onError={setError}
						className="h-full"
					/>
				)}
			</div>
		</>
	);
};
