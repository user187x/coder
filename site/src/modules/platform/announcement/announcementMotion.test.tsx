import { act, render, waitFor } from "@testing-library/react";
import { setAnimationPart } from "#/hooks/useAnimationSettings";
import { MockBanner } from "#/testHelpers/platform";
import * as frames from "../animations/gifFreezer";
import { BannerText } from "./BannerText";
import { useAnnouncementImage } from "./useAnnouncementImage";
import { AnnouncementMotionDisabled } from "./useAnnouncementMotion";

afterEach(() => {
	act(() => setAnimationPart("announcement", true));
	vi.restoreAllMocks();
});

it("stops the typewriter timer immediately when administrators enforce still mode", () => {
	const intervals = vi.spyOn(window, "setInterval");
	const clear = vi.spyOn(window, "clearInterval");
	const banner = { ...MockBanner, effect: "typewriter" as const, repeat: true };
	const view = render(<BannerText banner={banner} animate loop />);
	expect(intervals).toHaveBeenCalled();
	const timer = intervals.mock.results[0].value;
	view.rerender(
		<BannerText
			banner={{ ...banner, animationsDisabled: true }}
			animate
			loop
		/>,
	);
	expect(clear).toHaveBeenCalledWith(timer);
	intervals.mockClear();
	act(() => setAnimationPart("announcement", false));
	act(() => setAnimationPart("announcement", true));
	expect(intervals).not.toHaveBeenCalled();
	view.rerender(<BannerText banner={banner} animate loop />);
	expect(intervals).toHaveBeenCalled();
});

it("uses a still picture under enforced mode even with the personal switch on, and discards stale decoding", async () => {
	let finish: (value: string) => void = () => {};
	const decode = vi
		.spyOn(frames, "staticImageFrame")
		.mockImplementation((src) =>
			src === "/old.gif"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: Promise.resolve("data:image/png;base64,still"),
		);
	const observe = vi.fn();
	const Picture = ({ src }: { src: string }) => {
		observe(useAnnouncementImage(src));
		return null;
	};
	const view = render(
		<AnnouncementMotionDisabled.Provider value>
			<Picture src="/old.gif" />
		</AnnouncementMotionDisabled.Provider>,
	);
	expect(observe).toHaveBeenLastCalledWith(undefined);
	view.rerender(
		<AnnouncementMotionDisabled.Provider value>
			<Picture src="/new.gif" />
		</AnnouncementMotionDisabled.Provider>,
	);
	await waitFor(() =>
		expect(observe).toHaveBeenLastCalledWith("data:image/png;base64,still"),
	);
	await act(async () => finish("old-frame"));
	expect(observe).toHaveBeenLastCalledWith("data:image/png;base64,still");
	expect(decode).toHaveBeenCalledWith("/new.gif");
	view.rerender(
		<AnnouncementMotionDisabled.Provider value={false}>
			<Picture src="/new.gif" />
		</AnnouncementMotionDisabled.Provider>,
	);
	expect(observe).toHaveBeenLastCalledWith("/new.gif");
});
