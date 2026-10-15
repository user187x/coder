import { formatRate } from "./ClusterGauge";

describe("formatRate", () => {
	it("shows bytes per second from B/s to GB/s", () => {
		expect(formatRate(0)).toBe("0 B/s");
		expect(formatRate(512)).toBe("512 B/s");
		expect(formatRate(1_500)).toBe("1.5 kB/s");
		expect(formatRate(245_000)).toBe("245 kB/s");
		expect(formatRate(2_400_000)).toBe("2.4 MB/s");
		expect(formatRate(3_000_000_000)).toBe("3.0 GB/s");
	});
});
