import { ImageIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Loader } from "#/components/Loader/Loader";
import { toCssPx } from "#/utils/appZoom";

const BackgroundSection = lazy(() =>
	import("#/modules/platform/background/BackgroundSection").then((module) => ({
		default: module.BackgroundSection,
	})),
);

const backgroundSurface = "[data-dashboard-background]";

const isExposedBackground = (target: EventTarget, frame: HTMLElement) => {
	// A layout wrapper inside a card or a portal is still part of that component.
	let element = target instanceof Element ? target : null;
	while (element?.matches(backgroundSurface)) {
		if (element === frame) return true;
		element = element.parentElement;
	}
	return false;
};

export const DashboardBackgroundMenu: React.FC<{
	enabled: boolean;
	className: string;
	children: React.ReactNode;
}> = ({ enabled, className, children }) => {
	const [menu, setMenu] = useState({ open: false, x: 0, y: 0 });
	const [editing, setEditing] = useState(false);
	const frameRef = useRef<HTMLDivElement>(null);
	const returnFocus = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!enabled) return;

		const openFromWallpaper = (event: MouseEvent) => {
			const frame = frameRef.current;
			const target = event.target;
			if (event.defaultPrevented || !frame || !target) return;
			// The docked sidebar can leave exposed wallpaper outside the dashboard frame.
			if (
				target !== document.documentElement &&
				target !== document.body &&
				target !== frame.parentElement &&
				!isExposedBackground(target, frame)
			) {
				return;
			}
			event.preventDefault();
			returnFocus.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			setMenu({
				open: true,
				x: toCssPx(event.clientX),
				y: toCssPx(event.clientY),
			});
		};

		window.addEventListener("contextmenu", openFromWallpaper);
		return () => window.removeEventListener("contextmenu", openFromWallpaper);
	}, [enabled]);

	return (
		<>
			<div
				ref={frameRef}
				data-dashboard-background=""
				className={className}
				onKeyDown={
					enabled
						? (event) => {
								if (
									event.defaultPrevented ||
									!(event.target instanceof HTMLElement) ||
									!event.target.matches(`main${backgroundSurface}`) ||
									!isExposedBackground(event.target, event.currentTarget) ||
									!(
										event.key === "ContextMenu" ||
										(event.shiftKey && event.key === "F10")
									)
								) {
									return;
								}
								event.preventDefault();
								returnFocus.current = event.target;
								const rect = event.target.getBoundingClientRect();
								setMenu({
									open: true,
									x: toCssPx(Math.max(0, rect.left) + 16),
									y: toCssPx(Math.max(0, rect.top) + 16),
								});
							}
						: undefined
				}
			>
				{children}
			</div>

			{enabled && (
				<>
					<DropdownMenu
						modal={false}
						open={menu.open}
						onOpenChange={(open) =>
							setMenu((previous) => ({ ...previous, open }))
						}
					>
						<DropdownMenuTrigger asChild>
							<span
								aria-hidden
								className="pointer-events-none fixed size-0"
								style={{ left: menu.x, top: menu.y }}
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							aria-label="Dashboard background"
							align="start"
							sideOffset={0}
							className="rounded-xl"
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								if (!editing && document.activeElement === document.body)
									returnFocus.current?.focus();
							}}
						>
							<DropdownMenuItem onSelect={() => setEditing(true)}>
								<ImageIcon aria-hidden />
								Change background image
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<Dialog open={editing} onOpenChange={setEditing}>
						<DialogContent
							className="max-w-5xl rounded-2xl"
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								returnFocus.current?.focus();
							}}
						>
							<DialogHeader>
								<div className="flex items-center justify-between gap-2">
									<DialogTitle>Change background image</DialogTitle>
									<DialogClose asChild>
										<Button
											aria-label="Close background editor"
											size="icon"
											variant="subtle"
										>
											<XIcon aria-hidden />
										</Button>
									</DialogClose>
								</div>
								<DialogDescription>
									Saved changes apply to everyone on this deployment.
								</DialogDescription>
							</DialogHeader>
							<Suspense fallback={<Loader />}>
								<BackgroundSection embedded />
							</Suspense>
						</DialogContent>
					</Dialog>
				</>
			)}
		</>
	);
};
