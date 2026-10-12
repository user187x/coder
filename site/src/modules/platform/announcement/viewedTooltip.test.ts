import { viewedTooltip } from "./AnnouncementBanner";

describe("viewedTooltip", () => {
	it("gives the date, time, UTC offset and certificate fingerprint", () => {
		const at = new Date(2026, 9, 11, 22, 29);
		const offset = -at.getTimezoneOffset();
		const utc =
			offset === 0
				? "UTC"
				: `UTC${offset > 0 ? "+" : "-"}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, "0")}` : ""}`;
		expect(viewedTooltip(at, "14:77:2A")).toBe(
			`Announcement Viewed:\nDate: October 11, 2026 @ 10:29 PM ${utc}\nTLS/x509 Fingerprint: 14:77:2A`,
		);
	});
});
