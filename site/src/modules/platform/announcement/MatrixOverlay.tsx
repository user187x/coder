import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./matrixOverlay.css";

/** How long the rain takes to fade once a key or the mouse is pressed (ms). */
export const MATRIX_OUT_MS = 700;
const GLYPHS =
	"ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+-<>¦|";
const FONT_PX = 18;
/** A frame every this many ms: the rain's speed. */
const FRAME_MS = 50;

/**
 * The announcement terminal's "matrix": the Matrix's digital rain over the whole screen - green characters falling in
 * columns, each column's head bright, its trail fading - until a key or the mouse is pressed, when it fades away.
 * Still (one frame) without animations.
 */
export const MatrixOverlay: React.FC<{ onDone: () => void }> = ({ onDone }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [leaving, setLeaving] = useState(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext?.("2d");
		if (!canvas || !ctx) {
			return;
		}
		const still =
			document.documentElement.dataset.animations === "off" ||
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		let drops: number[] = [];
		const size = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
			const columns = Math.ceil(canvas.width / FONT_PX);
			drops = Array.from({ length: columns }, () =>
				Math.floor((Math.random() * -canvas.height) / FONT_PX),
			);
			ctx.fillStyle = "#000";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		};
		const frame = () => {
			// the trail: last frames fading under a translucent black
			ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.font = `${FONT_PX}px monospace`;
			for (let i = 0; i < drops.length; i++) {
				const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
				const y = drops[i] * FONT_PX;
				ctx.fillStyle = "#b5ffb5"; // its head, bright
				ctx.fillText(ch, i * FONT_PX, y);
				ctx.fillStyle = "#00e05a";
				ctx.fillText(
					GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
					i * FONT_PX,
					y - FONT_PX,
				);
				drops[i] =
					y > canvas.height && Math.random() > 0.975 ? 0 : drops[i] + 1;
			}
		};
		size();
		window.addEventListener("resize", size);
		let timer: number | undefined;
		if (still) {
			for (let i = 0; i < 60; i++) {
				frame();
			}
		} else {
			timer = window.setInterval(frame, FRAME_MS);
		}
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("resize", size);
		};
	}, []);

	useEffect(() => {
		let timer: number | undefined;
		const leave = (event: Event) => {
			event.preventDefault();
			event.stopPropagation();
			setLeaving(true);
			window.clearTimeout(timer);
			timer = window.setTimeout(onDone, MATRIX_OUT_MS);
		};
		// after the Enter that started it
		const arm = window.setTimeout(() => {
			window.addEventListener("keydown", leave, { capture: true, once: true });
			window.addEventListener("pointerdown", leave, {
				capture: true,
				once: true,
			});
		}, 0);
		return () => {
			window.clearTimeout(arm);
			window.clearTimeout(timer);
			window.removeEventListener("keydown", leave, true);
			window.removeEventListener("pointerdown", leave, true);
		};
	}, [onDone]);

	return createPortal(
		<div
			className="matrix-overlay"
			data-testid="matrix-overlay"
			data-leaving={leaving || undefined}
			role="presentation"
		>
			<canvas ref={canvasRef} />
		</div>,
		document.body,
	);
};
