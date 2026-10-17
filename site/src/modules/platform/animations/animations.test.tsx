import { act, fireEvent, render, screen } from "@testing-library/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { AnimationsToggleItem } from "#/modules/dashboard/Navbar/UserDropdown/AnimationsToggleItem";
import {
	setGraphEvery,
	useGraphEvery,
} from "#/modules/resources/metricGraphSettings";
import { AnimationsController } from "./AnimationsController";
import {
	animated,
	setAnimationPart,
	setAnimationsEnabled,
	useAnimationSettings,
} from "./animations";

const Probe: React.FC = () => {
	const s = useAnimationSettings();
	const graphs = useGraphEvery();
	return (
		<output data-testid="probe">
			{JSON.stringify({
				effects: animated(s, "effects"),
				gifs: animated(s, "gifs"),
				background: animated(s, "background"),
				graphs,
			})}
		</output>
	);
};
const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "");

describe("Animations", () => {
	afterEach(() => {
		act(() => {
			setAnimationsEnabled(true);
			setAnimationPart("effects", true);
			setAnimationPart("gifs", true);
			setAnimationPart("background", true);
			setGraphEvery(1);
		});
	});

	it("switches each part on its own, all of them off at once, and remembers both", () => {
		render(
			<>
				<AnimationsController />
				<Probe />
			</>,
		);
		expect(document.documentElement.dataset.animations).toBe("on");
		act(() => setAnimationPart("gifs", false));
		expect(probe()).toEqual({
			effects: true,
			gifs: false,
			background: true,
			graphs: 1,
		});
		expect(document.documentElement.dataset.animations).toBe("on");
		act(() => setAnimationPart("effects", false));
		expect(document.documentElement.dataset.animations).toBe("off");
		act(() => setAnimationPart("effects", true));
		act(() => setAnimationsEnabled(false));
		// all off: every part stands still, the graphs too, without forgetting the parts
		expect(probe()).toEqual({
			effects: false,
			gifs: false,
			background: false,
			graphs: "off",
		});
		expect(document.documentElement.dataset.animations).toBe("off");
		expect(localStorage.getItem("coder-ui-animations")).toBe("0");
		expect(
			JSON.parse(localStorage.getItem("coder-ui-animations-parts") ?? ""),
		).toEqual({ effects: true, gifs: false, background: true });
		act(() => setAnimationsEnabled(true));
		expect(probe().gifs).toBe(false);
		expect(probe().effects).toBe(true);
	});

	it("opens in the menu: All animations, then effects, GIFs, live graphs and background", async () => {
		render(
			<>
				<DropdownMenu open>
					<DropdownMenuTrigger>menu</DropdownMenuTrigger>
					<DropdownMenuContent>
						<AnimationsToggleItem />
					</DropdownMenuContent>
				</DropdownMenu>
				<Probe />
			</>,
		);
		const trigger = screen.getByTestId("animations-menu");
		expect(trigger).toHaveTextContent("On");
		expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(0);
		fireEvent.click(trigger);
		const items = await screen.findAllByRole("menuitemcheckbox");
		const labels = [
			"All animations",
			"Effects & transitions",
			"Animated GIFs",
			"Live graphs",
			"Moving background",
		];
		expect(items).toHaveLength(labels.length);
		items.forEach((item, n) =>
			expect(item.textContent?.startsWith(labels[n])).toBe(true),
		);
		const graphs = screen.getByRole("menuitemcheckbox", {
			name: /Live graphs/,
		});
		fireEvent.click(graphs);
		expect(probe().graphs).toBe("off");
		expect(trigger).toHaveTextContent("Some");
		fireEvent.click(graphs);
		expect(probe().graphs).toBe(1);
		// all off: the parts can't be switched until all are on again
		fireEvent.click(
			screen.getByRole("menuitemcheckbox", { name: /All animations/ }),
		);
		expect(trigger).toHaveTextContent("Off");
		expect(
			screen.getByRole("menuitemcheckbox", { name: /Animated GIFs/ }),
		).toHaveAttribute("aria-disabled", "true");
	});
});
