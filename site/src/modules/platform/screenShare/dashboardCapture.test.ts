import html2canvas from "html2canvas-pro";
import { captureDashboard } from "./dashboardCapture";

vi.mock("html2canvas-pro", () => ({ default: vi.fn() }));

const drawImage = vi.fn();
const requestFrame = vi.fn();
const stopTrack = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"MediaStream",
		class {
			getTracks() {
				return [{ requestFrame, stop: stopTrack }];
			}
			getVideoTracks() {
				return this.getTracks();
			}
		},
	);
	const createElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
		const element = createElement(tag, options);
		if (element instanceof HTMLCanvasElement)
			Object.assign(element, {
				captureStream: () => new MediaStream(),
				getContext: () => ({ drawImage }),
			});
		return element;
	});
	vi.mocked(html2canvas).mockResolvedValue(document.createElement("canvas"));
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it("publishes a fresh frame after a dashboard interaction and stops publishing after disconnect", async () => {
	const capture = await captureDashboard(vi.fn());
	expect(requestFrame).toHaveBeenCalledOnce();
	window.dispatchEvent(new Event("input"));
	await vi.advanceTimersByTimeAsync(0);
	expect(requestFrame).toHaveBeenCalledTimes(2);
	capture.stop();
	window.dispatchEvent(new Event("click"));
	await vi.advanceTimersByTimeAsync(1000);
	expect(requestFrame).toHaveBeenCalledTimes(2);
	expect(stopTrack).toHaveBeenCalledOnce();
});

it("does not send an in-flight capture after the owner stops sharing", async () => {
	const capture = await captureDashboard(vi.fn());
	let finish = (_frame: HTMLCanvasElement) => {};
	vi.mocked(html2canvas).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	window.dispatchEvent(new Event("click"));
	await vi.advanceTimersByTimeAsync(0);
	capture.stop();
	finish(document.createElement("canvas"));
	await vi.advanceTimersByTimeAsync(1000);
	expect(drawImage).toHaveBeenCalledOnce();
	expect(requestFrame).toHaveBeenCalledOnce();
});

it("terminates the stream and reports a capture failure instead of showing a stale frame", async () => {
	const onError = vi.fn();
	await captureDashboard(onError);
	vi.mocked(html2canvas).mockRejectedValueOnce(new Error("Rendering failed"));
	window.dispatchEvent(new Event("resize"));
	await vi.advanceTimersByTimeAsync(1000);
	expect(onError).toHaveBeenCalledWith(
		"Dashboard capture stopped. Reconnect to try again.",
	);
	expect(stopTrack).toHaveBeenCalledOnce();
	expect(requestFrame).toHaveBeenCalledOnce();
});

it("captures HiDPI dashboards at device resolution up to 1080p", async () => {
	vi.stubGlobal("devicePixelRatio", 2);
	vi.stubGlobal("innerWidth", 1600);
	vi.stubGlobal("innerHeight", 900);
	const capture = await captureDashboard(vi.fn());
	expect(html2canvas).toHaveBeenCalledWith(
		document.documentElement,
		expect.objectContaining({ width: 1600, height: 900, scale: 1.2 }),
	);
	capture.stop();
});
