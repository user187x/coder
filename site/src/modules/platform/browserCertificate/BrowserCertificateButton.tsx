import { LockKeyholeIcon, ShieldAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	browserCertificateStatus,
	importWorkspaceBrowserCertificate,
} from "#/api/queries/browserCertificate";
import { Button } from "#/components/Button/Button";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";
import { Spinner } from "#/components/Spinner/Spinner";
import { AgentButton } from "#/modules/resources/AgentButton";

export const BrowserCertificateButton: React.FC<{
	baseUrl: string;
	disabled?: boolean;
	grouped?: boolean;
	children: React.ReactNode;
	now?: number;
}> = ({ baseUrl, disabled, grouped, children, now }) => {
	const [open, setOpen] = useState(false);
	const trigger = grouped ? (
		<DropdownMenuItem
			disabled={disabled}
			onSelect={(event) => event.preventDefault()}
		>
			{children}
		</DropdownMenuItem>
	) : (
		<AgentButton disabled={disabled}>{children}</AgentButton>
	);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			{open && (
				<PopoverContent
					align="end"
					side="bottom"
					aria-label="Browser certificate"
					className="z-[2147483002] w-[min(380px,calc(100vw-32px))] rounded-xl p-4"
					onKeyDown={(event) => event.stopPropagation()}
				>
					<h3 className="mt-0 mb-2 text-sm font-semibold">
						Browser certificate
					</h3>
					<BrowserCertificateForm
						baseUrl={baseUrl}
						now={now}
						onClose={() => setOpen(false)}
					/>
				</PopoverContent>
			)}
		</Popover>
	);
};

const BrowserCertificateForm: React.FC<{
	baseUrl: string;
	onClose: () => void;
	now?: number;
}> = ({ baseUrl, onClose, now = Date.now() }) => {
	const id = useId();
	const client = useQueryClient();
	const status = useQuery(browserCertificateStatus(baseUrl));
	const [replacing, setReplacing] = useState(false);
	const certificate = status.data?.certificate;
	const expired = certificate
		? new Date(certificate.expires_at).getTime() <= now
		: false;
	const ready = status.data?.state === "ready" && !replacing;
	const [file, setFile] = useState<File>();
	const [password, setPassword] = useState("");
	const [fileError, setFileError] = useState("");
	const mutation = useMutation({
		...importWorkspaceBrowserCertificate(baseUrl, () => ({
			csrf: status.data?.csrf ?? "",
			file,
			password,
		})),
		onSuccess: () => setReplacing(false),
		onSettled: () => {
			setPassword("");
			void client.invalidateQueries(browserCertificateStatus(baseUrl));
		},
	});
	return (
		<form
			className="grid gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				if (!status.data?.csrf || fileError || mutation.isPending) return;
				mutation.mutate();
			}}
		>
			{status.isPending ? (
				<div role="status" className="flex items-center gap-2">
					<Spinner loading />
					Checking your saved certificate…
				</div>
			) : status.isError ? (
				<div role="alert" className="grid gap-2">
					<p>
						{getErrorMessage(
							status.error,
							"Unable to check the browser certificate.",
						)}
					</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => void status.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<p className="m-0 text-sm text-content-secondary">
					{status.data?.message}
				</p>
			)}
			{ready ? (
				<div className="grid gap-3 rounded-lg border border-solid border-border bg-surface-secondary p-3">
					<div className="flex items-center gap-2 text-sm font-medium">
						{expired ? (
							<ShieldAlertIcon className="size-5 text-content-warning" />
						) : (
							<LockKeyholeIcon className="size-5 text-content-success" />
						)}
						{expired ? "Imported certificate expired" : "Certificate imported"}
					</div>
					{certificate ? (
						<dl className="m-0 grid gap-1 text-xs">
							<dt>SHA-256 thumbprint</dt>
							<dd className="m-0 break-all font-mono select-all">
								{certificate.thumbprint}
							</dd>
							<dt className="mt-2">Expires</dt>
							<dd className="m-0">
								{new Date(certificate.expires_at).toLocaleString("en-US")}
							</dd>
							<dt className="mt-2">Subject</dt>
							<dd className="m-0 break-words">
								{certificate.subject || "Unknown"}
							</dd>
						</dl>
					) : (
						<p className="m-0 text-xs text-content-secondary">
							Certificate details are unavailable from this workspace's browser
							service.
						</p>
					)}
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={() => setReplacing(true)}
					>
						Replace certificate
					</Button>
				</div>
			) : (
				<>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-file`}>
							Certificate file (.p12 or .pfx)
						</Label>
						<Input
							id={`${id}-file`}
							type="file"
							accept=".p12,.pfx"
							disabled={mutation.isPending}
							onChange={(event) => {
								const selected = event.target.files?.[0];
								setFile(selected);
								setFileError(
									selected && selected.size > 1048576
										? "Choose a certificate smaller than 1 MiB."
										: "",
								);
								mutation.reset();
							}}
						/>
						<p className="m-0 text-xs text-content-secondary">
							Optional when using your saved certificate. Maximum size: 1 MiB.
						</p>
					</div>
					<div className="grid gap-2">
						<Label htmlFor={`${id}-password`}>Certificate password</Label>
						<Input
							id={`${id}-password`}
							type="password"
							autoComplete="off"
							value={password}
							disabled={mutation.isPending}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</div>
				</>
			)}
			{fileError && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{fileError}
				</p>
			)}
			{mutation.isError && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{getErrorMessage(
						mutation.error,
						"Could not import the certificate. Check the file and password, then try again.",
					)}
				</p>
			)}
			{mutation.isSuccess && (
				<p role="status" className="m-0 text-sm">
					{mutation.data.message}
				</p>
			)}
			<div className="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" onClick={onClose}>
					Close
				</Button>
				{!ready && (
					<Button
						type="submit"
						disabled={
							!status.data?.csrf ||
							status.isError ||
							Boolean(fileError) ||
							mutation.isPending
						}
					>
						<Spinner loading={mutation.isPending} />
						Import and relaunch browser
					</Button>
				)}
			</div>
		</form>
	);
};
