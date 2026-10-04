import { cn } from "cn";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type {
	KeycloakCheck,
	KeycloakFix,
	KeycloakReport,
	KeycloakSettings,
} from "#/api/platform";
import {
	applyKeycloakFixes,
	connectKeycloak,
	keycloakReport,
	undoKeycloakChange,
} from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Checkbox } from "#/components/Checkbox/Checkbox";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { Spinner } from "#/components/Spinner/Spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import {
	CHECK_STATUS_LABELS,
	CHECK_STATUS_VARIANTS,
	worstCheckStatus,
} from "#/modules/platform/checkStatus";

const FIX_LABELS: Record<KeycloakFix, string> = {
	"kc.client": "Create / repair the Keycloak client",
	"kc.scopes": "Add the profile and e-mail scopes",
	"coder.secret": "Copy the client secret into Coder's Secret",
	"coder.ca": "Give Coder Keycloak's CA",
	"coder.values": "Update Coder's OIDC settings (Coder restarts)",
};

// The settings field <- the Coder setting it becomes, to show what Coder has now.
const ENV_FOR: Partial<Record<keyof KeycloakSettings, string>> = {
	clientId: "CODER_OIDC_CLIENT_ID",
	scopes: "CODER_OIDC_SCOPES",
	usernameField: "CODER_OIDC_USERNAME_FIELD",
	emailField: "CODER_OIDC_EMAIL_FIELD",
	signInText: "CODER_OIDC_SIGN_IN_TEXT",
	iconUrl: "CODER_OIDC_ICON_URL",
};

const TEXT_FIELDS: {
	name: keyof KeycloakSettings;
	label: string;
	type?: string;
}[] = [
	{ name: "keycloakUrl", label: "Keycloak address", type: "url" },
	{ name: "realm", label: "Realm" },
	{ name: "clientId", label: "OIDC client ID" },
	{ name: "scopes", label: "Scopes" },
	{ name: "usernameField", label: "Username claim" },
	{ name: "emailField", label: "E-mail claim" },
	{ name: "signInText", label: "Sign-in button text" },
	{ name: "iconUrl", label: "Sign-in button icon" },
	{ name: "flowAlias", label: "Certificate sign-in flow (Keycloak)" },
];

const DEFAULT_SETTINGS: KeycloakSettings = {
	keycloakUrl: "",
	realm: "master",
	clientId: "coder",
	scopes: "openid,profile,email",
	usernameField: "preferred_username",
	emailField: "email",
	signInText: "Sign in with Keycloak",
	iconUrl: "/icon/keycloak.svg",
	flowAlias: "x509-browser",
	tokenLifespan: 36000,
	allowSignups: true,
	ignoreEmailVerified: true,
};

/** "kc.connect" is not applied like the others: an admin signs in once instead. */
const fixesNeeded = (report: KeycloakReport): KeycloakFix[] => [
	...new Set(
		report.checks.flatMap((c) =>
			c.fix && c.fix !== "kc.connect" ? [c.fix] : [],
		),
	),
];

/**
 * Keycloak sign-in for Coder: discovers how Keycloak and Coder are set up,
 * shows every check with what is there now and what it should be, and applies
 * the suggested fixes on approval (the platform service does the work through
 * Keycloak's admin API and the Secrets Coder reads).
 */
export const KeycloakView: React.FC = () => {
	const queryClient = useQueryClient();
	const reportQuery = useQuery(keycloakReport());
	const report = reportQuery.data;
	const apply = useMutation(applyKeycloakFixes(queryClient));
	const undo = useMutation(undoKeycloakChange(queryClient));
	const [draft, setDraft] = useState<KeycloakSettings | null>(null);
	const [pending, setPending] = useState<KeycloakFix[] | null>(null);
	const [confirmUndo, setConfirmUndo] = useState(false);

	if (reportQuery.isLoading) {
		return <Loader />;
	}
	if (!report) {
		return <ErrorAlert error={reportQuery.error} />;
	}

	const discovered: KeycloakSettings = {
		...DEFAULT_SETTINGS,
		...report.facts.settings,
	};
	const settings = draft ?? discovered;
	const fixes = fixesNeeded(report);

	const applyFixes = (list: KeycloakFix[]) =>
		apply.mutate(
			{ fixes: list, settings },
			{
				onSuccess: ({ done }) => {
					setPending(null);
					setDraft(null);
					toast.success(`${done.join(". ")}.`);
				},
				onError: (error) => {
					setPending(null);
					toast.error(
						getErrorMessage(error, "The fixes could not be applied."),
					);
				},
			},
		);

	return (
		<div className="flex flex-col gap-6">
			<StatusCard
				report={report}
				fixes={fixes}
				checking={reportQuery.isFetching}
				onApproveAll={() => setPending(fixes)}
				onRecheck={() => {
					void reportQuery.refetch();
				}}
				onUndo={() => setConfirmUndo(true)}
			/>
			{report.facts.keycloakConnected === false && (
				<ConnectCard settings={settings} />
			)}
			<ChecksCard
				report={report}
				onFix={(fix) => setPending([fix])}
				checkedAt={reportQuery.dataUpdatedAt}
			/>
			<SettingsCard
				report={report}
				settings={settings}
				onChange={(change) => setDraft({ ...settings, ...change })}
				onReset={() => setDraft(null)}
				onApply={() =>
					setPending([
						"kc.client",
						"kc.scopes",
						"coder.secret",
						"coder.ca",
						...(report.facts.canEditCoder ? (["coder.values"] as const) : []),
					])
				}
			/>
			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={pending !== null}
				title="Apply these changes?"
				confirmText="Apply"
				confirmLoading={apply.isPending}
				description={
					<div className="flex flex-col gap-3">
						<ul className="m-0 pl-5">
							{pending?.map((fix) => (
								<li key={fix}>{FIX_LABELS[fix]}</li>
							))}
						</ul>
						{pending?.includes("coder.values") && (
							<p className="m-0">
								Coder restarts to pick up the new settings (about 30 seconds).
								Signed-in users stay signed in.
							</p>
						)}
					</div>
				}
				onClose={() => setPending(null)}
				onConfirm={() => pending && applyFixes(pending)}
			/>
			<ConfirmDialog
				type="info"
				hideCancel={false}
				open={confirmUndo}
				title="Undo the last change"
				description="Put Coder's previous sign-in settings back? Coder restarts."
				confirmText="Undo"
				confirmLoading={undo.isPending}
				onClose={() => setConfirmUndo(false)}
				onConfirm={() =>
					undo.mutate(undefined, {
						onSuccess: ({ done }) => {
							setConfirmUndo(false);
							setDraft(null);
							toast.success(`${done.join(". ")}.`);
						},
						onError: (error) => {
							setConfirmUndo(false);
							toast.error(
								getErrorMessage(error, "The change could not be undone."),
							);
						},
					})
				}
			/>
		</div>
	);
};

type StatusCardProps = {
	report: KeycloakReport;
	fixes: KeycloakFix[];
	checking: boolean;
	onApproveAll: () => void;
	onRecheck: () => void;
	onUndo: () => void;
};

const StatusCard: React.FC<StatusCardProps> = ({
	report,
	fixes,
	checking,
	onApproveAll,
	onRecheck,
	onUndo,
}) => {
	const { checks, facts } = report;
	const level = worstCheckStatus(checks);
	const problems = checks.filter(
		(c) => c.status === "error" || c.status === "warn",
	).length;
	const s = facts.settings ?? {};
	const factRows: [string, string | null | undefined][] = [
		["Keycloak", s.keycloakUrl],
		["Realm", s.realm],
		["OIDC client", s.clientId],
		["Coder", facts.coderUrl],
		[
			"Coder's settings",
			facts.argoApp
				? `Argo CD Application ${facts.argoApp}`
				: "not editable from here",
		],
	];

	return (
		<section
			aria-labelledby="keycloak-status"
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex items-start gap-4">
				<span
					aria-hidden
					className={cn(
						"mt-1.5 size-3 shrink-0 rounded-full",
						level === "error"
							? "bg-content-destructive"
							: level === "warn"
								? "bg-content-warning"
								: "bg-content-success",
					)}
				/>
				<div>
					<h2 id="keycloak-status" className="m-0 text-base font-semibold">
						{level === "ok"
							? "Keycloak sign-in for Coder is set up correctly"
							: `${problems} ${problems === 1 ? "thing needs" : "things need"} attention`}
					</h2>
					<p className="m-0 text-sm text-content-secondary">
						{level === "ok"
							? "Everything below was checked just now."
							: facts.keycloakConnected === false
								? "Connect to Keycloak below (once) so Keycloak's side can be checked and repaired too."
								: fixes.length
									? "Review the suggestions below, then approve them. Nothing changes until you do."
									: "These cannot be fixed from here; the details below say what to do."}
					</p>
				</div>
			</div>
			<dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
				{factRows.map(([key, value]) => (
					<div key={key} className="contents">
						<dt className="text-content-secondary">{key}</dt>
						<dd className="m-0 break-all">{value || "N/A"}</dd>
					</div>
				))}
			</dl>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					disabled={!fixes.length}
					title={fixes.map((fix) => FIX_LABELS[fix]).join("\n")}
					onClick={onApproveAll}
				>
					{fixes.length
						? `Approve suggested fixes (${fixes.length})`
						: "Nothing to fix"}
				</Button>
				<Button variant="outline" disabled={checking} onClick={onRecheck}>
					<Spinner loading={checking} />
					Re-check
				</Button>
				{facts.undo && (
					<Button
						variant="subtle"
						title={`Saved ${new Date(facts.undo.savedAt).toLocaleString("en-US")} by ${facts.undo.savedBy}`}
						onClick={onUndo}
					>
						Undo the last change to Coder's settings
					</Button>
				)}
			</div>
		</section>
	);
};

const ConnectCard: React.FC<{ settings: KeycloakSettings }> = ({
	settings,
}) => {
	const id = useId();
	const queryClient = useQueryClient();
	const connect = useMutation(connectKeycloak(queryClient));
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");

	return (
		<section
			aria-labelledby={`${id}-connect`}
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id={`${id}-connect`} className="m-0 text-base font-semibold">
					Connect to Keycloak
				</h2>
				<Badge variant="destructive">not connected</Badge>
			</div>
			<p className="m-0 text-sm text-content-secondary">
				This view needs Keycloak's admin API to check and repair Coder's client.
				Sign in once with a Keycloak admin account: the password is used for
				this one request and is not stored. It creates a service account client{" "}
				<code>coder-ui-updates</code> in the master realm with only the roles
				needed for Coder's realm (view the realm, view and manage clients, view
				and look up users). Delete that client in Keycloak to revoke access.
			</p>
			<form
				autoComplete="off"
				className="grid gap-4 md:grid-cols-2"
				onSubmit={(event) => {
					event.preventDefault();
					connect.mutate(
						{ username: username.trim(), password, settings },
						{
							onSuccess: ({ done }) => {
								setUsername("");
								toast.success(done.join(" "));
							},
							onError: (error) => {
								toast.error(
									getErrorMessage(error, "Could not connect to Keycloak."),
								);
							},
							onSettled: () => setPassword(""),
						},
					);
				}}
			>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-username`}>Keycloak admin username</Label>
					<Input
						id={`${id}-username`}
						autoComplete="username"
						required
						value={username}
						onChange={(event) => setUsername(event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor={`${id}-password`}>Password</Label>
					<Input
						id={`${id}-password`}
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</div>
				<div>
					<Button type="submit" disabled={connect.isPending}>
						<Spinner loading={connect.isPending} />
						Connect
					</Button>
				</div>
			</form>
		</section>
	);
};

type ChecksCardProps = {
	report: KeycloakReport;
	checkedAt: number;
	onFix: (fix: KeycloakFix) => void;
};

const CHECK_GROUPS = ["Connection", "Keycloak", "Coder"];

const ChecksCard: React.FC<ChecksCardProps> = ({
	report,
	checkedAt,
	onFix,
}) => (
	<section
		aria-labelledby="keycloak-checks"
		className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
	>
		<div className="flex flex-wrap items-center justify-between gap-3">
			<h2 id="keycloak-checks" className="m-0 text-base font-semibold">
				What was found
			</h2>
			{checkedAt > 0 && (
				<span className="text-xs text-content-secondary" data-pixel="ignore">
					Checked {new Date(checkedAt).toLocaleTimeString("en-US")}
				</span>
			)}
		</div>
		{CHECK_GROUPS.map((group) => {
			const checks = report.checks.filter((c) => c.group === group);
			if (!checks.length) {
				return null;
			}
			return (
				<div key={group} className="flex flex-col gap-2">
					<h3 className="m-0 text-sm font-semibold">{group}</h3>
					{checks.map((check) => (
						<CheckRow
							key={check.id}
							check={check}
							report={report}
							onFix={onFix}
						/>
					))}
				</div>
			);
		})}
	</section>
);

type CheckRowProps = {
	check: KeycloakCheck;
	report: KeycloakReport;
	onFix: (fix: KeycloakFix) => void;
};

const CheckRow: React.FC<CheckRowProps> = ({ check, report, onFix }) => {
	const diffs = check.id === "coder.env" ? (report.facts.envDiffs ?? []) : [];
	return (
		<div className="grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-md border border-solid border-border p-3">
			<Badge size="xs" variant={CHECK_STATUS_VARIANTS[check.status]}>
				{CHECK_STATUS_LABELS[check.status]}
			</Badge>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="text-sm font-medium">{check.title}</span>
				{(check.current || check.expected) && (
					<span className="flex flex-wrap items-center gap-2 font-mono text-xs [overflow-wrap:anywhere]">
						{check.current && <span>{check.current}</span>}
						{check.expected && (
							<>
								<span aria-hidden className="text-content-secondary">
									→
								</span>
								<span className="text-content-success">{check.expected}</span>
							</>
						)}
					</span>
				)}
				{check.detail && (
					<p className="m-0 text-xs text-content-secondary">{check.detail}</p>
				)}
				{diffs.length > 0 && (
					<Table aria-label="Coder settings that differ">
						<TableHeader>
							<TableRow>
								<TableHead>Coder setting</TableHead>
								<TableHead>Now</TableHead>
								<TableHead>Suggested</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{diffs.map((diff) => (
								<TableRow key={diff.name}>
									<TableCell>
										<code>{diff.name}</code>
									</TableCell>
									<TableCell>
										{diff.current === null ? (
											<span className="text-content-secondary">not set</span>
										) : (
											<code>{diff.current}</code>
										)}
									</TableCell>
									<TableCell>
										<code>{diff.expected}</code>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>
			{check.fix === "kc.connect" ? (
				<span className="text-xs text-content-secondary">Connect below</span>
			) : check.fix ? (
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						if (check.fix && check.fix !== "kc.connect") {
							onFix(check.fix);
						}
					}}
				>
					Fix
				</Button>
			) : (
				<span />
			)}
		</div>
	);
};

type SettingsCardProps = {
	report: KeycloakReport;
	settings: KeycloakSettings;
	onChange: (change: Partial<KeycloakSettings>) => void;
	onReset: () => void;
	onApply: () => void;
};

const SettingsCard: React.FC<SettingsCardProps> = ({
	report,
	settings,
	onChange,
	onReset,
	onApply,
}) => {
	const id = useId();
	const diffs = new Map(
		(report.facts.envDiffs ?? []).map((diff) => [diff.name, diff]),
	);
	const discoveredUrl = report.facts.discoveredKeycloakUrl;
	const tokenHours =
		Math.round(((settings.tokenLifespan || 36000) / 3600) * 10) / 10;

	return (
		<section
			aria-labelledby={`${id}-settings`}
			className="flex flex-col gap-4 rounded-lg border border-solid border-border p-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id={`${id}-settings`} className="m-0 text-base font-semibold">
					Settings
				</h2>
				<span className="text-xs text-content-secondary">
					Pre-filled with what was discovered; suggested values are marked.
				</span>
			</div>
			<form
				autoComplete="off"
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					onApply();
				}}
			>
				<div className="grid gap-4 md:grid-cols-2">
					{TEXT_FIELDS.map(({ name, label, type }) => {
						const env = ENV_FOR[name];
						const diff = env ? diffs.get(env) : undefined;
						const value = settings[name];
						return (
							<div key={name} className="flex flex-col gap-1.5">
								<Label htmlFor={`${id}-${name}`}>{label}</Label>
								<Input
									id={`${id}-${name}`}
									type={type ?? "text"}
									value={typeof value === "string" ? value : String(value)}
									onChange={(event) => onChange({ [name]: event.target.value })}
								/>
								{diff && (
									<span className="text-xs text-content-warning">
										Suggested. Coder has now: {diff.current ?? "not set"}
									</span>
								)}
								{name === "keycloakUrl" && discoveredUrl && (
									<span className="text-xs text-content-secondary">
										{discoveredUrl !== settings.keycloakUrl ? (
											<>
												Discovered in the cluster:{" "}
												<Button
													variant="subtle"
													size="sm"
													className="h-auto px-1 py-0 underline"
													onClick={() =>
														onChange({ keycloakUrl: discoveredUrl })
													}
												>
													use {discoveredUrl}
												</Button>
											</>
										) : (
											"Discovered from the Keycloak resource in the cluster."
										)}
									</span>
								)}
							</div>
						);
					})}
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${id}-hours`}>Session length (hours)</Label>
						<Input
							id={`${id}-hours`}
							type="number"
							min={0.1}
							max={168}
							step={0.5}
							value={tokenHours}
							onChange={(event) => {
								const hours = Number(event.target.value);
								if (Number.isFinite(hours) && hours > 0) {
									onChange({ tokenLifespan: Math.round(hours * 3600) });
								}
							}}
						/>
					</div>
				</div>
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-2 text-sm">
						<Checkbox
							id={`${id}-signups`}
							checked={settings.allowSignups}
							onCheckedChange={(checked) =>
								onChange({ allowSignups: checked === true })
							}
						/>
						<Label htmlFor={`${id}-signups`} className="font-normal">
							New Keycloak users may create a Coder account
						</Label>
					</div>
					<div className="flex items-center gap-2 text-sm">
						<Checkbox
							id={`${id}-unverified`}
							checked={settings.ignoreEmailVerified}
							onCheckedChange={(checked) =>
								onChange({ ignoreEmailVerified: checked === true })
							}
						/>
						<Label htmlFor={`${id}-unverified`} className="font-normal">
							Accept unverified e-mail addresses
						</Label>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button type="submit">Apply these settings</Button>
					<Button variant="outline" onClick={onReset}>
						Back to discovered values
					</Button>
				</div>
			</form>
		</section>
	);
};
