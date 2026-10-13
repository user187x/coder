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

	const type = (text: string) => {
		const view = screen.getByTestId("announcement-scroll-view");
		for (const key of text) {
			fireEvent.keyDown(view, { key });
		}
	};

	it("takes typing at its prompt, like a terminal", () => {
		render(<Harness />);
		fireEvent.click(screen.getByTestId("announcement-scroll-toggle"));
		const view = screen.getByTestId("announcement-scroll-view");
		expect(document.activeElement).toBe(view);
		type("lsx");
		fireEvent.keyDown(view, { key: "Backspace" });
		const prompt = screen.getByTestId("announcement-scroll-prompt");
		expect(prompt.textContent).toBe("root@platform:~# ls");
		fireEvent.keyDown(view, { key: "Enter" });
		// Every command is answered with the wagging finger, then "ahh ahh ahh..." typed out.
		const answer = screen.getByTestId("announcement-scroll-nono");
		expect(answer.querySelector("img")?.getAttribute("src")).toBe("/no-no.gif");
		const letters = [...answer.querySelectorAll(".banner-scroll-ahh span")];
		expect(letters.map((l) => l.textContent).join("")).toBe("ahh ahh ahh...");
		const delays = letters.map((l) =>
			Number(/(\d+)ms 1 both/.exec((l as HTMLElement).style.animation)?.[1]),
		);
		expect(delays[0]).toBeGreaterThan(0);
		expect(delays).toEqual([...delays].sort((a, b) => a - b));
		expect(prompt.textContent).toBe("root@platform:~# ");
		// An empty line gets no answer.
		fireEvent.keyDown(view, { key: "Enter" });
		expect(screen.getAllByTestId("announcement-scroll-nono")).toHaveLength(1);
	});

	it("fades the screen into Skynet when someone types skynet, and glitches out on a key", () => {
		render(<Harness />);
		fireEvent.click(screen.getByTestId("announcement-scroll-toggle"));
		type("SkyNet");
		// The terminal rolls up; the whole screen is Skynet, above everything.
		const skynet = screen.getByTestId("skynet");
		expect(skynet.parentElement).toBe(document.body);
		expect(skynet.querySelector("img")?.getAttribute("src")).toBe(
			"/skynet.webp",
		);
		act(() => vi.advanceTimersByTime(300));
		expect(screen.queryByTestId("announcement-scroll-view")).toBeNull();
		// The keystrokes right after it shows are the typing that summoned it.
		fireEvent.keyDown(document, { key: "x" });
		expect(skynet.dataset.leaving).toBeUndefined();
		act(() => vi.advanceTimersByTime(500));
		fireEvent.keyDown(document, { key: "x" });
		expect(skynet.dataset.leaving).toBe("true");
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.queryByTestId("skynet")).toBeNull();
	});

	it("dismisses Skynet with a click", () => {
		render(<Harness />);
		fireEvent.click(screen.getByTestId("announcement-scroll-toggle"));
		type("skynet");
		act(() => vi.advanceTimersByTime(1000));
		fireEvent.pointerDown(screen.getByTestId("skynet"));
		expect(screen.getByTestId("skynet").dataset.leaving).toBe("true");
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.queryByTestId("skynet")).toBeNull();
	});

	it("closes with Escape", () => {
		render(<Harness />);
		fireEvent.click(screen.getByTestId("announcement-scroll-toggle"));
		fireEvent.keyDown(document, { key: "Escape" });
		act(() => vi.advanceTimersByTime(300));
		expect(screen.queryByTestId("announcement-scroll-view")).toBeNull();
	});
});
