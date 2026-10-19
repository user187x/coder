import { fireEvent, render, screen } from "@testing-library/react";
import { AppsCarousel } from "./AppsCarousel";

const apps = (n: number) =>
	Array.from({ length: n }, (_, i) => (
		<button type="button" key={`app-${i + 1}`}>
			app {i + 1}
		</button>
	));

const shown = () =>
	screen
		.getAllByTestId("workspace-apps-carousel-item")
		.filter((el) => !el.hasAttribute("inert"))
		.map((el) => el.textContent);

describe("AppsCarousel", () => {
	it("is just the buttons when they fit", () => {
		render(<AppsCarousel visible={4}>{apps(4)}</AppsCarousel>);
		expect(screen.queryByTestId("workspace-apps-carousel")).toBeNull();
		expect(screen.getAllByRole("button")).toHaveLength(4);
	});

	it("slides an app at a time over all of them, the ones out of it inert", () => {
		render(<AppsCarousel visible={4}>{apps(6)}</AppsCarousel>);
		const group = screen.getByTestId("workspace-apps-carousel");
		expect(shown()).toEqual(["app 1", "app 2", "app 3", "app 4"]);
		expect(group).toHaveAttribute("aria-label", "Apps 1 to 4 of 6");
		const previous = screen.getByTestId("workspace-apps-previous");
		const next = screen.getByTestId("workspace-apps-next");
		expect(previous).toBeDisabled();
		fireEvent.click(next);
		expect(shown()).toEqual(["app 2", "app 3", "app 4", "app 5"]);
		fireEvent.click(next);
		expect(shown()).toEqual(["app 3", "app 4", "app 5", "app 6"]);
		expect(next).toBeDisabled();
		expect(group).toHaveAttribute("aria-label", "Apps 3 to 6 of 6");
		// the arrow keys too
		fireEvent.keyDown(group, { key: "ArrowLeft" });
		expect(shown()).toEqual(["app 2", "app 3", "app 4", "app 5"]);
		// a sideways scroll; an up-and-down one is the page's
		fireEvent.wheel(group, { deltaX: 40, deltaY: 0 });
		expect(shown()).toEqual(["app 3", "app 4", "app 5", "app 6"]);
		fireEvent.wheel(group, { deltaX: 0, deltaY: -40 });
		expect(shown()).toEqual(["app 3", "app 4", "app 5", "app 6"]);
	});

	it("keeps its clicks from the row (the row opens the workspace)", () => {
		const row = vi.fn();
		render(
			// biome-ignore lint/a11y/useKeyWithClickEvents: the table row's click, as in the Workspaces table
			<div onClick={row}>
				<AppsCarousel visible={4}>{apps(5)}</AppsCarousel>
			</div>,
		);
		fireEvent.click(screen.getByTestId("workspace-apps-next"));
		fireEvent.click(screen.getByText("app 5"));
		expect(row).not.toHaveBeenCalled();
		expect(shown()).toEqual(["app 2", "app 3", "app 4", "app 5"]);
	});
});
