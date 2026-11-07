import { useEffect, useSyncExternalStore } from "react";
import { INTRO_DURATION } from "#/api/platform";

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

/** Names a section in the announcement banner for durationMs; a newer one replaces it. */
const showSectionSplash = (label: string, durationMs: number) => {
	clearTimeout(timer);
	setSplash(label);
	timer = setTimeout(() => setSplash(null), durationMs);
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
	durationMs: number = INTRO_DURATION.default,
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
			showSectionSplash(label, durationMs);
		}
	}, [id, label, enabled, durationMs]);
};
