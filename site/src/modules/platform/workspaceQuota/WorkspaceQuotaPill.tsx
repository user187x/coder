import { cn } from "cn";
import { type FC, useEffect } from "react";
import { useQuery } from "react-query";
import type { QuotaKey, QuotaMe } from "#/api/platform";
import { quotaMe } from "#/api/queries/platform";
import { QuotaRequestButton } from "../quotaRequests/QuotaRequestButton";

// Approved extras extend finite base limits until an administrator revokes them.

const PARTS: { key: QuotaKey; label: string; unit: string }[] = [
	{ key: "workspaces", label: "Workspaces", unit: "" },
	{ key: "cpu", label: "CPU", unit: " cores" },
	{ key: "memory", label: "Memory", unit: " GiB" },
	{ key: "disk", label: "Disk", unit: " GB" },
];

const num = (v: number) => `${Math.round(v * 100) / 100}`;

/** Where a part stands: fine, near (80% or more), or at its limit. */
export const quotaLevel = (used: number, limit: number) =>
	used >= limit ? "full" : used >= limit * 0.8 ? "near" : "ok";

export const WorkspaceQuotaPillView: FC<{ quota: QuotaMe }> = ({ quota }) => {
	if (!quota.limited || !quota.usage) {
		return !quota.limited && quota.activeGrantCount ? (
			<span className="rounded-full border border-dotted border-content-link px-3 py-1 text-xs">
				{quota.activeGrantCount} approved extra quota grants · No finite cap
				applies
			</span>
		) : null;
	}
	const parts = PARTS.flatMap((p) => {
		const limit = quota.limits[p.key];
		const used = quota.usage?.[p.key] ?? 0;
		return limit === null || limit === undefined
			? []
			: [{ ...p, limit, used, left: Math.max(limit - used, 0) }];
	});
	return (
		<div
			className="mb-1 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-solid border-border bg-surface-secondary px-3 py-1 text-xs text-content-secondary"
			data-testid="workspace-quota-pill"
			title={
				quota.atLimit
					? "One or more quota limits are reached. Per-instance limits apply separately to each workspace. Ask an admin to raise a limit if needed."
					: "Your workspace quota: what your workspaces are built with, of the limits an admin set."
			}
		>
			<span className="font-medium text-content-primary">Quota</span>
			{parts.map((p) => {
				const level = quotaLevel(p.used, p.limit);
				const pct = p.limit > 0 ? Math.min(p.used / p.limit, 1) * 100 : 100;
				return (
					<span
						key={p.key}
						className="flex items-center gap-1.5 whitespace-nowrap"
						data-testid={`quota-${p.key}`}
						data-level={level}
					>
						<span>
							{p.label}
							{p.key !== "workspaces" &&
							quota.resourceModes?.[p.key] === "instance"
								? " / instance (largest)"
								: ""}
						</span>
						<span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface-quaternary">
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
						</span>
						<span className="text-content-primary">
							{num(p.used)}/{num(p.limit)}
							{p.unit}
						</span>
						{(quota.bonus?.[p.key] ?? 0) > 0 && (
							<span
								className="rounded border border-dotted border-content-link px-1"
								title={`Base ${num(quota.baseLimits?.[p.key] ?? p.limit)}${p.unit}; approved extras remain until revoked`}
							>
								+{num(quota.bonus?.[p.key] ?? 0)} approved
							</span>
						)}
						<span
							className={cn(
								level === "full" && "text-content-destructive",
								level === "near" && "text-content-warning",
							)}
						>
							({num(p.left)} left)
						</span>
					</span>
				);
			})}
		</div>
	);
};

/**
 * workspacesKey: the table's workspaces and their latest builds - one made, deleted, rebuilt (other parameters) or
 * started refreshes the pill at once; between those it polls (an admin's change to the limits).
 */
export const WorkspaceQuotaPill: FC<{ workspacesKey?: string }> = ({
	workspacesKey,
}) => {
	const { data, refetch } = useQuery(quotaMe());
	useEffect(() => {
		void refetch();
	}, [workspacesKey, refetch]);
	return (
		<div className="flex flex-wrap items-center gap-2">
			{data && <WorkspaceQuotaPillView quota={data} />}
			<QuotaRequestButton />
		</div>
	);
};
