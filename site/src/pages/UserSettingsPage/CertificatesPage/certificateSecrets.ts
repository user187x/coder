/**
 * How a certificate is kept as a Coder user secret. The value is the file,
 * base64-encoded (secret values are text); the file path is
 * ~/.cert/.<username>.p12.b64, which Coder's agent writes into the owner's
 * workspaces and the template's installer decodes to ~/.cert/<username>.p12.
 * The description carries what the page shows (never secret): subject, expiry
 * and fingerprint.
 */

const PATH_RE = /^~\/\.cert\/\.([A-Za-z0-9_@+-][A-Za-z0-9._@+-]*)\.p12\.b64$/;

export const certificateSecretName = (username: string) =>
	`certificate-${username}`;

export const certificatePath = (name: string) => `~/.cert/.${name}.p12.b64`;

/** The certificate's name from a secret's file path, or null for other secrets. */
export const parseCertificatePath = (filePath: string): string | null =>
	PATH_RE.exec(filePath)?.[1] ?? null;

export type CertificateFacts = {
	sha: string;
	subject?: string;
	notAfter: Date | null;
};

export const describeCertificate = (
	username: string,
	facts: CertificateFacts,
): string => {
	const parts = [`PKCS#12 certificate, installed as ~/.cert/${username}.p12`];
	if (facts.subject) {
		parts.push(`subject ${facts.subject}`);
	}
	if (facts.notAfter && !Number.isNaN(facts.notAfter.getTime())) {
		parts.push(`expires ${facts.notAfter.toISOString().slice(0, 10)}`);
	}
	if (facts.sha) {
		parts.push(`sha256 ${facts.sha.slice(0, 16)}`);
	}
	return parts.join(" · ");
};

export const parseCertificateDescription = (description: string) => ({
	subject: /subject ([^·]+?)(?: ·|$)/.exec(description)?.[1],
	expires: /expires (\d{4}-\d\d-\d\d)/.exec(description)?.[1],
	sha: /sha256 ([0-9a-f]{16})/.exec(description)?.[1],
});
