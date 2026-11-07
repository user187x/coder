import { act, renderHook } from "@testing-library/react";
import * as dashboardCapture from "./dashboardCapture";
import {
	addShareTracks,
	shareDashboard,
	shareScreen,
	stopMedia,
	subscribeShareTermination,
	updateMedia,
	useShareMedia,
} from "./media";

afterEach(() => {
	stopMedia();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it("discards dashboard capture after cancellation and stops its render loop on disconnect", async () => {
	vi.stubGlobal(
		"MediaStream",
		class {
			getTracks() {
				return [];
			}
		},
	);
	let finish: (
		value: Awaited<ReturnType<typeof dashboardCapture.captureDashboard>>,
	) => void = () => {};
	vi.spyOn(dashboardCapture, "captureDashboard").mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const { result } = renderHook(useShareMedia);
	const canceled = shareDashboard("canceled");
	act(() => stopMedia());
	const stopCanceled = vi.fn();
	await act(async () => {
		finish({ stream: new MediaStream(), stop: stopCanceled });
		await canceled;
	});
	expect(stopCanceled).toHaveBeenCalledOnce();
	expect(result.current.local).toBeNull();
	const active = shareDashboard("active");
	const stopActive = vi.fn();
	await act(async () => {
		finish({ stream: new MediaStream(), stop: stopActive });
		await active;
	});
	expect(result.current.dashboard).toBe(true);
	act(() => stopMedia());
	expect(stopActive).toHaveBeenCalledOnce();
	expect(result.current.id).toBeNull();
});

it("discards a capture that resolves after cancellation and ignores a superseded track ending", async () => {
	const tracks: (EventTarget & { stop: ReturnType<typeof vi.fn> })[] = [];
	vi.stubGlobal(
		"MediaStream",
		class {
			track = Object.assign(new EventTarget(), { stop: vi.fn() });
			constructor() {
				tracks.push(this.track);
			}
			getTracks() {
				return [this.track];
			}
		},
	);
	let resolveCapture: (stream: MediaStream) => void = () => {};
	const capture = vi.fn(
		() =>
			new Promise<MediaStream>((resolve) => {
				resolveCapture = resolve;
			}),
	);
	vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: capture } });
	const { result } = renderHook(useShareMedia);
	const canceled = shareScreen("canceled");
	act(() => stopMedia());
	await act(async () => {
		resolveCapture(new MediaStream());
		await canceled;
	});
	expect(tracks[0]?.stop).toHaveBeenCalledOnce();
	expect(result.current.id).toBeNull();
	expect(result.current.local).toBeNull();
	const first = shareScreen("first");
	await act(async () => {
		resolveCapture(new MediaStream());
		await first;
	});
	const replacement = shareScreen("replacement");
	await act(async () => {
		resolveCapture(new MediaStream());
		await replacement;
	});
	act(() => tracks[1]?.dispatchEvent(new Event("ended")));
	expect(tracks[1]?.stop).toHaveBeenCalledOnce();
	expect(tracks[2]?.stop).not.toHaveBeenCalled();
	expect(result.current.id).toBe("replacement");
	act(() => tracks[2]?.dispatchEvent(new Event("ended")));
	expect(tracks[2]?.stop).toHaveBeenCalledOnce();
	expect(result.current.id).toBeNull();
});
it("notifies termination once for a received stream and never for an idle reset", () => {
	vi.stubGlobal(
		"MediaStream",
		class {
			getTracks() {
				return [];
			}
		},
	);
	const ended = vi.fn();
	const unsubscribe = subscribeShareTermination(ended);
	stopMedia();
	expect(ended).not.toHaveBeenCalled();
	updateMedia({ remote: new MediaStream() });
	stopMedia();
	stopMedia();
	expect(ended).toHaveBeenCalledTimes(1);
	updateMedia({ remote: new MediaStream() });
	updateMedia({ remote: null });
	expect(ended).toHaveBeenCalledTimes(2);
	unsubscribe();
	updateMedia({ remote: new MediaStream() });
	stopMedia();
	expect(ended).toHaveBeenCalledTimes(2);
});
it("requests video only after consent and stops every capture track", async () => {
	const stop = vi.fn();
	const ended = vi.fn();
	const capture = vi.fn().mockResolvedValue({
		getTracks: () => [{ stop, addEventListener: ended }],
	});
	vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: capture } });
	await shareScreen("consented-session");
	expect(capture).toHaveBeenCalledWith({
		video: {
			width: { ideal: 1920, max: 1920 },
			height: { ideal: 1080, max: 1080 },
			frameRate: { ideal: 30, max: 30 },
		},
		audio: false,
	});
	expect(ended).toHaveBeenCalledWith("ended", expect.any(Function), {
		once: true,
	});
	stopMedia();
	expect(stop).toHaveBeenCalledTimes(1);
});

it("sends video at a high bitrate ceiling, keeps resolution, and prefers VP9", async () => {
	const setParameters = vi.fn().mockResolvedValue(undefined);
	const setCodecPreferences = vi.fn();
	const addTransceiver = vi.fn(() => ({
		setCodecPreferences,
		sender: {
			getParameters: () => ({
				transactionId: "t1",
				encodings: [{ active: true }],
			}),
			setParameters,
		},
	}));
	const codecs = [
		{ mimeType: "video/VP8", clockRate: 90000 },
		{ mimeType: "video/rtx", clockRate: 90000 },
		{ mimeType: "video/H264", clockRate: 90000 },
		{ mimeType: "video/VP9", clockRate: 90000 },
	];
	vi.stubGlobal("RTCRtpReceiver", { getCapabilities: () => ({ codecs }) });
	const track = { kind: "video", contentHint: "" };
	vi.stubGlobal(
		"MediaStream",
		class {
			getTracks() {
				return [track];
			}
		},
	);
	vi.stubGlobal(
		"RTCPeerConnection",
		class {
			addTransceiver = addTransceiver;
		},
	);
	const stream = new MediaStream();
	addShareTracks(new RTCPeerConnection(), stream);
	expect(track.contentHint).toBe("detail");
	expect(addTransceiver).toHaveBeenCalledWith(track, {
		direction: "sendonly",
		streams: [stream],
		sendEncodings: [{ maxBitrate: 8_000_000, maxFramerate: 30 }],
	});
	expect(setParameters).toHaveBeenCalledWith({
		transactionId: "t1",
		degradationPreference: "maintain-resolution",
		encodings: [{ active: true, maxBitrate: 8_000_000, maxFramerate: 30 }],
	});
	expect(
		setCodecPreferences.mock.calls[0]?.[0].map(
			(codec: { mimeType: string }) => codec.mimeType,
		),
	).toEqual(["video/VP9", "video/H264", "video/VP8", "video/rtx"]);
});
