import {
	readTunnelLayout,
	saveTunnelLayout,
	type TunnelLayout,
} from "./tunnelLayout";

afterEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});
it("restores head positions, bends, routing modes and cable adjustments per user and view", () => {
	const layout: TunnelLayout = {
		heads: { tunnel: { x: -20, y: 40 } },
		routes: {
			tunnel: { orthogonal: true, points: [{ id: "bend", x: 20, y: 60 }] },
		},
		arcs: { tunnel: 80 },
		stubs: { tunnel: { length: 60, bend: 15 } },
	};
	saveTunnelLayout("user:table", layout);
	expect(readTunnelLayout("user:table")).toEqual(layout);
	expect(readTunnelLayout("other:table").heads).toEqual({});
	expect(readTunnelLayout("user:grid").heads).toEqual({});
});
it("ignores malformed saved positions", () => {
	localStorage.setItem("layout", '{"heads":{"tunnel":{"x":"wrong","y":2}}}');
	expect(readTunnelLayout("layout")).toEqual({
		heads: {},
		routes: {},
		arcs: {},
		stubs: {},
	});
	localStorage.setItem("layout", "invalid json");
	expect(readTunnelLayout("layout").heads).toEqual({});
});
it("keeps editing usable when browser storage is blocked", () => {
	vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
		throw new Error("Blocked");
	});
	expect(() =>
		saveTunnelLayout("layout", { heads: {}, routes: {}, arcs: {}, stubs: {} }),
	).not.toThrow();
	vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
		throw new Error("Blocked");
	});
	expect(readTunnelLayout("layout").heads).toEqual({});
});
