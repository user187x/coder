import { terminalRenderer } from "./terminalConfig";

describe("terminalRenderer", () => {
	it("is Ghostty's where the template gives the Ghostty app, or the link asks for it", () => {
		const dataflow = { apps: [{ slug: "nifi" }, { slug: "ghostty" }] };
		const developer = { apps: [{ slug: "code-server" }] };
		expect(terminalRenderer("webgl", dataflow)).toBe("webgl");
		expect(terminalRenderer(undefined, developer, "ghostty")).toBe("ghostty");
		expect(terminalRenderer("webgl", developer)).toBe("webgl");
		expect(terminalRenderer("canvas", undefined, null)).toBe("canvas");
	});
});
