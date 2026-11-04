import { cn } from "cn";
import { Spinner } from "#/components/Spinner/Spinner";

type LoaderProps = React.ComponentProps<"div"> & {
	fullscreen?: boolean;
	size?: "sm" | "lg";
	/**
	 * A label for the loader. This is used for accessibility purposes.
	 */
	label?: string;
};

export const Loader: React.FC<LoaderProps> = ({
	fullscreen,
	size = "lg",
	label,
	className,
	...attrs
}) => {
	const resolvedLabel = label ?? "Loading";

	return (
		<div
			{...attrs}
			role="status"
			aria-live="polite"
			aria-label={resolvedLabel}
			data-testid="loader"
			className={cn(
				"flex items-center justify-center",
				fullscreen ? "fixed inset-0 bg-surface-primary" : "w-full p-8",
				className,
			)}
		>
			<Spinner size={fullscreen && size === "lg" ? "page" : size} loading />
		</div>
	);
};

/** Centers the route loading indicator while leaving dashboard navigation available. */
export const PageLoader = () => (
	<Loader fullscreen className="pointer-events-none bg-transparent" />
);
