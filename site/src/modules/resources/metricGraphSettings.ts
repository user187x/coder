import { useSyncExternalStore } from "react";

/**
 * The workspace metric graphs' refresh interval, shared by the agent's
 * "Metrics Interval" menu (next to Open ports) and the graphs: seconds per bar
 * (0 = one bar per reading, as the agent sends it) or "off" (no graphs, nothing
 * recorded: for browsers short on processing power). 1 s unless chosen;
 * remembered in this browser. The graphs also publish how often each agent reports its metrics,
 * for the menu's readout.
 */
export type GraphEvery = number | "off";

export const GRAPH_CHOICES: readonly GraphEvery[] = [0, 1, 5, 30, 60, 300];

const STORE_KEY = "workspace.metrics.graphEvery";
const listeners = new Set<() => void>();
const intervals = new Map<string, { name: string; s: number }[]>();

const read = (): GraphEvery => {
	try {
		const raw = localStorage.getItem(STORE_KEY);
		if (raw === "off") {
			return "off";
		}
		if (raw === null) {
			return 1;
		}
		const v = Number(raw);
		return GRAPH_CHOICES.includes(v) ? v : 1;
	} catch {
		return 1;
	}
};

let every: GraphEvery = read();
let version = 0;

const emit = () => {
	version++;
	for (const l of listeners) {
		l();
	}
};

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export const setGraphEvery = (v: GraphEvery) => {
	every = v;
	try {
		localStorage.setItem(STORE_KEY, String(v));
	} catch {
		// a private window: the choice lasts this visit
	}
	emit();
};

export const useGraphEvery = () => useSyncExternalStore(subscribe, () => every);

/** The graphs say how often an agent reports each metric (its template's intervals). */
export const publishIntervals = (
	agentId: string,
	list: { name: string; s: number }[],
) => {
	const before = JSON.stringify(intervals.get(agentId) ?? null);
	if (before !== JSON.stringify(list)) {
		intervals.set(agentId, list);
		emit();
	}
};

export const useAgentIntervals = (agentId: string) => {
	useSyncExternalStore(subscribe, () => version);
	return intervals.get(agentId);
};

/** 10 → "10s", 60 → "1m", 300 → "5m", 90 → "90s". */
export const shortInterval = (seconds: number) =>
	seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

export const spanOf = (seconds: number) =>
	seconds >= 3600
		? `${+(seconds / 3600).toFixed(1)} h`
		: seconds >= 60
			? `${Math.round(seconds / 60)} min`
			: `${seconds} s`;
