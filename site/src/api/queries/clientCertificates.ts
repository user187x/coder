import type { QueryClient } from "react-query";
import {
	type CertificateDownload,
	type CertificateRequest,
	ClientCertificatesAPI,
} from "../clientCertificates";

const clientCertificatesKey = (org: string, user: string) =>
	["client-certificates", org, user] as const;
export const clientCertificateCapabilities = () => ({
	queryKey: ["client-certificate-capabilities"],
	queryFn: ClientCertificatesAPI.capabilities,
	retry: false,
});
export const clientCertificates = (org: string, user: string) => ({
	queryKey: clientCertificatesKey(org, user),
	queryFn: () => ClientCertificatesAPI.list(org, user),
	enabled: Boolean(org && user),
});
export const issueClientCertificate = (
	client: QueryClient,
	org: string,
	user: string,
) => ({
	mutationFn: (request: CertificateRequest) =>
		ClientCertificatesAPI.issue(org, user, request),
	gcTime: 0,
	onSettled: () =>
		client.invalidateQueries({ queryKey: clientCertificatesKey(org, user) }),
});
export const revokeClientCertificate = (
	client: QueryClient,
	org: string,
	user: string,
) => ({
	mutationFn: (id: string) => ClientCertificatesAPI.revoke(org, user, id),
	onSettled: () =>
		client.invalidateQueries({ queryKey: clientCertificatesKey(org, user) }),
});
export const issueCertificateForUser = (client: QueryClient) => ({
	mutationFn: ({
		organization,
		user,
		request,
	}: {
		organization: string;
		user: string;
		request: CertificateRequest;
	}) => ClientCertificatesAPI.issue(organization, user, request),
	gcTime: 0,
	onSettled: (
		_data: CertificateDownload | undefined,
		_error: Error | null,
		{ organization, user }: { organization: string; user: string },
	) =>
		client.invalidateQueries({
			queryKey: clientCertificatesKey(organization, user),
		}),
});
