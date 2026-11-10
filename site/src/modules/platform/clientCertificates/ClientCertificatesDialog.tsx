import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	clientCertificateCapabilities,
	clientCertificates,
	issueClientCertificate,
	revokeClientCertificate,
} from "#/api/queries/clientCertificates";
import { organizations } from "#/api/queries/organizations";
import type { User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import {
	ClientCertificateDownload,
	saveClientCertificate,
} from "./ClientCertificateDownload";

export const ClientCertificatesDialog = ({
	user,
	onClose,
}: {
	user: User;
	onClose: () => void;
}) => {
	const [organization, setOrganization] = useState(
		user.organization_ids[0] ?? "",
	);
	const id = useId();
	const client = useQueryClient();
	const capability = useQuery(clientCertificateCapabilities());
	const organizationQuery = useQuery({
		...organizations(),
		enabled: user.organization_ids.length > 1,
	});
	const query = useQuery(clientCertificates(organization, user.id));
	const issue = useMutation(
		issueClientCertificate(client, organization, user.id),
	);
	const revoke = useMutation(
		revokeClientCertificate(client, organization, user.id),
	);
	const [label, setLabel] = useState("");
	const [password, setPassword] = useState("");
	const [days, setDays] = useState("90");
	const lifetime = Number(days);
	const pending = issue.isPending || revoke.isPending;
	const eligible =
		capability.data?.enabled &&
		organization &&
		user.login_type === "oidc" &&
		!user.is_service_account &&
		user.status !== "suspended";
	const valid =
		label.trim().length > 0 &&
		password.length >= 12 &&
		password.length <= 128 &&
		Number.isInteger(lifetime) &&
		lifetime >= 1 &&
		lifetime <= 90;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<DialogContent
				className="max-h-[calc(90vh/var(--app-zoom,1))] overflow-y-auto"
				onInteractOutside={(event) => {
					if (pending || issue.data) event.preventDefault();
				}}
				onEscapeKeyDown={(event) => {
					if (pending || issue.data) event.preventDefault();
				}}
			>
				<DialogTitle>Client certificates for {user.username}</DialogTitle>
				<DialogDescription>
					Issue a separate sign-in certificate for each device. Revocation
					blocks future certificate logins; existing sessions keep their normal
					expiry.
				</DialogDescription>
				{user.organization_ids.length > 1 && (
					<>
						<Label htmlFor={`${id}-org`}>Organization</Label>
						<Select
							value={organization}
							onValueChange={setOrganization}
							disabled={pending || Boolean(issue.data)}
						>
							<SelectTrigger id={`${id}-org`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{user.organization_ids.map((id) => (
									<SelectItem key={id} value={id}>
										{organizationQuery.data?.find((org) => org.id === id)
											?.display_name ||
											organizationQuery.data?.find((org) => org.id === id)
												?.name ||
											"Unknown organization"}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</>
				)}
				{Boolean(
					query.error ||
						issue.error ||
						revoke.error ||
						capability.error ||
						organizationQuery.error,
				) && (
					<ErrorAlert
						error={
							query.error ||
							issue.error ||
							revoke.error ||
							capability.error ||
							organizationQuery.error
						}
					/>
				)}
				{!capability.isLoading && !capability.error && !eligible && (
					<p className="text-sm text-content-secondary">
						Device certificates require configured certificate sign-in and an
						enabled OpenID Connect user.
					</p>
				)}
				{issue.data ? (
					<ClientCertificateDownload credential={issue.data} />
				) : (
					<form
						className="space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (!eligible || !valid || pending) return;
							issue.mutate(
								{ label: label.trim(), password, days: lifetime },
								{
									onSuccess: (credential) => {
										setPassword("");
										saveClientCertificate(credential);
									},
								},
							);
						}}
					>
						<Label htmlFor={`${id}-label`}>Device name</Label>
						<Input
							id={`${id}-label`}
							value={label}
							onChange={(event) => setLabel(event.target.value)}
							required
							maxLength={80}
							disabled={pending}
						/>
						<Label htmlFor={`${id}-password`}>Download password</Label>
						<Input
							id={`${id}-password`}
							type="password"
							autoComplete="new-password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							required
							minLength={12}
							maxLength={128}
							disabled={pending}
						/>
						<Label htmlFor={`${id}-days`}>Valid for (days)</Label>
						<Input
							id={`${id}-days`}
							type="number"
							min={1}
							max={90}
							value={days}
							onChange={(event) => setDays(event.target.value)}
							required
							disabled={pending}
						/>
						<Button type="submit" disabled={pending || !eligible || !valid}>
							{issue.isPending ? "Issuing…" : "Issue and download"}
						</Button>
					</form>
				)}
				<div className="space-y-2">
					{query.isLoading ? (
						<p>Loading certificates…</p>
					) : query.data?.certificates.length === 0 ? (
						<p className="text-sm text-content-secondary">
							No device certificates issued here.
						</p>
					) : (
						query.data?.certificates.map((certificate) => (
							<div
								key={certificate.id}
								className="rounded-lg border border-solid p-3 text-sm bg-surface-primary"
							>
								<div className="flex items-center justify-between gap-2">
									<span>{certificate.label}</span>
									<span>{certificate.status}</span>
								</div>
								<p className="text-xs text-content-secondary">
									Expires{" "}
									{new Date(certificate.expires_at).toLocaleString("en-US")}
								</p>
								<details>
									<summary className="cursor-pointer text-xs">
										Certificate details
									</summary>
									<p className="break-all text-xs">
										{certificate.subject}
										<br />
										SHA-256: {certificate.fingerprint}
									</p>
								</details>
								{certificate.status !== "revoked" && (
									<Button
										size="sm"
										variant="outline"
										disabled={pending}
										onClick={() => revoke.mutate(certificate.id)}
									>
										Revoke {certificate.label}
									</Button>
								)}
							</div>
						))
					)}
				</div>
				<Button variant="outline" disabled={pending} onClick={onClose}>
					Done
				</Button>
			</DialogContent>
		</Dialog>
	);
};
