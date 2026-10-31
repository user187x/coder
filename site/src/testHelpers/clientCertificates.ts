import type {
	CertificateDownload,
	ClientCertificate,
} from "#/api/clientCertificates";

export const MockClientCertificate: ClientCertificate = {
	id: "f688a750-56e6-40f0-9b02-857ebca39579",
	label: "Android phone",
	subject: "CN=TestUser,OU=f688a750-56e6-40f0-9b02-857ebca39579",
	serial: "45c2",
	fingerprint:
		"3d954c9e1de00a89279da3c27a2b273b6416aa695b74a18c0a7bd8f8671925ed",
	expires_at: "2027-01-28T12:00:00Z",
	created_at: "2026-10-30T12:00:00Z",
	status: "active",
	revoked_at: null,
};
export const MockCertificateDownload: CertificateDownload = {
	id: MockClientCertificate.id,
	subject: MockClientCertificate.subject,
	expires_at: MockClientCertificate.expires_at,
	filename: "TestUser-device.p12",
	pkcs12: btoa("test-only-encrypted-credential"),
};
