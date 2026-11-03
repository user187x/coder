import { cn } from "cn";
import type {
	BackgroundDials,
	BackgroundImage,
	BackgroundLayer,
	BackgroundSlot,
} from "#/api/platform";
import { HtmlPreviewFrame } from "./HtmlBackgroundControls";
import { backgroundStyle } from "./PlatformBackground";
/** A small page with the background as it will be: same strength, fit and layer. */
export const BackgroundPreview: React.FC<{
	slot: BackgroundSlot;
	children?: React.ReactNode;
	navbarTransparency?: number;
	image: BackgroundImage | null;
	html?: string;
	dials: BackgroundDials;
	opacity: number;
	layer: BackgroundLayer;
}> = ({
	slot,
	image,
	html,
	dials,
	opacity,
	layer,
	children,
	navbarTransparency,
}) => {
	const htmlLayer = html ? (
		<HtmlPreviewFrame
			html={html}
			dials={dials}
			className={cn(
				"pointer-events-none absolute inset-0 h-[300%] w-[300%] origin-top-left scale-[0.3333]",
				layer === "under" ? "-z-10" : "z-10",
			)}
			style={{ opacity }}
		/>
	) : null;
	return (
		<div
			className={cn(
				"relative isolate overflow-hidden rounded-lg border border-solid border-border bg-surface-primary",
				children ? "min-h-80" : "h-44",
			)}
			aria-label={
				navbarTransparency === undefined
					? "Preview"
					: `Navigation bar preview at ${navbarTransparency}% transparency`
			}
			role="img"
		>
			{layer === "under" && htmlLayer}
			{image && image.layer === "under" && (
				<div
					className="absolute inset-0 -z-10"
					style={backgroundStyle(image)}
				/>
			)}
			{children ??
				(slot === "login" ? (
					<div className="flex h-full flex-col items-center justify-center gap-2">
						<span className="h-5 w-16 rounded bg-content-secondary/40" />
						<span className="h-7 w-40 rounded-md border border-solid border-border bg-surface-primary" />
						<span className="h-7 w-40 rounded-md border border-solid border-border bg-surface-primary" />
						<span className="h-7 w-40 rounded-md bg-content-primary/80" />
					</div>
				) : (
					<div className="flex h-full flex-col">
						<div
							className={cn(
								"flex h-8 items-center gap-2 border-0 border-b border-solid border-border px-3",
								navbarTransparency !== undefined && "relative z-20",
							)}
							style={
								navbarTransparency === undefined
									? undefined
									: {
											backgroundColor: `hsl(var(--surface-primary) / ${1 - navbarTransparency / 100})`,
										}
							}
						>
							{navbarTransparency !== undefined ? (
								<>
									<span className="rounded border border-solid border-border bg-surface-primary px-2 py-0.5 text-xs">
										Resources
									</span>
									<span className="ml-auto rounded border border-solid border-border bg-surface-primary px-2 py-0.5 text-xs">
										Settings
									</span>
								</>
							) : (
								<>
									<span className="h-3 w-10 rounded bg-content-secondary/40" />
									<span className="h-3 w-16 rounded bg-content-secondary/25" />
									<span className="h-3 w-12 rounded bg-content-secondary/25" />
								</>
							)}
						</div>
						<div className="flex flex-1 flex-col gap-2 p-4">
							<span className="h-4 w-40 rounded bg-content-secondary/40" />
							<span className="h-3 w-64 rounded bg-content-secondary/25" />
							<span className="h-14 w-full rounded-md border border-solid border-border" />
						</div>
					</div>
				))}
			{layer === "over" && htmlLayer}
			{image && image.layer === "over" && (
				<div
					className="pointer-events-none absolute inset-0"
					style={backgroundStyle(image)}
				/>
			)}
			{!image && !html && (
				<span className="absolute right-2 bottom-2 text-xs text-content-secondary">
					No background
				</span>
			)}
		</div>
	);
};
