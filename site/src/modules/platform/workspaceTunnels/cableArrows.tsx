export type ArrowMode = "none" | "start" | "end" | "both";

export type CableMarkers = { start?: string; end?: string };

/** The marker URLs a cable path needs for its arrowheads. */
export const arrowMarkers = (id: string, mode: ArrowMode): CableMarkers => ({
	start: mode === "start" || mode === "both" ? `url(#${id})` : undefined,
	end: mode === "end" || mode === "both" ? `url(#${id})` : undefined,
});

/** Defines the arrowhead marker that follows a path's direction at either end. */
export const CableArrowMarker = ({ id }: { id: string }) => (
	<defs>
		<marker
			id={id}
			viewBox="0 0 10 10"
			refX={8}
			refY={5}
			markerWidth={10}
			markerHeight={10}
			markerUnits="userSpaceOnUse"
			orient="auto-start-reverse"
		>
			<path
				d="M 1 1 L 9 5 L 1 9 z"
				fill="#f8fafc"
				stroke="#475569"
				strokeWidth={1}
				strokeLinejoin="round"
			/>
		</marker>
	</defs>
);
