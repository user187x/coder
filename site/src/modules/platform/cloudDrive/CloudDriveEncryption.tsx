import {
	DownloadIcon,
	LockIcon,
	LockOpenIcon,
	RotateCcwIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	type CloudDriveRecoveryKit,
	type CloudDriveEncryption as Encryption,
	PlatformAPI,
} from "#/api/platform";
import {
	cloudDriveEncryption,
	invalidateCloudDrive,
} from "#/api/queries/platform";
import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { RadioGroup, RadioGroupItem } from "#/components/RadioGroup/RadioGroup";
import { Spinner } from "#/components/Spinner/Spinner";

/** The recovery kit saved as a file (a JSON document the owner keeps). */
export const downloadKit = (kit: CloudDriveRecoveryKit, fileName: string) => {
	const url = URL.createObjectURL(
		new Blob([`${JSON.stringify(kit, null, 2)}\n`], {
			type: "application/json",
		}),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

type Prepared = { keyId: string; kit: CloudDriveRecoveryKit; fileName: string };

/**
 * The Cloud Drive window's Encryption: the owner's files on S3 encrypted with a key of their own (S3's SSE-C - the
 * storage keeps no copy of it), wrapped with their password or for their certificate in a recovery kit they must
 * download before it is turned on. Every connected workspace reads and writes it as before (and shows a lock); it
 * changes only while none of their workspaces has the drive.
 */
export const CloudDriveEncryption: React.FC = () => {
	const query = useQuery(cloudDriveEncryption());
	const enc = query.data;
	if (query.isLoading) {
		return (
			<p className="m-0 px-6 py-8 text-sm text-content-secondary">Reading…</p>
		);
	}
	if (!enc) {
		return (
			<p
				role="alert"
				className="m-0 px-6 py-8 text-sm text-content-destructive"
			>
				{getErrorMessage(query.error, "The encryption could not be read.")}
			</p>
		);
	}
	return (
		<div
			className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-6 py-5"
			data-testid="cloud-drive-encryption"
		>
			{enc.state === "encrypting" || enc.state === "decrypting" ? (
				<Progress enc={enc} />
			) : enc.state === "on" ? (
				<TurnOff enc={enc} />
			) : (
				<TurnOn enc={enc} />
			)}
		</div>
	);
};

const RunningWorkspaces: React.FC<{ enc: Encryption; doing: string }> = ({
	enc,
	doing,
}) =>
	enc.running.length > 0 ? (
		<Alert severity="warning">
			<AlertTitle>Stop your workspaces first</AlertTitle>
			<AlertDescription>
				{enc.running.length === 1
					? "One of your workspaces has"
					: `${enc.running.length} of your workspaces have`}{" "}
				your Cloud Drive now: it is {doing} while none of them has it. Stop
				them, then come back here.
			</AlertDescription>
		</Alert>
	) : null;

const TurnOn: React.FC<{ enc: Encryption }> = ({ enc }) => {
	const queryClient = useQueryClient();
	const [method, setMethod] = useState<"password" | "pki">("password");
	const [password, setPassword] = useState("");
	const [again, setAgain] = useState("");
	const [certificate, setCertificate] = useState("");
	const [prepared, setPrepared] = useState<Prepared>();
	const [downloaded, setDownloaded] = useState(false);
	const [kept, setKept] = useState(false);
	const prepare = useMutation({
		mutationFn: () =>
			PlatformAPI.prepareCloudDriveEncryption(
				method === "password" ? { method, password } : { method, certificate },
			),
		onSuccess: (out) => {
			setPrepared(out);
			setPassword("");
			setAgain("");
			downloadKit(out.kit, out.fileName);
			setDownloaded(true);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "The key could not be made.")),
	});
	const enable = useMutation({
		mutationFn: (keyId: string) =>
			PlatformAPI.enableCloudDriveEncryption(keyId),
		onSuccess: () => {
			toast.success("Encrypting your Cloud Drive…");
			void invalidateCloudDrive(queryClient);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "Encryption could not be turned on.")),
	});

	if (!enc.available || enc.source) {
		return (
			<Alert severity="info">
				<AlertTitle>Encryption is not available</AlertTitle>
				<AlertDescription>
					{enc.source
						? "Your Cloud Drive is a folder of one of your workspaces now: encryption is for its S3 storage."
						: enc.unavailable}
				</AlertDescription>
			</Alert>
		);
	}

	if (prepared) {
		return (
			<div className="flex flex-col gap-4">
				<p className="m-0 text-sm">
					Your recovery kit,{" "}
					<span className="font-mono text-xs">{prepared.fileName}</span>, was
					downloaded: where your files are, how much they hold, and your key
					wrapped with your {method === "password" ? "password" : "certificate"}
					. With it you (or an admin) can reach your files without this
					deployment.
				</p>
				<div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							downloadKit(prepared.kit, prepared.fileName);
							setDownloaded(true);
						}}
					>
						<DownloadIcon />
						Download it again
					</Button>
				</div>
				<div className="flex items-start gap-2">
					<Checkbox
						id="cloud-drive-kit-kept"
						checked={kept}
						disabled={!downloaded}
						onCheckedChange={(v) => setKept(v === true)}
					/>
					<Label htmlFor="cloud-drive-kit-kept" className="text-sm font-normal">
						I keep the recovery kit somewhere safe, apart from my{" "}
						{method === "password" ? "password" : "private key"}.
					</Label>
				</div>
				<RunningWorkspaces enc={enc} doing="encrypted" />
				<div className="flex gap-2">
					<Button
						disabled={
							!downloaded || !kept || enc.running.length > 0 || enable.isPending
						}
						onClick={() => enable.mutate(prepared.keyId)}
					>
						<Spinner loading={enable.isPending}>
							<LockIcon />
						</Spinner>
						Encrypt my Cloud Drive
					</Button>
					<Button variant="outline" onClick={() => setPrepared(undefined)}>
						Start over
					</Button>
				</div>
			</div>
		);
	}

	const tooShort = password.length < enc.passwordMin;
	const mismatch = again !== password;
	const submit = (e: FormEvent) => {
		e.preventDefault();
		prepare.mutate();
	};
	return (
		<form className="flex flex-col gap-4" onSubmit={submit}>
			<p className="m-0 text-sm text-content-secondary">
				Encrypt your Cloud Drive with a key of your own: the storage keeps no
				copy of it, and only you (with your password or certificate) and the
				deployment's admins can open your files. Your workspaces read and write
				them as before, and show a lock.
			</p>
			<RadioGroup
				value={method}
				onValueChange={(v) => setMethod(v as "password" | "pki")}
				className="flex gap-6"
				aria-label="How the recovery kit's key is wrapped"
			>
				<div className="flex items-center gap-2">
					<RadioGroupItem value="password" id="cd-enc-password" />
					<Label htmlFor="cd-enc-password">A password</Label>
				</div>
				<div className="flex items-center gap-2">
					<RadioGroupItem value="pki" id="cd-enc-pki" />
					<Label htmlFor="cd-enc-pki">My certificate (PKI)</Label>
				</div>
			</RadioGroup>
			{method === "password" ? (
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="flex flex-col gap-1">
						<Label htmlFor="cd-enc-pw">Password</Label>
						<Input
							id="cd-enc-pw"
							type="password"
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
						<span className="text-xs text-content-secondary">
							At least {enc.passwordMin} characters; it is never stored.
						</span>
					</div>
					<div className="flex flex-col gap-1">
						<Label htmlFor="cd-enc-pw2">Again</Label>
						<Input
							id="cd-enc-pw2"
							type="password"
							autoComplete="new-password"
							value={again}
							onChange={(e) => setAgain(e.target.value)}
							aria-invalid={Boolean(again) && mismatch}
						/>
						{again && mismatch && (
							<span className="text-xs text-content-destructive">
								Not the same password.
							</span>
						)}
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-1">
					<Label htmlFor="cd-enc-cert">
						Your certificate (PEM or DER), the public part only
					</Label>
					<textarea
						id="cd-enc-cert"
						className="min-h-28 rounded-md border border-solid border-border bg-transparent p-2 font-mono text-xs text-content-primary"
						placeholder="-----BEGIN CERTIFICATE-----"
						value={certificate}
						onChange={(e) => setCertificate(e.target.value)}
					/>
					<input
						type="file"
						accept=".pem,.crt,.cer,.der"
						aria-label="Choose a certificate file"
						className="text-xs"
						onChange={async (e) => {
							const file = e.target.files?.[0];
							if (!file) {
								return;
							}
							const bytes = new Uint8Array(await file.arrayBuffer());
							const text = new TextDecoder().decode(bytes);
							setCertificate(
								text.includes("-----BEGIN")
									? text
									: `-----BEGIN CERTIFICATE-----\n${btoa(String.fromCharCode(...bytes))}\n-----END CERTIFICATE-----\n`,
							);
						}}
					/>
					<span className="text-xs text-content-secondary">
						An RSA key of 2048 bits or more. From your PKCS#12 file:{" "}
						<span className="font-mono">
							openssl pkcs12 -in you.p12 -clcerts -nokeys -out you.crt
						</span>
						. Never your private key.
					</span>
				</div>
			)}
			<div>
				<Button
					type="submit"
					disabled={
						prepare.isPending ||
						(method === "password" ? tooShort || mismatch : !certificate.trim())
					}
				>
					<Spinner loading={prepare.isPending}>
						<DownloadIcon />
					</Spinner>
					Make the key and download its recovery kit
				</Button>
			</div>
		</form>
	);
};

const Progress: React.FC<{ enc: Encryption }> = ({ enc }) => {
	const queryClient = useQueryClient();
	const resume = useMutation({
		mutationFn: PlatformAPI.resumeCloudDriveEncryption,
		onSuccess: () => void invalidateCloudDrive(queryClient),
		onError: (e) => toast.error(getErrorMessage(e, "Not taken up again.")),
	});
	const job = enc.job;
	const doing = enc.state === "encrypting" ? "Encrypting" : "Decrypting";
	const stopped = !job || Boolean(job.finishedAt);
	const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;
	return (
		<div className="flex flex-col gap-3" aria-live="polite">
			<p className="m-0 text-sm font-medium">
				{doing} your Cloud Drive
				{job ? ` - ${job.done} of ${job.total} files` : ""}
			</p>
			<div
				className="h-2 overflow-hidden rounded-full bg-surface-secondary"
				role="progressbar"
				aria-valuenow={pct}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<div
					className="h-full bg-content-link transition-[width]"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<p className="m-0 text-xs text-content-secondary">
				Your workspaces wait for it to end before they have your Cloud Drive.
			</p>
			{stopped && (
				<Alert severity="warning">
					<AlertTitle>It stopped half way</AlertTitle>
					<AlertDescription>
						{job?.error ?? "The service restarted."} Take it up again: it goes
						on where it was.
					</AlertDescription>
				</Alert>
			)}
			{stopped && <RunningWorkspaces enc={enc} doing="re-encrypted" />}
			{stopped && (
				<div>
					<Button
						disabled={resume.isPending || enc.running.length > 0}
						onClick={() => resume.mutate()}
					>
						<Spinner loading={resume.isPending}>
							<RotateCcwIcon />
						</Spinner>
						Take it up again
					</Button>
				</div>
			)}
		</div>
	);
};

const TurnOff: React.FC<{ enc: Encryption }> = ({ enc }) => {
	const queryClient = useQueryClient();
	const [proof, setProof] = useState("");
	const disable = useMutation({
		mutationFn: () =>
			PlatformAPI.disableCloudDriveEncryption(
				enc.method === "password" ? { password: proof } : { dataKey: proof },
			),
		onSuccess: () => {
			setProof("");
			toast.success("Decrypting your Cloud Drive…");
			void invalidateCloudDrive(queryClient);
		},
		onError: (e) =>
			toast.error(getErrorMessage(e, "Encryption could not be turned off.")),
	});
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-start gap-3">
				<LockIcon aria-hidden className="mt-0.5 size-5 text-content-link" />
				<div className="flex flex-col gap-1 text-sm">
					<span className="font-medium">Your Cloud Drive is encrypted</span>
					<span className="text-content-secondary">
						With your key (SSE-C, AES-256), wrapped with your{" "}
						{enc.method === "password"
							? "password"
							: `certificate${enc.certificate?.subject ? ` (${enc.certificate.subject})` : ""}`}
						{enc.since
							? `, since ${new Date(enc.since * 1000).toLocaleDateString()}`
							: ""}
						. Key id <span className="font-mono">{enc.keyId}</span>: the one in
						your recovery kit.
					</span>
				</div>
			</div>
			<form
				className="flex flex-col gap-2 border-0 border-t border-solid border-border pt-4"
				onSubmit={(e) => {
					e.preventDefault();
					disable.mutate();
				}}
			>
				<Label htmlFor="cd-enc-proof">
					{enc.method === "password"
						? "Turn encryption off: your password"
						: "Turn encryption off: your data key (base64 of cloud-drive.key, from your recovery kit)"}
				</Label>
				<Input
					id="cd-enc-proof"
					type="password"
					autoComplete="off"
					value={proof}
					onChange={(e) => setProof(e.target.value)}
				/>
				<RunningWorkspaces enc={enc} doing="decrypted" />
				<div>
					<Button
						variant="outline"
						type="submit"
						disabled={!proof || disable.isPending || enc.running.length > 0}
					>
						<Spinner loading={disable.isPending}>
							<LockOpenIcon />
						</Spinner>
						Decrypt my Cloud Drive
					</Button>
				</div>
			</form>
		</div>
	);
};
