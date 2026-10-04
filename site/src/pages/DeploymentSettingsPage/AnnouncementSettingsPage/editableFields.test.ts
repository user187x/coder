import type { Banner } from "#/api/platform";
import { editableFields } from "./AnnouncementSettingsPage";

const banner: Banner = {
	id: "abc",
	enabled: true,
	level: "warning",
	title: "",
	message: "Restart tonight.",
	linkText: "",
	linkUrl: "",
	dismissible: true,
	showOnLoginPage: true,
	refreshSeconds: 60,
	effect: "none",
	repeat: false,
};

describe("editableFields", () => {
	it("leaves Markdown announcements as they are", () => {
		const custom = { ...banner, title: "{{colors bg=#000000 fg=#ffffff}}" };
		const { id: _id, ...fields } = custom;
		expect(editableFields(custom)).toEqual(fields);
	});

	it("folds an older lead-in and link into the Markdown message", () => {
		expect(
			editableFields({
				...banner,
				title: "Heads up:",
				linkText: "status",
				linkUrl: "https://status.example",
			}),
		).toMatchObject({
			title: "",
			linkText: "",
			linkUrl: "",
			message:
				"**Heads up:** Restart tonight. [status](https://status.example)",
		});
	});
});
