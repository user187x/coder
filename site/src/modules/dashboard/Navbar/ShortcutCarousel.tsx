import { useLayoutEffect, useState } from "react";
import { AppsCarousel } from "#/modules/platform/workspaceApps/AppsCarousel";

/** Fits the shortcut picker between its plus button and the dropdown's lower edge. */
export const ShortcutCarousel = ({
	anchor,
	container,
	onClose,
	children,
}: {
	anchor: HTMLElement;
	container: HTMLElement;
	onClose: () => void;
	children: React.ReactNode;
}) => {
	const [bounds, setBounds] = useState({ top: 0, height: 280 });
	useLayoutEffect(() => {
		const menu = container.closest('[role="menu"]');
		if (!menu) return;
		const update = () => {
			const parent = container.getBoundingClientRect();
			const button = anchor.getBoundingClientRect();
			const bottom = Math.min(
				menu.getBoundingClientRect().bottom,
				window.innerHeight - 8,
			);
			if (!button.height) return;
			const top = Math.min(
				button.top - 8,
				Math.max(parent.top + 16, bottom - 170),
			);
			const next = {
				top: top - parent.top,
				height: Math.max(150, bottom - top - 8),
			};
			setBounds((old) =>
				old.top === next.top && old.height === next.height ? old : next,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(menu);
		observer.observe(anchor);
		window.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", update);
		};
	}, [anchor, container]);
	return (
		<div
			className="settings-shortcut-carousel"
			style={bounds}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
					anchor.focus();
				}
			}}
		>
			<AppsCarousel
				framed
				className="settings-shortcut-carousel-track"
				orientation="vertical"
				label="Resource shortcuts"
				visible={Math.max(1, Math.floor((bounds.height - 102) / 40))}
			>
				{children}
			</AppsCarousel>
		</div>
	);
};
