import type { QueryClient } from "react-query";
import { PlatformAPI, type QuickMenuSettings } from "#/api/platform";
export const quickMenuKey = ["platform", "quick-menu"] as const;
export const quickMenu = () => ({
	queryKey: quickMenuKey,
	queryFn: PlatformAPI.getQuickMenu,
	staleTime: 60_000,
	retry: false,
});
export const saveQuickMenu = (client: QueryClient) => ({
	mutationFn: ({
		items,
		shortcut,
		enabled,
	}: {
		items: string[];
		shortcut: string;
		enabled: boolean;
	}) => PlatformAPI.saveQuickMenu(items, shortcut, enabled),
	onSuccess: (data: QuickMenuSettings) =>
		client.setQueryData(quickMenuKey, data),
});
export const resetQuickMenu = (client: QueryClient) => ({
	mutationFn: PlatformAPI.resetQuickMenu,
	onSuccess: (data: QuickMenuSettings) =>
		client.setQueryData(quickMenuKey, data),
});
