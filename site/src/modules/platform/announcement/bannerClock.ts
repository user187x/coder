import { useSyncExternalStore } from "react";

// One ticking clock for every countdown on the page.
let now = Date.now();
const tickListeners = new Set<() => void>();
let ticker: number | undefined;

const subscribeToClock = (listener: () => void) => {
	tickListeners.add(listener);
	if (ticker === undefined) {
		ticker = window.setInterval(() => {
			now = Date.now();
			for (const l of tickListeners) {
				l();
			}
		}, 1000);
	}
	return () => {
		tickListeners.delete(listener);
		if (tickListeners.size === 0 && ticker !== undefined) {
			window.clearInterval(ticker);
			ticker = undefined;
		}
	};
};

/**
 * The clock's time. While nothing keeps it ticking (no countdown on the page
 * since), it would be stale: the time now, to the second, so it stays the same
 * through a render.
 */
const snapshot = () => {
	if (ticker === undefined) {
		now = Math.floor(Date.now() / 1000) * 1000;
	}
	return now;
};

/** The time now, ticking every second (one timer for every countdown on the page). */
export const useBannerClock = (): number =>
	useSyncExternalStore(subscribeToClock, snapshot);
