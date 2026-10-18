import type { CloudDriveShare } from "#/api/platform";
import {
	GAP,
	loopsRoom,
	PLUG,
	SOCKET,
	SPACING,
	shareEdges,
	shareEnds,
} from "./shareCables";

const share = (
	id: string,
	owner: string,
	from: string,
	over: Partial<CloudDriveShare> = {},
): CloudDriveShare => ({
	id,
	owner,
	ownerName: owner,
	from,
	fromName: from,
	access: "read",
	asked: "read",
	state: "active",
	askedAt: 1,
	kind: "drive",
	path: "",
	by: "request",
	...over,
});

describe("shareEdges", () => {
	it("draws the active shares between accounts on the page, each once", () => {
		const { edges, offPage } = shareEdges(
			[
				share("s1", "ann", "bob", { access: "write" }),
				share("s1", "ann", "bob"),
				share("s2", "bob", "eve", { state: "approval" }),
				share("s3", "bob", "eve", { state: "ended" }),
				share("s4", "eve", "zed"),
			],
			new Set(["ann", "bob", "eve"]),
		);
		expect(edges).toEqual([
			{
				key: "s1",
				owner: "ann",
				to: "bob",
				access: "write",
				label: "ann's Cloud Drive, shared with bob (read and write)",
			},
		]);
		expect(offPage).toBe(1);
	});
});

describe("shareEnds", () => {
	const rows = new Map([
		["ann", { right: 800, mid: 100 }],
		["bob", { right: 800, mid: 160 }],
		["eve", { right: 800, mid: 220 }],
	]);
	const edges = shareEdges(
		[
			share("s1", "ann", "bob"),
			share("s2", "ann", "eve"),
			share("s3", "eve", "bob"),
		],
		new Set(rows.keys()),
	).edges;

	it("puts a socket at each owner's row's edge and a plug at each row it is shared with", () => {
		const { sockets, plugs } = shareEnds(edges, rows);
		expect([...sockets.keys()].sort()).toEqual(["ann", "eve"]);
		expect(sockets.get("ann")).toEqual({
			at: { x: 800, y: 100 },
			from: { x: 800 + SOCKET, y: 100 },
		});
		// bob has two plugs (ann's above eve's), round his middle
		expect(plugs.get("s1")?.end).toEqual({
			x: 800 + GAP + PLUG,
			y: 160 - SPACING / 2,
		});
		expect(plugs.get("s3")?.end.y).toBe(160 + SPACING / 2);
		// eve: her socket first, then ann's plug
		expect(sockets.get("eve")?.at.y).toBe(220 - SPACING / 2);
		expect(plugs.get("s2")?.end.y).toBe(220 + SPACING / 2);
	});

	it("nests the loops: the shorter a cable's drop, the further in", () => {
		const { plugs } = shareEnds(edges, rows);
		const reach = (k: string) => plugs.get(k)?.reach ?? 0;
		expect(reach("s1")).toBeLessThan(reach("s2"));
		expect(reach("s3")).toBeLessThan(reach("s2"));
		expect(loopsRoom(shareEnds(edges, rows))).toBe(
			reach("s2") + GAP + PLUG + SOCKET,
		);
	});

	it("leaves out a share whose row is not there", () => {
		const { sockets, plugs } = shareEnds(
			edges,
			new Map([["ann", { right: 800, mid: 100 }]]),
		);
		expect(sockets.size).toBe(0);
		expect(plugs.size).toBe(0);
	});
});
