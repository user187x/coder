import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "#/components/Button/Button";

/** The offline DOOM engine and game data, served with the dashboard (site/static/doom/, see its README). */
const DOOM_PAGE = "/doom/index.html";

/**
 * DOOM in the announcement panel, in place of its terminal, typed at the prompt. The game runs in its own frame, which
 * keeps the focus so every key and the mouse go to it, not the dashboard; Exit DOOM, or quitting from the game's menu,
 * returns to the terminal.
 */
export const DoomScreen: React.FC<{ onDone: () => void }> = ({ onDone }) => {
	const frame = useRef<HTMLIFrameElement>(null);
	useEffect(() => {
		const quit = (event: MessageEvent) => {
			if (
				event.origin === window.location.origin &&
				event.source === frame.current?.contentWindow &&
				event.data?.type === "coder:doom-exit"
			) {
				onDone();
			}
		};
		window.addEventListener("message", quit);
		return () => window.removeEventListener("message", quit);
	}, [onDone]);
	return (
		<section aria-label="DOOM" className="relative min-h-0 flex-1 bg-black">
			<iframe
				ref={frame}
				src={DOOM_PAGE}
				title="DOOM"
				allow="fullscreen; autoplay"
				className="block size-full border-0"
				onLoad={() => frame.current?.focus()}
			/>
			<Button
				variant="outline"
				size="sm"
				className="absolute right-3 top-3 opacity-60 hover:opacity-100 focus-visible:opacity-100"
				onClick={onDone}
			>
				<XIcon />
				Exit DOOM
			</Button>
		</section>
	);
};
