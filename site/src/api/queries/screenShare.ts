import { ScreenShareAPI } from "../screenShare";
export const screenShareKey = ["platform", "screen-share"] as const;
export const screenShares = () => ({
	queryKey: screenShareKey,
	queryFn: ScreenShareAPI.state,
	refetchInterval: 2000,
	retry: false,
});
export const updateScreenShare = () => ({ mutationFn: ScreenShareAPI.update });
