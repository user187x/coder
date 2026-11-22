import { cn } from "cn";
import {
	containerWidth,
	containerWidthMedium,
	sidePadding,
} from "#/theme/constants";

export type Size = "regular" | "medium" | "condensed" | "small";

const widthBySize: Record<Size, number | string> = {
	regular: `var(--page-margins-max-width, ${containerWidth}px)`,
	medium: containerWidthMedium,
	condensed: containerWidth / 2,
	small: containerWidth / 3,
};

type MarginsProps = React.JSX.IntrinsicElements["div"] & {
	size?: Size;
};

export const Margins: React.FC<MarginsProps> = ({
	size = "regular",
	children,
	className,
	...divProps
}) => {
	return (
		<div
			data-dashboard-background=""
			{...divProps}
			style={{
				maxWidth: widthBySize[size],
				paddingInline: `var(--page-margins-padding, ${sidePadding}px)`,
			}}
			className={cn("mx-auto w-full", className)}
		>
			{children}
		</div>
	);
};
