import { cn } from "cn";
import type React from "react";

type LinearProgressProps = React.ComponentProps<"div"> & {
	value: number;
	variant: "determinate" | "indeterminate";
	/** Animates the determinate fill with the shared barber pole (still under reduced motion). */
	striped?: boolean;
};

const LinearProgress: React.FC<LinearProgressProps> = ({
	value,
	className,
	variant,
	striped,
	...props
}) => {
	const isDeterminate = variant === "determinate";

	return (
		<div
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			{...(isDeterminate ? { "aria-valuenow": Math.round(value) } : {})}
			className={cn(
				"w-full h-1 bg-surface-sky rounded-full relative",
				"overflow-hidden block",
				className,
			)}
			{...props}
		>
			{!isDeterminate ? (
				<>
					<div
						className={cn(
							"absolute inset-y-0 w-auto origin-left rounded-full bg-highlight-sky",
							"animate-bar-indeterminate",
						)}
					/>
					<div
						className={cn(
							"absolute inset-y-0 w-auto origin-left rounded-full bg-highlight-sky",
							"animate-bar-indeterminate-2",
						)}
					/>
				</>
			) : (
				<div
					className={cn(
						"h-full rounded-full bg-highlight-sky",
						striped && "workspace-barber-pole",
					)}
					style={{ width: `${value}%` }}
				/>
			)}
		</div>
	);
};

export default LinearProgress;
