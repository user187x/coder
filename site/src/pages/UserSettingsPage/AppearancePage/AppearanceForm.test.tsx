import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockCustomTheme } from "#/testHelpers/appearance";
import { MockUserAppearanceSettings } from "#/testHelpers/entities";
import { render } from "#/testHelpers/renderHelpers";
import { encodeCustomTheme } from "#/theme/customTheme";
import { AppearanceForm } from "./AppearanceForm";

it("preserves a custom palette when the personal settings page changes the terminal font", async () => {
	const submit = vi.fn();
	const preference = encodeCustomTheme(MockCustomTheme);
	render(
		<AppearanceForm
			initialValues={{
				...MockUserAppearanceSettings,
				theme_preference: preference,
			}}
			activeScheme="dark"
			onSubmit={submit}
		/>,
	);
	await userEvent.click(screen.getByRole("radio", { name: "Fira Code" }));
	expect(submit).toHaveBeenCalledWith(
		expect.objectContaining({
			theme_preference: preference,
			terminal_font: "fira-code",
		}),
	);
});
