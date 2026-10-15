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
	it("takes a message with nothing of Markdown in it as the plain text it is", () => {
		const custom = { ...banner, title: "{{colors bg=#000000 fg=#ffffff}}" };
		const { id: _id, ...fields } = custom;
		// Saved before the newer settings existed: their defaults.
		expect(editableFields(custom)).toEqual({
			...fields,
			speed: "normal",
			font: "default",
			receipts: true,
			closeEffect: "fade",
			openEffect: "none",
			markdown: false,
			align: "center",
			outline: false,
			picture: "",
			pictureFit: "span",
			countdown: "",
		});
	});

	it("turns a Markdown message into plain text, its picture and countdown into the banner's", () => {
		expect(
			editableFields({
				...banner,
				message:
					'**Save** your work: {{countdown to=2026-10-20T18:00:00Z format=dhms done="now"}} ![usa](/__coder-ui/banner-picture/56bf5ea1f007daca#fit=fill)',
			}),
		).toMatchObject({
			markdown: false,
			message: "Save your work:",
			picture: "/__coder-ui/banner-picture/56bf5ea1f007daca",
			pictureFit: "fill",
			countdown: "2026-10-20T18:00:00Z",
		});
	});

	it("folds an older lead-in and link into the plain text", () => {
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
			markdown: false,
			message: "Heads up: Restart tonight. status (https://status.example)",
		});
	});

	it("leaves the editor's own plain text as it is", () => {
		const plain: Banner = {
			...banner,
			markdown: false,
			message: "Use **bold** as you like",
			picture: "/pictures/usa.gif",
			pictureFit: "tile",
			countdown: "2026-10-20T18:00:00Z",
			align: "left",
		};
		expect(editableFields(plain)).toMatchObject({
			markdown: false,
			message: "Use **bold** as you like",
			picture: "/pictures/usa.gif",
			pictureFit: "tile",
			countdown: "2026-10-20T18:00:00Z",
			align: "left",
		});
	});
});
