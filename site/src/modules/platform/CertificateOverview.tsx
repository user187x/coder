import { cn } from "cn";
import {
	FileKeyIcon,
	GlobeLockIcon,
	KeyRoundIcon,
	PackageIcon,
	RefreshCwIcon,
	ShieldCheckIcon,
	ShieldXIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import type {
	CertificateFile,
	CertificateInfo,
	CertificatesOverview,
	TlsEndpoint,
} from "#/api/platform";
import { certificates, refreshCertificates } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Spinner } from "#/components/Spinner/Spinner";

const DAY_MS = 24 * 60 * 60 * 1000;

/** TLS versions no longer considered safe: shown in warning colours when accepted. */
const LEGACY_TLS = new Set(["TLS 1.0", "TLS 1.1"]);
const ALL_TLS = ["TLS 1.0", "TLS 1.1", "TLS 1.2", "TLS 1.3"];

const formatDate = (iso: string) =>
	new Date(iso).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});

const isCertificate = (
	item: CertificateInfo | { error: string },
): item is CertificateInfo => "notAfter" in item;

/**
 * The share of a certificate's lifetime that is left, and a colour for it:
 * green when just issued, through yellow, to red as it nears expiry.
 */
export const certificateLifetime = (
	notBefore: string,
	notAfter: string,
	now = Date.now(),
) => {
	const start = new Date(notBefore).getTime();
	const end = new Date(notAfter).getTime();
	const total = Math.max(end - start, 1);
	const elapsed = Math.min(Math.max((now - start) / total, 0), 1);
	const remaining = 1 - elapsed;
	const daysLeft = Math.floor((end - now) / DAY_MS);
	return {
		elapsed,
		remaining,
		daysLeft,
		expired: now >= end,
		color: `hsl(${Math.round(remaining * 120)} 70% 45%)`,
	};
};

const describeDaysLeft = (daysLeft: number, expired: boolean) => {
	if (expired) {
		return `expired ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? "day" : "days"} ago`;
	}
	if (daysLeft < 1) {
		return "expires today";
	}
	return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
};

/**
 * General > Security: every certificate Coder depends on, at a glance. What
 * Coder's address, Keycloak and the database present on the wire (TLS
 * versions, cipher suites, chain, whether it is trusted), and each
 * certificate, CA, private key and PKCS#12 file mounted into Coder. Each
 * certificate's bar shows how much of its lifetime is left, from green (just
 * issued) to red (about to expire). Read by the platform service, which caches
 * it for 10 minutes; Refresh probes again.
 */
export const CertificateOverview: React.FC = () => {
	const queryClient = useQueryClient();
	const { data, error, isLoading } = useQuery(certificates());
	const refresh = useMutation(refreshCertificates(queryClient));

	return (
		<section aria-label="Certificates" className="flex flex-col gap-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="m-0 text-xl font-semibold text-content-primary">
						Certificates
					</h2>
					<p className="m-0 mt-1 text-sm text-content-secondary">
						The TLS endpoints Coder relies on and every certificate, CA and key
						mounted into it, with how long each has until it expires.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					disabled={refresh.isPending}
					onClick={() => refresh.mutate()}
				>
					<RefreshCwIcon className={cn(refresh.isPending && "animate-spin")} />
					{refresh.isPending ? "Probing…" : "Refresh"}
				</Button>
			</div>

			{error || refresh.error ? (
				<ErrorAlert error={refresh.error ?? error} />
			) : null}
			{isLoading && (
				<div className="flex items-center gap-3 text-sm text-content-secondary">
					<Spinner size="sm" loading /> Probing the endpoints (a few seconds)…
				</div>
			)}
			{data && <OverviewBody data={data} />}
		</section>
	);
};

const OverviewBody: React.FC<{ data: CertificatesOverview }> = ({ data }) => {
	const all = [
		...data.endpoints.flatMap((e) => (e.chain ?? []).filter(isCertificate)),
		...data.files.flatMap((f) =>
			(f.items ?? []).filter(
				(i): i is CertificateInfo =>
					i.kind === "certificate" && "notAfter" in i,
			),
		),
	];
	const soonest = all.reduce<CertificateInfo | undefined>(
		(min, c) => (!min || c.notAfter < min.notAfter ? c : min),
		undefined,
	);

	return (
		<>
			{soonest && <Summary count={all.length} soonest={soonest} />}

			<div className="flex flex-col gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base font-medium">
					<GlobeLockIcon aria-hidden className="size-4" />
					Endpoints
				</h3>
				{data.endpoints.length ? (
					data.endpoints.map((e) => <EndpointCard key={e.name} endpoint={e} />)
				) : (
					<p className="m-0 text-sm text-content-secondary">
						No TLS endpoints found.
					</p>
				)}
			</div>

			<div className="flex flex-col gap-3">
				<h3 className="m-0 flex items-center gap-2 text-base font-medium">
					<FileKeyIcon aria-hidden className="size-4" />
					Mounted certificates, CAs and keys
				</h3>
				{data.files.length ? (
					data.files.map((f) => (
						<FileCard key={`${f.source}/${f.key ?? ""}`} file={f} />
					))
				) : (
					<p className="m-0 text-sm text-content-secondary">
						Coder mounts no certificate files.
					</p>
				)}
			</div>

			<p className="m-0 text-xs text-content-secondary">
				Checked {new Date(data.generatedAt).toLocaleString("en-US")}.
			</p>
		</>
	);
};

const Summary: React.FC<{ count: number; soonest: CertificateInfo }> = ({
	count,
	soonest,
}) => {
	const life = certificateLifetime(soonest.notBefore, soonest.notAfter);
	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-solid border-border px-4 py-3 text-sm">
			<span>
				<span className="font-semibold text-content-primary">{count}</span>{" "}
				<span className="text-content-secondary">
					certificates in use (some appear more than once)
				</span>
			</span>
			<span className="text-content-secondary">
				First to expire:{" "}
				<span className="font-medium text-content-primary">
					{soonest.commonName || soonest.subject}
				</span>{" "}
				on {formatDate(soonest.notAfter)} (
				<span style={{ color: life.color }} className="font-medium">
					{describeDaysLeft(life.daysLeft, life.expired)}
				</span>
				)
			</span>
		</div>
	);
};

const EndpointCard: React.FC<{ endpoint: TlsEndpoint }> = ({ endpoint: e }) => {
	const accepted = new Map(
		(e.versions ?? []).map((v) => [v.version, v.cipher]),
	);
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-solid border-border p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-col">
					<span className="font-semibold text-content-primary">{e.name}</span>
					<code className="text-xs text-content-secondary">
						{e.host}:{e.port}
					</code>
				</div>
				{e.trusted === true ? (
					<Badge variant="green" size="sm">
						<ShieldCheckIcon aria-hidden /> Trusted
					</Badge>
				) : e.trusted === false ? (
					<Badge variant="destructive" size="sm" title={e.trustError}>
						<ShieldXIcon aria-hidden /> Not trusted
						{e.trustError ? `: ${e.trustError}` : ""}
					</Badge>
				) : null}
			</div>

			{e.error && !e.negotiated ? (
				<p className="m-0 text-sm text-content-destructive">
					Not reachable: {e.error}
				</p>
			) : (
				<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
					<dt className="text-content-secondary">TLS versions</dt>
					<dd className="m-0 flex flex-wrap gap-1.5">
						{ALL_TLS.map((v) => {
							const on = accepted.has(v);
							return (
								<span
									key={v}
									title={
										on
											? `Accepted (${accepted.get(v)})`
											: "Refused by the server"
									}
									className={cn(
										"rounded px-1.5 py-0.5 text-xs font-medium",
										!on &&
											"bg-surface-tertiary text-content-disabled line-through",
										on &&
											(LEGACY_TLS.has(v)
												? "bg-surface-orange text-content-warning"
												: "bg-surface-green text-content-success"),
									)}
								>
									{v}
								</span>
							);
						})}
					</dd>
					{e.negotiated && (
						<>
							<dt className="text-content-secondary">Negotiated</dt>
							<dd className="m-0">
								{e.negotiated.version.replace("TLSv", "TLS ")} ·{" "}
								<code className="text-xs">{e.negotiated.cipher}</code> ·{" "}
								{e.negotiated.bits}-bit
							</dd>
						</>
					)}
					{(e.ciphers12?.length ?? 0) > 0 && (
						<>
							<dt className="text-content-secondary">TLS 1.2 ciphers</dt>
							<dd className="m-0 flex flex-wrap gap-1.5">
								{e.ciphers12?.map((c) => (
									<code
										key={c}
										className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs"
									>
										{c}
									</code>
								))}
							</dd>
						</>
					)}
					{accepted.has("TLS 1.3") && (
						<>
							<dt className="text-content-secondary">TLS 1.3 cipher</dt>
							<dd className="m-0">
								<code className="text-xs">{accepted.get("TLS 1.3")}</code>
							</dd>
						</>
					)}
				</dl>
			)}

			{(e.chain?.length ?? 0) > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-xs font-medium uppercase tracking-wide text-content-secondary">
						Chain presented
					</span>
					{e.chain?.map((c, i) =>
						isCertificate(c) ? (
							<CertificateCard
								key={c.sha256}
								cert={c}
								role={i === 0 ? "Leaf" : c.selfSigned ? "Root" : "Intermediate"}
							/>
						) : (
							<p key={i} className="m-0 text-sm text-content-destructive">
								{c.error}
							</p>
						),
					)}
				</div>
			)}
		</div>
	);
};

const FileCard: React.FC<{ file: CertificateFile }> = ({ file: f }) => {
	const title = f.key ?? f.source;
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-solid border-border p-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-semibold text-content-primary">{title}</span>
				<span className="text-xs text-content-secondary">
					{f.source}
					{f.mountPath ? (
						<>
							{" "}
							→ <code>{f.mountPath}</code>
						</>
					) : (
						" (not mounted into Coder)"
					)}
				</span>
			</div>
			{f.error && (
				<p className="m-0 text-sm text-content-destructive">{f.error}</p>
			)}
			{f.items?.length === 0 && (
				<p className="m-0 text-sm text-content-secondary">
					No certificate or key in this entry.
				</p>
			)}
			{f.items?.map((item, i) => {
				if (item.kind === "certificate") {
					return "notAfter" in item ? (
						<CertificateCard
							key={item.sha256}
							cert={item}
							role={item.isCA ? "CA" : "Certificate"}
						/>
					) : null;
				}
				if (item.kind === "key") {
					return (
						<div key={i} className="flex flex-wrap items-center gap-2 text-sm">
							<KeyRoundIcon
								aria-hidden
								className="size-4 text-content-secondary"
							/>
							<span className="font-medium">Private key</span>
							<span className="text-content-secondary">
								{item.keyAlgorithm}
								{item.keySize
									? ` ${item.keySize}${typeof item.keySize === "number" ? "-bit" : ""}`
									: ""}
							</span>
							{item.matches ? (
								<Badge variant="green" size="xs">
									matches {item.matches}
								</Badge>
							) : (
								<Badge variant="default" size="xs">
									no matching certificate here
								</Badge>
							)}
						</div>
					);
				}
				return (
					<div key={i} className="flex items-center gap-2 text-sm">
						<PackageIcon
							aria-hidden
							className="size-4 text-content-secondary"
						/>
						<span className="font-medium">PKCS#12 bundle</span>
						<span className="text-content-secondary">
							{item.bytes.toLocaleString("en-US")} bytes (password-protected:
							contents not read)
						</span>
					</div>
				);
			})}
		</div>
	);
};

const CertificateCard: React.FC<{ cert: CertificateInfo; role: string }> = ({
	cert: c,
	role,
}) => {
	const life = certificateLifetime(c.notBefore, c.notAfter);
	return (
		<div className="flex flex-col gap-2 rounded-md bg-surface-secondary p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium text-content-primary">
					{c.commonName || c.subject}
				</span>
				<Badge size="xs">{role}</Badge>
				{c.isCA && role !== "CA" && <Badge size="xs">CA</Badge>}
				{c.selfSigned && <Badge size="xs">self-signed</Badge>}
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-baseline justify-between text-xs">
					<span className="text-content-secondary">
						Issued {formatDate(c.notBefore)}
					</span>
					<span style={{ color: life.color }} className="font-semibold">
						{describeDaysLeft(life.daysLeft, life.expired)}
					</span>
					<span className="text-content-secondary">
						Expires {formatDate(c.notAfter)}
					</span>
				</div>
				<div
					role="progressbar"
					aria-label={`${c.commonName || c.subject}: lifetime used`}
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(life.elapsed * 100)}
					className="h-2 overflow-hidden rounded-full bg-surface-tertiary"
				>
					<div
						className="h-full rounded-full"
						style={{
							width: `${Math.max(life.elapsed * 100, 2)}%`,
							background: life.color,
						}}
					/>
				</div>
			</div>

			<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
				<dt className="text-content-secondary">Issuer</dt>
				<dd className="m-0 break-all">{c.issuerCommonName || c.issuer}</dd>
				{c.sans.length > 0 && (
					<>
						<dt className="text-content-secondary">SANs</dt>
						<dd className="m-0 flex flex-wrap gap-1">
							{c.sans.map((san) => (
								<code
									key={san}
									className="rounded bg-surface-tertiary px-1 py-0.5"
								>
									{san}
								</code>
							))}
						</dd>
					</>
				)}
				<dt className="text-content-secondary">Key</dt>
				<dd className="m-0">
					{c.keyAlgorithm}
					{c.keySize
						? ` ${c.keySize}${typeof c.keySize === "number" ? "-bit" : ""}`
						: ""}{" "}
					· signed with {c.signature}
				</dd>
				{(c.keyUsage.length > 0 || c.extendedKeyUsage.length > 0) && (
					<>
						<dt className="text-content-secondary">Usage</dt>
						<dd className="m-0">
							{[...c.keyUsage, ...c.extendedKeyUsage].join(", ")}
						</dd>
					</>
				)}
				<dt className="text-content-secondary">Serial</dt>
				<dd className="m-0 break-all font-mono">{c.serial}</dd>
				<dt className="text-content-secondary">SHA-256</dt>
				<dd className="m-0 break-all font-mono" title={c.sha256}>
					{c.sha256.match(/.{1,2}/g)?.join(":")}
				</dd>
			</dl>
		</div>
	);
};
