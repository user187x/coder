import { cn } from "cn";
import {
	ChevronRightIcon,
	CircleCheckIcon,
	CircleHelpIcon,
	InfoIcon,
	OctagonAlertIcon,
	ShieldCheckIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import type { PostureCheck, PostureSeverity } from "#/api/platform";
import { monitoringPosture } from "#/api/queries/platform";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { Loader } from "#/components/Loader/Loader";

const ORDER: PostureSeverity[] = [
	"critical",
	"warning",
	"unknown",
	"info",
	"ok",
];
const CATEGORIES = ["Identity", "Exposure", "Runtime", "Signals"] as const;

const SEVERITY: Record<
	PostureSeverity,
	{ label: string; icon: typeof InfoIcon; className: string }
> = {
	critical: {
		label: "Critical",
		icon: OctagonAlertIcon,
		className: "text-content-destructive",
	},
	warning: {
		label: "Warning",
		icon: TriangleAlertIcon,
		className: "text-content-warning",
	},
	unknown: {
		label: "Not checked",
		icon: CircleHelpIcon,
		className: "text-content-secondary",
	},
	info: { label: "Note", icon: InfoIcon, className: "text-content-link" },
	ok: { label: "OK", icon: CircleCheckIcon, className: "text-content-success" },
};

/**
 * General > Monitoring > Security posture: zero-trust checks (who holds
 * privilege and how they sign in, tokens, what is shared beyond its owner, how
 * workspace pods are isolated and segmented, image provenance) and runtime
 * signals (restarts, failed builds, disconnected agents, workspaces that never
 * stop), each with the items behind it and how to fix them.
 */
export const SecurityPostureSection: React.FC = () => {
	const { data, error, isLoading } = useQuery(monitoringPosture());

	return (
		<section className="mb-8 flex flex-col gap-4" aria-label="Security posture">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="m-0 flex items-center gap-2 text-lg font-semibold">
					<ShieldCheckIcon aria-hidden className="size-5" />
					Security posture
				</h2>
				{data && (
					<div className="flex flex-wrap items-center gap-3 text-sm">
						{ORDER.filter((s) => data.summary[s]).map((s) => {
							const { icon: Icon, className, label } = SEVERITY[s];
							return (
								<span key={s} className="flex items-center gap-1">
									<Icon aria-hidden className={cn("size-4", className)} />
									<span className="tabular-nums">{data.summary[s]}</span>
									<span className="text-content-secondary">{label}</span>
								</span>
							);
						})}
						<span className="text-xs text-content-secondary">
							{data.users} users · {data.workspaces} workspaces · {data.pods}{" "}
							pods · updated{" "}
							{new Date(data.generatedAt).toLocaleTimeString("en-US")}
						</span>
					</div>
				)}
			</div>
			{isLoading && <Loader />}
			{error ? <ErrorAlert error={error} /> : null}
			{data && (
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					{CATEGORIES.map((category) => {
						const checks = data.checks
							.filter((c) => c.category === category)
							.sort(
								(a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
							);
						return (
							checks.length > 0 && (
								<div
									key={category}
									className="flex flex-col rounded-lg border border-solid border-border"
								>
									<h3 className="m-0 border-0 border-b border-solid border-border px-4 py-2 text-sm font-medium text-content-secondary">
										{category}
									</h3>
									{checks.map((check) => (
										<PostureRow key={check.id} check={check} />
									))}
								</div>
							)
						);
					})}
				</div>
			)}
		</section>
	);
};

const PostureRow: React.FC<{ check: PostureCheck }> = ({ check }) => {
	const [open, setOpen] = useState(false);
	const { icon: Icon, className, label } = SEVERITY[check.severity];
	const expandable = check.items.length > 0 || Boolean(check.fix);
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="border-0 border-b border-solid border-border last:border-b-0"
		>
			<CollapsibleTrigger
				disabled={!expandable}
				className="flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent px-4 py-3 text-left text-sm text-content-primary hover:bg-surface-secondary disabled:cursor-default disabled:hover:bg-transparent"
			>
				<Icon
					aria-label={label}
					className={cn("mt-0.5 size-4 shrink-0", className)}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="font-medium">{check.title}</span>
					<span className="text-content-secondary">{check.summary}</span>
				</span>
				{expandable && (
					<ChevronRightIcon
						aria-hidden
						className={cn(
							"mt-0.5 size-4 shrink-0 text-content-secondary transition-transform",
							open && "rotate-90",
						)}
					/>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="flex flex-col gap-2 px-4 pb-3 pl-11 text-sm">
					{check.items.length > 0 && (
						<ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0">
							{check.items.map((item) => (
								<li key={`${item.label}-${item.note}`} className="flex gap-2">
									<span className="font-mono text-xs leading-5">
										{item.label}
									</span>
									<span className="text-content-secondary">{item.note}</span>
								</li>
							))}
							{check.count > check.items.length && (
								<li className="text-content-secondary">
									… and {check.count - check.items.length} more
								</li>
							)}
						</ul>
					)}
					{check.fix && check.severity !== "ok" && (
						<p className="m-0 text-content-secondary">
							<span className="font-medium text-content-primary">Fix: </span>
							{check.fix}
						</p>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};
