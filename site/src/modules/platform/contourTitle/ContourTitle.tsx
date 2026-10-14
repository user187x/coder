import { useLayoutEffect, useRef, useState } from "react";
import { LOGIN_PAGE_DEFAULT, type LoginEffect } from "#/api/platform";
import "./contourTitle.css";

const HEIGHT = 56;
// Room for the stroke and the letter spacing past the last letter.
const PAD = 8;

type ContourTitleProps = {
	text: string;
	/**
	 * wireframe: drawn as an outline that a dash keeps tracing (the default);
	 * neon: filled, glowing and slowly pulsing; plain: filled, still.
	 */
	effect?: LoginEffect;
	/** The outline's, glow's or fill's colour; the default's cyan reads darker on the light themes. */
	color?: string;
	/** Seconds for one trace (wireframe) or one pulse (neon). */
	speed?: number;
};

/**
 * A title drawn with a text effect (contourTitle.css), as wide as its text:
 * the deployment's name (Coder, or the name set in Appearance) or the title
 * set in Customize > Sign-in page, on the sign-in page, where signing out also
 * lands.
 */
export const ContourTitle: React.FC<ContourTitleProps> = ({
	text,
	effect = LOGIN_PAGE_DEFAULT.effect,
	color = LOGIN_PAGE_DEFAULT.color,
	speed = LOGIN_PAGE_DEFAULT.speed,
}) => {
	const ref = useRef<SVGTextElement>(null);
	// A first guess (a monospace letter is about 0.6 of its 40 px size), then the text's measured width.
	const [width, setWidth] = useState(text.length * 25 + PAD);
	useLayoutEffect(() => {
		const measure = () => {
			const w = ref.current?.getComputedTextLength?.();
			if (w) {
				setWidth(Math.ceil(w) + PAD);
			}
		};
		measure();
		// The bundled font may still be loading: measure again once it is in.
		void document.fonts?.ready.then(measure);
	}, [text]);
	return (
		<svg
			className="fx-contour"
			viewBox={`0 0 ${width} ${HEIGHT}`}
			width={width}
			role="img"
			aria-label={text}
			data-testid="contour-title"
			data-effect={effect}
			style={
				{
					// the default colour is left to the stylesheet, which darkens it on the light themes
					...(color.toLowerCase() !== LOGIN_PAGE_DEFAULT.color
						? { "--fx-color": color }
						: {}),
					"--fx-speed": `${speed}s`,
				} as React.CSSProperties
			}
		>
			<text
				ref={ref}
				x="50%"
				y="50%"
				dominantBaseline="central"
				textAnchor="middle"
			>
				{text}
			</text>
		</svg>
	);
};
