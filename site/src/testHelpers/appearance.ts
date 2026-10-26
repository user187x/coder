import type { BackgroundsState } from "#/api/platform";
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
	limits: { opacity: { min: 0, max: 0.5, default: 0.06 }, maxBytes: 4194304 },
	login: {
		url: "/pictures/login.png",
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
		url: "/pictures/dashboard.png",
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
