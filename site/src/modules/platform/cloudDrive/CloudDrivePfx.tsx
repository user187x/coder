import { ShieldCheckIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "react-query";
import { API } from "#/api/api";
import { getErrorMessage } from "#/api/errors";
import { userSecrets } from "#/api/queries/userSecrets";
import { Alert } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { FileUpload } from "#/components/FileUpload/FileUpload";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { parseCertificatePath } from "#/pages/UserSettingsPage/CertificatesPage/certificateSecrets";
import {
	certificatePem,
	Pkcs12Error,
	pkcs12UserCertificate,
} from "#/utils/pkcs12";

type Bytes = Uint8Array<ArrayBuffer>;

/** Where the file comes from: the certificate kept in Account > Certificates, or one chosen now. */
type Source = { kind: "account"; name: string } | { kind: "file"; file: File };

export type PfxCertificate = { pem: string; subject: string };

type Step = "assure" | "choose" | "password";

/**
 * The Cloud Drive's encryption with "PFX": the public certificate read out of the user's PKCS#12 file, here in the
 * browser, and put into the form for them. First what happens to the password (it never leaves this page); then the
 * file - the one kept in Account > Certificates when there is one (Coder hands it back to its owner only, still
 * encrypted), else one they choose - and its password. The password lives in this dialog's state while it is open,
 * is never sent, stored, logged or put in a URL, and is cleared as soon as the certificate is out (or the dialog
 * closes); the file's bytes are wiped too.
 */
export const CloudDrivePfxDialog: React.FC<{
	onCertificate: (cert: PfxCertificate) => void;
	onCancel: () => void;
}> = ({ onCertificate, onCancel }) => {
	const id = useId();
	const [step, setStep] = useState<Step>("assure");
	const [source, setSource] = useState<Source>();
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [working, setWorking] = useState(false);
	const bytes = useRef<Bytes | null>(null);
	const secretsQuery = useQuery({
		...userSecrets("me"),
		enabled: step !== "assure",
	});
	// The newest certificate: the one installed in the workspaces (Account > Certificates moves an older name's to
	// the current username's).
	const stored = (secretsQuery.data ?? [])
		.filter((s) => parseCertificatePath(s.file_path) !== null)
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

	const wipe = () => {
		bytes.current?.fill(0);
		bytes.current = null;
	};
	useEffect(() => () => wipe(), []);

	const close = () => {
		setPassword("");
		wipe();
		onCancel();
	};

	// After the assurance: the Account's certificate when there is one, else a file to choose.
	const proceed = () => {
		setError("");
		setStep("choose");
	};
	useEffect(() => {
		if (step !== "choose" || secretsQuery.isLoading || source) {
			return;
		}
		if (stored) {
			setSource({ kind: "account", name: stored.name });
			setStep("password");
		}
	}, [step, secretsQuery.isLoading, stored, source]);

	const read = async () => {
		if (!source) {
			return;
		}
		setWorking(true);
		setError("");
		try {
			if (!bytes.current) {
				bytes.current =
					source.kind === "account"
						? Uint8Array.from(
								atob(
									(await API.getUserCertificateFile("me", source.name)).base64,
								),
								(c) => c.charCodeAt(0),
							)
						: new Uint8Array(await source.file.arrayBuffer());
			}
			const cert = await pkcs12UserCertificate(bytes.current, password);
			setPassword("");
			wipe();
			onCertificate({ pem: certificatePem(cert.der), subject: cert.subject });
		} catch (e) {
			setError(
				e instanceof Pkcs12Error
					? e.message
					: getErrorMessage(e, "The certificate could not be read."),
			);
		} finally {
			setWorking(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !working) {
					close();
				}
			}}
		>
			<DialogContent className="max-w-xl" data-testid="cloud-drive-pfx">
				{step === "assure" ? (
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<ShieldCheckIcon className="size-5 text-content-success" />
								Your PFX password stays with you
							</DialogTitle>
							<DialogDescription>
								Your PFX (PKCS#12) file is opened here, in your browser. Its
								password unlocks it in this page's memory only, just long enough
								to read out the public certificate, and is cleared right after.
							</DialogDescription>
						</DialogHeader>
						<ul
							className="m-0 flex flex-col gap-1.5 pl-5 text-sm"
							data-testid="cloud-drive-pfx-assurance"
						>
							<li>
								The password is never sent to the server, never saved, and never
								written to any log or history.
							</li>
							<li>
								No one else can see or recover it: not the server, not an
								administrator.
							</li>
							<li>
								Only the public certificate goes into the form. Your private key
								stays inside your file.
							</li>
						</ul>
						<DialogFooter className="gap-2">
							<Button variant="outline" onClick={close}>
								Cancel
							</Button>
							<Button onClick={proceed} data-testid="cloud-drive-pfx-continue">
								Continue
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Your certificate from your PFX</DialogTitle>
							<DialogDescription>
								{source?.kind === "account"
									? "The certificate you keep in Account › Certificates: enter its password to read out the public certificate."
									: "Choose your .pfx / .p12 file, then enter its password to read out the public certificate."}
							</DialogDescription>
						</DialogHeader>
						{step === "choose" && secretsQuery.isLoading && (
							<Spinner loading size="sm" />
						)}
						{(source?.kind === "file" ||
							(step === "choose" && !secretsQuery.isLoading && !stored)) && (
							<FileUpload
								isUploading={false}
								file={source?.kind === "file" ? source.file : undefined}
								extensions={["p12", "pfx"]}
								title="Choose your .pfx / .p12 file or drop it here"
								removeLabel="Choose another file"
								onUpload={(file) => {
									wipe();
									setError("");
									setSource({ kind: "file", file });
									setStep("password");
								}}
								onUnsupportedFile={(file) =>
									setError(`${file.name}: a .pfx or .p12 file is expected.`)
								}
								onRemove={() => {
									wipe();
									setSource(undefined);
									setPassword("");
									setStep("choose");
								}}
							/>
						)}
						{source?.kind === "account" && (
							<p
								className="m-0 text-sm text-content-secondary"
								data-testid="cloud-drive-pfx-account"
							>
								From Account › Certificates.{" "}
								<button
									type="button"
									className="cursor-pointer border-0 bg-transparent p-0 text-content-link underline"
									onClick={() => {
										wipe();
										setPassword("");
										setSource(undefined);
										setError("");
										setStep("choose");
									}}
								>
									Use another file
								</button>
							</p>
						)}
						{step === "password" && source && (
							<div className="flex flex-col gap-2">
								<Label htmlFor={`${id}-password`}>Certificate password</Label>
								<Input
									id={`${id}-password`}
									type="password"
									autoComplete="off"
									data-1p-ignore
									data-lpignore="true"
									data-bwignore
									spellCheck={false}
									autoFocus
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !working) {
											void read();
										}
									}}
									data-testid="cloud-drive-pfx-password"
								/>
								<span className="text-xs text-content-secondary">
									Used here, in your browser, and cleared once the certificate
									is out; never sent, saved or logged.
								</span>
							</div>
						)}
						{error && (
							<Alert severity="error" prominent>
								{error}
							</Alert>
						)}
						<DialogFooter className="gap-2">
							<Button variant="outline" disabled={working} onClick={close}>
								Cancel
							</Button>
							<Button
								disabled={step !== "password" || !source || working}
								onClick={() => {
									void read();
								}}
								data-testid="cloud-drive-pfx-read"
							>
								<Spinner loading={working} />
								Read the certificate
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
};
