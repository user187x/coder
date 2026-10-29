import {
	getBrowserCertificateStatus,
	importBrowserCertificate,
} from "#/api/browserCertificate";

export const browserCertificateStatus = (baseUrl: string) => ({
	queryKey: ["browser-certificate", baseUrl],
	queryFn: () => getBrowserCertificateStatus(baseUrl),
	gcTime: 0,
	retry: false,
});

export const importWorkspaceBrowserCertificate = (
	baseUrl: string,
	readInput: () => { csrf: string; file: File | undefined; password: string },
) => ({
	// Credentials stay in the mounted form, not in mutation variables or cache.
	mutationFn: () => {
		const { csrf, file, password } = readInput();
		return importBrowserCertificate(baseUrl, csrf, file, password);
	},
	gcTime: 0,
});
