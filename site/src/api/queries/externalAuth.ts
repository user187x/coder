import { API } from "#/api/api";

export const externalAuthProvider = (providerId: string) => {
	return {
		queryKey: ["external-auth", providerId],
		queryFn: () => API.getExternalAuthProvider(providerId),
	};
};

export const externalAuthDevice = (providerId: string) => {
	return {
		queryFn: () => API.getExternalAuthDevice(providerId),
		queryKey: ["external-auth", providerId, "device"],
	};
};

export const exchangeExternalAuthDevice = (
	providerId: string,
	deviceCode: string,
) => {
	return {
		queryFn: () =>
			API.exchangeExternalAuthDevice(providerId, {
				device_code: deviceCode,
			}),
		queryKey: ["external-auth", providerId, "device", deviceCode],
	};
};
