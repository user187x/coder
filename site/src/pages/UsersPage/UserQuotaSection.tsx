import { cn } from "cn";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorMessage } from "#/api/errors";
import type {
	QuotaKey,
	QuotaLimits,
	QuotaReport,
	QuotaResourceModes,
	QuotaSettings,
} from "#/api/platform";
import { quotaReport, updateQuota } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Badge } from "#/components/Badge/Badge";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { Loader } from "#/components/Loader/Loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/Select/Select";
import { Switch } from "#/components/Switch/Switch";
import { TableCell } from "#/components/Table/Table";
import { QuotaAdjustments } from "#/modules/platform/quotaRequests/QuotaAdjustments";
import { Header, HeaderTitle, Main } from "#/pages/HealthPage/Content";
import { WorkspaceSchedulerSection } from "#/pages/HealthPage/WorkspaceSchedulerSection";
import { QuotaClusterLoad } from "./QuotaClusterLoad";
import { formatQuotaNumber, quotaUserColor } from "./quotaFormatting";

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
	resourceModes: QuotaResourceModes;
	default: Record<QuotaKey, string>;
	/** Per user: "" = the default, NO_LIMIT = no limit, else a number. */
	users: Record<string, Record<QuotaKey, string>>;
	exemptAdmins: boolean;
};

const emptyRow = (): Record<QuotaKey, string> => ({
	workspaces: "",
	cpu: "",
	memory: "",
});

const toDraft = (s: QuotaSettings): Draft => ({
	resourceModes: s.resourceModes ?? { cpu: "cumulative", memory: "cumulative" },
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
		resourceModes: d.resourceModes,
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

/**
 * Health > User Quota: how many workspaces each developer may have, and how
 * many CPU cores and GiB of memory those workspaces may be built with in all
 * (the template's cpu and memory parameters). A default for everyone, with
 * overrides per user. Coder asks the platform service before it creates a
 * workspace and refuses one that would pass a limit. The charts show what each
 * user's workspaces take against the cluster's capacity.
 */
/**
 * User Quota, at the top of Accounts: what every developer may provision and
 * each one's overrides, their usage, the cluster's load and the workspace
 * scheduler.
 */
type QuotaEditorState = {
	report?: QuotaReport;
	error: unknown;
	draft?: Draft;
	saved?: QuotaSettings;
	dirty: boolean;
	saving: boolean;
	setDraft: (draft: Draft) => void;
	onSave: () => void;
	onDiscard: () => void;
};
export const QuotaEditorContext = createContext<QuotaEditorState | undefined>(
	undefined,
);

/** Shares one quota draft between account rows and their default controls. */
export const UserQuotaProvider: React.FC<{
	enabled: boolean;
	children: React.ReactNode;
}> = ({ enabled, children }) => {
	const queryClient = useQueryClient();
	const { data: report, error } = useQuery({ ...quotaReport(), enabled });
	const save = useMutation(updateQuota(queryClient));
	const [edited, setEdited] = useState<Draft>();
	const draft = edited ?? (report ? toDraft(report.settings) : undefined);
	const saved = report?.settings;
	const dirty = Boolean(
		draft && saved && !sameSettings(toSettings(draft), saved),
	);
	const onSave = () => {
		if (draft) {
			const rows = [draft.default, ...Object.values(draft.users)];
			for (const row of rows)
				for (const key of KEYS) {
					const value = row[key].trim();
					if (
						value !== "" &&
						value.toLowerCase() !== NO_LIMIT &&
						(!Number.isFinite(Number(value)) ||
							Number(value) < 0 ||
							(key === "workspaces" && !Number.isInteger(Number(value))))
					) {
						toast.error(
							"Quota values must be non-negative numbers; workspace counts must be whole numbers.",
						);
						return;
					}
				}
		}
		if (draft)
			save.mutate(toSettings(draft), {
				onSuccess: (result) => {
					queryClient.setQueryData<QuotaReport>(
						quotaReport().queryKey,
						(before) =>
							before ? { ...before, settings: result.settings } : before,
					);
					setEdited(undefined);
					toast.success("User quota saved.");
				},
				onError: (error) =>
					toast.error(getErrorMessage(error, "The quota could not be saved.")),
			});
	};
	const value = enabled
		? {
				report,
				error,
				draft,
				saved,
				dirty,
				saving: save.isPending,
				setDraft: setEdited,
				onSave,
				onDiscard: () => setEdited(undefined),
			}
		: undefined;
	return (
		<QuotaEditorContext.Provider value={value}>
			{children}
		</QuotaEditorContext.Provider>
	);
};

export const UserQuotaSection: React.FC<{
	quotaAdjustments?: React.ReactNode;
}> = ({ quotaAdjustments }) => {
	const quota = useContext(QuotaEditorContext);
	if (!quota) return null;
	const {
		report,
		error,
		draft,
		saved,
		dirty,
		saving,
		setDraft,
		onSave,
		onDiscard,
	} = quota;
	const atLimit = report?.users.filter((u) => u.atLimit) ?? [];
	const anyLimit = Boolean(
		saved &&
			(KEYS.some((k) => saved.default[k] !== null) ||
				Object.keys(saved.users).length > 0),
	);

	return (
		<>
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
						<QuotaClusterLoad report={report} />

						<section className="flex flex-col gap-4">
							<div>
								<h3 className="m-0 text-base font-medium">Default quota</h3>
								<p className="m-0 mt-1 text-sm text-content-secondary">
									Choose whether CPU and memory limits apply cumulatively across
									workspaces or separately to each instance. These modes also
									apply to account overrides. Leave a field empty for no limit.
									Coder refuses new workspaces and increased allocations that
									exceed a limit. Existing workspaces may restart unchanged or
									with fewer resources.
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
										{k !== "workspaces" && (
											<>
												<Label htmlFor={`quota-mode-${k}`}>
													{LABELS[k]} limit applies to
												</Label>
												<Select
													value={draft.resourceModes[k]}
													disabled={saving}
													onValueChange={(value) => {
														if (value === "cumulative" || value === "instance")
															setDraft({
																...draft,
																resourceModes: {
																	...draft.resourceModes,
																	[k]: value,
																},
															});
													}}
												>
													<SelectTrigger id={`quota-mode-${k}`}>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="cumulative">
															Cumulative across workspaces
														</SelectItem>
														<SelectItem value="instance">
															Per workspace instance
														</SelectItem>
													</SelectContent>
												</Select>
											</>
										)}
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

						<p className="m-0 text-sm text-content-secondary">
							Open an account’s Resources panel above to see allocations against
							its effective quota, with darker bars for running workspaces and
							live usage. Empty overrides use the default;{" "}
							<code>{NO_LIMIT}</code> removes the limit. Approved additions
							apply globally until revoked.
						</p>
						{quotaAdjustments ?? <QuotaAdjustments />}

						<div className="flex items-center gap-3">
							<Button disabled={!dirty || saving} onClick={onSave}>
								{saving ? "Saving…" : "Save quota"}
							</Button>
							{dirty && (
								<Button variant="outline" onClick={onDiscard}>
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

/** The account table's allocation, running usage, live usage and editable quota. */
export const QuotaUsageCells: React.FC<{ userId: string }> = ({ userId }) => {
	const quota = useContext(QuotaEditorContext);
	const user = quota?.report?.users.find((u) => u.id === userId);
	if (!quota?.report || !quota.draft || !user)
		return (
			<>
				{KEYS.map((k) => (
					<TableCell
						key={k}
						data-label={LABELS[k]}
						className="text-xs text-content-secondary"
					>
						{quota?.error
							? "Quota unavailable"
							: quota?.report
								? "No resource data"
								: "Loading quota…"}
					</TableCell>
				))}
			</>
		);
	const { report, draft, setDraft } = quota;
	const onChange = (row: Record<QuotaKey, string>) =>
		setDraft({ ...draft, users: { ...draft.users, [user.username]: row } });
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
		<>
			{KEYS.map((k) => {
				const own = row[k].trim();
				const fallback = draft.default[k].trim();
				const base =
					exempt || own.toLowerCase() === NO_LIMIT
						? null
						: own !== ""
							? Number(own)
							: fallback !== ""
								? Number(fallback)
								: null;
				const bonus = user.bonus?.[k] ?? 0;
				const effective = base === null ? null : base + bonus;
				const perInstance =
					k !== "workspaces" && draft.resourceModes[k] === "instance";
				const used = perInstance
					? Math.max(0, ...user.workspaces.map((w) => w[k]))
					: user.usage[k];
				const runningUsed = perInstance
					? Math.max(
							0,
							...user.workspaces.filter((w) => w.running).map((w) => w[k]),
						)
					: running[k];
				const scale =
					effective !== null && Number.isFinite(effective) && effective > 0
						? effective
						: (capacity[k] ?? Math.max(used, 1));
				const fraction = scale ? used / scale : 0;
				const liveValue = live[k];
				return (
					<TableCell key={k} data-label={LABELS[k]}>
						<div className="flex flex-col gap-1.5">
							<div className="flex items-baseline justify-between gap-2 text-xs">
								<span className="font-medium text-content-primary">
									{k === "workspaces" && (
										<span
											aria-hidden
											className="mr-1.5 inline-block size-2 rounded-sm"
											style={{
												background: quotaUserColor(
													report.users.findIndex((u) => u.id === user.id),
												),
											}}
										/>
									)}
									{formatQuotaNumber(used)}
									{effective !== null && Number.isFinite(effective)
										? ` / ${formatQuotaNumber(effective)}`
										: ""}{" "}
									{UNITS[k]}
									{perInstance ? " / instance (largest)" : ""}
								</span>
								<span className="text-content-secondary">
									{runningUsed
										? `${formatQuotaNumber(runningUsed)} running`
										: ""}
									{liveValue !== null && liveValue !== undefined
										? ` · ${formatQuotaNumber(liveValue)} ${perInstance ? "total live" : "live"}`
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
										width: `${Math.min(scale ? runningUsed / scale : 0, 1) * 100}%`,
									}}
								/>
								{base !== null && Number.isFinite(base) && bonus > 0 && (
									<div
										aria-hidden
										className="absolute inset-y-0 border border-dotted border-content-link bg-[radial-gradient(hsl(var(--content-link)/0.6)_0.6px,transparent_0.6px)] bg-size-[4px_4px]"
										style={{
											left: `${Math.min(base / scale, 1) * 100}%`,
											width: `${Math.max(0, Math.min(bonus / scale, 1 - base / scale)) * 100}%`,
										}}
									/>
								)}
							</div>
							<span className="text-[10px] text-content-secondary">
								{exempt
									? "Administrator exempt"
									: `Base ${base === null ? "unlimited" : Number.isFinite(base) ? formatQuotaNumber(base) : "invalid"}${bonus > 0 ? ` + ${formatQuotaNumber(bonus)} approved globally` : ""}`}
								{user.atLimit && !exempt ? " · at limit" : ""}
							</span>

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
		</>
	);
};
