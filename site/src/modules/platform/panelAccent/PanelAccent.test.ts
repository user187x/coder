import { panelTextTokens } from "./PanelAccent";

it("turns a text colour into the theme's text tokens, secondary a step quieter", () => {
	expect(panelTextTokens("#ffffff")).toEqual({
		primary: "0 0% 100%",
		secondary: "0 0% 83%",
	});
	expect(panelTextTokens("#ff0000")).toEqual({
		primary: "0 100% 50%",
		secondary: "0 100% 50%",
	});
	expect(panelTextTokens("#000000").secondary).toBe("0 0% 17%");
});
