import {
	MockPersistenceReport,
	MockPersistenceReportNeedsAttention,
	MockPersistenceReportNoOperator,
} from "#/testHelpers/platform";
import {
	fixesForSettings,
	fixesNeeded,
	parseQuantity,
} from "./persistenceFixes";

describe("fixesNeeded", () => {
	it("lists the fixes the checks suggest, once each", () => {
		expect(fixesNeeded(MockPersistenceReportNeedsAttention)).toEqual([
			"cnpg.instances",
			"cnpg.storage",
			"cnpg.backup",
		]);
	});

	it("leaves out installing the operator, which is done by an administrator", () => {
		expect(fixesNeeded(MockPersistenceReportNoOperator)).toEqual([]);
	});
});

describe("fixesForSettings", () => {
	const { settings } = MockPersistenceReport.facts;

	it("creates a cluster, with backups when a snapshot class is chosen", () => {
		expect(fixesForSettings(MockPersistenceReportNoOperator, settings)).toEqual(
			["cnpg.cluster", "cnpg.backup"],
		);
		expect(
			fixesForSettings(MockPersistenceReportNoOperator, {
				...settings,
				snapshotClass: "",
			}),
		).toEqual(["cnpg.cluster"]);
	});

	it("has nothing to apply when the form matches the cluster", () => {
		expect(fixesForSettings(MockPersistenceReport, settings)).toEqual([]);
	});

	it("scales the cluster and grows its storage, never shrinks it", () => {
		expect(
			fixesForSettings(MockPersistenceReport, {
				...settings,
				instances: 5,
				storageSize: "40Gi",
			}),
		).toEqual(["cnpg.instances", "cnpg.storage"]);
		expect(
			fixesForSettings(MockPersistenceReport, {
				...settings,
				storageSize: "5Gi",
			}),
		).toEqual([]);
	});
});

describe("parseQuantity", () => {
	it.each([
		["20Gi", 20 * 2 ** 30],
		["500M", 500e6],
		["1.5Ti", 1.5 * 2 ** 40],
		["1024", 1024],
		["20 GB", null],
		["lots", null],
	])("reads %s", (text, value) => {
		expect(parseQuantity(text)).toBe(value);
	});
});
