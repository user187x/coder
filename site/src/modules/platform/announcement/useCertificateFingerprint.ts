import { useQuery } from "react-query";
import { userSecrets } from "#/api/queries/userSecrets";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import {
	parseCertificateDescription,
	parseCertificatePath,
} from "#/pages/UserSettingsPage/CertificatesPage/certificateSecrets";
import { formatFingerprint } from "#/utils/pkcs12";

/** The signed-in user's certificate's fingerprints, "AB:CD:…" each. */
export type CertificateFingerprints = {
	/** SHA-256 of the certificate (x509, DER). */
	sha256?: string;
	/** MD5 of it. */
	md5?: string;
};

/** A fingerprint Settings › Certificates did not record (an older upload, or one without its password). */
export const NOT_RECORDED =
	"not recorded (upload your certificate again, with its password, in Settings › Certificates)";

/**
 * The signed-in user's certificate fingerprints, from what Settings >
 * Certificates recorded with their certificate. `undefined` while loading;
 * `null` when they have none (or it cannot be told).
 */
export const useCertificateFingerprint = ():
	| CertificateFingerprints
	| null
	| undefined => {
	const { user } = useAuthContext();
	const query = useQuery({
		...userSecrets(user?.id ?? ""),
		enabled: Boolean(user),
		staleTime: 60_000,
		retry: false,
	});
	if (!user || query.isLoading) {
		return undefined;
	}
	if (query.isError) {
		return null;
	}
	const certificates = (query.data ?? [])
		.filter((secret) => parseCertificatePath(secret.file_path))
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
	const mine =
		certificates.find(
			(secret) => parseCertificatePath(secret.file_path) === user.username,
		) ?? certificates[0];
	if (!mine) {
		return null;
	}
	const { x509, md5 } = parseCertificateDescription(mine.description);
	return {
		sha256: x509 ? formatFingerprint(x509) : undefined,
		md5: md5 ? formatFingerprint(md5) : undefined,
	};
};
