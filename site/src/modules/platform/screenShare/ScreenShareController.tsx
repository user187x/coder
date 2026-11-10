import { PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	screenShareKey,
	screenShares,
	updateScreenShare,
} from "#/api/queries/screenShare";
import type { ScreenShareSession } from "#/api/screenShare";
import { Button } from "#/components/Button/Button";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import {
	addShareTracks,
	bindDashboardChannel,
	completeDescription,
	declineDashboardCapture,
	measureLatency,
	setDashboardCapture,
	shareDashboard,
	shareScreen,
	stopMedia,
	updateMedia,
	useRemotePointer,
	useShareMedia,
} from "./media";
import { CaptureSwitch, SharedDashboardView } from "./SharedDashboardView";

const subscribeFullscreen = (changed: () => void) => {
	document.addEventListener("fullscreenchange", changed);
	return () => document.removeEventListener("fullscreenchange", changed);
};
const watermarkHost = () => document.fullscreenElement ?? document.body;

/** Keeps a consented stream alive across page changes; navigation never starts capture. */
export const ScreenShareController = () => {
	const { user } = useAuthContext();
	const overlayHost = useSyncExternalStore(subscribeFullscreen, watermarkHost);
	const client = useQueryClient();
	const query = useQuery({ ...screenShares(), enabled: Boolean(user) });
	const { mutateAsync: signal } = useMutation({
		...updateScreenShare(),
		onSettled: (_data, _error, action) => {
			if (action.action !== "heartbeat")
				void client.invalidateQueries({ queryKey: screenShareKey });
		},
	});
	const action = useMutation({
		...updateScreenShare(),
		onSettled: () => client.invalidateQueries({ queryKey: screenShareKey }),
	});
	const capture = useMutation({
		mutationFn: (session: ScreenShareSession) =>
			session.mode === "dashboard"
				? shareDashboard(session.id)
				: shareScreen(session.id),
	});
	const media = useShareMedia();
	const location = useLocation();
	const session = query.data?.sessions.find((s) => s.id === media.id);
	const iceServers = useEffectEvent(() => query.data?.iceServers ?? []);
	const expiresAt = useEffectEvent(() =>
		session ? Date.parse(session.expires_at) : Number.NaN,
	);
	const isSharer = session?.sharer === user?.id;
	const offer = isSharer ? null : session?.offer;
	const dashboard = session?.mode === "dashboard";
	const pcRef = useRef<RTCPeerConnection | null>(null);
	useEffect(() => {
		if (!media.id || (!media.local && !offer)) return;
		const id = media.id;
		const pc = new RTCPeerConnection({
			iceServers: iceServers(),
			iceTransportPolicy: iceServers().length ? "relay" : "all",
		});
		pcRef.current = pc;
		if (dashboard) {
			updateMedia({ dashboard: true });
			if (isSharer)
				bindDashboardChannel(
					pc.createDataChannel("coder-dashboard-control-v1"),
					id,
					true,
				);
			else
				pc.ondatachannel = (event) =>
					bindDashboardChannel(event.channel, id, false);
		}
		let disposed = false;
		pc.ontrack = (event) => {
			if (disposed) return;
			event.track.addEventListener(
				"ended",
				() => {
					if (!disposed) stopMedia();
				},
				{ once: true },
			);
			updateMedia({ remote: new MediaStream([event.track]), status: "Live" });
		};
		pc.onconnectionstatechange = () => {
			if (disposed) return;
			if (pc.connectionState === "connected") updateMedia({ status: "Live" });
			if (pc.connectionState === "failed")
				stopMedia("Connection failed. End the session and reconnect.");
		};
		const negotiate = async () => {
			if (isSharer && media.local) {
				addShareTracks(pc, media.local);
				const sdp = await completeDescription(pc, await pc.createOffer());
				if (!disposed) await signal({ action: "offer", id, sdp });
			} else if (offer) {
				await pc.setRemoteDescription({ type: "offer", sdp: offer });
				const sdp = await completeDescription(pc, await pc.createAnswer());
				if (!disposed) await signal({ action: "answer", id, sdp });
			}
		};
		// The live view's latency, from the connection's own round-trip measurements.
		const latencyTimer = setInterval(() => {
			if (pc.connectionState !== "connected") return;
			void measureLatency(pc)
				.then((latency) => {
					if (!disposed && latency !== null) updateMedia({ latency });
				})
				.catch(() => {});
		}, 2000);
		void negotiate().catch((error) => {
			if (!disposed)
				stopMedia(getErrorMessage(error, "Could not connect screen share."));
		});
		return () => {
			disposed = true;
			clearInterval(latencyTimer);
			pc.close();
			pcRef.current = null;
		};
		// A session has one offer. Poll updates must not recreate its peer connection.
	}, [media.id, media.local, offer, isSharer, dashboard, signal]);
	useEffect(() => {
		const pc = pcRef.current;
		if (
			!session?.answer ||
			!isSharer ||
			!pc ||
			pc.signalingState !== "have-local-offer"
		)
			return;
		void pc
			.setRemoteDescription({ type: "answer", sdp: session.answer })
			.catch((error) =>
				stopMedia(getErrorMessage(error, "Could not accept the viewer.")),
			);
	}, [session?.answer, isSharer]);
	useEffect(() => {
		if (!media.id) return;
		const id = media.id;
		let confirmedAt = Date.now();
		let pending = false;
		let disposed = false;
		const heartbeat = () => {
			if (pending || disposed) return;
			pending = true;
			void signal({ action: "heartbeat", id })
				.then(({ session }) => {
					if (disposed) return;
					confirmedAt = Date.now();
					if (session.status === "ended") stopMedia();
					else if (Date.parse(session.expires_at) <= Date.now())
						stopMedia("This screen-sharing session has expired.");
				})
				.catch(() => {
					// The independent watchdog also covers requests that never settle.
				})
				.finally(() => {
					pending = false;
				});
		};
		heartbeat();
		const timer = setInterval(heartbeat, 10000);
		const watchdog = setInterval(() => {
			if (Date.now() - confirmedAt >= 30000) {
				disposed = true;
				stopMedia("Connection to Coder was lost. Screen sharing stopped.");
			} else if (expiresAt() <= Date.now()) {
				disposed = true;
				stopMedia("This screen-sharing session has expired.");
			}
		}, 1000);
		return () => {
			disposed = true;
			clearInterval(timer);
			clearInterval(watchdog);
			void signal({ action: "end", id }).catch(() => {
				/* Server expires abandoned sessions after 45 seconds. */
			});
		};
	}, [media.id, signal]);
	useEffect(() => () => stopMedia(), []);
	useEffect(() => {
		if (!media.dashboard || !media.local) return;
		const stopShortcut = (event: KeyboardEvent) => {
			if (
				event.isTrusted &&
				event.ctrlKey &&
				event.altKey &&
				event.key === "Escape"
			)
				stopMedia();
		};
		window.addEventListener("keydown", stopShortcut, true);
		return () => window.removeEventListener("keydown", stopShortcut, true);
	}, [media.dashboard, media.local]);
	const pending = query.data?.sessions[0];
	const mediaError = pending?.status === "requested" ? null : media.error;
	const captureError =
		capture.variables?.id === pending?.id ? capture.error : null;
	const actionError =
		action.variables &&
		"id" in action.variables &&
		action.variables.id === pending?.id
			? action.error
			: null;
	if (!pending && !media.error) return null;
	const connectedElsewhere = Boolean(
		!media.id &&
			pending &&
			(pending.sharer === user?.id ? pending.offer : pending.answer),
	);
	const end = () => {
		stopMedia();
		capture.reset();
		action.reset();
		if (pending) action.mutate({ action: "end", id: pending.id });
	};
	const monitored = query.data?.sessions.some(
		(s) =>
			s.admin_viewer &&
			s.status === "sharing" &&
			Date.parse(s.expires_at) > Date.now(),
	);
	const viewingHere =
		Boolean(media.id && media.remote) &&
		location.pathname !== "/deployment/monitoring";
	// Once connected, the session is a pill by the monitoring badge; the panel stays only for what still needs attention.
	const panel =
		!media.id ||
		viewingHere ||
		Boolean(mediaError || captureError || actionError);
	return (
		<>
			{(media.id || monitored) &&
				createPortal(
					<div
						data-dashboard-support-ignore
						className="pointer-events-none fixed bottom-[calc(var(--coder-classification-h,0px)+0.75rem)] left-3 z-[100] flex flex-col items-start gap-1.5"
					>
						{media.id && (
							<div
								role="status"
								aria-label="Support session"
								className="pointer-events-auto flex items-center gap-2 rounded-full border border-solid border-border bg-surface-primary/90 py-0.5 pl-3 pr-0.5 text-xs font-semibold shadow-lg"
							>
								<span
									aria-hidden
									className={
										media.status === "Live"
											? "size-2 rounded-full bg-content-success"
											: "size-2 rounded-full bg-content-warning"
									}
								/>
								{media.local
									? media.dashboard
										? "Dashboard control"
										: "Sharing screen"
									: "Viewing"}
								: {media.status}
								{media.local && media.dashboard && media.capture && (
									<>
										{media.captureRequest === "tab" && (
											<span className="font-normal text-content-link">
												Video requested
											</span>
										)}
										<CaptureSwitch
											value={media.capture}
											requested={media.captureRequest}
											onChange={(mode) =>
												void setDashboardCapture(mode).catch((error) =>
													toast.error(
														getErrorMessage(
															error,
															"Could not switch the dashboard capture.",
														),
													),
												)
											}
										/>
										{media.captureRequest === "tab" && (
											<Button
												size="xs"
												variant="subtle"
												className="rounded-full"
												onClick={declineDashboardCapture}
											>
												Not now
											</Button>
										)}
									</>
								)}
								<Button
									size="xs"
									variant="outline"
									className="rounded-full"
									onClick={end}
								>
									Stop
								</Button>
							</div>
						)}
						{monitored && (
							<div
								role="status"
								className="rounded-md bg-black/70 px-3 py-1.5 text-xs font-semibold text-white"
							>
								Monitoring In Progress
							</div>
						)}
					</div>,
					overlayHost,
				)}
			{media.dashboard &&
				media.local &&
				media.controlReady &&
				createPortal(<SupportPointer />, overlayHost)}
			{panel && (
				<aside
					aria-label="Desktop support session"
					data-dashboard-support-ignore
					className="fixed left-1/2 top-20 z-[70] w-[min(420px,calc(calc(100vw/var(--app-zoom,1))-32px))] -translate-x-1/2 rounded-xl border border-solid border-border bg-surface-primary p-3 shadow-xl"
				>
					<div className="flex items-center justify-between gap-3">
						<strong className="text-sm">
							{media.id
								? `${media.local ? (media.dashboard ? "Dashboard control" : "Sharing screen") : "Viewing"}: ${media.status}`
								: mediaError
									? "Screen sharing stopped"
									: connectedElsewhere
										? "Screen share active in another tab"
										: "Desktop support request"}
						</strong>
						<Button size="sm" variant="outline" onClick={end}>
							{media.id
								? "Stop"
								: !pending
									? "Dismiss"
									: connectedElsewhere
										? "End session"
										: "Decline"}
						</Button>
					</div>
					{pending && !media.id && (
						<p className="my-2 text-xs text-content-secondary">
							{pending.sharer === user?.id
								? `Share with ${pending.viewer_name}`
								: `Viewing ${pending.sharer_name}`}{" "}
							· {pending.label} ·{" "}
							{pending.mode === "dashboard"
								? "Mouse and keyboard control"
								: "View only"}{" "}
							· Ends after one hour
						</p>
					)}
					{!media.id &&
						pending?.mode === "dashboard" &&
						pending.sharer === user?.id && (
							<p className="my-2 text-xs text-content-secondary">
								Allow {pending.viewer_name} to see and operate this Coder
								dashboard tab. You can stop at any time with Stop or
								Ctrl+Alt+Escape. Other tabs, password fields, and workspace
								windows are excluded.
							</p>
						)}
					{connectedElsewhere && (
						<p className="my-2 text-xs text-content-secondary">
							Continue in the browser or tab where you connected. End this
							session before starting another.
						</p>
					)}
					{!media.id && pending && (
						<Button
							size="sm"
							disabled={capture.isPending || connectedElsewhere}
							onClick={() =>
								pending.sharer === user?.id
									? capture.mutate(pending)
									: updateMedia({
											id: pending.id,
											error: null,
											status: "Waiting for screen",
										})
							}
						>
							{pending.sharer === user?.id
								? pending.mode === "dashboard"
									? "Allow dashboard control"
									: "Share screen"
								: pending.mode === "dashboard"
									? "View dashboard"
									: "View screen"}
						</Button>
					)}
					{viewingHere && (
						<SharedDashboardView
							stream={media.remote}
							className="max-h-[calc(60vh/var(--app-zoom,1))]"
						/>
					)}
					{(mediaError || captureError || actionError) && (
						<p role="alert" className="text-xs text-content-destructive">
							{mediaError ||
								getErrorMessage(
									captureError || actionError,
									"Could not update support session.",
								)}
						</p>
					)}
				</aside>
			)}
		</>
	);
};

/** Shows the owner where the support viewer's pointer is; capture excludes it. */
const SupportPointer = () => {
	const pointer = useRemotePointer();
	if (!pointer) return null;
	return (
		<PointerIcon
			aria-hidden
			data-dashboard-support-ignore
			className="pointer-events-none fixed z-[100] size-6 -translate-x-[40%] text-content-link drop-shadow"
			style={{ left: pointer.x * innerWidth, top: pointer.y * innerHeight }}
		/>
	);
};
