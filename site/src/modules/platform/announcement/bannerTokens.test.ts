import {
	countdownText,
	countdownToken,
	parseColors,
	parseCountdown,
	parseInline,
	plainLabel,
} from "./bannerTokens";

describe("parseInline", () => {
	it("reads bold, italic, strike-through and code", () => {
		expect(parseInline("**a** *b* ~~c~~ `d`")).toEqual([
			{ type: "strong", children: [{ type: "text", text: "a" }] },
			{ type: "text", text: " " },
			{ type: "em", children: [{ type: "text", text: "b" }] },
			{ type: "text", text: " " },
			{ type: "s", children: [{ type: "text", text: "c" }] },
			{ type: "text", text: " " },
			{ type: "code", text: "d" },
		]);
	});

	it("leaves underscores and stars inside words alone", () => {
		expect(parseInline("snake_case_name and 2*3*4")).toEqual([
			{ type: "text", text: "snake_case_name and 2*3*4" },
		]);
	});

	it("links only http(s) URLs and same-site paths", () => {
		expect(parseInline("[ok](https://example.com)")).toEqual([
			{
				type: "link",
				href: "https://example.com",
				children: [{ type: "text", text: "ok" }],
			},
		]);
		for (const unsafe of [
			"[bad](javascript:alert(1))",
			"[proto](//evil.example)",
			"[data](data:text/html,x)",
		]) {
			const nodes = parseInline(unsafe);
			expect(nodes.every((node) => node.type === "text")).toBe(true);
		}
	});

	it("keeps escaped characters literal", () => {
		expect(parseInline("\\*not italic\\*")).toEqual([
			{ type: "text", text: "*not italic*" },
		]);
	});

	it("reads a countdown token", () => {
		expect(
			parseInline(
				'in {{countdown to=2026-10-04T02:00:00Z format=clock done="now"}}',
			),
		).toMatchObject([
			{ type: "text", text: "in " },
			{
				type: "countdown",
				countdown: { to: "2026-10-04T02:00:00Z", format: "clock", done: "now" },
			},
		]);
	});
});

describe("countdowns", () => {
	it("round-trips through its token", () => {
		const token = countdownToken({
			to: "2026-10-04T02:00:00Z",
			format: "words",
			done: 'say "hi"',
		});
		expect(parseCountdown(`Restart ${token}.`)).toMatchObject({
			to: "2026-10-04T02:00:00Z",
			format: "words",
			done: "say hi",
			index: 8,
		});
	});

	it("shows the remaining time, then the text for zero", () => {
		const countdown = {
			to: "2026-10-04T02:00:00Z",
			format: "dhms",
			done: "now",
		} as const;
		const to = Date.parse(countdown.to);
		expect(countdownText(countdown, to - (26 * 3600 + 61) * 1000)).toBe(
			"1d 02h 01m 01s",
		);
		expect(
			countdownText({ ...countdown, format: "clock" }, to - 3661 * 1000),
		).toBe("01:01:01");
		expect(
			countdownText({ ...countdown, format: "words" }, to - 3660 * 1000),
		).toBe("1 hour, 1 minute");
		expect(countdownText(countdown, to + 1000)).toBe("now");
	});
});

describe("plainLabel", () => {
	it("shows tokens as what they are and drops Markdown", () => {
		expect(
			plainLabel(
				"{{colors bg=#112233 fg=#ffffff}}",
				"**Patch** at {{countdown to=2026-10-04T02:00:00Z}} [status](https://s.example)",
			),
		).toBe("Patch at ⏱ status");
		expect(parseColors("{{colors bg=#112233 fg=#ffffff}}")).toEqual({
			bg: "#112233",
			fg: "#ffffff",
		});
	});
});
