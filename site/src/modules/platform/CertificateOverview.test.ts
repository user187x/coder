import { certificateLifetime } from "./CertificateOverview";

describe("certificateLifetime", () => {
	const notBefore = "2026-01-01T00:00:00+00:00";
	const notAfter = "2026-01-11T00:00:00+00:00";
	const at = (iso: string) => new Date(iso).getTime();

	it("is green when just issued", () => {
		const life = certificateLifetime(notBefore, notAfter, at(notBefore));
		expect(life.elapsed).toBe(0);
		expect(life.daysLeft).toBe(10);
		expect(life.expired).toBe(false);
		expect(life.color).toBe("hsl(120 70% 45%)");
	});

	it("turns towards red as it nears expiry", () => {
		const life = certificateLifetime(
			notBefore,
			notAfter,
			at("2026-01-10T00:00:00+00:00"),
		);
		expect(life.elapsed).toBeCloseTo(0.9);
		expect(life.daysLeft).toBe(1);
		expect(life.color).toBe("hsl(12 70% 45%)");
	});

	it("is red and expired after notAfter", () => {
		const life = certificateLifetime(
			notBefore,
			notAfter,
			at("2026-01-13T00:00:00+00:00"),
		);
		expect(life.elapsed).toBe(1);
		expect(life.expired).toBe(true);
		expect(life.daysLeft).toBe(-2);
		expect(life.color).toBe("hsl(0 70% 45%)");
	});
});
