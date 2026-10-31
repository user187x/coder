import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ClassificationSettings } from "#/api/platform";
import { MockClassification } from "#/testHelpers/platform";
import { renderComponent } from "#/testHelpers/renderHelpers";
import { ClassificationForm } from "./ClassificationSettingsPage";

const saved: ClassificationSettings = { ...MockClassification, enabled: false };

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

it("switches colour targets without losing edited values and saves both", async () => {
	const onSave = vi.fn();
	const Form = () => {
		const [form, setForm] = useState(saved);
		return (
			<ClassificationForm
				saved={saved}
				form={form}
				onChange={(change) => setForm((before) => ({ ...before, ...change }))}
				onDiscard={() => setForm(saved)}
				onSave={onSave}
				isSaving={false}
			/>
		);
	};
	renderComponent(<Form />);
	const user = userEvent.setup();
	await user.click(screen.getByRole("button", { name: "CUI #502b85" }));
	await user.click(screen.getByRole("tab", { name: "Text" }));
	await user.click(screen.getByRole("button", { name: "Black #000000" }));
	await user.click(screen.getByRole("tab", { name: "Background" }));
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(onSave).toHaveBeenCalledWith({
		...saved,
		background: "#502b85",
		color: "#000000",
	});
});

it("changing the colour target does not modify the marking", async () => {
	const { onChange, onSave } = renderForm(saved);
	const user = userEvent.setup();
	await user.click(screen.getByRole("tab", { name: "Text" }));
	await user.keyboard("{ArrowLeft}");
	expect(onChange).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Save" }));
	expect(onSave).not.toHaveBeenCalled();
});
