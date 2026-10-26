import { insertTunnelBend, routedTunnelPath } from "./tunnelRouting";

it("inserts into the closest segment and keeps waypoints relative to the connector", () => {
	const route = {
		orthogonal: false,
		points: [
			{ id: "a", x: 30, y: 20 },
			{ id: "b", x: 70, y: 20 },
		],
	};
	const next = insertTunnelBend({ x: 100, y: 200 }, { x: 200, y: 200 }, route, {
		x: 150,
		y: 222,
	});
	expect(next.points.map(({ x, y }) => ({ x, y }))).toEqual([
		{ x: 30, y: 20 },
		{ x: 50, y: 22 },
		{ x: 70, y: 20 },
	]);
	expect(route.points).toHaveLength(2);
});

it("uses only horizontal and vertical segments, including reverse flow", () => {
	const route = { orthogonal: true, points: [{ id: "a", x: 30, y: 20 }] };
	expect(routedTunnelPath({ x: 10, y: 10 }, { x: 90, y: 60 }, route)).toBe(
		"M 10 10 H 40 V 30 H 90 V 60",
	);
	expect(
		routedTunnelPath({ x: 10, y: 10 }, { x: 90, y: 60 }, route, true),
	).toBe("M 90 60 V 30 H 40 V 10 H 10");
});
