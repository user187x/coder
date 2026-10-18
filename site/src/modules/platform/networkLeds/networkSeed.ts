import { useEffect, useRef } from "react";
import { useQuery } from "react-query";
import { workspaceNetwork } from "#/api/queries/platform";
import type { NetworkSample } from "./NetworkHistogram";

/** Two lists of readings as one: each reading once (by its time), oldest first, none older than `windowMs`. */
export const mergeSamples = (
	a: readonly NetworkSample[],
	b: readonly NetworkSample[],
	windowMs: number,
	now = Date.now(),
): NetworkSample[] =>
	[...new Map([...a, ...b].map((s) => [s.t, s])).values()]
		.filter((s) => s.t > now - windowMs)
		.sort((x, y) => x.t - y.t);

/**
 * The agent's traffic before the page opened: the platform service keeps the last minutes of every workspace's
 * (whether or not anyone looks), so the network pill and lights start from them, then go on from the live readings.
 * Asked again when the page is back in contact with Coder (the gap filled), and every 15 seconds while the live
 * readings have stalled (`stalled`).
 */
export const useNetworkSeed = (
	workspaceId: string | undefined,
	agentId: string,
	/** The card's live parts are stopped (no contact, the agent gone). */
	stopped: boolean,
	/** No live reading for a while: the platform service's minutes are asked for again and again. */
	stalled = false,
) => {
	const query = useQuery({
		...workspaceNetwork(workspaceId ?? ""),
		enabled: Boolean(workspaceId),
	});
	const wasStopped = useRef(stopped);
	const { refetch } = query;
	useEffect(() => {
		if (!stalled || !workspaceId) {
			return;
		}
		void refetch();
		const id = setInterval(() => void refetch(), 15_000);
		return () => clearInterval(id);
	}, [stalled, workspaceId, refetch]);
	useEffect(() => {
		if (wasStopped.current && !stopped) {
			void refetch();
		}
		wasStopped.current = stopped;
	}, [stopped, refetch]);
	return query.data?.agents[agentId];
};
