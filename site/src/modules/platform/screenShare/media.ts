import { useSyncExternalStore } from "react";
import { captureDashboard } from "./dashboardCapture";
import {
	applyDashboardInput,
	type DashboardInput,
	parseDashboardInput,
	parseDashboardPointer,
} from "./dashboardInput";

type MediaState = {
	id: string | null;
	local: MediaStream | null;
	remote: MediaStream | null;
	status: string;
	error: string | null;
	dashboard: boolean;
	controlReady: boolean;
};
let state: MediaState = {
	id: null,
	local: null,
	remote: null,
	status: "Standby",
	error: null,
	dashboard: false,
	controlReady: false,
};
const listeners = new Set<() => void>();
type PointerPosition = { x: number; y: number } | null;
let pointer: PointerPosition = null;
const pointerListeners = new Set<() => void>();
const setPointer = (next: PointerPosition) => {
	pointer = next;
	for (const notify of pointerListeners) notify();
};
/**
 * Where the controller's pointer is on the shared dashboard, normalized to
 * 0..1. A separate store keeps per-frame moves from rerendering every share
 * subscriber.
 */
export const useRemotePointer = () =>
	useSyncExternalStore(
		(listener) => {
			pointerListeners.add(listener);
			return () => {
				pointerListeners.delete(listener);
			};
		},
		() => pointer,
	);
let captureGeneration = 0;
let stopDashboardCapture: (() => void) | null = null;
let controlChannel: RTCDataChannel | null = null;
const terminationListeners = new Set<() => void>();
/** Announces the end of either a shared stream or a direct workspace view. */
export const notifyShareTermination = () => {
	for (const notify of terminationListeners) notify();
};
/** Subscribes to the end of a received stream, including remote disconnects. */
export const subscribeShareTermination = (listener: () => void) => {
	terminationListeners.add(listener);
	return () => {
		terminationListeners.delete(listener);
	};
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
export const updateMedia = (patch: Partial<MediaState>) => {
	const ended = state.remote !== null && patch.remote === null;
	state = { ...state, ...patch };
	if (ended) notifyShareTermination();
	for (const notify of listeners) notify();
};
export const useShareMedia = () => useSyncExternalStore(subscribe, () => state);
export const stopMedia = (error: string | null = null) => {
	captureGeneration++;
	stopDashboardCapture?.();
	stopDashboardCapture = null;
	const channel = controlChannel;
	controlChannel = null;
	channel?.close();
	setPointer(null);
	for (const track of state.local?.getTracks() ?? []) track.stop();
	updateMedia({
		id: null,
		local: null,
		remote: null,
		status: "Standby",
		error,
		dashboard: false,
		controlReady: false,
	});
};
/** Native resolution up to 1080p at 30 fps; larger displays are downscaled. */
const SHARE_CAPTURE = {
	width: { ideal: 1920, max: 1920 },
	height: { ideal: 1080, max: 1080 },
	frameRate: { ideal: 30, max: 30 },
} satisfies MediaTrackConstraints;
/** About 8 Mbps leaves headroom for 1080p text without saturating the relay's 40 Mbps per-session cap. */
const SHARE_ENCODING = {
	maxBitrate: 8_000_000,
	maxFramerate: 30,
} satisfies RTCRtpEncodingParameters;
const codecRank = (mimeType: string) =>
	["video/VP9", "video/H264"].indexOf(mimeType) + 1 || 3;

/**
 * Sends each track with a high bitrate ceiling. Screens are text: the encoder
 * keeps resolution and drops frames under congestion instead of blurring.
 */
export const addShareTracks = (pc: RTCPeerConnection, stream: MediaStream) => {
	for (const track of stream.getTracks()) {
		const video = track.kind === "video";
		if (video) track.contentHint = "detail";
		const transceiver = pc.addTransceiver(track, {
			direction: "sendonly",
			streams: [stream],
			sendEncodings: video ? [SHARE_ENCODING] : undefined,
		});
		if (!video) continue;
		try {
			const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs;
			if (codecs)
				transceiver.setCodecPreferences(
					codecs.toSorted(
						(a, b) => codecRank(a.mimeType) - codecRank(b.mimeType),
					),
				);
		} catch {
			// Codec preference is an optimization; the browser default still works.
		}
		const parameters = transceiver.sender.getParameters();
		void transceiver.sender
			.setParameters({
				...parameters,
				degradationPreference: "maintain-resolution",
				encodings: parameters.encodings.map((encoding) => ({
					...encoding,
					...SHARE_ENCODING,
				})),
			})
			.catch(() => {
				// Older browsers reject degradationPreference; sendEncodings already apply.
			});
	}
};

export const shareScreen = async (id: string) => {
	if (!navigator.mediaDevices?.getDisplayMedia)
		throw new Error(
			"This browser does not support desktop sharing. Use a desktop browser over HTTPS.",
		);
	const generation = ++captureGeneration;
	const stream = await navigator.mediaDevices.getDisplayMedia({
		video: SHARE_CAPTURE,
		audio: false,
	});
	if (generation !== captureGeneration) {
		for (const track of stream.getTracks()) track.stop();
		return;
	}
	for (const track of state.local?.getTracks() ?? []) track.stop();
	for (const track of stream.getTracks())
		track.addEventListener(
			"ended",
			() => {
				if (generation === captureGeneration && state.local === stream)
					stopMedia();
			},
			{ once: true },
		);
	updateMedia({
		id,
		local: stream,
		remote: null,
		status: "Connecting",
		error: null,
		dashboard: false,
		controlReady: false,
	});
};

export const shareDashboard = async (id: string) => {
	const generation = ++captureGeneration;
	const capture = await captureDashboard((error) => {
		if (generation === captureGeneration) stopMedia(error);
	});
	if (generation !== captureGeneration) {
		capture.stop();
		return;
	}
	stopDashboardCapture?.();
	for (const track of state.local?.getTracks() ?? []) track.stop();
	stopDashboardCapture = capture.stop;
	updateMedia({
		id,
		local: capture.stream,
		remote: null,
		status: "Connecting",
		error: null,
		dashboard: true,
		controlReady: false,
	});
};

/** A channel is usable only by the current session, and the owner must have consented locally. */
export const bindDashboardChannel = (
	channel: RTCDataChannel,
	id: string,
	sharer: boolean,
) => {
	if (
		channel.label !== "coder-dashboard-control-v1" ||
		state.id !== id ||
		!state.dashboard ||
		(sharer && !state.local)
	) {
		channel.close();
		return;
	}
	controlChannel = channel;
	channel.addEventListener("open", () => {
		if (state.id !== id || !state.dashboard || controlChannel !== channel) {
			channel.close();
			return;
		}
		if (sharer) {
			channel.send(
				JSON.stringify({ type: "dashboard-control", enabled: true }),
			);
			updateMedia({ controlReady: true });
		}
	});
	channel.addEventListener("message", (event) => {
		if (state.id !== id || !state.dashboard || controlChannel !== channel)
			return;
		if (sharer) {
			if (!state.local || !state.controlReady) return;
			const input = parseDashboardInput(event.data);
			if (!input) return;
			if (input.type === "move") {
				setPointer({ x: input.x, y: input.y });
				if (channel.bufferedAmount <= 65536)
					channel.send(
						JSON.stringify({
							type: "dashboard-pointer",
							x: input.x,
							y: input.y,
						}),
					);
			}
			applyDashboardInput(input);
		} else if (
			event.data ===
			JSON.stringify({ type: "dashboard-control", enabled: true })
		) {
			updateMedia({ controlReady: true });
		} else {
			const echoed = parseDashboardPointer(event.data);
			if (echoed) setPointer(echoed);
		}
	});
	channel.addEventListener("close", () => {
		if (state.id === id && controlChannel === channel) {
			controlChannel = null;
			stopMedia("Dashboard control disconnected.");
		}
	});
	channel.addEventListener("error", () => {
		if (state.id === id && controlChannel === channel)
			stopMedia("Dashboard control disconnected.");
	});
};

export const sendDashboardInput = (input: DashboardInput) => {
	if (
		!state.dashboard ||
		!state.controlReady ||
		state.local ||
		!state.remote ||
		controlChannel?.readyState !== "open" ||
		controlChannel.bufferedAmount > 65536
	)
		return;
	controlChannel.send(JSON.stringify(input));
};

/** Wait for all ICE candidates so signaling needs no candidate ordering or retries. */
export const completeDescription = async (
	pc: RTCPeerConnection,
	description: RTCSessionDescriptionInit,
) => {
	await pc.setLocalDescription(description);
	if (pc.iceGatheringState !== "complete")
		await new Promise<void>((resolve, reject) => {
			const finish = () => {
				clearTimeout(timer);
				pc.removeEventListener("icegatheringstatechange", change);
				pc.removeEventListener("connectionstatechange", closed);
			};
			const change = () => {
				if (pc.iceGatheringState === "complete") {
					finish();
					resolve();
				}
			};
			const closed = () => {
				if (pc.connectionState === "closed") {
					finish();
					reject(new Error("Support session ended."));
				}
			};
			const timer = setTimeout(() => {
				finish();
				reject(
					new Error(
						"Could not discover a media route. Check the TURN relay and try again.",
					),
				);
			}, 15000);
			pc.addEventListener("icegatheringstatechange", change);
			pc.addEventListener("connectionstatechange", closed);
			change();
		});
	if (!pc.localDescription?.sdp)
		throw new Error("No media session was created.");
	return pc.localDescription.sdp;
};
