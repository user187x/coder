import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntroductionCard } from "./IntroductionCard";

describe("IntroductionCard", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const setup = (settings = {}) => {
		const onChange = vi.fn();
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		render(
			<IntroductionCard
				settings={{ introductions: false, ...settings }}
				onChange={onChange}
			/>,
		);
		return { onChange, user };
	};

	it("reports the new state when the switch is flipped", async () => {
		const { onChange, user } = setup();
		await user.click(
			screen.getByRole("switch", { name: "Show section introductions" }),
		);
		expect(onChange).toHaveBeenCalledWith({ introductions: true });
	});

	it("saves the effect chosen in the gallery at once", async () => {
		const { onChange, user } = setup();
		await user.click(
			screen.getByRole("button", { name: "Introduction text effect" }),
		);
		await user.click(screen.getByRole("radio", { name: "Gold Foil" }));
		expect(onChange).toHaveBeenCalledWith({ introEffect: "gold" });
	});

	it.each([
		["Introduction size", "Extra large", { introSize: "xlarge" }],
		["Introduction weight", "Black", { introWeight: "black" }],
	])("saves %s at once", async (control, option, expected) => {
		const { onChange, user } = setup();
		await user.click(screen.getByRole("combobox", { name: control }));
		await user.click(screen.getByRole("option", { name: option }));
		expect(onChange).toHaveBeenCalledWith(expected);
	});

	it("saves the all-capitals switch, which the splash pill carries as data", async () => {
		const { onChange, user } = setup();
		const pill = screen.getByTestId("section-splash-pill");
		expect(pill).not.toHaveAttribute("data-intro-uppercase");
		await user.click(screen.getByRole("switch", { name: "All capitals" }));
		expect(onChange).toHaveBeenCalledWith({ introUppercase: true });
	});

	it("marks the preview pill when the capitals are on, leaving the label as written", () => {
		setup({ introUppercase: true });
		const pill = screen.getByTestId("section-splash-pill");
		expect(pill).toHaveAttribute("data-intro-uppercase");
		expect(pill).toHaveTextContent("Appearance");
	});

	it("previews inside the banner's own screen and motion setting", () => {
		setup({ introEffect: "gold" });
		const stage = screen.getByTestId("effect-stage");
		expect(stage).toHaveAttribute("data-announcement-motion");
		expect(stage).toContainElement(screen.getByTestId("section-splash-pill"));
	});

	it("does not offer the crawl, which needs a whole banner", async () => {
		const { user } = setup();
		await user.click(
			screen.getByRole("button", { name: "Introduction text effect" }),
		);
		expect(screen.getByRole("radio", { name: "Rainbow" })).toBeInTheDocument();
		expect(
			screen.queryByRole("radio", { name: /crawl|star wars/i }),
		).toBeNull();
	});

	it("shows the duration and saves it once the slider rests", async () => {
		const { onChange, user } = setup({ introDurationMs: 2000 });
		const slider = screen.getByRole("slider", { name: "Visible for" });
		expect(screen.getByText("2 s")).toBeInTheDocument();
		slider.focus();
		await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
		expect(screen.getByText("3.5 s")).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();
		await act(() => vi.advanceTimersByTimeAsync(500));
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith({ introDurationMs: 3500 });
	});

	it("previews the splash with the current options", () => {
		setup({ introEffect: "rainbow", introSize: "large", introWeight: "bold" });
		const preview = screen.getByRole("group", { name: "Introduction preview" });
		expect(preview).toHaveTextContent("Appearance");
		expect(within(preview).getByTestId("section-splash-pill")).toHaveAttribute(
			"data-intro-effect",
			"rainbow",
		);
	});
});
