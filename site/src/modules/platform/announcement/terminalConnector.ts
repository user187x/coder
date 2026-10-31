import { useSyncExternalStore } from "react";
import type { Workspace } from "#/api/typesGenerated";

type Connector = {
	armed: boolean;
	ownerId: string | null;
	workspace: Workspace | null;
	origin: { x: number; y: number } | null;
	pointer: { x: number; y: number } | null;
};
let state: Connector = {
	armed: false,
	ownerId: null,
	workspace: null,
	origin: null,
	pointer: null,
};
const listeners = new Set<() => void>();
const banners = new Map<string, () => boolean>();

/** Register a banner that can host a terminal while it is visible. */
export const registerTerminalBanner = (
	id: string,
	isVisible: () => boolean,
) => {
	banners.set(id, isVisible);
	return () => {
		banners.delete(id);
	};
};

/** Connect directly to a visible banner without arming the drag gesture. */
export const connectBannerTerminal = (workspace: Workspace): boolean => {
	for (const [ownerId, isVisible] of banners) {
		if (!isVisible()) continue;
		updateConnector({
			ownerId,
			workspace,
			armed: false,
			origin: null,
			pointer: null,
		});
		return true;
	}
	return false;
};

export const updateConnector = (patch: Partial<Connector>) => {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
};
export const resetConnector = () =>
	updateConnector({
		armed: false,
		ownerId: null,
		workspace: null,
		origin: null,
		pointer: null,
	});
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
export const useTerminalConnector = () =>
	useSyncExternalStore(subscribe, () => state);
