import type { BrowserCertificateStatus } from "#/api/browserCertificate";

export const MockBrowserCertificate: BrowserCertificateStatus = {
	state: "ready",
	message: "Your certificate is installed.",
	csrf: "story-csrf",
	certificate: {
		thumbprint:
			"47:91:CE:18:31:2B:F1:00:2F:56:5D:BC:81:2A:5E:DF:3C:4A:83:B7:AA:06:59:81:BC:99:36:42:AE:2D:31:68",
		expires_at: "2030-10-30T12:00:00+00:00",
		subject: "CN=Workspace Browser, O=Example",
	},
};
