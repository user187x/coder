/**
 * The text size buttons' icons: Font Awesome's plus-circle and minus-circle
 * (fa-plus-circle / fa-minus-circle), as inline SVG so nothing is fetched (the
 * dashboard runs air-gapped). Paths from Font Awesome Free 6 (solid
 * circle-plus / circle-minus), https://fontawesome.com, CC BY 4.0.
 */

type IconProps = React.SVGProps<SVGSVGElement>;

const CircleIcon: React.FC<IconProps & { d: string }> = ({ d, ...props }) => (
	<svg
		aria-hidden
		viewBox="0 0 512 512"
		width="1em"
		height="1em"
		fill="currentColor"
		{...props}
	>
		<path d={d} />
	</svg>
);

export const FaPlusCircleIcon: React.FC<IconProps> = (props) => (
	<CircleIcon
		{...props}
		d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 344V280H168c-13.3 0-24-10.7-24-24s10.7-24 24-24h64V168c0-13.3 10.7-24 24-24s24 10.7 24 24v64h64c13.3 0 24 10.7 24 24s-10.7 24-24 24H280v64c0 13.3-10.7 24-24 24s-24-10.7-24-24z"
	/>
);

export const FaMinusCircleIcon: React.FC<IconProps> = (props) => (
	<CircleIcon
		{...props}
		d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM184 232H328c13.3 0 24 10.7 24 24s-10.7 24-24 24H184c-13.3 0-24-10.7-24-24s10.7-24 24-24z"
	/>
);
