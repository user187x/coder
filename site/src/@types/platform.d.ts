import type { ClassificationSettings } from "#/api/platform";

// What the platform service's boot.js sets before the dashboard starts
// (contexts/platformBoot.ts), and browser APIs not yet in TypeScript's DOM types.
declare global {
	interface Window {
		/** URL of the uploaded logo, or "" when Coder's own logo is used. */
		__cuiLogo?: string;
		__cuiClassification?: ClassificationSettings;
		/** Uploaded avatars by username. */
		__cuiAvatars?: Record<string, string>;
		/** URL of the default avatar, or "" when none is installed. */
		__cuiAvatarDefault?: string;
		/** Usernames that get the default avatar (this browser's last answer). */
		__cuiAvatarUsers?: Set<string>;
		/** Lets a dashboard page embedded in a frame navigate the page around it. */
		__platformNavigate?: (url: string) => void;
		/** The EyeDropper API (Chromium): picks a colour from the screen. */
		EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
	}
}
