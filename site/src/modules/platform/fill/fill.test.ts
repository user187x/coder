import { fillCSS, fillHTML, fillSettings } from "./fill";

it("normalizes untrusted presets before embedding them in HTML", () => {
	const settings = fillSettings({
		mode: "linear",
		color: "</style><script>alert(1)</script>",
		endColor: "#ABCDEF",
		angle: Number.NaN,
		start: -10,
		end: Number.POSITIVE_INFINITY,
	});
	expect(fillCSS(settings)).toBe(
		"linear-gradient(135deg, #0f172a 0%, #abcdef 100%)",
	);
	expect(fillHTML(settings)).not.toContain("<script>");
});
