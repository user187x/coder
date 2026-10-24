import { API } from "./api";
import type {
	GlobalLockdownState,
	UpdateGlobalLockdownRequest,
} from "./typesGenerated";

/** Deployment-wide workspace access control, authenticated by the Coder client. */
export const GlobalLockdownAPI = {
	get: async (): Promise<GlobalLockdownState> => {
		const response = await API.getAxiosInstance().get<GlobalLockdownState>(
			"/api/v2/global-lockdown",
		);
		return response.data;
	},
	set: async (
		request: UpdateGlobalLockdownRequest,
	): Promise<GlobalLockdownState> => {
		const response = await API.getAxiosInstance().post<GlobalLockdownState>(
			"/api/v2/global-lockdown",
			request,
		);
		return response.data;
	},
};
