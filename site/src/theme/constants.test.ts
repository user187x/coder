import { DEFAULT_TERMINAL_FONT, terminalFonts } from "./constants";

describe("terminalFonts", () => {
	it("uses the terminal symbol fallback before generic monospace", () => {
		for (const fontFamily of Object.values(terminalFonts)) {
			expect(fontFamily).toMatch(/'Coder Terminal Symbols', monospace$/);
		}
	});

	it("defaults to the bundled JetBrains Mono Nerd Font, also when unset", () => {
		expect(DEFAULT_TERMINAL_FONT).toBe("jetbrains-mono-nerd");
		for (const name of ["jetbrains-mono-nerd", ""] as const) {
			expect(terminalFonts[name]).toMatch(
				/^'JetBrainsMono Nerd Font', 'JetBrains Mono', /,
			);
		}
	});
});
