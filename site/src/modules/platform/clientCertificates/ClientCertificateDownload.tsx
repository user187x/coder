import { DownloadIcon } from "lucide-react";
import type { CertificateDownload } from "#/api/clientCertificates";
import { Button } from "#/components/Button/Button";

/** Saves the one-time encrypted credential without storing it in browser storage. */
export const saveClientCertificate = (credential: CertificateDownload) => {
	const bytes = Uint8Array.from(atob(credential.pkcs12), (value) =>
		value.charCodeAt(0),
	);
	const url = URL.createObjectURL(
		new Blob([bytes], { type: "application/x-pkcs12" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = credential.filename;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const ClientCertificateDownload = ({
	credential,
}: {
	credential: CertificateDownload;
}) => (
	<div className="space-y-3 rounded-lg border border-solid p-4">
		<p className="text-sm">
			Your device certificate is ready. Save it before leaving this page.
			Install the .p12 file on Android or your computer using the download
			password you chose.
		</p>
		<p className="break-all text-xs text-content-secondary">
			{credential.subject}
		</p>
		<Button onClick={() => saveClientCertificate(credential)}>
			<DownloadIcon /> Download certificate
		</Button>
	</div>
);
