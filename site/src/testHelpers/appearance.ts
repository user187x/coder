import type { BackgroundsState, QuickMenuSettings } from "#/api/platform";
import type { CustomTheme } from "#/theme/customTheme";
export const MockCustomTheme: CustomTheme = {
	base: "dark",
	background: "#09090b",
	surface: "#18181b",
	text: "#fafafa",
	accent: "#38bdf8",
	border: "#3f3f46",
};
export const MockBackgrounds: BackgroundsState = {
	available: true,
	limits: {
		opacity: { min: 0, max: 1, default: 0.06 },
		maxBytes: 16 * 1024 * 1024,
	},
	login: {
		url: "/pictures/destructed-cube.png",
		opacity: 0.06,
		fit: "cover",
		layer: "under",
		kind: "image",
		type: "image/png",
		bytes: 100,
		updatedBy: "admin",
		updatedAt: null,
	},
	dashboard: {
		url: "/pictures/background.gif",
		opacity: 0.06,
		fit: "cover",
		layer: "under",
		kind: "image",
		type: "image/png",
		bytes: 100,
		updatedBy: "admin",
		updatedAt: null,
	},
};

export const MockQuickMenu: QuickMenuSettings = {
	items: null,
	wedges: [3, 12],
	enabled: true,
};
