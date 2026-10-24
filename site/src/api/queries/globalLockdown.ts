import type { QueryClient } from "react-query";
import { GlobalLockdownAPI } from "#/api/globalLockdown";

export const globalLockdownKey = ["global-lockdown"] as const;

export const globalLockdown = () => ({
	queryKey: globalLockdownKey,
	queryFn: GlobalLockdownAPI.get,
	refetchInterval: 2_000,
	retry: false,
});

export const setGlobalLockdown = (queryClient: QueryClient) => ({
	mutationFn: GlobalLockdownAPI.set,
	onSuccess: (state: Awaited<ReturnType<typeof GlobalLockdownAPI.get>>) => {
		queryClient.setQueryData(globalLockdownKey, state);
		void queryClient.invalidateQueries({ queryKey: globalLockdownKey });
	},
});
