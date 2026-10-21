import { cn } from "cn";
import {
	CheckIcon,
	InfoIcon,
	OctagonXIcon,
	TriangleAlertIcon,
	XIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps as SonnerProps } from "sonner";
import { Spinner } from "#/components/Spinner/Spinner";

// Platform: toasts in the bottom left corner (clear of the chat bar on the right), and smaller.
export const Toaster = ({ ...props }: SonnerProps) => {
	return (
		<Sonner
			position="bottom-left"
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
