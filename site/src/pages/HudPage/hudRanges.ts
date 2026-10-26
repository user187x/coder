import type { HudRange } from "#/api/platform";

export const RANGES: { value: HudRange; label: string }[] = [
	{ value: "15m", label: "15 min" },
	{ value: "1h", label: "1 hour" },
	{ value: "6h", label: "6 hours" },
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
];
