import { platformRequest } from "./platform";

export type ClientCertificate = {
	id: string;
	label: string;
	subject: string;
	serial: string;
	fingerprint: string;
	expires_at: string;
	created_at: string;
	status: "pending" | "active" | "revoked";
	revoked_at: string | null;
};
export type CertificateRequest = {
	label: string;
	password: string;
	days: number;
};
export type CertificateDownload = {
	id: string;
	filename: string;
	pkcs12: string;
	subject: string;
	expires_at: string;
};
const path = (org: string, user: string) =>
	`${platformRequest.base}/api/organizations/${encodeURIComponent(org)}/users/${encodeURIComponent(user)}/client-certificates`;
export const ClientCertificatesAPI = {
	capabilities: () =>
		platformRequest.get<{ enabled: boolean }>(
			`${platformRequest.base}/api/client-certificates`,
		),
	list: (org: string, user: string) =>
		platformRequest.get<{ certificates: ClientCertificate[] }>(path(org, user)),
	issue: (org: string, user: string, request: CertificateRequest) =>
		platformRequest.post<CertificateDownload>(path(org, user), {
			action: "issue",
			...request,
		}),
	revoke: (org: string, user: string, id: string) =>
		platformRequest.post<{ revoked: boolean }>(path(org, user), {
			action: "revoke",
			id,
		}),
};
