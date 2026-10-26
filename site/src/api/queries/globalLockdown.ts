import type { QueryClient } from "react-query";
import { GlobalControlsAPI, GlobalLockdownAPI } from "#/api/globalLockdown";

export const globalLockdownKey = ["global-lockdown"] as const;

export const globalLockdown = () => ({
	queryKey: globalLockdownKey,
	queryFn: GlobalLockdownAPI.get,
	refetchInterval: 2_000,
	retry: false,
});

export const setGlobalLockdown = (
	queryClient: QueryClient,
	token?: string,
) => ({
	mutationFn: (request: Parameters<typeof GlobalLockdownAPI.set>[0]) =>
		token
			? GlobalLockdownAPI.set(request, token)
			: GlobalLockdownAPI.set(request),
	onSuccess: (state: Awaited<ReturnType<typeof GlobalLockdownAPI.get>>) => {
		queryClient.setQueryData(globalLockdownKey, state);
		void queryClient.invalidateQueries({ queryKey: globalLockdownKey });
	},
});

export const globalControlsKey = ["global-controls"] as const;
export const globalControls = () => ({
	queryKey: globalControlsKey,
	queryFn: GlobalControlsAPI.get,
	retry: false,
});
export const unlockGlobalControls = () => ({
	mutationFn: GlobalControlsAPI.unlock,
});
export const configureGlobalControls = (client: QueryClient) => ({
	mutationFn: GlobalControlsAPI.configure,
	onSuccess: () => client.invalidateQueries({ queryKey: globalControlsKey }),
});
export const closeGlobalControls = () => ({
	mutationFn: GlobalControlsAPI.close,
});
