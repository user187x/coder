import { API } from "#/api/api";

export const licensesKey = ["licenses"] as const;

export const licenses = () => ({
	queryKey: licensesKey,
	queryFn: () => API.getLicenses(),
});
