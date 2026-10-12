import { useQuery } from "react-query";
import { userSecrets } from "#/api/queries/userSecrets";
import { useAuthContext } from "#/contexts/auth/AuthProvider";
import {
	parseCertificateDescription,
	parseCertificatePath,
} from "#/pages/UserSettingsPage/CertificatesPage/certificateSecrets";
import { formatFingerprint } from "#/utils/pkcs12";

/**
 * The signed-in user's certificate fingerprint (x509, SHA-256 of the
 * certificate, as "AB:CD:…"), from what Settings > Certificates recorded with
 * their certificate. `undefined` while loading; a sentence when there is none.
 */
export const useCertificateFingerprint = (): string | undefined => {
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
		return "unavailable";
	}
	const certificates = (query.data ?? [])
		.filter((secret) => parseCertificatePath(secret.file_path))
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
	const mine =
		certificates.find(
			(secret) => parseCertificatePath(secret.file_path) === user.username,
		) ?? certificates[0];
	if (!mine) {
		return "no certificate on file (Settings › Certificates)";
	}
	const x509 = parseCertificateDescription(mine.description).x509;
	return x509
		? formatFingerprint(x509)
		: "not recorded (upload your certificate again, with its password, in Settings › Certificates)";
};
