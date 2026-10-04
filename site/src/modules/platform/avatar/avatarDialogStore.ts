import { useSyncExternalStore } from "react";

// The avatar dialog is opened from menus that unmount as soon as an item is
// chosen, so it is rendered once, outside them (AvatarDialogHost), and opened
// through this flag.
let open = false;
const listeners = new Set<() => void>();

const setOpen = (next: boolean) => {
	open = next;
	for (const listener of listeners) {
		listener();
	}
};

export const openAvatarDialog = () => setOpen(true);

export const closeAvatarDialog = () => setOpen(false);

export const useAvatarDialogOpen = (): boolean =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => open,
	);
