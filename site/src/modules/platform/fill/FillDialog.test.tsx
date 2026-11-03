import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "#/testHelpers/renderHelpers";
import { FillDialog } from "./FillDialog";

it("applies selected swatches and gradient controls", async () => {
	const apply = vi.fn();
	const close = vi.fn();
	const user = userEvent.setup();
	render(
		<FillDialog
			open
			onOpenChange={close}
			onPick={vi.fn()}
			onSettings={apply}
		/>,
	);
	await user.click(screen.getByRole("combobox", { name: "Fill style" }));
	await user.click(screen.getByRole("option", { name: "Linear gradient" }));
	await user.click(
		within(
			screen.getByRole("group", { name: "Start color presets" }),
		).getByRole("button", { name: "Blue #2563eb" }),
	);
	await user.click(
		within(screen.getByRole("group", { name: "End color presets" })).getByRole(
			"button",
			{ name: "Violet #7c3aed" },
		),
	);
	await user.clear(screen.getByLabelText("Angle (degrees)"));
	await user.type(screen.getByLabelText("Angle (degrees)"), "90");
	await user.clear(screen.getByLabelText("Start position (%)"));
	await user.type(screen.getByLabelText("Start position (%)"), "15");
	await user.clear(screen.getByLabelText("End position (%)"));
	await user.type(screen.getByLabelText("End position (%)"), "80");
	await user.click(screen.getByRole("button", { name: "Use fill" }));
	expect(apply).toHaveBeenCalledWith({
		name: "fill",
		mode: "linear",
		color: "#2563eb",
		endColor: "#7c3aed",
		angle: 90,
		start: 15,
		end: 80,
	});
	expect(close).toHaveBeenCalledWith(false);
});
