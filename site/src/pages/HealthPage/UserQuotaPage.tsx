import { cn } from "cn";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type {
	QuotaKey,
	QuotaLimits,
	QuotaReport,
	QuotaSettings,
	QuotaUser,
} from "#/api/platform";
import { quotaReport, updateQuota } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Avatar } from "#/components/Avatar/Avatar";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import { Switch } from "#/components/Switch/Switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/Table/Table";
import { TableEmpty } from "#/components/TableEmpty/TableEmpty";
import { pageTitle } from "#/utils/page";
import { Header, HeaderTitle, Main } from "./Content";
import { WorkspaceSchedulerSection } from "./WorkspaceSchedulerSection";

const KEYS: readonly QuotaKey[] = ["workspaces", "cpu", "memory"];

const LABELS: Record<QuotaKey, string> = {
	workspaces: "Workspaces",
	cpu: "CPU cores",
	memory: "Memory (GiB)",
};

const UNITS: Record<QuotaKey, string> = {
	workspaces: "",
	cpu: "cores",
	memory: "GiB",
};

/** What an override field holds to lift the default for one user. */
const NO_LIMIT = "none";

type Draft = {
	default: Record<QuotaKey, string>;
	/** Per user: "" = the default, NO_LIMIT = no limit, else a number. */
	users: Record<string, Record<QuotaKey, string>>;
	exemptAdmins: boolean;
};

const trim = (value: number): string => {
	if (!Number.isFinite(value)) {
		return "0";
	}
	const fixed =
		value >= 100
			? value.toFixed(0)
			: value >= 10
				? value.toFixed(1)
				: value.toFixed(2);
	return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

const emptyRow = (): Record<QuotaKey, string> => ({
	workspaces: "",
	cpu: "",
	memory: "",
});

const toDraft = (s: QuotaSettings): Draft => ({
	default: {
		workspaces: s.default.workspaces?.toString() ?? "",
		cpu: s.default.cpu?.toString() ?? "",
		memory: s.default.memory?.toString() ?? "",
	},
	users: Object.fromEntries(
		Object.entries(s.users).map(([name, o]) => {
			const row = emptyRow();
			for (const k of KEYS) {
				if (k in o) {
					const v = o[k];
					row[k] = v === null || v === undefined ? NO_LIMIT : String(v);
				}
			}
			return [name, row];
		}),
	),
	exemptAdmins: s.exemptAdmins,
});

const toSettings = (d: Draft): QuotaSettings => {
	const num = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
	const users: QuotaSettings["users"] = {};
	for (const [name, row] of Object.entries(d.users)) {
		const o: Partial<QuotaLimits> = {};
		for (const k of KEYS) {
			const v = row[k].trim();
			if (v === "") {
				continue;
			}
			o[k] = v.toLowerCase() === NO_LIMIT ? null : Number(v);
		}
		if (Object.keys(o).length) {
			users[name] = o;
		}
	}
	return {
		default: {
			workspaces: num(d.default.workspaces),
			cpu: num(d.default.cpu),
			memory: num(d.default.memory),
		},
		users,
		exemptAdmins: d.exemptAdmins,
	};
};

const sameSettings = (a: QuotaSettings, b: QuotaSettings) =>
	JSON.stringify(toDraft(a)) === JSON.stringify(toDraft(b));

/** A bar fill by how much of a limit (or of the cluster) is taken. */
const loadColor = (fraction: number) =>
	fraction >= 1
		? "bg-content-destructive"
		: fraction >= 0.75
			? "bg-content-warning"
			: "bg-content-success";

/** Distinct, stable colours for each user's share of the cluster. */
const userColor = (index: number) => `hsl(${(index * 137.508) % 360} 65% 55%)`;

/**
 * Health > User Quota: how many workspaces each developer may have, and how
 * many CPU cores and GiB of memory those workspaces may be built with in all
 * (the template's cpu and memory parameters). A default for everyone, with
 * overrides per user. Coder asks the platform service before it creates a
 * workspace and refuses one that would pass a limit. The charts show what each
 * user's workspaces take against the cluster's capacity.
 */
const UserQuotaPage: React.FC = () => {
	const queryClient = useQueryClient();
	const { data: report, error } = useQuery(quotaReport());
	const save = useMutation(updateQuota(queryClient));
	// What is stored, and the admin's edits to it. The draft follows what is
	// stored (the report refreshes) until the admin edits something.
	const [form, setForm] = useState<{ draft: Draft; saved: QuotaSettings }>();
	useEffect(() => {
		if (!report) {
			return;
		}
		setForm((f) => ({
			saved: report.settings,
			draft:
				!f || sameSettings(toSettings(f.draft), f.saved)
					? toDraft(report.settings)
					: f.draft,
		}));
	}, [report]);
	const draft = form?.draft;
	const saved = form?.saved;
	const setDraft = (next: Draft) => setForm((f) => f && { ...f, draft: next });

	const dirty = Boolean(
		draft && saved && !sameSettings(toSettings(draft), saved),
	);
	const atLimit = report?.users.filter((u) => u.atLimit) ?? [];
	const anyLimit = Boolean(
		saved &&
			(KEYS.some((k) => saved.default[k] !== null) ||
				Object.keys(saved.users).length > 0),
	);

	const onSave = async () => {
		if (!draft) {
			return;
		}
		try {
			const result = await save.mutateAsync(toSettings(draft));
			setForm({ saved: result.settings, draft: toDraft(result.settings) });
			toast.success("User quota saved.");
		} catch (e) {
			toast.error(getErrorMessage(e, "The quota could not be saved."));
		}
	};

	return (
		<>
			<title>{pageTitle("User Quota - Health")}</title>

			<Header>
				<HeaderTitle>
					{report &&
						(atLimit.length ? (
							<TriangleAlertIcon
								aria-hidden
								className="size-4 text-content-warning"
							/>
						) : (
							<CircleCheckIcon
								aria-hidden
								className="size-4 text-content-link"
							/>
						))}
					User Quota
				</HeaderTitle>
				{report && (
					<Badge variant={atLimit.length ? "warning" : "default"}>
						{!anyLimit
							? "No limits set"
							: atLimit.length
								? `${atLimit.length} at the limit`
								: "Everyone within quota"}
					</Badge>
				)}
			</Header>

			<Main>
				{error ? <ErrorAlert error={error} /> : null}
				{!report && !error && <Loader />}
				{report && draft && (
					<>
						<ClusterLoad report={report} />

						<section className="flex flex-col gap-4">
							<div>
								<h3 className="m-0 text-base font-medium">Default quota</h3>
								<p className="m-0 mt-1 text-sm text-content-secondary">
									What every developer may provision in all, across their
									workspaces. Leave a field empty for no limit. Once a limit is
									reached, Coder refuses new workspaces until one is deleted or
									the quota is raised.
								</p>
							</div>
							<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
								{KEYS.map((k) => (
									<div key={k} className="flex flex-col gap-1.5 text-sm">
										<Label htmlFor={`quota-default-${k}`}>{LABELS[k]}</Label>
										<Input
											id={`quota-default-${k}`}
											inputMode="decimal"
											placeholder="No limit"
											value={draft.default[k]}
											onChange={(e) =>
												setDraft({
													...draft,
													default: { ...draft.default, [k]: e.target.value },
												})
											}
										/>
									</div>
								))}
							</div>
							<div className="flex items-center gap-3 text-sm">
								<Switch
									id="quota-exempt-admins"
									checked={draft.exemptAdmins}
									onCheckedChange={(checked) =>
										setDraft({ ...draft, exemptAdmins: checked })
									}
								/>
								<Label htmlFor="quota-exempt-admins">
									Administrators are exempt
								</Label>
							</div>
						</section>

						<section className="flex flex-col gap-4">
							<div>
								<h3 className="m-0 text-base font-medium">
									Developers and what they consume
								</h3>
								<p className="m-0 mt-1 text-sm text-content-secondary">
									Each bar is what a developer's workspaces are built with
									against their limit (or, without one, against the cluster).
									The darker part is what is running now. Override a limit for
									one developer in their row: empty uses the default,{" "}
									<code>{NO_LIMIT}</code> lifts it.
								</p>
							</div>
							<Table aria-label="Developers' quota and usage">
								<TableHeader>
									<TableRow>
										<TableHead className="w-[22%]">Developer</TableHead>
										{KEYS.map((k) => (
											<TableHead key={k}>{LABELS[k]}</TableHead>
										))}
									</TableRow>
								</TableHeader>
								<TableBody>
									{report.users.length ? (
										report.users.map((u, i) => (
											<QuotaRow
												key={u.id}
												user={u}
												color={userColor(i)}
												report={report}
												draft={draft}
												onChange={(row) =>
													setDraft({
														...draft,
														users: { ...draft.users, [u.username]: row },
													})
												}
											/>
										))
									) : (
										<TableEmpty message="No active users." />
									)}
								</TableBody>
							</Table>
						</section>

						<div className="flex items-center gap-3">
							<Button disabled={!dirty || save.isPending} onClick={onSave}>
								{save.isPending ? "Saving…" : "Save quota"}
							</Button>
							{dirty && (
								<Button
									variant="outline"
									onClick={() => saved && setDraft(toDraft(saved))}
								>
									Discard changes
								</Button>
							)}
							<span className="ml-auto text-xs text-content-secondary">
								CPU and memory are read from each workspace's{" "}
								<code>{report.parameters.cpu}</code> and{" "}
								<code>{report.parameters.memory}</code> parameters. Updated{" "}
								{new Date(report.generatedAt).toLocaleTimeString("en-US")}.
							</span>
						</div>
					</>
				)}
				<div className="border-0 border-t border-solid border-border pt-6">
					<WorkspaceSchedulerSection />
				</div>
			</Main>
		</>
	);
};

/**
 * How taxed the cluster is: for CPU and memory, each developer's provisioned
 * share as a coloured segment of the cluster's capacity, with what running
 * pods requested and what is in use (metrics-server) marked on it.
 */
const ClusterLoad: React.FC<{ report: QuotaReport }> = ({ report }) => {
	const { cluster, users } = report;
	if (cluster.error !== undefined) {
		return (
			<p className="m-0 text-sm text-content-secondary">
				The cluster's capacity is not readable: {cluster.error}
			</p>
		);
	}
	const rows = [
		{
			kind: "cpu" as const,
			label: "CPU",
			unit: "cores",
			total: cluster.cpu,
			requested: cluster.requestedCpu,
			used: cluster.usedCpu,
		},
		{
			kind: "memory" as const,
			label: "Memory",
			unit: "GiB",
			total: cluster.memory,
			requested: cluster.requestedMemory,
			used: cluster.usedMemory,
		},
	];

	return (
		<section className="flex flex-col gap-4">
			<div>
				<h3 className="m-0 text-base font-medium">Cluster load</h3>
				<p className="m-0 mt-1 text-sm text-content-secondary">
					What developers' workspaces are built with, each in their colour,
					against the cluster's {cluster.nodes}{" "}
					{cluster.nodes === 1 ? "node" : "nodes"}. The dashed line is what all
					pods reserve; the solid line what is in use
					{cluster.live ? "" : " (no metrics-server: reservations shown)"}.
				</p>
			</div>
			{rows.map((r) => {
				const provisioned = users.reduce((sum, u) => sum + u.usage[r.kind], 0);
				const scale = Math.max(r.total, provisioned, r.requested, 1e-9);
				const pct = (v: number) => `${Math.min((v / scale) * 100, 100)}%`;
				const share = r.total ? provisioned / r.total : 0;
				return (
					<div key={r.kind} className="flex flex-col gap-1.5">
						<div className="flex items-baseline justify-between text-sm">
							<span className="font-medium">{r.label}</span>
							<span className="text-content-secondary">
								{trim(provisioned)} of {trim(r.total)} {r.unit} provisioned (
								<span
									className={cn(
										share >= 1
											? "text-content-destructive"
											: share >= 0.75
												? "text-content-warning"
												: "text-content-success",
									)}
								>
									{Math.round(share * 100)}%
								</span>
								) · {trim(r.used)} in use · {trim(r.requested)} reserved
							</span>
						</div>
						<div
							role="img"
							aria-label={`${r.label}: ${trim(provisioned)} of ${trim(r.total)} ${r.unit} provisioned`}
							className="relative h-5 overflow-hidden rounded bg-surface-tertiary"
						>
							<div className="absolute inset-0 flex">
								{users.map((u, i) =>
									u.usage[r.kind] > 0 ? (
										<div
											key={u.id}
											title={`${u.username}: ${trim(u.usage[r.kind])} ${r.unit} in ${u.usage.workspaces} ${u.usage.workspaces === 1 ? "workspace" : "workspaces"}`}
											className="h-full border-0 border-r border-solid border-surface-primary"
											style={{
												width: pct(u.usage[r.kind]),
												background: userColor(i),
											}}
										/>
									) : null,
								)}
							</div>
							{r.total < scale && (
								<div
									title="The cluster's capacity: beyond this line it is overcommitted"
									className="absolute inset-y-0 w-0.5 bg-content-destructive"
									style={{ left: pct(r.total) }}
								/>
							)}
							<div
								title={`Reserved by all pods: ${trim(r.requested)} ${r.unit}`}
								className="absolute inset-y-0 w-0 border-0 border-l-2 border-dashed border-content-primary"
								style={{ left: pct(r.requested) }}
							/>
							<div
								title={`In use: ${trim(r.used)} ${r.unit}`}
								className="absolute inset-y-0 w-0.5 bg-content-primary"
								style={{ left: pct(r.used) }}
							/>
						</div>
					</div>
				);
			})}
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
				{users.map((u, i) =>
					u.usage.workspaces ? (
						<span key={u.id} className="inline-flex items-center gap-1.5">
							<span
								aria-hidden
								className="size-2.5 rounded-sm"
								style={{ background: userColor(i) }}
							/>
							{u.username}
						</span>
					) : null,
				)}
			</div>
		</section>
	);
};

type QuotaRowProps = {
	user: QuotaUser;
	color: string;
	report: QuotaReport;
	draft: Draft;
	onChange: (row: Record<QuotaKey, string>) => void;
};

const QuotaRow: React.FC<QuotaRowProps> = ({
	user,
	color,
	report,
	draft,
	onChange,
}) => {
	const row = draft.users[user.username] ?? emptyRow();
	const cluster = report.cluster.error === undefined ? report.cluster : null;
	const capacity: Record<QuotaKey, number | null> = {
		workspaces: null,
		cpu: cluster?.cpu ?? null,
		memory: cluster?.memory ?? null,
	};
	const running: Record<QuotaKey, number> = {
		workspaces: user.usage.running,
		cpu: user.usage.runningCpu,
		memory: user.usage.runningMemory,
	};
	const live: Record<QuotaKey, number | null> = {
		workspaces: null,
		cpu: user.usage.liveCpu,
		memory: user.usage.liveMemory,
	};
	const exempt = user.admin && draft.exemptAdmins;

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-3">
					<span
						aria-hidden
						className="h-8 w-1 shrink-0 rounded-full"
						style={{ background: color }}
					/>
					<Avatar size="sm" src={user.avatar} fallback={user.username} />
					<div className="flex min-w-0 flex-col">
						<span className="truncate font-semibold">{user.username}</span>
						<span className="flex gap-1.5 text-xs text-content-secondary">
							{exempt ? "admin · exempt" : user.admin ? "admin" : "developer"}
							{user.atLimit && !exempt && (
								<span className="text-content-destructive">· at limit</span>
							)}
						</span>
					</div>
				</div>
			</TableCell>
			{KEYS.map((k) => {
				const own = row[k].trim();
				const fallback = draft.default[k].trim();
				const effective =
					exempt || own.toLowerCase() === NO_LIMIT
						? null
						: own !== ""
							? Number(own)
							: fallback !== ""
								? Number(fallback)
								: null;
				const used = user.usage[k];
				const scale =
					effective !== null && Number.isFinite(effective) && effective > 0
						? effective
						: (capacity[k] ?? Math.max(used, 1));
				const fraction = scale ? used / scale : 0;
				const liveValue = live[k];
				return (
					<TableCell key={k}>
						<div className="flex flex-col gap-1.5">
							<div className="flex items-baseline justify-between gap-2 text-xs">
								<span className="font-medium text-content-primary">
									{trim(used)}
									{effective !== null && Number.isFinite(effective)
										? ` / ${trim(effective)}`
										: ""}{" "}
									{UNITS[k]}
								</span>
								<span className="text-content-secondary">
									{running[k] ? `${trim(running[k])} running` : ""}
									{liveValue !== null && liveValue !== undefined
										? ` · ${trim(liveValue)} live`
										: ""}
								</span>
							</div>
							<div
								role="progressbar"
								aria-label={`${user.username}: ${LABELS[k]}`}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(Math.min(fraction, 1) * 100)}
								className="relative h-2 overflow-hidden rounded-full bg-surface-tertiary"
							>
								<div
									className={cn(
										"absolute inset-y-0 left-0 opacity-50",
										effective !== null
											? loadColor(fraction)
											: "bg-content-secondary",
									)}
									style={{ width: `${Math.min(fraction, 1) * 100}%` }}
								/>
								<div
									className={cn(
										"absolute inset-y-0 left-0",
										effective !== null
											? loadColor(fraction)
											: "bg-content-secondary",
									)}
									style={{
										width: `${Math.min(scale ? running[k] / scale : 0, 1) * 100}%`,
									}}
								/>
							</div>
							<Input
								aria-label={`${LABELS[k]} for ${user.username}`}
								className="h-7 text-xs"
								inputMode="decimal"
								disabled={exempt}
								placeholder={
									exempt
										? "exempt"
										: fallback !== ""
											? `default: ${fallback}`
											: "default: no limit"
								}
								value={row[k]}
								onChange={(e) => onChange({ ...row, [k]: e.target.value })}
							/>
						</div>
					</TableCell>
				);
			})}
		</TableRow>
	);
};

export default UserQuotaPage;
