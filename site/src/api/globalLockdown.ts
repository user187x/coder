import { API } from "./api";
import type {
	ConfigureGlobalControlPINRequest,
	GlobalControlPINRequest,
	GlobalControlStatus,
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
		token?: string,
	): Promise<GlobalLockdownState> => {
		const response = await API.getAxiosInstance().post<GlobalLockdownState>(
			"/api/v2/global-lockdown",
			request,
			{ headers: { "X-Coder-Global-Control-Token": token } },
		);
		return response.data;
	},
};

export const GlobalControlsAPI = {
	get: async () =>
		(
			await API.getAxiosInstance().get<GlobalControlStatus>(
				"/api/v2/global-lockdown/controls",
			)
		).data,
	unlock: async (request: GlobalControlPINRequest) =>
		(
			await API.getAxiosInstance().post<GlobalControlStatus>(
				"/api/v2/global-lockdown/controls/unlock",
				request,
			)
		).data,
	configure: async (
		request: ConfigureGlobalControlPINRequest & {
			token?: string;
		},
	) => {
		const { token, ...body } = request;
		return (
			await API.getAxiosInstance().put<GlobalControlStatus>(
				"/api/v2/global-lockdown/controls",
				body,
				{
					headers: { "X-Coder-Global-Control-Token": token },
				},
			)
		).data;
	},
	close: async () =>
		(
			await API.getAxiosInstance().post<GlobalControlStatus>(
				"/api/v2/global-lockdown/controls/close",
			)
		).data,
};
