import { PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "#/components/Button/Button";
import { sendDashboardInput, useRemotePointer, useShareMedia } from "./media";
import { ShareVideo } from "./ShareVideo";

export const SharedDashboardView = ({
	stream,
	paused = false,
	fill = false,
	className,
}: {
	stream: MediaStream | null;
	paused?: boolean;
	fill?: boolean;
	className?: string;
}) => {
	const media = useShareMedia();
	const [enabled, setEnabled] = useState(false);
	const video = useRef<HTMLVideoElement>(null);
	const surface = useRef<HTMLDivElement>(null);
	const controlButton = useRef<HTMLButtonElement>(null);
	const active = media.dashboard && media.controlReady && enabled && !paused;
	const coordinates = (x: number, y: number) => {
		const box = contentBox(video.current);
		if (!box) return null;
		const point = {
			x: (x - box.rect.left - box.left) / box.width,
			y: (y - box.rect.top - box.top) / box.height,
		};
		return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
			? point
			: null;
	};
	const pendingMove = useRef<{ x: number; y: number } | null>(null);
	const moveFrame = useRef(0);
	useEffect(() => () => cancelAnimationFrame(moveFrame.current), []);
	// Coalesce pointer moves to one message per display frame.
	const move = (event: React.PointerEvent) => {
		if (!active) return;
		const point = coordinates(event.clientX, event.clientY);
		if (!point) return;
		pendingMove.current = point;
		if (moveFrame.current) return;
		moveFrame.current = requestAnimationFrame(() => {
			moveFrame.current = 0;
			const latest = pendingMove.current;
			pendingMove.current = null;
			if (latest) sendDashboardInput({ type: "move", ...latest });
		});
	};
	const wheel = useEffectEvent((event: WheelEvent) => {
		if (!active) return;
		event.preventDefault();
		const point = coordinates(event.clientX, event.clientY);
		if (point)
			sendDashboardInput({
				type: "wheel",
				...point,
				dx: Math.max(-2000, Math.min(2000, event.deltaX)),
				dy: Math.max(-2000, Math.min(2000, event.deltaY)),
			});
	});
	useEffect(() => {
		const target = surface.current;
		const listener = (event: WheelEvent) => wheel(event);
		target?.addEventListener("wheel", listener, { passive: false });
		return () => target?.removeEventListener("wheel", listener);
	}, []);
	const click = (event: React.MouseEvent, button: 0 | 2) => {
		if (!active) return;
		event.preventDefault();
		surface.current?.focus();
		const point = coordinates(event.clientX, event.clientY);
		if (point)
			sendDashboardInput({ type: "click", ...point, button, count: 1 });
	};
	return (
		<div data-dashboard-support-ignore className="flex min-h-0 flex-1 flex-col">
			{media.dashboard && (
				<div className="my-2 flex flex-wrap items-center gap-2 text-xs">
					<Button
						ref={controlButton}
						size="sm"
						variant="outline"
						disabled={!media.controlReady || paused}
						aria-pressed={active}
						onClick={() => {
							setEnabled(!enabled);
							if (!enabled) surface.current?.focus();
						}}
					>
						{active ? "Release keyboard and mouse" : "Control dashboard"}
					</Button>
					<span className="text-content-secondary">
						{media.controlReady
							? "Click the view to focus. Escape releases input."
							: "Waiting for the user's consent and control connection."}
					</span>
				</div>
			)}
			<div className="relative min-h-0 flex-1">
				<ShareVideo
					stream={stream}
					paused={paused}
					fill={media.dashboard ? false : fill}
					className={className}
					videoRef={video}
				/>
				<div
					ref={surface}
					role="application"
					aria-label="Remote dashboard keyboard and mouse"
					tabIndex={active ? 0 : -1}
					aria-hidden={!active}
					className={
						active
							? "absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-content-link"
							: "pointer-events-none absolute inset-0"
					}
					onPointerMove={move}
					onClick={(event) => click(event, 0)}
					onContextMenu={(event) => click(event, 2)}
					onKeyDown={(event) => {
						if (!active || event.nativeEvent.isComposing) return;
						event.stopPropagation();
						if (event.key === "Escape") {
							setEnabled(false);
							controlButton.current?.focus();
							return;
						}
						if (
							(event.ctrlKey || event.metaKey) &&
							event.key.toLowerCase() === "v"
						)
							return;
						event.preventDefault();
						sendDashboardInput({
							type: "key",
							key: event.key,
							ctrl: event.ctrlKey,
							alt: event.altKey,
							shift: event.shiftKey,
							meta: event.metaKey,
						});
					}}
					onCompositionEnd={(event) => {
						if (active && event.data)
							sendDashboardInput({
								type: "text",
								text: event.data.slice(0, 4096),
							});
					}}
					onPaste={(event) => {
						if (!active) return;
						event.preventDefault();
						sendDashboardInput({
							type: "text",
							text: event.clipboardData.getData("text/plain").slice(0, 4096),
						});
					}}
				/>
				{active && <ViewerPointer video={video} />}
			</div>
		</div>
	);
};

/** The letterboxed area of the video that shows the stream. */
const contentBox = (frame: HTMLVideoElement | null) => {
	if (!frame?.videoWidth || !frame.videoHeight) return null;
	const rect = frame.getBoundingClientRect();
	const scale = Math.min(
		rect.width / frame.videoWidth,
		rect.height / frame.videoHeight,
	);
	const width = frame.videoWidth * scale;
	const height = frame.videoHeight * scale;
	return {
		rect,
		width,
		height,
		left: (rect.width - width) / 2,
		top: (rect.height - height) / 2,
	};
};

/** Marks where the sharer applied the last move, so lag or a stuck pointer is visible. */
const ViewerPointer = ({
	video,
}: {
	video: React.RefObject<HTMLVideoElement | null>;
}) => {
	const pointer = useRemotePointer();
	const box = contentBox(video.current);
	if (!pointer || !box) return null;
	return (
		<PointerIcon
			aria-hidden
			className="pointer-events-none absolute size-5 -translate-x-[40%] text-content-link drop-shadow"
			style={{
				left: box.left + pointer.x * box.width,
				top: box.top + pointer.y * box.height,
			}}
		/>
	);
};
