import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TOOLTIP_DELAY_DURATION } from "./Tooltip";

type Label = {
	anchor: Element;
	text: string;
	suppress: () => () => void;
};

function tooltipLabel(target: Element, active?: Label): Label | undefined {
	if (target.closest(".table-card")) return;
	for (
		let anchor: Element | null = target;
		anchor;
		anchor = anchor.parentElement
	) {
		if (anchor === active?.anchor) return active;
		const title = anchor.getAttribute("title");
		if (title !== null) {
			if (!title.trim()) return;
			const element = anchor;
			return {
				anchor: element,
				text: title,
				suppress: () => {
					element.setAttribute("title", "");
					return () => {
						if (element.getAttribute("title") === "")
							element.setAttribute("title", title);
					};
				},
			};
		}
		if (anchor instanceof SVGElement) {
			const node = anchor.querySelector(":scope > title")?.firstChild;
			if (node instanceof Text && node.data.trim()) {
				const text = node.data;
				return {
					anchor,
					text,
					suppress: () => {
						node.data = "";
						return () => {
							if (node.data === "") node.data = text;
						};
					},
				};
			}
		}
	}
}

type Hint = { text: string; x: number; y: number };

/** Renders HTML and SVG title hints in the application so they share its tooltip styling. */
export function TitleTooltip() {
	const [hint, setHint] = useState<Hint>();
	useEffect(() => {
		let active: (Label & { restore: () => void }) | undefined;
		let timer: number | undefined;
		const dismiss = () => {
			window.clearTimeout(timer);
			if (!active) return;
			active.restore();
			active = undefined;
			setHint(undefined);
		};
		const show = (event: PointerEvent) => {
			const target = event.target;
			if (event.pointerType === "touch" || !(target instanceof Element)) return;
			const label = tooltipLabel(target, active);
			if (label && label === active) return;
			dismiss();
			if (!label) return;
			active = { ...label, restore: label.suppress() };
			if (target.closest("[data-tooltip-trigger]")) return;
			const { clientX: x, clientY: y } = event;
			timer = window.setTimeout(() => {
				if (label.anchor.isConnected && label.anchor.matches(":hover")) {
					setHint({ text: label.text, x, y });
				}
			}, TOOLTIP_DELAY_DURATION);
		};
		const leave = (event: PointerEvent) => {
			if (
				event.relatedTarget instanceof Node &&
				active?.anchor.contains(event.relatedTarget)
			)
				return;
			dismiss();
		};
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") dismiss();
		};
		document.addEventListener("pointerover", show);
		document.addEventListener("pointerout", leave);
		document.addEventListener("pointerdown", dismiss);
		document.addEventListener("scroll", dismiss, true);
		document.addEventListener("keydown", handleKey);
		window.addEventListener("resize", dismiss);
		return () => {
			window.clearTimeout(timer);
			active?.restore();
			document.removeEventListener("pointerover", show);
			document.removeEventListener("pointerout", leave);
			document.removeEventListener("pointerdown", dismiss);
			document.removeEventListener("scroll", dismiss, true);
			document.removeEventListener("keydown", handleKey);
			window.removeEventListener("resize", dismiss);
		};
	}, []);

	if (!hint) return null;
	const flipX = hint.x > window.innerWidth / 2;
	const flipY = hint.y > window.innerHeight - 112;
	return createPortal(
		<div
			role="tooltip"
			className="pointer-events-none fixed z-[2147483647] w-max max-w-[min(20rem,calc(50vw-1rem))] rounded-xl border border-solid border-border bg-surface-primary px-3 py-2 text-xs font-medium whitespace-pre-wrap text-content-secondary shadow-md [overflow-wrap:anywhere]"
			style={{
				left: hint.x + (flipX ? -12 : 12),
				top: hint.y + (flipY ? -12 : 12),
				translate: `${flipX ? "-100%" : "0"} ${flipY ? "-100%" : "0"}`,
				zoom: "calc(1 / var(--app-zoom, 1))",
			}}
		>
			{hint.text}
		</div>,
		document.body,
	);
}
