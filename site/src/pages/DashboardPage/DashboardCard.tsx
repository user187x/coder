import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/Collapsible/Collapsible";
import { Skeleton } from "#/components/Skeleton/Skeleton";
import { SERIES_WINDOW_MS } from "./dashboardModel";
import { useCardHandle } from "./SortableCards";

/** A card's icon tile tints, after the Cloud Drive's. */
const TONES = {
	sky: "bg-surface-sky text-highlight-sky",
	purple: "bg-surface-purple text-highlight-purple",
	green: "bg-surface-green text-highlight-green",
	orange: "bg-surface-orange text-highlight-orange",
	magenta: "bg-surface-magenta text-highlight-magenta",
} as const;

type DashboardCardProps = {
	title: string;
	/** The icon in a tinted tile before the title. */
	icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
	tone?: keyof typeof TONES;
	/** Beside the title: the total of the card's resource supplied to the account (its quota, or the capacity). */
	badge?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
	/** Greyed out (nothing to show), all but the title's pill, which says why. */
	muted?: boolean;
	children: React.ReactNode;
};

/** A titled card of the Dashboard: an uppercase header with optional actions on the right. */
export const DashboardCard: React.FC<DashboardCardProps> = ({
	title,
	icon: Icon,
	tone = "sky",
	badge,
	actions,
	className,
	muted = false,
	children,
}) => {
	const dim = muted && "opacity-50 grayscale";
	// A card that can be moved (SortableCards) is dragged by its header.
	const handle = useCardHandle();
	return (
		<section
			aria-label={title}
			className={cn(
				"rounded-[20px] border border-solid border-border bg-surface-primary px-5 py-4",
				"shadow-sm transition-shadow hover:shadow-md",
				className,
			)}
		>
			<header
				{...handle?.headerProps}
				className={cn(
					"group/handle mb-3 flex flex-wrap items-center justify-between gap-2",
					handle && "cursor-grab",
					handle?.dragging && "cursor-grabbing",
				)}
			>
				<span className="flex min-w-0 items-center gap-3">
					{handle?.grip(title)}
					{Icon && (
						<span
							className={cn(
								"flex size-10 shrink-0 items-center justify-center rounded-xl",
								TONES[tone],
								dim,
							)}
						>
							<Icon aria-hidden className="size-5" />
						</span>
					)}
					<h2
						className={cn(
							"m-0 shrink-0 text-[13px] font-bold uppercase tracking-wide text-content-primary",
							dim,
						)}
					>
						{title}
					</h2>
					{badge}
				</span>
				{/* Beside the title while they fit, else on a line of their own: the title is never cut short for them */}
				{actions && <span className="ml-auto flex shrink-0">{actions}</span>}
			</header>
			{muted ? <div className={cn(dim)}>{children}</div> : children}
		</section>
	);
};

type CardStateProps = {
	isLoading: boolean;
	error: unknown;
	/** Text for a card with nothing to show, or false when there is something. */
	empty?: string | false;
	children: React.ReactNode;
};

/** A card's body: skeletons until its data first arrives, the server's error, a deliberate empty state, or the data. */
export const CardState: React.FC<CardStateProps> = ({
	isLoading,
	error,
	empty = false,
	children,
}) => {
	if (isLoading) {
		return (
			<div aria-busy className="flex flex-col gap-3">
				<Skeleton className="h-6 w-2/3" />
				<Skeleton className="h-16 w-full" />
				<Skeleton className="h-4 w-1/2" />
			</div>
		);
	}
	if (error) {
		return <ErrorAlert error={error} showDebugDetail={false} />;
	}
	if (empty) {
		return <p className="m-0 text-sm text-content-secondary">{empty}</p>;
	}
	return children;
};

/**
 * A label and its value with a dotted guide line between them, as in the template's breakdowns. Each stays on one
 * line: the value never wraps, and a long label is cut short with an ellipsis instead.
 */
export const DottedRow: React.FC<{
	label: React.ReactNode;
	value: React.ReactNode;
}> = ({ label, value }) => {
	return (
		<div className="flex items-baseline gap-2 text-xs">
			<dt className="flex min-w-0 flex-1 items-baseline gap-2 text-content-secondary">
				<span className="truncate">{label}</span>
				<span
					aria-hidden
					className="min-w-2 flex-1 border-0 border-b border-dotted border-border"
				/>
			</dt>
			<dd className="m-0 whitespace-nowrap font-medium tabular-nums text-content-primary">
				{value}
			</dd>
		</div>
	);
};

/** A faint squircle round a card's bottom graph (rounded corners where the browser has no squircle corner shape). */
export const GraphFrame: React.FC<{
	className?: string;
	children: React.ReactNode;
}> = ({ className, children }) => (
	<div
		className={cn(
			"rounded-[18px] border border-solid border-border/60 bg-surface-secondary/40 px-3 py-2.5",
			"supports-[corner-shape:squircle]:rounded-[28px] supports-[corner-shape:squircle]:[corner-shape:squircle]",
			className,
		)}
	>
		{children}
	</div>
);

/**
 * "Show workspaces": a card's reading for each workspace, folded away until asked for. Rows are dotted label and
 * value pairs by default; `children` replaces them with the card's own list.
 */
export const ShowWorkspaces: React.FC<{
	rows?: readonly {
		id: string;
		label: React.ReactNode;
		value: React.ReactNode;
	}[];
	children?: React.ReactNode;
}> = ({ rows = [], children }) => {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-xs font-medium text-content-link">
				{open ? "Hide workspaces" : "Show workspaces"}
				<ChevronDownIcon
					aria-hidden
					className={cn("size-3.5 transition-transform", open && "rotate-180")}
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="mt-2">
				{children ?? (
					<dl className="m-0 flex flex-col gap-1.5">
						{rows.map((row) => (
							<DottedRow key={row.id} label={row.label} value={row.value} />
						))}
					</dl>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
};

/** A card header's small pill: the span its live graphs show. */
export const RangePill: React.FC = () => {
	const minutes = Math.round(SERIES_WINDOW_MS / 60_000);
	return (
		<span
			className="whitespace-nowrap rounded-full border border-solid border-border bg-surface-secondary px-1.5 text-[10px] leading-4 tabular-nums text-content-secondary"
			title={`The graphs show the last ${minutes} minutes`}
		>
			Last {minutes} min
		</span>
	);
};

/** A card heading's badge: the total supplied to the account, labelled by what it is. */
export const SuppliedBadge: React.FC<{ value: string; what: string }> = ({
	value,
	what,
}) => (
	<span
		className="whitespace-nowrap rounded-full bg-surface-tertiary px-2 text-[11px] font-semibold leading-5 tabular-nums text-content-primary"
		title={what}
	>
		<span className="sr-only">{what}: </span>
		{value}
	</span>
);
