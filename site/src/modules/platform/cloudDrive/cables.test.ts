import {
	type Cable,
	cableLength,
	cablePath,
	cablePoint,
	cableReach,
	fall,
	hangingRest,
	makeCable,
	plugAngle,
	REACH,
	reelSpeed,
	restHandles,
	restingCable,
	seat,
	settle,
	stepCable,
} from "./cables";

describe("cables", () => {
	// The socket on the Cloud Drive's right side at (407, 30); a row's plug at (415, 110); the table's edge at 403.
	const from = { x: 407, y: 30 };
	const to = { x: 415, y: 110 };

	it("loops out to the right of both ends, leaving and entering them straight", () => {
		const rest = restHandles(from, to, cableReach(to.y - from.y, 0));
		const cable = settle(makeCable(from, to), rest);
		expect(cable.handles[0].x).toBeCloseTo(rest[0].x, 0);
		expect(cable.handles[1].y).toBeCloseTo(rest[1].y, 0);
		// out to the right: its widest point well right of both ends, as wide as the drop for a short one
		const widest = Math.max(
			...Array.from(
				{ length: 21 },
				(_, i) => cablePoint(from, cable, to, i / 20).x,
			),
		);
		expect(widest - to.x).toBeGreaterThan(40);
		// leaving the socket and entering the plug from the right
		expect(cablePoint(from, cable, to, 0.05).x).toBeGreaterThan(from.x);
		expect(cablePoint(from, cable, to, 0.95).x).toBeGreaterThan(to.x);
	});

	it("nests a deeper row's loop round a shallower one's, within bounds", () => {
		expect(cableReach(80, 0)).toBeLessThan(cableReach(80, 1));
		expect(cableReach(30, 0)).toBeLessThan(cableReach(300, 0));
		expect(cableReach(3000, 0)).toBe(REACH);
		expect(cableReach(3000, 50)).toBe(cableReach(3000, 8));
	});

	it("swings when its row moves, then comes to rest, never over the table", () => {
		const rest = restHandles(from, to, 60);
		const cable = restingCable(rest);
		const moved = { x: 415, y: 170 }; // the row moved down a row
		const next = restHandles(from, moved, 60);
		let motion = stepCable(cable, next, 1 / 60, 403);
		expect(motion).toBeGreaterThan(0);
		for (let i = 0; i < 600; i++) {
			motion = stepCable(cable, next, 1 / 60, 403);
			expect(cable.handles[0].x).toBeGreaterThanOrEqual(403);
			expect(cable.handles[1].x).toBeGreaterThanOrEqual(403);
		}
		expect(motion).toBeLessThan(0.01);
		expect(cable.handles[1].y).toBeCloseTo(next[1].y, 1);
	});

	it("flies a plug to its row and latches it there", () => {
		const end = { ...from };
		const v = { x: 0, y: 0 };
		let steps = 0;
		while (!seat(end, v, to, 1 / 120) && steps < 600) {
			steps++;
		}
		expect(steps).toBeLessThan(600);
		expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(1.5);
	});

	it("lets a loose plug fall on its cable, swing and never pass the table's edge", () => {
		const end = { x: 500, y: 30 };
		const v = { x: 0, y: 0 };
		const length = 120;
		for (let i = 0; i < 240; i++) {
			fall(end, v, from, length, 1 / 120, 403);
			expect(Math.hypot(end.x - from.x, end.y - from.y)).toBeLessThanOrEqual(
				length + 0.01,
			);
			expect(end.x).toBeGreaterThanOrEqual(403);
		}
		// it swung down below the socket
		expect(end.y).toBeGreaterThan(from.y + 60);
	});

	it("reels in slowly, then fast", () => {
		expect(reelSpeed(0)).toBeLessThan(reelSpeed(0.2));
		expect(reelSpeed(0.2)).toBeLessThan(reelSpeed(0.5));
		expect(reelSpeed(10)).toBe(3200);
	});

	it("hangs a loose cable from the socket, the plug below it, prongs down", () => {
		const plug = { x: 410, y: 200 };
		const cable: Cable = restingCable(hangingRest(from, plug));
		expect(cable.handles[1].y).toBeLessThan(plug.y);
		// prongs pointing down (about 90°)
		expect(plugAngle(cable, plug)).toBeCloseTo(Math.PI / 2, 1);
		// plugged in, the prongs point left, into the row
		const plugged = restingCable(restHandles(from, to, 60));
		expect(Math.abs(plugAngle(plugged, to))).toBeCloseTo(Math.PI, 1);
	});

	it("measures and draws it from the socket to the plug", () => {
		const cable = restingCable(restHandles(from, to, 60));
		const length = cableLength(from, cable, to);
		expect(length).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y));
		const d = cablePath(from, cable, to);
		expect(d).toMatch(/^M407,30 C/);
		expect(d).toMatch(/ 415,110$/);
		// the Cloud Drive left of the table's corner: straight along the top to the corner first
		expect(cablePath({ x: 300, y: 30 }, cable, to, from)).toMatch(
			/^M300,30 L407,30 C/,
		);
	});
});
