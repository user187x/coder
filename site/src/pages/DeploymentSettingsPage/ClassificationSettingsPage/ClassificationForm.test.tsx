import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClassificationSettings } from "#/api/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ClassificationForm } from "./ClassificationSettingsPage";

const saved: ClassificationSettings = {
	enabled: false,
	text: "UNCLASSIFIED",
	height: 24,
	background: "#007a33",
	color: "#ffffff",
};

const renderForm = (form: ClassificationSettings) => {
	const onChange = vi.fn();
	const onSave = vi.fn();
	renderComponent(
		<ClassificationForm
			saved={saved}
			form={form}
			onChange={onChange}
			onDiscard={vi.fn()}
			onSave={onSave}
			isSaving={false}
		/>,
	);
	return { onChange, onSave };
};

describe("ClassificationForm", () => {
	it("gives a light marking colour black text", async () => {
		const { onChange } = renderForm(saved);

		await userEvent.click(
			screen.getByRole("button", { name: "TOP SECRET//SCI #fce83a" }),
		);

		expect(onChange).toHaveBeenCalledWith({
			background: "#fce83a",
			color: "#000000",
		});
	});

	it("saves the edited marking", async () => {
		const form = { ...saved, enabled: true, text: "SECRET" };
		const { onSave } = renderForm(form);

		await userEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onSave).toHaveBeenCalledWith(form);
	});

	it("does not save banners that are on without text", async () => {
		const { onSave } = renderForm({ ...saved, enabled: true, text: " " });

		await userEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onSave).not.toHaveBeenCalled();
	});
});
