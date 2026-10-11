import { cn } from "cn";
import { useId, useState } from "react";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
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
import {
	checkPkcs12Password,
	inspectPkcs12,
	type Pkcs12Certificate,
	Pkcs12Error,
	type Pkcs12Info,
	pkcs12Certificates,
	sha256Hex,
} from "#/utils/pkcs12";

/** base64 of this fits Coder's 24 KiB limit for one secret value. */
const MAX_BYTES = 18 * 1024;

export type PreparedCertificate = {
	base64: string;
	sha: string;
	details: Pkcs12Certificate | null;
	file: { file: File; bytes: Uint8Array<ArrayBuffer> };
	/** Then use its private key as the user's SSH key (UseAsSSHKeyDialog). */
	useAsSSHKey: boolean;
};

type Fact = {
	label: string;
	value: string;
	tone?: "ok" | "warn" | "error";
};

type Analysis = {
	file: File;
	bytes: Uint8Array<ArrayBuffer>;
	info: Pkcs12Info;
	sha: string;
	base64: string;
};

const toBase64 = (bytes: Uint8Array<ArrayBuffer>) => {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
};

const daysLeft = (date: Date) =>
	Math.floor((date.getTime() - Date.now()) / 86_400_000);

type CertificateUploadDialogProps = {
	username: string;
	replacing: boolean;
	saving: boolean;
	onClose: () => void;
	onSave: (prepared: PreparedCertificate) => void;
};

/**
 * Picks a .p12 / .pfx file and checks it in the browser: PKCS#12 structure,
 * protection, and (with the optional password, which is never sent) who the
 * certificate is for and when it expires.
 */
export const CertificateUploadDialog: React.FC<
	CertificateUploadDialogProps
> = ({ username, replacing, saving, onClose, onSave }) => {
	const id = useId();
	const [analysis, setAnalysis] = useState<Analysis | null>(null);
	const [password, setPassword] = useState("");
	const [facts, setFacts] = useState<Fact[]>([]);
	const [details, setDetails] = useState<Pkcs12Certificate | null>(null);
	const [useAsSSHKey, setUseAsSSHKey] = useState(false);

	const describe = async (current: Analysis, pw: string) => {
		const { info } = current;
		const out: Fact[] = [
			{
				label: "File",
				value: `PKCS#12, ${(info.size / 1024).toFixed(1)} KB, SHA-256 ${current.sha.slice(0, 16)}…`,
				tone: "ok",
			},
			{
				label: "Private key",
				value: info.hasKey
					? "included"
					: "not visible (encrypted, or certificate only)",
			},
		];
		const legacy = info.encryption.some((e) => /legacy/.test(e));
		out.push({
			label: "Protection",
			value: `${info.encryption.join(", ") || "none"}${info.mac ? `; integrity ${info.mac}` : ""}`,
			tone: legacy ? "warn" : "ok",
		});
		if (legacy) {
			out.push({
				label: "",
				value:
					"Legacy encryption: consider re-exporting with AES (e.g. openssl pkcs12 -export without -legacy).",
				tone: "warn",
			});
		}
		let leaf: Pkcs12Certificate | null = null;
		if (pw || info.mac) {
			try {
				const ok = await checkPkcs12Password(current.bytes, pw);
				if (pw || ok) {
					out.push({
						label: "Password",
						value:
							ok === null
								? "cannot be checked here (PBMAC1)"
								: ok
									? "correct"
									: "does not match this file",
						tone: ok === false ? "error" : ok ? "ok" : undefined,
					});
				}
				if (ok) {
					const list = await pkcs12Certificates(current.bytes, pw).catch(
						() => null,
					);
					if (Array.isArray(list) && list[0]) {
						leaf = list[0];
						out.push({ label: "Subject", value: leaf.subject });
						out.push({ label: "Issued by", value: leaf.issuer });
						if (leaf.notAfter) {
							const left = daysLeft(leaf.notAfter);
							out.push({
								label: "Valid until",
								value: `${leaf.notAfter.toLocaleDateString("en-US", { dateStyle: "medium" })}${left < 0 ? " (expired)" : left <= 30 ? ` (${left} days left)` : ""}`,
								tone: left < 0 ? "error" : left <= 30 ? "warn" : "ok",
							});
						}
					} else if (list && !Array.isArray(list)) {
						out.push({
							label: "Details",
							value: `not readable here (${list.legacy})`,
						});
					}
				}
			} catch {
				// The details are optional.
			}
		}
		if (!pw) {
			out.push({
				label: "",
				value:
					"Enter the password to check it and see who the certificate is for (optional).",
			});
		}
		setDetails(leaf);
		setFacts(out);
	};

	const pick = async (file: File) => {
		setAnalysis(null);
		setDetails(null);
		const bytes = new Uint8Array(await file.arrayBuffer());
		try {
			if (bytes.length > MAX_BYTES) {
				throw new Pkcs12Error(
					`The file is ${(bytes.length / 1024).toFixed(1)} KB; the limit is 18 KB.`,
				);
			}
			const next: Analysis = {
				file,
				bytes,
				info: inspectPkcs12(bytes),
				sha: await sha256Hex(bytes),
				base64: toBase64(bytes),
			};
			setAnalysis(next);
			await describe(next, password);
		} catch (error) {
			setFacts([
				{
					label: "File",
					value:
						error instanceof Pkcs12Error
							? error.message
							: "This file cannot be read.",
					tone: "error",
				},
			]);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) {
					setPassword("");
					onClose();
				}
			}}
		>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{replacing ? "Replace" : "Upload"} ~/.cert/{username}.p12
					</DialogTitle>
					<DialogDescription>
						PKCS#12 (.p12 / .pfx), up to 18 KB.
					</DialogDescription>
				</DialogHeader>
				<FileUpload
					isUploading={false}
					file={analysis?.file}
					extensions={["p12", "pfx"]}
					title="Choose a .p12 / .pfx file or drop it here"
					removeLabel="Choose another file"
					onUpload={(file) => {
						void pick(file);
					}}
					onUnsupportedFile={(file) =>
						setFacts([
							{
								label: "File",
								value: `${file.name}: a .p12 or .pfx file is expected.`,
								tone: "error",
							},
						])
					}
					onRemove={() => {
						setAnalysis(null);
						setFacts([]);
					}}
				/>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-password`}>
						Password{" "}
						<span className="font-normal text-content-secondary">
							(optional, only to check the file)
						</span>
					</Label>
					<Input
						id={`${id}-password`}
						type="password"
						autoComplete="off"
						data-1p-ignore
						data-lpignore="true"
						spellCheck={false}
						value={password}
						onChange={(event) => {
							setPassword(event.target.value);
							if (analysis) {
								void describe(analysis, event.target.value);
							}
						}}
					/>
					<span className="text-xs text-content-secondary">
						Checked here in your browser. Never sent or stored.
					</span>
				</div>
				{facts.length > 0 && (
					<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
						{facts.map((fact, i) => (
							<div key={i} className="contents">
								<dt className="text-content-secondary">{fact.label}</dt>
								<dd
									className={cn(
										"m-0",
										fact.tone === "error" && "text-content-destructive",
										fact.tone === "warn" && "text-content-warning",
										fact.tone === "ok" && "text-content-success",
									)}
								>
									{fact.value}
								</dd>
							</div>
						))}
					</dl>
				)}
				{analysis?.info.hasKey !== false && (
					<div className="flex items-start gap-2">
						<Checkbox
							id={`${id}-ssh`}
							checked={useAsSSHKey}
							onCheckedChange={(checked) => setUseAsSSHKey(checked === true)}
						/>
						<Label htmlFor={`${id}-ssh`} className="font-normal leading-snug">
							Also use its private key as my SSH key{" "}
							<span className="text-content-secondary">
								(next, replacing the current one; asks for the password if the
								file has one)
							</span>
						</Label>
					</div>
				)}
				<DialogFooter className="gap-2">
					<Button variant="outline" disabled={saving} onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!analysis || saving}
						onClick={() => {
							if (analysis) {
								onSave({
									base64: analysis.base64,
									sha: analysis.sha,
									details,
									file: { file: analysis.file, bytes: analysis.bytes },
									useAsSSHKey,
								});
								setPassword("");
							}
						}}
					>
						<Spinner loading={saving} />
						{replacing ? "Replace" : "Upload"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
