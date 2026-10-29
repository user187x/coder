import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	browserCertificateStatus,
	importWorkspaceBrowserCertificate,
} from "#/api/queries/browserCertificate";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/Dialog/Dialog";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Spinner } from "#/components/Spinner/Spinner";
import { AgentButton } from "#/modules/resources/AgentButton";

export const BrowserCertificateButton: React.FC<{
	baseUrl: string;
	disabled?: boolean;
	grouped?: boolean;
	children: React.ReactNode;
}> = ({ baseUrl, disabled, grouped, children }) => {
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
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			{open && (
				<DialogContent
					overlayClassName="z-[2147483001] backdrop-blur-md"
					className="z-[2147483002] max-w-xl rounded-2xl"
				>
					<DialogHeader>
						<DialogTitle>Browser certificate</DialogTitle>
						<DialogDescription>
							Use your saved client certificate or supply a certificate for this
							workspace browser.
						</DialogDescription>
					</DialogHeader>
					<BrowserCertificateForm
						baseUrl={baseUrl}
						onClose={() => setOpen(false)}
					/>
				</DialogContent>
			)}
		</Dialog>
	);
};

export const BrowserCertificateForm: React.FC<{
	baseUrl: string;
	onClose: () => void;
}> = ({ baseUrl, onClose }) => {
	const id = useId();
	const client = useQueryClient();
	const status = useQuery(browserCertificateStatus(baseUrl));
	const [file, setFile] = useState<File>();
	const [password, setPassword] = useState("");
	const [fileError, setFileError] = useState("");
	const mutation = useMutation({
		...importWorkspaceBrowserCertificate(baseUrl, () => ({
			csrf: status.data?.csrf ?? "",
			file,
			password,
		})),
		onSettled: () => {
			setPassword("");
			void client.invalidateQueries(browserCertificateStatus(baseUrl));
		},
	});
	return (
		<form
			className="grid gap-5"
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
			<div className="grid gap-2">
				<Label htmlFor={`${id}-file`}>Certificate file (.p12 or .pfx)</Label>
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
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					Close
				</Button>
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
			</DialogFooter>
		</form>
	);
};
