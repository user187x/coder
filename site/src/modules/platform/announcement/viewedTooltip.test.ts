import { viewedTooltip } from "./AnnouncementBanner";
import { NOT_RECORDED } from "./useCertificateFingerprint";

describe("viewedTooltip", () => {
	const at = new Date(2026, 9, 11, 22, 29);
	const offset = -at.getTimezoneOffset();
	const utc =
		offset === 0
			? "UTC"
			: `UTC${offset > 0 ? "+" : "-"}${Math.floor(Math.abs(offset) / 60)}${Math.abs(offset) % 60 ? `:${String(Math.abs(offset) % 60).padStart(2, "0")}` : ""}`;
	const head = `Announcement Viewed:\nDate: October 11, 2026 @ 10:29 PM ${utc}`;

	it("gives the date, time, UTC offset and the certificate's fingerprint and MD5 hash", () => {
		expect(viewedTooltip(at, { sha256: "14:77:2A", md5: "9E:10:7D" })).toBe(
			`${head}\nCertificate Fingerprint: 14:77:2A\nMD5 HASH: 9E:10:7D`,
		);
	});

	it("leaves the certificate lines out when there is no certificate (or while it loads)", () => {
		expect(viewedTooltip(at, null)).toBe(head);
		expect(viewedTooltip(at, undefined)).toBe(head);
	});

	it("says which fingerprint an older upload did not record", () => {
		expect(viewedTooltip(at, { sha256: "14:77:2A" })).toBe(
			`${head}\nCertificate Fingerprint: 14:77:2A\nMD5 HASH: ${NOT_RECORDED}`,
		);
	});
});
