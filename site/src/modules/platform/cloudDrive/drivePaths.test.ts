import {
	breadcrumbs,
	formatBytes,
	joinPath,
	usedPercent,
	validName,
} from "./drivePaths";

describe("Cloud Drive paths", () => {
	it("joins a folder and a name", () => {
		expect(joinPath("", "a.txt")).toBe("a.txt");
		expect(joinPath("docs/2026", "a.txt")).toBe("docs/2026/a.txt");
	});

	it("gives a folder's breadcrumbs from the top", () => {
		expect(breadcrumbs("")).toEqual([{ name: "Cloud Drive", path: "" }]);
		expect(breadcrumbs("docs/2026")).toEqual([
			{ name: "Cloud Drive", path: "" },
			{ name: "docs", path: "docs" },
			{ name: "2026", path: "docs/2026" },
		]);
	});

	it("takes the names the service takes", () => {
		expect(validName("report final.pdf")).toBeNull();
		expect(validName("  ")).not.toBeNull();
		expect(validName("..")).not.toBeNull();
		expect(validName("a/b")).not.toBeNull();
		expect(validName("tab\there")).not.toBeNull();
		expect(validName("é".repeat(128))).not.toBeNull(); // 256 bytes
	});
});

describe("formatBytes", () => {
	it("reads like a file manager", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(10 * 1024 ** 3)).toBe("10 GB");
		expect(formatBytes(150 * 1024 ** 2)).toBe("150 MB");
	});

	it("gives the quota's share in use", () => {
		expect(usedPercent(5, 10)).toBe(50);
		expect(usedPercent(20, 10)).toBe(100);
		expect(usedPercent(1, 0)).toBe(0);
	});
});
