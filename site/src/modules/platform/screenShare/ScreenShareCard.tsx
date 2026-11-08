import {
	MaximizeIcon,
	MinimizeIcon,
	MonitorIcon,
	PauseIcon,
	PlayIcon,
	ScanIcon,
	SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "react-query";
import type { MonitoringOverview } from "#/api/platform";
import { screenShareKey, updateScreenShare } from "#/api/queries/screenShare";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CRTShutdown } from "./CRTShutdown";
import {
	type DashboardCapture,
	notifyShareTermination,
	requestDashboardCapture,
	stopMedia,
	updateMedia,
	useShareMedia,
} from "./media";
import {
	CaptureSwitch,
	DashboardControlButton,
	SharedDashboardView,
} from "./SharedDashboardView";
import { SupportWorkspaceSearch } from "./SupportWorkspaceSearch";
import { WorkspaceControlScreen } from "./WorkspaceControlScreen";
import "./screenShare.css";
export const ScreenShareCard = ({
	overview,
	error,
	onRetry,
}: {
	overview?: MonitoringOverview;
	error?: unknown;
	onRetry?: () => void;
}) => {
	const [workspace, setWorkspace] = useState("");
	const [directWorkspace, setDirectWorkspace] = useState("");
	const viewer = useRef<HTMLDivElement>(null);
	const [fullscreen, setFullscreen] = useState(false);
	const [fullscreenError, setFullscreenError] = useState("");
	const [fill, setFill] = useState(false);
	const [paused, setPaused] = useState(false);
	// Control taken in one session never carries into the next.
	const [controlFor, setControlFor] = useState<string | null>(null);
	const controlButton = useRef<HTMLButtonElement>(null);
	const [askedCapture, setAskedCapture] = useState<DashboardCapture | null>(
		null,
	);
	const client = useQueryClient();
	const media = useShareMedia();
	const control = controlFor !== null && controlFor === media.id;
	const setControl = (on: boolean) => setControlFor(on ? media.id : null);
	const controlling = Boolean(media.dashboard && media.remote);
	const selected = overview?.users
		.flatMap(({ instances }) => instances)
		.find((w) => w.workspaceId === workspace);
	useEffect(() => {
		const changed = () =>
			setFullscreen(document.fullscreenElement === viewer.current);
		document.addEventListener("fullscreenchange", changed);
		return () => document.removeEventListener("fullscreenchange", changed);
	}, []);
	const toggleFullscreen = async () => {
		setFullscreenError("");
		try {
			if (document.fullscreenElement === viewer.current)
				await document.exitFullscreen();
			else await viewer.current?.requestFullscreen();
		} catch {
			setFullscreenError("Fullscreen is unavailable in this browser.");
		}
	};
	const end = useMutation({
		...updateScreenShare(),
		onSettled: () => client.invalidateQueries({ queryKey: screenShareKey }),
	});
	const request = useMutation({
		...updateScreenShare(),
		onSuccess: ({ session }) => {
			setPaused(false);
			updateMedia({
				id: session.id,
				status: "Waiting for screen",
				error: null,
			});
			void client.invalidateQueries({ queryKey: screenShareKey });
		},
	});
	return (
		<section
			aria-label="Live workspace support"
			className="support-monitor mb-8 rounded-2xl border border-solid border-border bg-surface-secondary p-4"
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="m-0 text-base font-semibold">
						Live workspace support
					</h2>
					<p className="mb-0 mt-1 text-xs text-content-secondary">
						Connect to the workspace for mouse and keyboard support, or ask its
						owner for control of their Coder dashboard.
					</p>
				</div>
				<div
					className="flex flex-wrap items-center gap-2"
					role="group"
					aria-label="Support monitor controls"
				>
					{controlling && !fullscreen && (
						<DashboardControlButton
							enabled={control}
							onEnabledChange={setControl}
							paused={paused}
							buttonRef={controlButton}
						/>
					)}
					{controlling && media.capture && (
						<CaptureSwitch
							value={media.capture}
							requested={askedCapture}
							onChange={(mode) => {
								setAskedCapture(mode);
								requestDashboardCapture(mode);
							}}
						/>
					)}
					{controlling && askedCapture === "tab" && media.capture !== "tab" && (
						<span role="status" className="text-xs text-content-secondary">
							Waiting for the user to allow tab video
						</span>
					)}
					<Button size="sm" variant="outline" onClick={toggleFullscreen}>
						<MaximizeIcon />
						Fullscreen
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!media.remote}
						aria-pressed={fill}
						onClick={() => setFill(!fill)}
						title="Fit shows the entire screen; Fill crops its edges to fill the monitor."
					>
						<ScanIcon />
						{fill ? "Fit screen" : "Fill monitor"}
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={!media.remote}
						aria-pressed={paused}
						onClick={() => setPaused(!paused)}
						title="Pause your view without stopping the remote workspace."
					>
						{paused ? <PlayIcon /> : <PauseIcon />}
						{paused ? "Resume view" : "Pause view"}
					</Button>
					{selected && !directWorkspace && (
						<Button
							size="sm"
							variant="outline"
							disabled={Boolean(media.id) || request.isPending}
							onClick={() => setDirectWorkspace(workspace)}
						>
							<MonitorIcon />
							Connect workspace
						</Button>
					)}
					{(media.id || directWorkspace) && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								const id = media.id;
								if (directWorkspace) notifyShareTermination();
								setDirectWorkspace("");
								stopMedia();
								if (id) end.mutate({ action: "end", id });
							}}
						>
							<SquareIcon />
							Disconnect
						</Button>
					)}
				</div>
			</div>
			<div className="support-crt">
				<div
					ref={viewer}
					className="support-crt-screen"
					data-live={media.remote || directWorkspace ? "" : undefined}
				>
					<CRTShutdown />
					{fullscreen && controlling && (
						<DashboardControlButton
							enabled={control}
							onEnabledChange={setControl}
							paused={paused}
							buttonRef={controlButton}
							className="absolute left-3 top-3 z-10"
						/>
					)}
					{fullscreen && (
						<Button
							size="sm"
							variant="outline"
							className="absolute right-3 top-3 z-10 bg-surface-primary/80"
							onClick={toggleFullscreen}
						>
							<MinimizeIcon />
							Exit fullscreen
						</Button>
					)}
					{(request.isPending ||
						media.id ||
						media.remote ||
						directWorkspace) && (
						<div
							key={
								directWorkspace ||
								(media.remote ? "live" : (media.id ?? "requesting"))
							}
							className="support-test-pattern"
							aria-hidden="true"
						/>
					)}
					{directWorkspace ? (
						<div className="support-workspace-screen w-full">
							<WorkspaceControlScreen
								workspaceId={directWorkspace}
								onEnded={() => {
									notifyShareTermination();
									setDirectWorkspace("");
								}}
							/>
						</div>
					) : media.remote ? (
						<SharedDashboardView
							stream={media.remote}
							paused={paused}
							fill={fill}
							className="support-monitor-video"
							enabled={control}
							onEnabledChange={setControl}
							controlButtonRef={controlButton}
						/>
					) : (
						<div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center font-mono">
							<span className="text-3xl">◉</span>
							<strong>{media.id ? media.status : "NO SIGNAL"}</strong>
							<span className="text-xs text-content-secondary">
								{media.id
									? "Waiting for the user to select a screen or workspace window."
									: "Select a workspace to begin a support session."}
							</span>
						</div>
					)}
				</div>
				<div className="mt-3 flex items-center gap-2 text-xs">
					<span className="size-2 rounded-full bg-content-success" /> SUPPORT
					MONITOR{" "}
					<span className="ml-auto tracking-[4px] text-content-secondary">
						||||||||||||
					</span>
				</div>
			</div>
			<div className="support-search-controls mt-4">
				<SupportWorkspaceSearch
					overview={overview}
					value={workspace}
					onChange={setWorkspace}
					disabled={request.isPending || Boolean(media.id || directWorkspace)}
				/>
				<Button
					disabled={
						!selected ||
						Boolean(error) ||
						request.isPending ||
						Boolean(media.id || directWorkspace)
					}
					onClick={() =>
						request.mutate({ action: "request", workspace, mode: "dashboard" })
					}
				>
					Request dashboard control
				</Button>
			</div>
			{!overview && !error && (
				<p className="text-sm text-content-secondary">
					Loading workspace list…
				</p>
			)}
			{overview?.users.every(({ instances }) => instances.length === 0) && (
				<p className="text-sm text-content-secondary">
					No workspaces are available for support.
				</p>
			)}
			{request.error && <ErrorAlert error={request.error} />}
			{end.error && <ErrorAlert error={end.error} />}
			{error ? (
				<div className="mt-3">
					<ErrorAlert error={error} />
					{onRetry && (
						<Button size="sm" variant="outline" onClick={onRetry}>
							Retry workspace search
						</Button>
					)}
				</div>
			) : null}
			{fullscreenError && (
				<p role="alert" className="text-sm text-content-destructive">
					{fullscreenError}
				</p>
			)}
			{media.error && (
				<p role="alert" className="text-sm text-content-destructive">
					{media.error}
				</p>
			)}
		</section>
	);
};
