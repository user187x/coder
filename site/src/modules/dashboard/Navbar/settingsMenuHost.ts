import { useEffect, useSyncExternalStore } from "react";

/**
 * Where the Settings dropdown opens from instead of the navbar's Settings button: the admin settings' breadcrumb, moved
 * into the navbar, registers its Settings chevron's slot here, and the Settings menu (ProxyMenu) puts its trigger
 * there. The menu says it is mounted, so the breadcrumb keeps its own Settings link when there is no menu to open.
 */
let host: HTMLElement | null = null;
let menus = 0;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const setSettingsMenuHost = (next: HTMLElement | null) => {
	host = next;
	emit();
};

export const useSettingsMenuHost = () =>
	useSyncExternalStore(subscribe, () => host);

/** Whether a Settings menu is mounted to open from the breadcrumb. */
export const useSettingsMenuPresent = () =>
	useSyncExternalStore(subscribe, () => menus > 0);

/** Marks the Settings menu mounted while the calling component is. */
export const useRegisterSettingsMenu = (enabled: boolean) => {
	useEffect(() => {
		if (!enabled) return;
		menus += 1;
		emit();
		return () => {
			menus -= 1;
			emit();
		};
	}, [enabled]);
};
