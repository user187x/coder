import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { BannerScrollView } from "./BannerScrollView";

const message =
	"# Maintenance tonight\nThe cluster restarts at 22:00.\n\n- save your work\n- push your branches\n\n![diagram](/icon/desktop.svg) 🚀 **Thanks!**";

const Harness: React.FC = () => {
	const anchor = useRef<HTMLDivElement>(null);
	return (
		<div>
			<div ref={anchor}>
				<BannerScrollView
					banner={{ id: "x", message, font: "default" }}
					anchor={anchor}
				/>
			</div>
			<p>elsewhere</p>
		</div>
	);
};

describe("BannerScrollView", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("rolls the whole message down over the page and back up on a click outside", () => {
		render(<Harness />);
		expect(screen.queryByTestId("announcement-scroll-view")).toBeNull();
		fireEvent.click(screen.getByTestId("announcement-scroll-toggle"));
		const view = screen.getByTestId("announcement-scroll-view");
		// In a portal on the body: above everything else on the page.
		expect(view.parentElement).toBe(document.body);
		expect(view.querySelector("h2")?.textContent).toBe("Maintenance tonight");
		expect(view.querySelectorAll("li")).toHaveLength(2);
		expect(view.querySelector("img")?.getAttribute("src")).toBe(
			"/icon/desktop.svg",
		);
		expect(view.textContent).toContain("🚀");
		// A click inside keeps it open.
		fireEvent.pointerDown(view);
		expect(view.dataset.closing).toBeUndefined();
		// A click anywhere else rolls it back up, then it is gone.
		fireEvent.pointerDown(screen.getByText("elsewhere"));
		expect(screen.getByTestId("announcement-scroll-view").dataset.closing).toBe(
			"true",
		);
		act(() => vi.advanceTimersByTime(300));
		expect(screen.queryByTestId("announcement-scroll-view")).toBeNull();
	});

	it("closes with Escape", () => {
		render(<Harness />);
		fireEvent.click(screen.getByTestId("announcement-scroll-toggle"));
		fireEvent.keyDown(document, { key: "Escape" });
		act(() => vi.advanceTimersByTime(300));
		expect(screen.queryByTestId("announcement-scroll-view")).toBeNull();
	});
});
