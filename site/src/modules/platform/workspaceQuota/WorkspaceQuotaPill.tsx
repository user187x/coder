import { cn } from "cn";
import { type FC, useEffect } from "react";
import { useQuery } from "react-query";
import type { QuotaKey, QuotaMe } from "#/api/platform";
import { quotaMe } from "#/api/queries/platform";

// Platform: the signed-in user's quota (Health > User Quota) in a pill above the Workspaces search - each limit set for
// them, what their workspaces take of it and what is left. Nothing when no limit applies (none set, or an exempt admin).

const PARTS: { key: QuotaKey; label: string; unit: string }[] = [
	{ key: "workspaces", label: "Workspaces", unit: "" },
	{ key: "cpu", label: "CPU", unit: " cores" },
	{ key: "memory", label: "Memory", unit: " GiB" },
];

const num = (v: number) => `${Math.round(v * 100) / 100}`;

/** Where a part stands: fine, near (80% or more), or at its limit. */
export const quotaLevel = (used: number, limit: number) =>
	used >= limit ? "full" : used >= limit * 0.8 ? "near" : "ok";

export const WorkspaceQuotaPillView: FC<{ quota: QuotaMe }> = ({ quota }) => {
	if (!quota.limited || !quota.usage) {
		return null;
	}
	const parts = PARTS.flatMap((p) => {
		const limit = quota.limits[p.key];
		const used = quota.usage?.[p.key] ?? 0;
		return limit === null
			? []
			: [{ ...p, limit, used, left: Math.max(limit - used, 0) }];
	});
	return (
		<div
			className="mb-1 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-solid border-border bg-surface-secondary px-3 py-1 text-xs text-content-secondary"
			data-testid="workspace-quota-pill"
			title={
				quota.atLimit
					? "Your quota is reached: delete or shrink a workspace, or ask an admin to raise it."
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
						<span>{p.label}</span>
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
						</span>
						<span className="text-content-primary">
							{num(p.used)}/{num(p.limit)}
							{p.unit}
						</span>
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
	return data ? <WorkspaceQuotaPillView quota={data} /> : null;
};
