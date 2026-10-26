import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { HudSortableGrid } from "./HudSortableGrid";

it("reorders graph panels using the keyboard handle", async () => {
	const onReorder = vi.fn();
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const top = this.textContent?.includes("Second") ? 200 : 0;
			return {
				x: 0,
				y: top,
				top,
				left: 0,
				right: 100,
				bottom: top + 100,
				width: 100,
				height: 100,
				toJSON: () => ({}),
			};
		},
	);
	renderComponent(
		<HudSortableGrid
			className="grid"
			onReorder={onReorder}
			panels={[
				{
					id: "one",
					label: "First",
					render: (handle) => <section>{handle}First</section>,
				},
				{
					id: "two",
					label: "Second",
					render: (handle) => <section>{handle}Second</section>,
				},
			]}
		/>,
	);
	const user = userEvent.setup();
	screen.getByRole("button", { name: "Reorder First" }).focus();
	await user.keyboard("[Space][ArrowDown][Space]");
	await waitFor(() => expect(onReorder).toHaveBeenCalledWith(["two", "one"]));
	vi.restoreAllMocks();
});
