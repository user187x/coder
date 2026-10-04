import { cn } from "cn";

type FeatureUnavailableProps = {
	/** The feature's name, as the page calls it. */
	feature: string;
	className?: string;
};

/**
 * Shown where a feature needs a capability this deployment doesn't have: a
 * plain statement of fact, nothing to buy.
 */
export const FeatureUnavailable: React.FC<FeatureUnavailableProps> = ({
	feature,
	className,
}) => {
	return (
		<div
			role="note"
			className={cn(
				"rounded-lg border border-solid border-border bg-surface-secondary px-6 py-5 text-sm text-content-secondary",
				className,
			)}
		>
			<span className="font-semibold text-content-primary">{feature}</span> is
			not enabled on this deployment.
		</div>
	);
};
