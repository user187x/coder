import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import {
	createUserSecret,
	deleteUserSecret,
	updateUserSecret,
	userSecrets,
} from "#/api/queries/userSecrets";
import type { UserSecret } from "#/api/typesGenerated";
import { Alert } from "#/components/Alert/Alert";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Loader } from "#/components/Loader/Loader";
import {
	SettingsHeader,
	SettingsHeaderDescription,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { useEmbeddedMetadata } from "#/hooks/useEmbeddedMetadata";
import { pageTitle } from "#/utils/page";
import {
	CertificateUploadDialog,
	type PreparedCertificate,
} from "./CertificateUploadDialog";
import {
	type CertificateFacts,
	certificatePath,
	certificateSecretName,
	describeCertificate,
	parseCertificateDescription,
	parseCertificatePath,
} from "./certificateSecrets";

type CertificateSecret = UserSecret & { certificate: string };

const formatDate = (date: string | undefined) =>
	date
		? new Date(date).toLocaleDateString("en-US", { dateStyle: "medium" })
		: "N/A";

const daysLeft = (date: string) =>
	Math.floor((new Date(date).getTime() - Date.now()) / 86_400_000);

/**
 * Settings > Certificates: the user's PKCS#12 certificate, installed into
 * every workspace they start as ~/.cert/<username>.p12 (mode 0600). It is one
 * of their own Coder secrets: the file, base64-encoded, delivered by Coder's
 * agent to ~/.cert/.<username>.p12.b64, which the template's installer
 * decodes. Coder never returns secret values, so this page shows what it can
 * see: description and dates.
 */
const CertificatesPage: React.FC = () => {
	const { user } = useAuthenticated();
	const { metadata } = useEmbeddedMetadata();
	const filePathsEnabled =
		metadata["user-secret-file-path-enabled"].value ?? true;
	const queryClient = useQueryClient();
	const secretsQuery = useQuery(userSecrets(user.id));
	const create = useMutation(createUserSecret(queryClient, user.id));
	const update = useMutation(updateUserSecret(queryClient, user.id));
	const remove = useMutation(deleteUserSecret(queryClient, user.id));
	const [uploading, setUploading] = useState(false);
	const [deleting, setDeleting] = useState<CertificateSecret | null>(null);
	const [saving, setSaving] = useState(false);

	const username = user.username;
	const certificates: CertificateSecret[] = (secretsQuery.data ?? [])
		.flatMap((secret) => {
			const certificate = parseCertificatePath(secret.file_path);
			return certificate ? [{ ...secret, certificate }] : [];
		})
		.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
	const current = certificates.find((c) => c.certificate === username) ?? null;
	const extras = certificates.filter((c) => c !== current);

	// A certificate saved under another name (an earlier username, or another
	// name picked before) is installed as ~/.cert/<username>.p12 from now on:
	// the newest, if several. Any others are listed as not installed.
	const migrating = useRef(false);
	const { mutate: updateSecret } = update;
	const toMigrate = !current ? certificates[0] : undefined;
	useEffect(() => {
		if (!toMigrate || migrating.current) {
			return;
		}
		migrating.current = true;
		const parsed = parseCertificateDescription(toMigrate.description);
		updateSecret(
			{
				name: toMigrate.name,
				request: {
					file_path: certificatePath(username),
					description: describeCertificate(username, {
						sha: parsed.sha ?? "",
						subject: parsed.subject,
						notAfter: parsed.expires ? new Date(parsed.expires) : null,
					}),
				},
			},
			{
				onSuccess: () =>
					toast.success(
						`${toMigrate.certificate}.p12 is now installed as ~/.cert/${username}.p12. Restart your workspaces to apply.`,
					),
				onSettled: () => {
					migrating.current = false;
				},
			},
		);
	}, [toMigrate, username, updateSecret]);

	const save = async (prepared: PreparedCertificate) => {
		const facts: CertificateFacts = {
			sha: prepared.sha,
			subject: prepared.details?.subject,
			notAfter: prepared.details?.notAfter ?? null,
		};
		const body = {
			value: prepared.base64,
			description: describeCertificate(username, facts),
			file_path: certificatePath(username),
		};
		const replaced = Boolean(current);
		setSaving(true);
		try {
			if (current && current.name === certificateSecretName(username)) {
				await update.mutateAsync({
					name: current.name,
					request: { ...body, enabled: true },
				});
			} else {
				// New, or replacing one stored under an older name: store it as
				// certificate-<username>, then remove the old one.
				if (current) {
					await update.mutateAsync({
						name: current.name,
						request: {
							file_path: certificatePath(`${current.certificate}.replaced`),
						},
					});
				}
				try {
					await create.mutateAsync({
						name: certificateSecretName(username),
						...body,
					});
				} catch (error) {
					if (current) {
						update.mutate({
							name: current.name,
							request: { file_path: certificatePath(username) },
						});
					}
					throw error;
				}
				if (current) {
					await remove.mutateAsync(current.name);
				}
			}
			setUploading(false);
			toast.success(
				`${replaced ? "Replaced" : "Uploaded"} ~/.cert/${username}.p12. Workspaces you start from now on have it; restart running ones.`,
			);
		} catch (error) {
			toast.error(
				getErrorMessage(error, "The certificate could not be saved."),
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<title>{pageTitle("Certificates")}</title>
			<SettingsHeader
				actions={
					<Button
						disabled={!filePathsEnabled}
						onClick={() => setUploading(true)}
					>
						{current ? "Replace certificate…" : "Upload certificate…"}
					</Button>
				}
			>
				<SettingsHeaderTitle>Certificates</SettingsHeaderTitle>
				<SettingsHeaderDescription>
					Your .p12 certificate, installed into every workspace you start as
					~/.cert/{username}.p12.
				</SettingsHeaderDescription>
			</SettingsHeader>

			<div className="flex flex-col gap-6">
				{!filePathsEnabled && (
					<Alert severity="warning" prominent>
						Secret files are turned off on this deployment, so certificates
						cannot be installed into workspaces.
					</Alert>
				)}
				{secretsQuery.isLoading ? (
					<Loader />
				) : secretsQuery.error ? (
					<ErrorAlert error={secretsQuery.error} />
				) : !current && !extras.length ? (
					<p className="m-0 text-sm text-content-secondary">
						No certificate yet. Upload your .p12 and every workspace you start
						has it as ~/.cert/{username}.p12.
					</p>
				) : (
					<CertificatesTable
						username={username}
						current={current}
						extras={extras}
						onReplace={() => setUploading(true)}
						onDelete={setDeleting}
					/>
				)}

				<section
					aria-labelledby="certificates-how"
					className="rounded-lg border border-solid border-border p-6"
				>
					<h2
						id="certificates-how"
						className="m-0 mb-3 text-base font-semibold"
					>
						How it works
					</h2>
					<ul className="m-0 flex flex-col gap-2 pl-5 text-sm text-content-secondary">
						<li>
							Every workspace you start gets your certificate as{" "}
							<code>~/.cert/{username}.p12</code>, named after your Coder
							username and readable only by you (<code>0600</code>). Nothing
							else is placed in <code>~/.cert</code>. Restart a running
							workspace to pick up a new or replaced certificate.
						</li>
						<li>
							It is stored as your own Coder secret: only you can upload,
							replace or delete it, its contents can never be read back through
							Coder, and it is delivered only to workspaces you own. Every
							change is in Coder's audit log.
						</li>
						<li>
							The optional password check happens in this page only. The
							password is never sent or stored: keep using it wherever the
							certificate is opened.
						</li>
					</ul>
				</section>
			</div>

			{uploading && (
				<CertificateUploadDialog
					username={username}
					replacing={Boolean(current)}
					saving={saving}
					onClose={() => setUploading(false)}
					onSave={(prepared) => {
						void save(prepared);
					}}
				/>
			)}
			<ConfirmDialog
				type="delete"
				open={deleting !== null}
				title="Delete certificate"
				description={
					deleting === current
						? `Delete ~/.cert/${username}.p12? It is removed from your workspaces the next time each one starts.`
						: `Delete ${deleting?.certificate}.p12 (not installed)?`
				}
				confirmLoading={remove.isPending}
				onClose={() => setDeleting(null)}
				onConfirm={() => {
					if (!deleting) {
						return;
					}
					const installed = deleting === current;
					remove.mutate(deleting.name, {
						onSuccess: () => {
							toast.success(
								installed
									? `Deleted ~/.cert/${username}.p12. Restart your workspaces to remove it from them.`
									: `Deleted ${deleting.certificate}.p12.`,
							);
							setDeleting(null);
						},
						onError: (error) => {
							toast.error(
								getErrorMessage(error, "The certificate could not be deleted."),
							);
						},
					});
				}}
			/>
		</>
	);
};

type CertificatesTableProps = {
	username: string;
	current: CertificateSecret | null;
	extras: CertificateSecret[];
	onReplace: () => void;
	onDelete: (certificate: CertificateSecret) => void;
};

const CertificatesTable: React.FC<CertificatesTableProps> = ({
	username,
	current,
	extras,
	onReplace,
	onDelete,
}) => (
	<div className="flex flex-col gap-2">
		<Table aria-label="Your certificates">
			<TableHeader>
				<TableRow>
					<TableHead>In your workspaces</TableHead>
					<TableHead>Certificate</TableHead>
					<TableHead>Expires</TableHead>
					<TableHead>Updated</TableHead>
					<TableHead>
						<span className="sr-only">Actions</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{[current, ...extras].flatMap((certificate) => {
					if (!certificate) {
						return [];
					}
					const installed = certificate === current;
					const facts = parseCertificateDescription(certificate.description);
					const left = facts.expires ? daysLeft(facts.expires) : null;
					return [
						<TableRow key={certificate.id}>
							<TableCell>
								<div className="flex flex-col gap-1">
									<span className="flex flex-wrap items-center gap-2">
										<code>
											{installed
												? `~/.cert/${username}.p12`
												: `${certificate.certificate}.p12`}
										</code>
										{!installed && <Badge size="xs">not installed</Badge>}
										{installed && !certificate.enabled && (
											<Badge size="xs">disabled</Badge>
										)}
									</span>
									{facts.sha && (
										<span className="text-xs text-content-secondary">
											SHA-256 {facts.sha}…
										</span>
									)}
								</div>
							</TableCell>
							<TableCell>{facts.subject ?? "N/A"}</TableCell>
							<TableCell>
								{facts.expires ? (
									<span className="flex items-center gap-2">
										{formatDate(facts.expires)}
										{left !== null && left < 0 ? (
											<Badge size="xs" variant="destructive">
												expired
											</Badge>
										) : left !== null && left <= 30 ? (
											<Badge size="xs" variant="warning">
												{left} days left
											</Badge>
										) : null}
									</span>
								) : (
									<span className="text-content-secondary">unknown</span>
								)}
							</TableCell>
							<TableCell>{formatDate(certificate.updated_at)}</TableCell>
							<TableCell className="text-right">
								<div className="flex justify-end gap-2">
									{installed && (
										<Button size="sm" variant="outline" onClick={onReplace}>
											Replace…
										</Button>
									)}
									<Button
										size="sm"
										variant="outline"
										onClick={() => onDelete(certificate)}
									>
										Delete
									</Button>
								</div>
							</TableCell>
						</TableRow>,
					];
				})}
			</TableBody>
		</Table>
		{extras.length > 0 && (
			<p className="m-0 text-sm text-content-secondary">
				Only ~/.cert/{username}.p12 is installed. Certificates saved under other
				names are not; delete them.
			</p>
		)}
	</div>
);

export default CertificatesPage;
