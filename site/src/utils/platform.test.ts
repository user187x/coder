import { afterEach, describe, expect, it, vi } from "vitest";
import { isMac } from "./platform";

const stubPlatform = (platform: string) => {
	vi.stubGlobal("navigator", { ...navigator, platform });
};

describe("platform", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("detects macOS", () => {
		stubPlatform("MacIntel");
		expect(isMac()).toBe(true);
	});

	it("treats Windows and Linux as not macOS", () => {
		for (const platform of ["Win32", "Linux x86_64"]) {
			stubPlatform(platform);
			expect(isMac()).toBe(false);
		}
	});
});
