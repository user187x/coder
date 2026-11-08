import { cn } from "cn";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Skeleton } from "#/components/Skeleton/Skeleton";

type DashboardCardProps = {
	title: string;
	actions?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
};

/** A titled card of the Dashboard: an uppercase header with optional actions on the right. */
export const DashboardCard: React.FC<DashboardCardProps> = ({
	title,
	actions,
	className,
	children,
}) => {
	return (
		<section
			aria-label={title}
			className={cn(
				"rounded-[20px] border border-solid border-border bg-surface-primary px-5 py-4",
				"shadow-sm transition-shadow hover:shadow-md",
				className,
			)}
		>
			<header className="mb-3 flex items-center justify-between gap-2">
				<h2 className="m-0 text-[13px] font-bold uppercase tracking-wide text-content-primary">
					{title}
				</h2>
				{actions}
			</header>
			{children}
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

/** A label and its value with a dotted guide line between them, as in the template's breakdowns. */
export const DottedRow: React.FC<{
	label: React.ReactNode;
	value: React.ReactNode;
}> = ({ label, value }) => {
	return (
		<div className="flex items-baseline gap-2 text-xs">
			<dt className="flex flex-1 items-baseline gap-2 text-content-secondary">
				{label}
				<span
					aria-hidden
					className="flex-1 border-0 border-b border-dotted border-border"
				/>
			</dt>
			<dd className="m-0 font-medium tabular-nums text-content-primary">
				{value}
			</dd>
		</div>
	);
};
