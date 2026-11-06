import { useEffect, useRef, useSyncExternalStore } from "react";

/** How long the announcement banner names the section being opened. */
const SECTION_SPLASH_MS = 2000;

let splash: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const setSplash = (label: string | null) => {
	splash = label;
	for (const listener of listeners) {
		listener();
	}
};

/** Names a section in the announcement banner for SECTION_SPLASH_MS; a newer one replaces it. */
const showSectionSplash = (label: string) => {
	clearTimeout(timer);
	setSplash(label);
	timer = setTimeout(() => setSplash(null), SECTION_SPLASH_MS);
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** The section name the announcement banner is showing in place of its message, if any. */
export const useSectionSplash = () =>
	useSyncExternalStore(
		subscribe,
		() => splash,
		() => null,
	);

/**
 * Shows the section's name when the user moves to a different one: not on the
 * first render, and not when only the query string changes within a section.
 */
export const useAnnounceSection = (
	section: { id: string; label: string } | null,
	enabled: boolean,
) => {
	const previous = useRef(section?.id);
	const id = section?.id;
	const label = section?.label;
	useEffect(() => {
		if (previous.current === id) {
			return;
		}
		previous.current = id;
		if (enabled && label) {
			showSectionSplash(label);
		}
	}, [id, label, enabled]);
};
