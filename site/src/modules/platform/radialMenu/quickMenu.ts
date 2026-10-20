import { useQuery } from "react-query";
import { PlatformAPI } from "#/api/platform";

export const quickMenuKey = ["platform", "quick-menu"] as const;

/** The wedges admins arranged for the quick access wheel (Admin Settings > Quick Menu); items null: the default. */
export const useQuickMenu = () =>
	useQuery({
		queryKey: quickMenuKey,
		queryFn: PlatformAPI.getQuickMenu,
		staleTime: 60_000,
		retry: false,
	});
