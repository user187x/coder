import axios from "axios";

export type BrowserCertificateStatus = {
	state: "checking" | "missing" | "locked" | "ready" | "error";
	message: string;
	csrf: string;
};

const certificateClient = axios.create();

export const getBrowserCertificateStatus = async (baseUrl: string) => {
	const response = await certificateClient.get<BrowserCertificateStatus>(
		`${baseUrl}status`,
	);
	return response.data;
};

export const importBrowserCertificate = async (
	baseUrl: string,
	csrf: string,
	file: File | undefined,
	password: string,
) => {
	let certificate = "";
	if (file) {
		if (file.size > 1048576) {
			throw new Error("Choose a certificate smaller than 1 MiB.");
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		certificate = btoa(binary);
	}
	const response = await certificateClient.post<{ message: string }>(
		`${baseUrl}certificate`,
		{ certificate, password },
		{ headers: { "X-Browser-CSRF": csrf } },
	);
	return response.data;
};
