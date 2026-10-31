import { createPortal } from "react-dom";
import "./promptEffects.css";

export const PromptCat = ({ onDone }: { onDone: () => void }) => (
	<div
		className="banner-prompt-cat-track"
		role="img"
		aria-label="Turbo cat crossing the terminal"
	>
		<img
			className="banner-prompt-cat"
			src="/turbo-cat.gif"
			alt="Prancing cat"
			draggable={false}
			onAnimationEnd={onDone}
		/>
	</div>
);
export const PromptFlash = ({ onDone }: { onDone: () => void }) =>
	createPortal(
		<div className="banner-prompt-flash" aria-hidden onAnimationEnd={onDone} />,
		document.body,
	);
export const PromptEcho = () => (
	<div
		className="banner-prompt-echo-track"
		role="status"
		aria-label="Echo wave. Press any key to stop."
	>
		<pre className="banner-prompt-echo" aria-hidden>
			{"   .   .   .\n(( ( E C H O ) ))\n   '   '   '"}
		</pre>
	</div>
);
