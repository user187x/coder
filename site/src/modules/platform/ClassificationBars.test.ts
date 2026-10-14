import { isTerminalPage } from "./ClassificationBars";

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
