import type { LucideIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Where the Settings dropdown opens from instead of the navbar's Settings button: the admin settings' breadcrumb, moved
 * into the navbar, registers its category slot here, and the Settings menu (ProxyMenu) puts its trigger there. The
 * menu says it is mounted, so the breadcrumb keeps its own categories list when there is no Settings menu to open.
 */
type SettingsMenuHost = {
	element: HTMLElement;
	/** The settings category the page shows, the trigger's name and icon. */
	label: string;
	icon: LucideIcon;
};

let host: SettingsMenuHost | null = null;
let menus = 0;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const setSettingsMenuHost = (next: SettingsMenuHost | null) => {
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
