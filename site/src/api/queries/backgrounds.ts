import type { QueryClient } from "react-query";
import {
	type BackgroundSlot,
	type BackgroundsState,
	PlatformAPI,
} from "#/api/platform";
import { CONTROLLER } from "#/modules/platform/background/backgroundHtml";
export const backgroundsKey = ["platform", "backgrounds"] as const;
export const backgrounds = () => ({
	queryKey: backgroundsKey,
	queryFn: PlatformAPI.getBackgrounds,
});

export const backgroundHTML = (url: string | undefined) => ({
	queryKey: [...backgroundsKey, "html", url],
	enabled: Boolean(url),
	queryFn: async () =>
		url
			? (await PlatformAPI.getBackgroundHTML(url)).replace(CONTROLLER, "")
			: "",
});
export const saveBackground = (client: QueryClient, slot: BackgroundSlot) => ({
	mutationFn: (body: Parameters<typeof PlatformAPI.saveBackground>[1]) =>
		PlatformAPI.saveBackground(slot, body),
	onSuccess: async (
		result: Awaited<ReturnType<typeof PlatformAPI.saveBackground>>,
	) => {
		client.setQueryData<BackgroundsState>(backgroundsKey, (old) =>
			old
				? {
						...old,
						[slot]: result[slot]
							? {
									type: "",
									bytes: 0,
									updatedAt: null,
									updatedBy: null,
									...old[slot],
									...result[slot],
								}
							: null,
					}
				: old,
		);
		await client.invalidateQueries({ queryKey: backgroundsKey });
	},
});
export const resetBackground = (client: QueryClient, slot: BackgroundSlot) => ({
	mutationFn: () => PlatformAPI.resetBackground(slot),
	onSuccess: async () => {
		client.setQueryData<BackgroundsState>(backgroundsKey, (old) =>
			old ? { ...old, [slot]: null } : old,
		);
		await client.invalidateQueries({ queryKey: backgroundsKey });
	},
});
