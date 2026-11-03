import {
	closestCenter,
	DndContext,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef } from "react";

type TrayItem = { id: string; content: React.ReactNode };

export function SortableTrayLinks({
	items,
	order,
	disabled,
	onReorder,
}: {
	items: TrayItem[];
	order: readonly string[];
	disabled: boolean;
	onReorder: (order: string[]) => void;
}) {
	const ids = [...new Set([...order, ...items.map((item) => item.id)])].filter(
		(id) => items.some((item) => item.id === id),
	);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { delay: 450, tolerance: 5 },
		}),
	);
	const suppressClick = useRef(false);
	useEffect(() => {
		// The pointer sensor stops the click reaching React. Cancel the native link action after a drag as well.
		const preventNavigation = (event: MouseEvent) => {
			if (
				suppressClick.current &&
				event.detail > 0 &&
				event.target instanceof Element &&
				event.target.closest("[data-tray-shortcut]")
			) {
				event.preventDefault();
			}
		};
		document.addEventListener("click", preventNavigation, true);
		return () => document.removeEventListener("click", preventNavigation, true);
	}, []);
	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={() => {
				suppressClick.current = true;
			}}
			onDragEnd={({ active, over }) => {
				if (over && over.id !== active.id)
					onReorder(
						arrayMove(
							ids,
							ids.indexOf(String(active.id)),
							ids.indexOf(String(over.id)),
						),
					);
			}}
		>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				{ids.map((id, index) => (
					<TrayLink
						key={id}
						id={id}
						disabled={disabled}
						onPointerDown={() => {
							suppressClick.current = false;
						}}
						onClick={(event) => {
							if (suppressClick.current && event.detail > 0) {
								event.preventDefault();
								event.stopPropagation();
								suppressClick.current = false;
							}
						}}
						onMove={(direction) => {
							const to = index + direction;
							if (to >= 0 && to < ids.length)
								onReorder(arrayMove(ids, index, to));
						}}
					>
						{items.find((item) => item.id === id)?.content}
					</TrayLink>
				))}
			</SortableContext>
		</DndContext>
	);
}

function TrayLink({
	id,
	disabled,
	children,
	onMove,
	onPointerDown,
	onClick,
}: React.PropsWithChildren<{
	id: string;
	disabled: boolean;
	onMove: (by: number) => void;
	onPointerDown: () => void;
	onClick: React.MouseEventHandler<HTMLDivElement>;
}>) {
	const { setNodeRef, listeners, transform, transition, isDragging } =
		useSortable({ id, disabled });
	return (
		<div
			ref={setNodeRef}
			data-tray-shortcut={id}
			className="shrink-0 touch-pan-y select-none"
			data-reordering={isDragging || undefined}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				zIndex: isDragging ? 2 : undefined,
			}}
			title="Hold to drag, or use Alt + Up or Down to reorder"
			onDragStart={(event) => event.preventDefault()}
			onClickCapture={onClick}
			onPointerDown={(event) => {
				onPointerDown();
				if (
					event.target instanceof Element &&
					!event.target.closest('button[aria-label="Open notification inbox"]')
				)
					listeners?.onPointerDown?.(event);
			}}
			onKeyDownCapture={(event) => {
				if (
					!disabled &&
					event.altKey &&
					(event.key === "ArrowUp" || event.key === "ArrowDown")
				) {
					event.preventDefault();
					event.stopPropagation();
					onMove(event.key === "ArrowUp" ? -1 : 1);
				}
			}}
		>
			{children}
		</div>
	);
}
