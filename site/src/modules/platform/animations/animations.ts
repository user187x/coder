import { useSyncExternalStore } from "react";

/**
 * The user menu's "Animations" switch (on by default, remembered in this
 * browser). Off: the workspace page's agent cards wear Coder's own solid
 * borders instead of the animated ones, the initializing panel's title stops
 * fading, and animated GIFs anywhere in the dashboard (logo, avatars, the
 * initializing animation, ...) stand still on their first frame
 * (AnimationsController). <html data-animations="on|off"> carries it for CSS.
 */
const KEY = "coder-ui-animations";
const CHANGE = "coder-ui-animations-change";

export const readAnimationsEnabled = (): boolean => {
	try {
		return localStorage.getItem(KEY) !== "0";
	} catch {
		return true;
	}
};

export const setAnimationsEnabled = (enabled: boolean) => {
	try {
		localStorage.setItem(KEY, enabled ? "1" : "0");
	} catch {
		// For this page only.
	}
	window.dispatchEvent(new CustomEvent(CHANGE, { detail: enabled }));
};

let override: boolean | undefined;
const current = () => override ?? readAnimationsEnabled();

const subscribe = (onChange: () => void) => {
	const onLocal = (event: Event) => {
		// Remembered even when storage is unavailable.
		override = (event as CustomEvent<boolean>).detail;
		onChange();
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key === KEY) {
			override = undefined;
			onChange();
		}
	};
	window.addEventListener(CHANGE, onLocal);
	window.addEventListener("storage", onStorage);
	return () => {
		window.removeEventListener(CHANGE, onLocal);
		window.removeEventListener("storage", onStorage);
	};
};

export const useAnimationsEnabled = (): boolean =>
	useSyncExternalStore(subscribe, current, () => true);
