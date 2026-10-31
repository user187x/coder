import { cn } from "cn";
import {
	CpuIcon,
	HardDriveIcon,
	MemoryStickIcon,
	MonitorIcon,
} from "lucide-react";
import { useQuery } from "react-query";
import type { QuotaKey, QuotaMe } from "#/api/platform";
import { quotaMe } from "#/api/queries/platform";
import { myShortTermLease } from "#/api/queries/shortTermLeases";
import { QuotaRequestButton } from "../quotaRequests/QuotaRequestButton";
import { LeaseExtensionButton } from "../shortTermLeases/LeaseExtensionButton";

// Approved extras extend finite base limits until an administrator revokes them.

const PARTS: {
	key: QuotaKey;
	label: string;
	unit: string;
	icon: typeof CpuIcon;
}[] = [
	{ key: "workspaces", label: "Workspaces", unit: "", icon: MonitorIcon },
	{ key: "cpu", label: "CPU", unit: " cores", icon: CpuIcon },
	{ key: "memory", label: "Memory", unit: " GiB", icon: MemoryStickIcon },
	{ key: "disk", label: "Disk", unit: " GB", icon: HardDriveIcon },
];

const num = (v: number) => `${Math.round(v * 100) / 100}`;

/** Where a part stands: fine, near (80% or more), or at its limit. */
export const quotaLevel = (used: number, limit: number) =>
	used >= limit ? "full" : used >= limit * 0.8 ? "near" : "ok";

export const WorkspaceQuotaPillView: React.FC<{
	quota: QuotaMe;
	action?: React.ReactNode;
}> = ({ quota, action }) => {
	if (!quota.limited || !quota.usage) {
		return !quota.limited && quota.activeGrantCount ? (
			<div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-border bg-surface-primary/70 px-4 py-3 text-xs text-content-secondary">
				<span>
					{quota.activeGrantCount} approved extra quota grants · No finite cap
					applies
				</span>
				{action}
			</div>
		) : (
			action
		);
	}
	const parts = PARTS.flatMap((p) => {
		const limit = quota.limits[p.key];
		const used = quota.usage?.[p.key] ?? 0;
		return limit === null || limit === undefined
			? []
			: [{ ...p, limit, used, left: Math.max(limit - used, 0) }];
	});
	return (
		<section
			aria-label="Workspace quota"
			className="@container w-full overflow-hidden rounded-xl border border-solid border-border bg-surface-primary/70 text-content-secondary"
			title={
				quota.atLimit
					? "One or more quota limits are reached. Per-instance limits apply separately to each workspace. Ask an admin to raise a limit if needed."
					: "Your workspace quota: what your workspaces are built with, of the limits an admin set."
			}
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-2.5">
				<h2 className="m-0 text-sm font-semibold text-content-primary">
					Quota
				</h2>
				{action}
			</div>
			<div className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 @min-[480px]:grid-cols-2 @min-[880px]:grid-cols-4">
				{parts.map((p) => {
					const level = quotaLevel(p.used, p.limit);
					const pct = p.limit > 0 ? Math.min(p.used / p.limit, 1) * 100 : 100;
					const Icon = p.icon;
					return (
						<div
							key={p.key}
							className="min-w-0"
							data-testid={`quota-${p.key}`}
							data-level={level}
						>
							<div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
								<Icon aria-hidden className="size-3.5 shrink-0" />
								<span className="font-medium">{p.label}</span>
								{p.key !== "workspaces" &&
									quota.resourceModes?.[p.key] === "instance" && (
										<span className="text-2xs">/ instance (largest)</span>
									)}
							</div>
							<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 tabular-nums">
								<span className="text-sm font-medium text-content-primary">
									{num(p.used)}/{num(p.limit)}
									{p.unit}
								</span>
								<span
									className={cn(
										"text-xs",
										level === "full" && "text-content-destructive",
										level === "near" && "text-content-warning",
									)}
								>
									({num(p.left)} left)
								</span>
							</div>
							<div
								role="meter"
								aria-label={`${p.label} quota usage`}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={pct}
								aria-valuetext={`${num(p.used)} of ${num(p.limit)}${p.unit}, ${num(p.left)} remaining`}
								className="relative h-1.5 overflow-hidden rounded-full bg-surface-quaternary"
							>
								<span
									className={cn(
										"absolute inset-y-0 left-0 rounded-full",
										level === "full"
											? "bg-content-destructive"
											: level === "near"
												? "bg-content-warning"
												: "bg-content-success",
									)}
									style={{ width: `${pct}%` }}
								/>
								{(quota.bonus?.[p.key] ?? 0) > 0 && (
									<span
										className="absolute inset-y-0 right-0 box-border border border-dotted border-content-link"
										style={{
											width: `${p.limit > 0 ? Math.min((quota.bonus?.[p.key] ?? 0) / p.limit, 1) * 100 : 0}%`,
										}}
									/>
								)}
							</div>
							{(quota.bonus?.[p.key] ?? 0) > 0 && (
								<span
									className="mt-2 inline-flex rounded border border-dotted border-content-link px-1.5 py-0.5 text-2xs"
									title={`Base ${num(quota.baseLimits?.[p.key] ?? p.limit)}${p.unit}; approved extras remain until revoked`}
								>
									+{num(quota.bonus?.[p.key] ?? 0)} approved
								</span>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
};

/**
 * workspacesKey: the table's workspaces and their latest builds - one made, deleted, rebuilt (other parameters) or
 * started refreshes the pill at once; between those it polls (an admin's change to the limits).
 */
export const WorkspaceQuotaPill: React.FC<{ workspacesKey?: string }> = ({
	workspacesKey,
}) => {
	const lease = useQuery(myShortTermLease());
	const quotaQuery = quotaMe();
	const { data } = useQuery({
		...quotaQuery,
		queryKey: [...quotaQuery.queryKey, workspacesKey],
		enabled: lease.isSuccess && !lease.data,
	});
	if (lease.data) return <LeaseExtensionButton lease={lease.data} />;
	const action = !lease.isLoading && <QuotaRequestButton />;
	return data ? (
		<WorkspaceQuotaPillView quota={data} action={action} />
	) : (
		action
	);
};
