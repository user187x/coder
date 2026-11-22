import { isPixel } from "@coder/pixel-storybook/storyapi";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { useId } from "react";

const spinnerVariants = cva("", {
	variants: {
		size: {
			page: "size-20",
			lg: "size-icon-lg",
			sm: "size-icon-sm",
		},
	},
	defaultVariants: {
		size: "lg",
	},
});

type SpinnerProps = React.ComponentProps<"svg"> &
	VariantProps<typeof spinnerVariants> & {
		children?: React.ReactNode;
		loading?: boolean;
		/**
		 * Exposes the spinner as an accessible live region labelled with this text. Leave undefined for
		 * decorative spinners, e.g. inside a component that already provides its own status region.
		 */
		label?: string;
	};

export function Spinner({
	className,
	size,
	loading,
	children,
	label,
	...props
}: SpinnerProps) {
	const steel = useId();
	if (!loading) {
		return children;
	}

	return (
		<svg
			viewBox="0 0 96 96"
			role={label ? "status" : undefined}
			aria-label={label}
			className={cn(
				spinnerVariants({ size }),
				!isPixel() &&
					"animate-spin [animation-duration:1.3s] [animation-timing-function:ease] motion-reduce:animate-none",
				className,
			)}
			{...props}
		>
			<title>Loading spinner</title>
			<defs>
				<linearGradient id={steel} x1="10%" y1="5%" x2="90%" y2="95%">
					<stop offset="0" stopColor="#f4f6f8" />
					<stop offset="0.28" stopColor="#a2aab2" />
					<stop offset="0.5" stopColor="#e2e6e9" />
					<stop offset="0.72" stopColor="#7c8792" />
					<stop offset="1" stopColor="#49515a" />
				</linearGradient>
			</defs>
			<path
				fill={`url(#${steel})`}
				fillRule="evenodd"
				stroke="#414851"
				strokeWidth={1.2}
				strokeLinejoin="round"
				d="M39.9,12.9 43.0,12.4 43.7,3.2 52.3,3.2 53.0,12.4 56.1,12.9 58.5,13.6 61.5,14.6 66.7,7.1 74.1,11.4 70.2,19.6 72.6,21.7 74.3,23.4 76.4,25.8 84.6,21.9 88.9,29.3 81.4,34.5 82.4,37.5 83.1,39.9 83.6,43.0 92.8,43.7 92.8,52.3 83.6,53.0 83.1,56.1 82.4,58.5 81.4,61.5 88.9,66.7 84.6,74.1 76.4,70.2 74.3,72.6 72.6,74.3 70.2,76.4 74.1,84.6 66.7,88.9 61.5,81.4 58.5,82.4 56.1,83.1 53.0,83.6 52.3,92.8 43.7,92.8 43.0,83.6 39.9,83.1 37.5,82.4 34.5,81.4 29.3,88.9 21.9,84.6 25.8,76.4 23.4,74.3 21.7,72.6 19.6,70.2 11.4,74.1 7.1,66.7 14.6,61.5 13.6,58.5 12.9,56.1 12.4,53.0 3.2,52.3 3.2,43.7 12.4,43.0 12.9,39.9 13.6,37.5 14.6,34.5 7.1,29.3 11.4,21.9 19.6,25.8 21.7,23.4 23.4,21.7 25.8,19.6 21.9,11.4 29.3,7.1 34.5,14.6 37.5,13.6Z M62,48a14,14 0 1 0-28,0a14,14 0 1 0 28,0Z"
			/>
			<circle
				cx={48}
				cy={48}
				r={32}
				fill="none"
				stroke="#4f5860"
				strokeWidth={1}
			/>
			<circle
				cx={48}
				cy={48}
				r={21}
				fill="none"
				stroke="#4d565e"
				strokeWidth={5}
			/>
			<circle
				cx={48}
				cy={48}
				r={20}
				fill="none"
				stroke="#d4dce2"
				strokeWidth={1.5}
			/>
			<circle
				cx={48}
				cy={48}
				r={15.5}
				fill="none"
				stroke="#353b43"
				strokeWidth={2}
			/>
			<g fill="#434b55" stroke="#d9e0e6" strokeWidth={0.75}>
				<circle cx={48} cy={20} r={2.6} />
				<circle cx={48} cy={76} r={2.6} />
				<circle cx={20} cy={48} r={2.6} />
				<circle cx={76} cy={48} r={2.6} />
			</g>
		</svg>
	);
}
