import { useLayoutEffect, useRef, useState } from "react";
import "./contourTitle.css";

const HEIGHT = 56;
// Room for the stroke and the letter spacing past the last letter.
const PAD = 8;

/**
 * A title drawn as an outline that a dash keeps tracing (contourTitle.css),
 * as wide as its text: the deployment's name (Coder, or the name set in
 * Appearance) on the sign-in page, where signing out also lands.
 */
export const ContourTitle: React.FC<{ text: string }> = ({ text }) => {
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
