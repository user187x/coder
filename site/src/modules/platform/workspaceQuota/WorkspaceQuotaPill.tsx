import { cn } from "cn";
import {
	CpuIcon,
	HardDriveIcon,
	MemoryStickIcon,
	MonitorIcon,
} from "lucide-react";
import { useLayoutEffect, useRef } from "react";
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
	/** What is left, with its unit: "6 Cores". */
	amount: (n: number) => string;
	icon: typeof CpuIcon;
	/** Its card's icon tile, in the Dashboard's tints. */
	tone: string;
}[] = [
	{
		key: "workspaces",
		label: "Workspaces",
		unit: "",
		amount: (n) => `${num(n)} ${n === 1 ? "workspace" : "workspaces"}`,
		icon: MonitorIcon,
		tone: "bg-surface-green text-highlight-green",
	},
	{
		key: "cpu",
		label: "CPU",
		unit: " cores",
		amount: (n) => `${num(n)} ${n === 1 ? "Core" : "Cores"}`,
		icon: CpuIcon,
		tone: "bg-surface-sky text-highlight-sky",
	},
	{
		key: "memory",
		label: "Memory",
		unit: " GB",
		amount: (n) => `${num(n)} GB`,
		icon: MemoryStickIcon,
		tone: "bg-surface-purple text-highlight-purple",
	},
	{
		key: "disk",
		label: "Disk",
		unit: " GB",
		amount: (n) => `${num(n)} GB`,
		icon: HardDriveIcon,
		tone: "bg-surface-orange text-highlight-orange",
	},
];

function num(v: number) {
	return `${Math.round(v * 100) / 100}`;
}

/**
 * A card that glides to its new place when the cards before it come or go (User Quota switched on or off): it
 * measures where it was and slides from there (FLIP), unless the user prefers reduced motion.
 */
const SlidingCard: React.FC<React.ComponentProps<"div">> = (props) => {
	const ref = useRef<HTMLDivElement>(null);
	const left = useRef<number | null>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const now = element.offsetLeft;
		const before = left.current;
		left.current = now;
		if (
			before === null ||
			before === now ||
			!element.animate ||
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
		)
			return;
		element.animate(
			[{ transform: `translateX(${before - now}px)` }, { transform: "none" }],
			{ duration: 450, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
		);
	});
	return <div ref={ref} {...props} />;
};

/** A part's card, as the Dashboard's cards. */
const QUOTA_CARD =
	"min-w-0 rounded-[20px] border border-solid border-border bg-surface-primary px-5 py-4 shadow-sm";

/** Where a part stands: fine, near (80% or more), or at its limit. */
export const quotaLevel = (used: number, limit: number) =>
	used >= limit ? "full" : used >= limit * 0.8 ? "near" : "ok";

export const WorkspaceQuotaPillView: React.FC<{
	/** Undefined while it loads, or where a short-term lease replaces the quota. */
	quota?: QuotaMe;
	action?: React.ReactNode;
	/** The table's last column: the account's Cloud Drive (CloudDrive, placement "quota"). */
	cloudDrive?: React.ReactNode;
}> = ({ quota, action, cloudDrive }) => {
	const limited = Boolean(quota?.limited && quota.usage);
	// Quotas not enforced: nothing about quotas (no heading, grants or request), only the Cloud Drive's card.
	if (!limited) {
		return cloudDrive ? (
			<div className="grid w-full grid-cols-[repeat(5,minmax(13rem,1fr))] gap-3 overflow-x-auto pb-1">
				<SlidingCard className={QUOTA_CARD} data-testid="quota-cloud-drive">
					{cloudDrive}
				</SlidingCard>
			</div>
		) : null;
	}
	const parts = PARTS.flatMap((p) => {
		if (!quota || !limited) {
			return [];
		}
		const limit = quota.limits[p.key];
		const used = quota.usage?.[p.key] ?? 0;
		return limit === null || limit === undefined
			? []
			: [{ ...p, limit, used, left: Math.max(limit - used, 0) }];
	});
	return (
		<section
			aria-label="Workspace quota"
			className="w-full text-content-secondary"
			title={
				quota?.atLimit
					? "One or more quota limits are reached. Per-instance limits apply separately to each workspace. Ask an admin to raise a limit if needed."
					: "Your workspace quota: what your workspaces are built with, of the limits an admin set."
			}
		>
			<div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-1">
				<h2 className="m-0 text-sm font-semibold text-content-primary">
					Quota
				</h2>
				{action}
			</div>
			{/* One card per part, as the Dashboard's, all on one line (scrolling sideways where the window is too narrow);
			    the Cloud Drive is the last of them. */}
			{/* Always five columns' worth (the four parts and the Cloud Drive): a card keeps its size whether or not the
			    others show, and fewer cards line up from the left. */}
			<div className="grid grid-cols-[repeat(5,minmax(13rem,1fr))] gap-3 overflow-x-auto pb-1">
				{parts.map((p) => {
					const level = quotaLevel(p.used, p.limit);
					const pct = p.limit > 0 ? Math.min(p.used / p.limit, 1) * 100 : 100;
					const Icon = p.icon;
					return (
						<div
							key={p.key}
							className={QUOTA_CARD}
							data-testid={`quota-${p.key}`}
							data-level={level}
						>
							<div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
								<span
									className={cn(
										"flex size-8 shrink-0 items-center justify-center rounded-lg",
										p.tone,
									)}
								>
									<Icon aria-hidden className="size-4" />
								</span>
								<span className="text-[13px] font-bold uppercase tracking-wide text-content-primary">
									{p.label}
								</span>
								{p.key !== "workspaces" &&
									quota?.resourceModes?.[p.key] === "instance" && (
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
									({p.amount(p.left)} available)
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
								{(quota?.bonus?.[p.key] ?? 0) > 0 && (
									<span
										className="absolute inset-y-0 right-0 box-border border border-dotted border-content-link"
										style={{
											width: `${p.limit > 0 ? Math.min((quota?.bonus?.[p.key] ?? 0) / p.limit, 1) * 100 : 0}%`,
										}}
									/>
								)}
							</div>
							{(quota?.bonus?.[p.key] ?? 0) > 0 && (
								<span
									className="mt-2 inline-flex rounded border border-dotted border-content-link px-1.5 py-0.5 text-2xs"
									title={`Base ${num(quota?.baseLimits?.[p.key] ?? p.limit)}${p.unit}; approved extras remain until revoked`}
								>
									+{num(quota?.bonus?.[p.key] ?? 0)} approved
								</span>
							)}
						</div>
					);
				})}
				{cloudDrive && (
					<SlidingCard className={QUOTA_CARD} data-testid="quota-cloud-drive">
						{cloudDrive}
					</SlidingCard>
				)}
			</div>
		</section>
	);
};

/**
 * workspacesKey: the table's workspaces and their latest builds - one made, deleted, rebuilt (other parameters) or
 * started refreshes the pill at once; between those it polls (an admin's change to the limits).
 */
export const WorkspaceQuotaPill: React.FC<{
	workspacesKey?: string;
	/** See WorkspaceQuotaPillView. */
	cloudDrive?: React.ReactNode;
}> = ({ workspacesKey, cloudDrive }) => {
	const lease = useQuery(myShortTermLease());
	const quotaQuery = quotaMe();
	const { data } = useQuery({
		...quotaQuery,
		queryKey: [...quotaQuery.queryKey, workspacesKey],
		enabled: lease.isSuccess && !lease.data,
	});
	if (lease.data) {
		const extend = <LeaseExtensionButton lease={lease.data} />;
		return cloudDrive ? (
			<WorkspaceQuotaPillView action={extend} cloudDrive={cloudDrive} />
		) : (
			extend
		);
	}
	// Only where a workspace quota applies: the Cloud Drive asks for its own storage (Cloud Drive > Settings).
	const action = !lease.isLoading && data?.limited && <QuotaRequestButton />;
	return data || cloudDrive ? (
		<WorkspaceQuotaPillView
			quota={data}
			action={action}
			cloudDrive={cloudDrive}
		/>
	) : (
		action
	);
};
