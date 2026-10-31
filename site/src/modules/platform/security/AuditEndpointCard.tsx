import { KeyRoundIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { getErrorMessage } from "#/api/errors";
import {
	auditCollectors,
	createAuditCollector,
	deleteAuditCollector,
} from "#/api/queries/auditCollectors";
import { organizations } from "#/api/queries/organizations";
import { Button } from "#/components/Button/Button";
import { CopyButton } from "#/components/CopyButton/CopyButton";
import { Input } from "#/components/Input/Input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";

export const AuditEndpointCard = () => {
	const orgs = useQuery(organizations());
	const [selected, setSelected] = useState("");
	const organizationId = selected || orgs.data?.[0]?.id || "";
	return (
		<section
			aria-label="External audit endpoint"
			className="flex min-w-0 flex-col gap-4 rounded-xl border border-solid border-border bg-surface-secondary p-5"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base">
					<ShieldCheckIcon className="size-4" />
					External audit endpoint
				</h3>
				<label className="flex items-center gap-2 text-sm">
					Organization
					<select
						aria-label="Audit organization"
						value={organizationId}
						onChange={(event) => setSelected(event.target.value)}
						className="h-9 rounded-md border border-solid border-border bg-surface-primary px-3"
					>
						{orgs.data?.map((org) => (
							<option key={org.id} value={org.id}>
								{org.display_name || org.name}
							</option>
						))}
					</select>
				</label>
			</div>
			{orgs.isLoading && (
				<p className="m-0 text-sm text-content-secondary">
					Loading organizations…
				</p>
			)}
			{orgs.isError && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					Could not load organizations.{" "}
					<Button
						size="sm"
						variant="outline"
						onClick={() => void orgs.refetch()}
					>
						Retry
					</Button>
				</p>
			)}
			{orgs.data?.length === 0 && (
				<p className="m-0 text-sm text-content-secondary">
					No organizations are available.
				</p>
			)}
			{organizationId && (
				<CollectorConfiguration
					key={organizationId}
					organizationId={organizationId}
				/>
			)}
		</section>
	);
};

const CollectorConfiguration = ({
	organizationId,
}: {
	organizationId: string;
}) => {
	const query = useQuery(auditCollectors(organizationId));
	const client = useQueryClient();
	const create = useMutation(createAuditCollector(client, organizationId));
	const revoke = useMutation(deleteAuditCollector(client, organizationId));
	const [name, setName] = useState("");
	const [subject, setSubject] = useState("");
	const [clientId, setClientId] = useState("");
	const [days, setDays] = useState("30");
	const id = useId();
	const config = query.data;
	const error = create.error || revoke.error || query.error;
	const validDays = Number(days);
	return (
		<>
			{query.isLoading && (
				<p className="m-0 text-sm text-content-secondary">
					Loading collector access…
				</p>
			)}
			{error && (
				<p role="alert" className="m-0 text-sm text-content-destructive">
					{getErrorMessage(error, "Could not update audit collector access.")}{" "}
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							create.reset();
							revoke.reset();
							void query.refetch();
						}}
					>
						Refresh access
					</Button>
				</p>
			)}
			{config && (
				<>
					<div className="flex min-w-0 items-center gap-3 rounded-lg border border-solid border-border bg-surface-primary p-3">
						<span className="rounded bg-surface-success px-2 py-1 font-mono text-xs font-semibold text-content-success">
							GET
						</span>
						<code className="min-w-0 flex-1 break-all text-xs">
							{config.endpoint}
						</code>
						<CopyButton text={config.endpoint} label="Copy audit endpoint" />
					</div>
					<p className="m-0 text-sm text-content-secondary">
						Read-only JSON logs for this organization. Access requires an active
						collector grant and a short-lived Keycloak access token. Revoking a
						grant blocks the collector's next request, including tokens already
						issued.
					</p>
					{!config.available && (
						<p role="status" className="m-0 text-sm text-content-warning">
							External collection is unavailable. Configure HTTPS and the
							Keycloak OIDC provider first.
						</p>
					)}
					<details className="rounded-lg border border-solid border-border bg-surface-primary p-3 text-sm">
						<summary className="cursor-pointer font-medium">
							Authentication and request examples
						</summary>
						<div className="mt-4 flex flex-col gap-4">
							<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
								<dt>Issuer</dt>
								<dd className="m-0 break-all font-mono">
									{config.issuer || "Not configured"}
								</dd>
								<dt>Audience</dt>
								<dd className="m-0 font-mono">{config.audience}</dd>
								<dt>Scope</dt>
								<dd className="m-0 font-mono">{config.scope}</dd>
								<dt>Token lifetime</dt>
								<dd className="m-0">15 minutes maximum</dd>
							</dl>
							<div>
								<h4 className="mb-2 mt-0">Keycloak token</h4>
								<p className="m-0 text-content-secondary">
									Use a dedicated service-account client. Add the audience and
									scope above to its access tokens, then grant its exact subject
									and client ID below. Dashboard sessions and ordinary sign-in
									tokens do not grant collector access.
								</p>
							</div>
							<div>
								<h4 className="mb-2 mt-0">X.509 certificate</h4>
								<p className="m-0 text-content-secondary">
									Set the Keycloak client's authenticator to X509 Certificate
									with its exact certificate subject and CA subject. Use the
									certificate and private key at Keycloak's TLS token endpoint
									to obtain the audit token; no client secret is required. Keep
									certificate-bound access tokens off for this endpoint.
								</p>
								<pre className="mb-0 overflow-auto rounded-md bg-surface-secondary p-3 text-xs">{`curl --cert collector.crt --key collector.key \\\n  --data-urlencode 'grant_type=client_credentials' \\\n  --data-urlencode 'client_id=YOUR_COLLECTOR_CLIENT' \\\n  --data-urlencode 'scope=${config.scope}' \\\n  '${config.token_endpoint}'`}</pre>
							</div>
							<div>
								<h4 className="mb-2 mt-0">Collect logs</h4>
								<pre className="m-0 overflow-auto rounded-md bg-surface-secondary p-3 text-xs">{`curl -H "Authorization: Bearer $AUDIT_ACCESS_TOKEN" \\\n  '${config.endpoint}?limit=100&offset=0'`}</pre>
							</div>
							<Table aria-label="Audit API parameters">
								<TableHeader>
									<TableRow>
										<TableHead>Parameter</TableHead>
										<TableHead>Meaning</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									<TableRow>
										<TableCell>
											<code>q</code>
										</TableCell>
										<TableCell>
											Audit filter, for example action:login or
											date_from:2026-10-31. Organization scope cannot be
											overridden.
										</TableCell>
									</TableRow>
									<TableRow>
										<TableCell>
											<code>limit / offset</code>
										</TableCell>
										<TableCell>
											1 to 500 events per page; default 100. Use date filters
											and deduplicate by event ID when polling.
										</TableCell>
									</TableRow>
									<TableRow>
										<TableCell>200 / 401 / 403 / 429</TableCell>
										<TableCell>
											JSON results / invalid token / no active grant or scope /
											rate limit.
										</TableCell>
									</TableRow>
								</TableBody>
							</Table>
						</div>
					</details>
					<form
						className="flex flex-col gap-3 rounded-lg border border-solid border-border bg-surface-primary p-4"
						onSubmit={(event) => {
							event.preventDefault();
							create.mutate(
								{
									name: name.trim(),
									subject: subject.trim(),
									client_id: clientId.trim(),
									valid_days: validDays,
								},
								{
									onSuccess: () => {
										setName("");
										setSubject("");
										setClientId("");
									},
								},
							);
						}}
					>
						<h4 className="m-0 flex items-center gap-2 text-sm">
							<KeyRoundIcon className="size-4" />
							Grant collector access
						</h4>
						<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
							<label
								htmlFor={`${id}-name`}
								className="flex flex-col gap-2 text-xs"
							>
								Name
								<Input
									id={`${id}-name`}
									required
									maxLength={100}
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</label>
							<label
								htmlFor={`${id}-client`}
								className="flex flex-col gap-2 text-xs"
							>
								Keycloak client ID
								<Input
									id={`${id}-client`}
									required
									maxLength={255}
									value={clientId}
									onChange={(event) => setClientId(event.target.value)}
								/>
							</label>
							<label
								htmlFor={`${id}-subject`}
								className="flex flex-col gap-2 text-xs"
							>
								Subject (sub)
								<Input
									id={`${id}-subject`}
									required
									maxLength={255}
									value={subject}
									onChange={(event) => setSubject(event.target.value)}
								/>
							</label>
							<label
								htmlFor={`${id}-days`}
								className="flex flex-col gap-2 text-xs"
							>
								Access lifetime (days)
								<Input
									id={`${id}-days`}
									type="number"
									min={1}
									max={365}
									required
									value={days}
									onChange={(event) => setDays(event.target.value)}
								/>
							</label>
						</div>
						<Button
							type="submit"
							className="self-start"
							disabled={
								!config.available ||
								create.isPending ||
								!name.trim() ||
								!subject.trim() ||
								!clientId.trim() ||
								!Number.isInteger(validDays) ||
								validDays < 1 ||
								validDays > 365
							}
						>
							{create.isPending ? "Granting access…" : "Grant access"}
						</Button>
					</form>
					<div className="overflow-x-auto">
						<Table aria-label="Audit collectors">
							<TableHeader>
								<TableRow>
									<TableHead>Collector</TableHead>
									<TableHead>Identity</TableHead>
									<TableHead>Expires</TableHead>
									<TableHead>Access</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{config.collectors.length === 0 && (
									<TableRow>
										<TableCell colSpan={4}>
											No collectors have access.
										</TableCell>
									</TableRow>
								)}
								{config.collectors.map((collector) => (
									<TableRow key={collector.id}>
										<TableCell>{collector.name}</TableCell>
										<TableCell>
											<div>{collector.client_id}</div>
											<code className="break-all text-xs text-content-secondary">
												{collector.subject}
											</code>
										</TableCell>
										<TableCell>
											{new Date(collector.expires_at).toLocaleString("en-US")}
										</TableCell>
										<TableCell>
											<Button
												size="sm"
												variant="outline"
												disabled={revoke.isPending}
												onClick={() => revoke.mutate(collector.id)}
												aria-label={`Revoke ${collector.name}`}
											>
												<Trash2Icon />
												Revoke
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</>
			)}
		</>
	);
};
