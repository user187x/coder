import type { LucideIcon } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import type { UserUIPreferences } from "#/api/platform";

/**
 * Where the Settings dropdown opens from instead of the navbar's Settings button: the admin settings' breadcrumb, moved
 * into the navbar, registers its Settings chevron's slot here, and the Settings menu (ProxyMenu) puts its trigger
 * there. The menu says it is mounted, so the breadcrumb keeps its own Settings link when there is no menu to open.
 */
type SettingsMenuHost = {
	element: HTMLElement;
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

/**
 * The Settings chevron's slot, as a ref: the navbar's own breadcrumb and a settings page's both offer one, and a slot
 * leaving clears the host only while it is still the host, so one replacing the other never loses it.
 */
export const settingsMenuSlot = (
	element: HTMLElement | null,
	{ label, icon }: Pick<SettingsMenuHost, "label" | "icon">,
) => {
	if (!element) return;
	const registration = { element, label, icon };
	host = registration;
	emit();
	return () => {
		if (host !== registration) return;
		host = null;
		emit();
	};
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

let chatSlot: HTMLDivElement | null = null;

export const settingsChatSlot = (element: HTMLDivElement | null) => {
	if (!element) return;
	chatSlot = element;
	emit();
	return () => {
		if (chatSlot !== element) return;
		chatSlot = null;
		emit();
	};
};

export const useSettingsChatSlot = () =>
	useSyncExternalStore(subscribe, () => chatSlot);

let pageCrumbs = 0;

/** Whether a page put its own settings breadcrumb (with the Settings chevron's slot) in the navbar. */
export const usePageSettingsBreadcrumb = () =>
	useSyncExternalStore(subscribe, () => pageCrumbs > 0);

/** Marks a page's settings breadcrumb in the navbar while the calling component shows one. */
export const useRegisterPageSettingsBreadcrumb = (enabled: boolean) => {
	useEffect(() => {
		if (!enabled) return;
		pageCrumbs += 1;
		emit();
		return () => {
			pageCrumbs -= 1;
			emit();
		};
	}, [enabled]);
};

/** The end of the navbar the Settings chevron group sits at (Appearance > Navigation bar). */
export const navbarSettingsSide = (
	preferences: UserUIPreferences | undefined,
): "left" | "right" =>
	preferences?.navbar_settings_side === "right" ? "right" : "left";
