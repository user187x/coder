import { cn } from "cn";
import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "react-query";
import { Link as RouterLink } from "react-router";
import { toast } from "sonner";
import { API } from "#/api/api";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import { setUserSSHKey } from "#/api/queries/sshKeys";
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
import {
	Pkcs12Error,
	pkcs12PrivateKey,
	privateKeyPem,
	sha256Hex,
} from "#/utils/pkcs12";

/** base64 of this fits Coder's 24 KiB limit for one secret value (as on upload). */
const MAX_BYTES = 18 * 1024;

export type P12File = { file: File; bytes: Uint8Array<ArrayBuffer> };

type Opened = P12File & {
	sha: string;
	/** The key opens without a password. */
	open: boolean;
};

type UseAsSSHKeyDialogProps = {
	userId: string;
	/** The file just uploaded; otherwise the user chooses it (Coder never returns a stored one). */
	initial?: P12File;
	/** First 16 hex digits of the stored certificate's SHA-256, to tell whether the chosen file is it. */
	storedSha?: string;
	onClose: () => void;
};

/**
 * Uses the private key of the user's .p12 as their SSH key (for Git in their
 * workspaces). The key is decrypted here, in the page: the password is only
 * held by this dialog while it is open, is never sent, stored, logged or put
 * in a URL, and is cleared as soon as the key is out (or the dialog closes).
 * Only the decrypted key goes to Coder, which keeps it as it keeps the keys it
 * generates.
 */
export const UseAsSSHKeyDialog: React.FC<UseAsSSHKeyDialogProps> = ({
	userId,
	initial,
	storedSha,
	onClose,
}) => {
	const id = useId();
	const queryClient = useQueryClient();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [working, setWorking] = useState(false);
	const alive = useRef(true);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	const pick = async ({ file, bytes }: P12File) => {
		setOpened(null);
		setError("");
		setPassword("");
		if (bytes.length > MAX_BYTES) {
			setError(
				`The file is ${(bytes.length / 1024).toFixed(1)} KB; the limit is 18 KB.`,
			);
			return;
		}
		let open = false;
		try {
			// Without a password? (The key is wiped at once; it is taken again on confirm.)
			const key = await pkcs12PrivateKey(bytes, "");
			key.pkcs8.fill(0);
			open = true;
		} catch (e) {
			const message = e instanceof Pkcs12Error ? e.message : "";
			if (!/password/.test(message)) {
				setError(message || "This file cannot be read.");
				return;
			}
		}
		setOpened({ file, bytes, sha: await sha256Hex(bytes), open });
	};

	const initialFile = initial?.file;
	const initialBytes = initial?.bytes;
	useEffect(() => {
		if (initialFile && initialBytes) {
			void pick({ file: initialFile, bytes: initialBytes });
		}
	}, [initialFile, initialBytes]);

	const close = () => {
		setPassword("");
		onClose();
	};

	const use = async () => {
		if (!opened) {
			return;
		}
		setWorking(true);
		setError("");
		let pkcs8: Uint8Array | null = null;
		try {
			const key = await pkcs12PrivateKey(opened.bytes, password);
			pkcs8 = key.pkcs8;
			setPassword("");
			const saved = await API.importUserSSHKey(
				userId,
				privateKeyPem(key.pkcs8),
			);
			setUserSSHKey(queryClient, userId, saved);
			setUserSSHKey(queryClient, "me", saved);
			toast.success(
				`Your SSH key is now your certificate's ${key.algorithm} key. Add the new public key to the Git services you use.`,
			);
			close();
		} catch (e) {
			if (alive.current) {
				setError(
					e instanceof Pkcs12Error
						? e.message
						: [
								getErrorMessage(e, "The key could not be saved."),
								getErrorDetail(e),
							]
								.filter(Boolean)
								.join(": "),
				);
			}
		} finally {
			pkcs8?.fill(0);
			if (alive.current) {
				setWorking(false);
			}
		}
	};

	const matches = opened && storedSha ? opened.sha.startsWith(storedSha) : null;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !working) {
					close();
				}
			}}
		>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Use your certificate's key as your SSH key</DialogTitle>
					<DialogDescription>
						Its private key becomes the SSH key your workspaces use for Git,
						replacing the current one (as Regenerate does).
					</DialogDescription>
				</DialogHeader>
				{!initial && (
					<FileUpload
						isUploading={false}
						file={opened?.file}
						extensions={["p12", "pfx"]}
						title="Choose your .p12 / .pfx file or drop it here"
						removeLabel="Choose another file"
						onUpload={(file) => {
							void file
								.arrayBuffer()
								.then((buffer) =>
									pick({ file, bytes: new Uint8Array(buffer) }),
								);
						}}
						onUnsupportedFile={(file) =>
							setError(`${file.name}: a .p12 or .pfx file is expected.`)
						}
						onRemove={() => {
							setOpened(null);
							setPassword("");
							setError("");
						}}
					/>
				)}
				{!initial && !opened && (
					<p className="m-0 text-sm text-content-secondary">
						Coder never gives a stored certificate back, so choose the file
						again. It is read here, in your browser.
					</p>
				)}
				{opened && (
					<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
						<dt className="text-content-secondary">File</dt>
						<dd className="m-0">
							{opened.file.name}, SHA-256 {opened.sha.slice(0, 16)}…
							{matches !== null && (
								<span
									className={cn(
										"ml-2",
										matches ? "text-content-success" : "text-content-warning",
									)}
								>
									{matches
										? "(your uploaded certificate)"
										: "(not the certificate you uploaded)"}
								</span>
							)}
						</dd>
						<dt className="text-content-secondary">Protection</dt>
						<dd className="m-0">
							{opened.open ? "no password" : "password protected"}
						</dd>
					</dl>
				)}
				{opened && !opened.open && (
					<div className="flex flex-col gap-2">
						<Label htmlFor={`${id}-password`}>Certificate password</Label>
						<Input
							id={`${id}-password`}
							type="password"
							autoComplete="off"
							data-1p-ignore
							data-lpignore="true"
							spellCheck={false}
							autoFocus
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && password && !working) {
									void use();
								}
							}}
						/>
						<span className="text-xs text-content-secondary">
							Used here, in your browser, to decrypt the key; never sent, stored
							or logged, and cleared once the key is out.
						</span>
					</div>
				)}
				{error && (
					<Alert severity="error" prominent>
						{error}
					</Alert>
				)}
				<DialogFooter className="gap-2 sm:justify-between">
					<RouterLink
						to="/settings/ssh-keys"
						className="self-center text-sm text-content-secondary"
					>
						Your SSH key
					</RouterLink>
					<div className="flex gap-2">
						<Button variant="outline" disabled={working} onClick={close}>
							Cancel
						</Button>
						<Button
							disabled={!opened || working || (!opened.open && !password)}
							onClick={() => {
								void use();
							}}
						>
							<Spinner loading={working} />
							Use as SSH key
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
