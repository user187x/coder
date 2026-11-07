import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScreenShareAPI } from "#/api/screenShare";
import { renderWithAuth } from "#/testHelpers/renderHelpers";
import { MockScreenShare } from "#/testHelpers/screenShare";
import * as media from "./media";
import { ScreenShareController } from "./ScreenShareController";

beforeEach(() => {
	vi.setSystemTime(new Date("2026-10-30T07:00:00Z"));
});

afterEach(() => {
	media.stopMedia();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
it("requires an explicit sharing action and ends a declined request", async () => {
	vi.spyOn(ScreenShareAPI, "state").mockResolvedValue({
		sessions: [MockScreenShare],
		iceServers: [],
	});
	const capture = vi.spyOn(media, "shareScreen").mockResolvedValue();
	const end = vi
		.spyOn(ScreenShareAPI, "update")
		.mockResolvedValue({ session: { ...MockScreenShare, status: "ended" } });
	renderWithAuth(<ScreenShareController />);
	const button = await screen.findByRole("button", { name: "Share screen" });
	expect(capture).not.toHaveBeenCalled();
	await userEvent.click(button);
	await waitFor(() => expect(capture).toHaveBeenCalledWith(MockScreenShare.id));
	await userEvent.click(screen.getByRole("button", { name: "Decline" }));
	await waitFor(() =>
		expect(end).toHaveBeenCalledWith({ action: "end", id: MockScreenShare.id }),
	);
});

it.each(["sharer", "viewer"] as const)(
	"does not renegotiate a session already connected by the %s in another tab",
	async (role) => {
		const session = {
			...MockScreenShare,
			...(role === "viewer"
				? { sharer: MockScreenShare.viewer, viewer: MockScreenShare.sharer }
				: {}),
			offer: "v=0\r\nexisting-offer",
			answer: "v=0\r\nexisting-answer",
			status: "sharing" as const,
			admin_viewer: true,
		};
		vi.spyOn(ScreenShareAPI, "state").mockResolvedValue({
			sessions: [session],
			iceServers: [],
		});
		const capture = vi.spyOn(media, "shareScreen").mockResolvedValue();
		const signal = vi
			.spyOn(ScreenShareAPI, "update")
			.mockResolvedValue({ session });
		renderWithAuth(<ScreenShareController />);
		await userEvent.click(
			await screen.findByRole("button", {
				name: role === "sharer" ? "Share screen" : "View screen",
			}),
		);
		expect(capture).not.toHaveBeenCalled();
		expect(signal).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "End session" }));
		await waitFor(() =>
			expect(signal).toHaveBeenCalledWith({ action: "end", id: session.id }),
		);
	},
);

it("dismisses a failed session without signaling or leaving a stale error", async () => {
	vi.spyOn(ScreenShareAPI, "state").mockResolvedValue({
		sessions: [],
		iceServers: [],
	});
	const signal = vi.spyOn(ScreenShareAPI, "update");
	media.stopMedia("This signaling action is not allowed.");
	const { unmount } = renderWithAuth(<ScreenShareController />);
	await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
	const observed = renderHook(media.useShareMedia);
	expect(observed.result.current.error).toBeNull();
	expect(signal).not.toHaveBeenCalled();
	observed.unmount();
	unmount();
});

it.each(["Stop", "unresponsive signaling", "expiry"] as const)(
	"keeps the negotiated peer stable and closes capture on %s",
	async (termination) => {
		const peers: TestPeer[] = [];
		class TestPeer {
			iceGatheringState = "complete";
			signalingState = "stable";
			localDescription: RTCSessionDescriptionInit | null = null;
			addTransceiver = vi.fn(() => ({
				setCodecPreferences: vi.fn(),
				sender: {
					getParameters: () => ({ transactionId: "", encodings: [] }),
					setParameters: vi.fn().mockResolvedValue(undefined),
				},
			}));
			close = vi.fn();
			createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0\r\nlocal" }));
			setLocalDescription = vi.fn(
				async (description: RTCSessionDescriptionInit) => {
					this.localDescription = description;
					this.signalingState = "have-local-offer";
				},
			);
			setRemoteDescription = vi.fn(async () => {
				this.signalingState = "stable";
			});
			constructor() {
				peers.push(this);
			}
		}
		const stopped = vi.fn();
		vi.stubGlobal("RTCPeerConnection", TestPeer);
		vi.stubGlobal(
			"MediaStream",
			class {
				getTracks() {
					return [{ stop: stopped }];
				}
			},
		);
		let session = { ...MockScreenShare };
		vi.spyOn(ScreenShareAPI, "state").mockImplementation(async () => ({
			sessions: [session],
			iceServers: [],
		}));
		const signal = vi
			.spyOn(ScreenShareAPI, "update")
			.mockImplementation(async (action) => {
				if (action.action === "offer")
					session = {
						...session,
						offer: action.sdp,
						answer: "v=0\r\nremote",
						status: "sharing",
					};
				return { session };
			});
		vi.spyOn(media, "shareScreen").mockImplementation(async (id) =>
			media.updateMedia({ id, local: new MediaStream() }),
		);
		const view = renderWithAuth(<ScreenShareController />);
		await userEvent.click(
			await screen.findByRole("button", { name: "Share screen" }),
		);
		await waitFor(() =>
			expect(signal).toHaveBeenCalledWith({
				action: "offer",
				id: session.id,
				sdp: "v=0\r\nlocal",
			}),
		);
		await waitFor(() =>
			expect(peers[0]?.setRemoteDescription).toHaveBeenCalledWith({
				type: "answer",
				sdp: "v=0\r\nremote",
			}),
		);
		expect(peers).toHaveLength(1);
		if (termination === "Stop") {
			await userEvent.click(screen.getByRole("button", { name: "Stop" }));
			await waitFor(() => expect(peers[0]?.close).toHaveBeenCalled());
		} else {
			vi.useFakeTimers();
			// Establish the effect's timers under the fake clock before disconnecting.
			act(() => media.updateMedia({ id: null }));
			act(() => media.updateMedia({ id: session.id }));
			if (termination === "unresponsive signaling") {
				signal.mockImplementation(() => new Promise(() => {}));
			} else {
				session = { ...session, expires_at: "2026-10-30T07:00:15Z" };
			}
			await act(() => vi.advanceTimersByTimeAsync(41000));
			expect(peers.at(-1)?.close).toHaveBeenCalled();
			expect(screen.getByRole("alert")).toHaveTextContent(
				termination === "unresponsive signaling"
					? "Connection to Coder was lost"
					: "expired",
			);
		}
		expect(stopped).toHaveBeenCalled();
		view.unmount();
	},
);

it("does not grant dashboard control until the owner explicitly consents", async () => {
	const session = { ...MockScreenShare, mode: "dashboard" as const };
	vi.spyOn(ScreenShareAPI, "state").mockResolvedValue({
		sessions: [session],
		iceServers: [],
	});
	const capture = vi.spyOn(media, "shareDashboard").mockResolvedValue();
	vi.spyOn(ScreenShareAPI, "update").mockResolvedValue({ session });
	renderWithAuth(<ScreenShareController />);
	const allow = await screen.findByRole("button", {
		name: "Allow dashboard control",
	});
	expect(capture).not.toHaveBeenCalled();
	await userEvent.click(allow);
	await waitFor(() => expect(capture).toHaveBeenCalledWith(session.id));
});
