import { diskAmounts } from "./ClusterDiskGraph";

describe("diskAmounts", () => {
	it("keeps overlapping PVC claims separate from physical capacity", () => {
		expect(
			diskAmounts({ diskUsed: 70, diskTotal: 100, diskClaimed: 80 }),
		).toEqual({ used: 70, total: 100, claimed: 80, remaining: 30 });
	});
	it("preserves overcommitted claims without inventing negative remaining capacity", () => {
		expect(
			diskAmounts({ diskUsed: 110, diskTotal: 100, diskClaimed: 200 }),
		).toEqual({ used: 110, total: 100, claimed: 200, remaining: 0 });
	});
	it("distinguishes missing measurements from measured zero", () => {
		expect(diskAmounts(undefined)).toEqual({
			used: null,
			total: null,
			claimed: null,
			remaining: null,
		});
		expect(
			diskAmounts({
				diskUsed: Number.NaN,
				diskTotal: Number.POSITIVE_INFINITY,
				diskClaimed: -1,
			}),
		).toEqual(diskAmounts(undefined));
		expect(
			diskAmounts({ diskUsed: 0, diskTotal: 100, diskClaimed: 0 }),
		).toEqual({ used: 0, total: 100, claimed: 0, remaining: 100 });
	});
});
