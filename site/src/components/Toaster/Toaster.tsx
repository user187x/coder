import { cn } from "cn";
import {
	CheckIcon,
	InfoIcon,
	OctagonXIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps as SonnerProps } from "sonner";
import { Spinner } from "#/components/Spinner/Spinner";
import { bottomBarsHeight } from "#/modules/platform/bottomBars";

/** How far (px) the toasts float above the bars along the bottom, and from the window's left edge. */
const TOAST_GAP = 12;
const TOAST_LEFT = 24;
const MEASURE_EVERY_MS = 500;

/**
 * Platform: the height of the bars along the window's bottom (the deployment's bar, the classification bar), kept
 * measured - on resize and twice a second, as the chat dock does - so the toasts rise above whatever is there.
 */
const useBottomBars = () => {
	const [bottom, setBottom] = useState(0);
	useEffect(() => {
		const measure = () => setBottom(bottomBarsHeight());
		window.addEventListener("resize", measure);
		const interval = window.setInterval(measure, MEASURE_EVERY_MS);
		measure();
		return () => {
			window.removeEventListener("resize", measure);
			window.clearInterval(interval);
		};
	}, []);
	return bottom;
};

// Platform: toasts in the bottom left corner (clear of the chat bar on the right), smaller, and just above the bars
// along the bottom, whichever are there.
export const Toaster = ({ ...props }: SonnerProps) => {
	const bars = useBottomBars();
	return (
		<Sonner
			position="bottom-left"
			offset={{ bottom: bars + TOAST_GAP, left: TOAST_LEFT }}
			mobileOffset={{ bottom: bars + TOAST_GAP }}
			style={{ "--width": "288px" } as React.CSSProperties}
			icons={{
				success: <CheckIcon className="text-content-success" />,
				info: <InfoIcon className="text-content-primary" />,
				warning: <TriangleAlertIcon className="text-content-warning" />,
				error: <OctagonXIcon className="text-content-destructive" />,
				loading: <Spinner size="sm" loading />,
				close: <XIcon className="size-icon-sm" />,
			}}
			toastOptions={{
				unstyled: true,
				closeButton: true,
				classNames: {
					toast: cn(
						"bg-surface-secondary text-content-secondary border border-solid text-xs leading-snug p-2.5 pr-9",
						"shadow-sm rounded-md grid grid-cols-[auto_1fr] w-72 gap-1.5",
						"data-[expanded=false]:data-[front=false]:overflow-hidden",
						"[&[data-expanded=false][data-front=false]>*]:opacity-0",
					),
					title: "text-content-primary",
					description: "mt-0.5",
					icon: "pt-0.5 [&_svg]:size-icon-xs flex flex-col",
					actionButton: cn(
						"border border-solid bg-transparent text-xs rounded-md cursor-pointer",
						"flex items-center gap-2 mt-1 py-1.5 px-2 col-start-2 justify-self-start",
						"[&_svg]:size-icon-xs [&_span]:text-xs text-content-primary",
					),
					closeButton:
						"absolute top-2.5 right-2.5 bg-transparent border-none p-0 text-content-primary [&_svg]:size-3.5",
					// Loading styles require a bit more love, the icon doesn't render inline.
					loader: "left-[17px]! top-[19px]! -translate-x-[none]!",
					loading: "pl-[28px]!",
				},
			}}
			{...props}
		/>
	);
};
