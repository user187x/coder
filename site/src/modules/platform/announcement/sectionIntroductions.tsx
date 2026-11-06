import { useEffect, useSyncExternalStore } from "react";

/** How long the announcement banner names the section being opened. */
const SECTION_SPLASH_MS = 2000;

let splash: string | null = null;
/**
 * The section last shown, kept outside any component: Workspaces, Templates
 * and the deployment pages each mount their own settings layout, so moving
 * between them starts a new component.
 */
let lastSection: string | null | undefined;
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
 * Shows the section's name when the user moves to a different one: not when
 * the app first loads, and not when only the query string changes within a
 * section.
 */
export const useAnnounceSection = (
	section: { id: string; label: string } | null,
	enabled: boolean,
) => {
	const id = section?.id ?? null;
	const label = section?.label;
	useEffect(() => {
		const first = lastSection === undefined;
		if (lastSection === id) {
			return;
		}
		lastSection = id;
		if (!first && enabled && label) {
			showSectionSplash(label);
		}
	}, [id, label, enabled]);
};
