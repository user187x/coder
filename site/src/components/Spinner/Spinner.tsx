import { isPixel } from "@coder/pixel-storybook/storyapi";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const toothAngles = [0, 45, 90, 135, 180, 225, 270, 315];

const spinnerVariants = cva("", {
	variants: {
		size: {
			page: "size-14 text-content-link",
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
	if (!loading) {
		return children;
	}

	return (
		<svg
			viewBox="0 0 64 64"
			fill="currentColor"
			role={label ? "status" : undefined}
			aria-label={label}
			className={cn(
				spinnerVariants({ size }),
				!isPixel() &&
					"animate-spin [animation-duration:2s] will-change-transform motion-reduce:animate-none",
				className,
			)}
			{...props}
		>
			<title>Loading spinner</title>
			<path
				fillRule="evenodd"
				d="M32 10a22 22 0 1 1 0 44 22 22 0 1 1 0-44Zm0 11a11 11 0 1 0 0 22 11 11 0 1 0 0-22Z"
			/>
			{toothAngles.map((angle) => (
				<path
					key={angle}
					d="m26 12 1-6 2-2h6l2 2 1 6-6 2Z"
					transform={`rotate(${angle} 32 32)`}
				/>
			))}
			<circle cx="32" cy="16" r="2.5" fill="hsl(var(--surface-primary))" />
		</svg>
	);
}
