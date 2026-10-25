/** The Cloud Drive male connector, with its cable join at the origin and prongs pointing right. */
export const CloudDriveMalePlug: React.FC = () => (
	<>
		<line className="cd-prong" x1={11} y1={-2} x2={19} y2={-2} />
		<line className="cd-prong" x1={11} y1={2} x2={19} y2={2} />
		<rect
			className="cd-plug-body"
			x={0}
			y={-4.5}
			width={12}
			height={9}
			rx={2}
		/>
	</>
);
