import { MockClassification } from "#/testHelpers/platform";
import { isClassificationShown, isTerminalPage } from "./ClassificationBars";

it("preserves sign-in markings for older settings and honors the saved choice", () => {
	const settings = { ...MockClassification, enabled: true };
	expect(isClassificationShown(settings, true)).toBe(true);
	expect(isClassificationShown({ ...settings, showOnLogin: false }, true)).toBe(
		false,
	);
	expect(
		isClassificationShown({ ...settings, showOnLogin: false }, false),
	).toBe(true);
	expect(isClassificationShown({ ...settings, enabled: false }, true)).toBe(
		false,
	);
	expect(isClassificationShown(undefined, true)).toBe(false);
});

describe("isTerminalPage", () => {
	it("is Coder's terminal page, in a window of its own", () => {
		expect(isTerminalPage("/@admin/zzz.main/terminal")).toBe(true);
		expect(isTerminalPage("/admin/zzz/terminal/")).toBe(true);
	});

	it("is no other page", () => {
		expect(isTerminalPage("/@admin/zzz")).toBe(false);
		expect(isTerminalPage("/@admin/zzz.main/apps/terminal")).toBe(false);
		expect(isTerminalPage("/terminal")).toBe(false);
		expect(isTerminalPage("/deployment/overview")).toBe(false);
	});
});
