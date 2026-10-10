import { applyOrder, elevate } from "./hudOrder";

const items = ["users", "workspaces", "active", "cpu"].map((id) => ({ id }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("HUD order", () => {
	it("keeps the server's order until something is clicked", () => {
		expect(ids(applyOrder(items, []))).toEqual([
			"users",
			"workspaces",
			"active",
			"cpu",
		]);
	});

	it("puts the clicked metric on top, then the earlier picks", () => {
		let order = elevate([], "cpu");
		order = elevate(order, "active");
		expect(order).toEqual(["active", "cpu"]);
		expect(ids(applyOrder(items, order))).toEqual([
			"active",
			"cpu",
			"users",
			"workspaces",
		]);
		expect(elevate(order, "cpu")).toEqual(["cpu", "active"]);
	});

	it("ignores ids that no longer exist", () => {
		expect(ids(applyOrder(items, ["gone", "cpu"]))).toEqual([
			"cpu",
			"users",
			"workspaces",
			"active",
		]);
	});
});
