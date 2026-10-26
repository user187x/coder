import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockCustomTheme } from "#/testHelpers/appearance";
import { MockUserAppearanceSettings } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { encodeCustomTheme } from "#/theme/customTheme";
import { CompactAppearanceForm } from "./CompactAppearanceForm";

it("previews a preset without saving, then submits the selected theme", async () => {
	const submit = vi.fn();
	render(
		<CompactAppearanceForm
			initialValues={MockUserAppearanceSettings}
			activeScheme="dark"
			onSubmit={submit}
		/>,
	);
	await userEvent.click(screen.getByLabelText("Theme selection"));
	await userEvent.click(screen.getByRole("option", { name: "Light default" }));
	expect(submit).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("button", { name: "Save theme" }));
	expect(submit).toHaveBeenCalledWith(
		expect.objectContaining({
			theme_preference: "light",
			theme_mode: "single",
		}),
	);
});
it("saves edited custom colors only after confirmation", async () => {
	const submit = vi.fn();
	const preference = encodeCustomTheme(MockCustomTheme);
	render(
		<CompactAppearanceForm
			initialValues={{
				...MockUserAppearanceSettings,
				theme_preference: preference,
			}}
			activeScheme="dark"
			onSubmit={submit}
		/>,
	);
	await userEvent.clear(screen.getByLabelText("Accent (hex)"));
	await userEvent.type(screen.getByLabelText("Accent (hex)"), "#ff0000");
	expect(submit).not.toHaveBeenCalled();
	await userEvent.click(screen.getByRole("button", { name: "Save theme" }));
	expect(submit).toHaveBeenCalledWith(
		expect.objectContaining({
			theme_preference: encodeCustomTheme({
				...MockCustomTheme,
				accent: "#ff0000",
			}),
		}),
	);
});

it("edits one system theme without losing the other slot", async () => {
	const submit = vi.fn();
	render(
		<CompactAppearanceForm
			initialValues={{ ...MockUserAppearanceSettings, theme_mode: "sync" }}
			activeScheme="dark"
			onSubmit={submit}
		/>,
	);
	await userEvent.click(screen.getByRole("button", { name: "Light theme" }));
	await userEvent.click(screen.getByLabelText("Theme selection"));
	await userEvent.click(
		screen.getByRole("option", { name: "Light tritanopia" }),
	);
	await userEvent.click(screen.getByRole("button", { name: "Save theme" }));
	expect(submit).toHaveBeenCalledWith(
		expect.objectContaining({
			theme_mode: "sync",
			theme_dark: "dark",
			theme_light: "light-tritan",
		}),
	);
});
