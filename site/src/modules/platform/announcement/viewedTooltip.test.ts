import { viewedTooltip } from "./AnnouncementBanner";

describe("viewedTooltip", () => {
	const at = new Date(2026, 9, 11, 22, 29);
	const offset = -at.getTimezoneOffset();
	const utc =
		offset === 0
			? "UTC"
			: `UTC${offset > 0 ? "+" : "-"}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, "0")}` : ""}`;
	const head = `Announcement Viewed:\nDate: October 11, 2026 @ 10:29 PM ${utc}`;

	it("appends a recorded SHA-256 fingerprint on its own line", () => {
		expect(viewedTooltip(at, "14772a")).toBe(
			`${head}\nCertificate Fingerprint (SHA-256): 14:77:2A`,
		);
	});

	it("omits the fingerprint when the receipt has no certificate evidence", () => {
		expect(viewedTooltip(at, null)).toBe(head);
		expect(viewedTooltip(at)).toBe(head);
	});
});
