import { PlatformAPI } from "#/api/platform";
export const backgroundsKey = ["platform", "backgrounds"] as const;
export const backgrounds = () => ({
	queryKey: backgroundsKey,
	queryFn: PlatformAPI.getBackgrounds,
});
