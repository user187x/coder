import type { CloudDrivePeers, CloudDriveShare } from "#/api/platform";
import {
	CLOUD_RISE,
	CLOUD_STEP,
	cloudXs,
	GLYPH_X,
	sharedDrives,
	spotAt,
	TETHER_X,
	TETHER_Y,
	tetherRest,
} from "./sharedClouds";

const share = (
	id: string,
	owner: string,
	over: Partial<CloudDriveShare> = {},
): CloudDriveShare => ({
	id,
	owner,
	ownerName: owner,
	from: "me",
	fromName: "me",
	access: "read",
	asked: "read",
	state: "active",
	askedAt: 1,
	kind: "drive",
	path: "",
	by: "request",
	...over,
});

const peers = (asked: CloudDriveShare[], enabled = true): CloudDrivePeers => ({
	settings: { enabled, adminApproval: true, updatedBy: null, updatedAt: null },
	admin: false,
	me: "me",
	asked,
	ofMine: [],
});

describe("sharedDrives", () => {
	it("is each active share of another's drive, by its owner's name, the wider access of two", () => {
		expect(
			sharedDrives(
				peers([
					share("1", "zed"),
					share("2", "bob", { state: "approval" }),
					share("3", "ann"),
					share("4", "ann", { access: "write" }),
					share("5", "eve", { state: "ended" }),
				]),
			),
		).toEqual([
			{ owner: "ann", ownerName: "ann", access: "write" },
			{ owner: "zed", ownerName: "zed", access: "read" },
		]);
	});

	it("gives a drive shared only in parts one cloud, its first part for the HUD and how many more", () => {
		const out = sharedDrives(
			peers([
				share("2", "zed", {
					ownerName: "zed",
					kind: "file",
					path: "z/notes.txt",
					access: "write",
				}),
				share("1", "zed", { ownerName: "zed", kind: "folder", path: "docs" }),
				share("3", "ann", { ownerName: "ann", kind: "folder", path: "a" }),
				share("4", "ann", { ownerName: "ann" }),
			]),
		);
		expect(out).toEqual([
			{ owner: "ann", ownerName: "ann", access: "read" },
			{
				owner: "zed",
				ownerName: "zed",
				access: "write",
				part: { id: "1", kind: "folder", path: "docs", more: 1 },
			},
		]);
	});

	it("is none while sharing is off, or before the shares are read", () => {
		expect(sharedDrives(peers([share("1", "ann")], false))).toEqual([]);
		expect(sharedDrives(undefined)).toEqual([]);
	});
});

describe("cloud placement", () => {
	const button = { left: 1000, top: 400, right: 1340 };

	it("starts over the button's glyph, steps right to its end, then goes on left of the first", () => {
		const xs = cloudXs(button, 7);
		expect(xs.slice(0, 5)).toEqual(
			[0, 1, 2, 3, 4].map((i) => 1000 + GLYPH_X + i * CLOUD_STEP),
		);
		// the fifth's cloud still ends within the button; a sixth would not
		expect(xs[5]).toBe(1000 + GLYPH_X - CLOUD_STEP);
		expect(xs[6]).toBe(1000 + GLYPH_X - 2 * CLOUD_STEP);
		expect(cloudXs({ left: 0, top: 0, right: 40 }, 2)).toEqual([
			GLYPH_X,
			GLYPH_X - CLOUD_STEP,
		]);
	});

	it("floats the cloud above the button, its cable down into a socket on its top edge", () => {
		const spot = spotAt(button, 1025);
		expect(spot.corner).toEqual({
			x: 1025 - TETHER_X,
			y: 400 - CLOUD_RISE - TETHER_Y,
		});
		expect(spot.from).toEqual({ x: 1025, y: 400 - CLOUD_RISE - 1 });
		expect(spot.socket).toEqual({ x: 1025, y: 400 });
		expect(spot.end.y).toBeLessThan(400);
		expect(spot.end.y).toBeGreaterThan(spot.from.y);
		const [a, b] = tetherRest(spot.from, spot.end);
		// out of the cloud with a bow; straight down into the plug
		expect(a.x).toBeGreaterThan(spot.from.x);
		expect(b.x).toBe(spot.end.x);
		expect(b.y).toBeLessThan(spot.end.y);
	});
});
