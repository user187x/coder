import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "#/components/Button/Button";

/** The offline DOOM engine and game data, served with the dashboard (site/static/doom/, see its README). */
const DOOM_PAGE = "/doom/index.html";

/**
 * DOOM over the whole screen, typed at the announcement prompt. The game runs in its own frame, which keeps the focus
 * so every key and the mouse go to it, not the dashboard; Exit DOOM, or quitting from the game's menu, ends it.
 */
export const DoomOverlay: React.FC<{ onDone: () => void }> = ({ onDone }) => {
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
		<div
			role="dialog"
			aria-label="DOOM"
			className="fixed inset-0 z-[2147483647] bg-black"
		>
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
		</div>
	);
};
