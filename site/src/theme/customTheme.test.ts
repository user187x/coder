import { MockCustomTheme } from "#/testHelpers/appearance";
import {
	customThemeStyle,
	encodeCustomTheme,
	parseCustomTheme,
} from "./customTheme";
import { migrateLegacyPreference } from "./themeMode";

it("round trips a custom palette through the existing user preference with its base theme", () => {
	const preference = encodeCustomTheme(MockCustomTheme);
	expect(parseCustomTheme(preference)).toEqual(MockCustomTheme);
	expect(
		migrateLegacyPreference({
			theme_mode: "single",
			theme_preference: preference,
		}),
	).toEqual({ mode: "single", theme: "dark" });
	expect(
		customThemeStyle({ ...MockCustomTheme, accent: "#ff0000" })[
			"--content-link"
		],
	).toBe("0 100% 50%");
});
it("rejects malformed custom preferences instead of applying CSS fragments", () => {
	for (const value of [
		"dark",
		"custom-v1:unknown:#000000:#000000:#ffffff:#ff0000:#000000",
		"custom-v1:dark:url(x):#000000:#ffffff:#ff0000:#000000",
	])
		expect(parseCustomTheme(value)).toBeUndefined();
});
