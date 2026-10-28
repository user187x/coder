/** CPU cores as Kubernetes writes them: "250m" under one core, else "1.5" ("N/A" if unknown). */
export const cores = (c: number | null | undefined) =>
	c == null || !Number.isFinite(c)
		? "N/A"
		: c < 1
			? `${Math.round(c * 1000)}m`
			: `${+c.toFixed(c < 10 ? 2 : 1)}`;

/**
 * A measured latency: microseconds show under a millisecond (in-cluster hops
 * often take less), whole milliseconds from 10 ms, seconds from one second.
 */
export const formatMs = (ms: number | null | undefined) => {
	if (ms == null || !Number.isFinite(ms)) {
		return "N/A";
	}
	if (ms < 0.01) {
		return "<0.01 ms";
	}
	if (ms < 1) {
		return `${ms.toFixed(2)} ms`;
	}
	if (ms < 10) {
		return `${ms.toFixed(1)} ms`;
	}
	if (ms < 1000) {
		return `${Math.round(ms)} ms`;
	}
	return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
};

/** Seconds as the largest sensible unit, signed for a lease ("in 25 s", "lapsed 3 s ago"). */
export const seconds = (s: number | null | undefined) => {
	if (s == null || !Number.isFinite(s)) {
		return "N/A";
	}
	const a = Math.abs(s);
	return a < 90
		? `${Math.round(a)} s`
		: a < 5400
			? `${Math.round(a / 60)} min`
			: `${Math.round(a / 3600)} h`;
};

/** Keeps node identity colors stable across filtering and refreshes. */
export const nodeBadgeStyle = (name: string) => {
	let hash = 0;
	for (const character of name) {
		hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
	}
	const hue = (hash * 137.508) % 360;
	return {
		color: `hsl(${hue} 70% 82%)`,
		backgroundColor: `hsl(${hue} 45% 18%)`,
		borderColor: `hsl(${hue} 55% 43%)`,
	};
};
