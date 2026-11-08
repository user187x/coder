import { MousePointerClickIcon, PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "#/components/Button/Button";
import { sendDashboardInput, useRemotePointer, useShareMedia } from "./media";
import { ShareVideo } from "./ShareVideo";

/**
 * Takes or releases the shared dashboard's keyboard and mouse, showing the
 * live view's latency.
 */
export const DashboardControlButton = ({
	enabled,
	onEnabledChange,
	paused = false,
	buttonRef,
	className,
}: {
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	paused?: boolean;
	buttonRef?: React.Ref<HTMLButtonElement>;
	className?: string;
}) => {
	const media = useShareMedia();
	const active = media.dashboard && media.controlReady && enabled && !paused;
	return (
		<Button
			ref={buttonRef}
			size="sm"
			disabled={!media.controlReady || paused}
			aria-pressed={active}
			title={
				media.controlReady
					? "Click the view to focus. Escape releases input."
					: "Waiting for the user's consent and control connection."
			}
			className={className}
			onClick={() => onEnabledChange(!enabled)}
		>
			<MousePointerClickIcon />
			{active ? "Release keyboard and mouse" : "Control dashboard"}
			{media.latency !== null && (
				<>
					<span
						aria-hidden
						className="rounded-full bg-surface-primary/20 px-1.5 text-2xs tabular-nums"
					>
						{media.latency} ms
					</span>
					<span className="sr-only">
						, latency {media.latency} milliseconds
					</span>
				</>
			)}
		</Button>
	);
};

/**
 * The shared dashboard's live view and its input surface. Without
 * `onEnabledChange` it shows its own control button above the view;
 * with it, the caller places a DashboardControlButton.
 */
export const SharedDashboardView = ({
	stream,
	paused = false,
	fill = false,
	className,
	enabled: controlledEnabled,
	onEnabledChange,
	controlButtonRef,
}: {
	stream: MediaStream | null;
	paused?: boolean;
	fill?: boolean;
	className?: string;
	enabled?: boolean;
	onEnabledChange?: (enabled: boolean) => void;
	controlButtonRef?: React.RefObject<HTMLButtonElement | null>;
}) => {
	const media = useShareMedia();
	const [ownEnabled, setOwnEnabled] = useState(false);
	const enabled = controlledEnabled ?? ownEnabled;
	const setEnabled = onEnabledChange ?? setOwnEnabled;
	const video = useRef<HTMLVideoElement>(null);
	const surface = useRef<HTMLDivElement>(null);
	const ownButton = useRef<HTMLButtonElement>(null);
	const controlButton = controlButtonRef ?? ownButton;
	const active = media.dashboard && media.controlReady && enabled && !paused;
	// Taking control moves keyboard focus to the view, wherever the button is.
	useEffect(() => {
		if (active) surface.current?.focus();
	}, [active]);
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
			{media.dashboard && !onEnabledChange && (
				<div className="my-2 flex flex-wrap items-center gap-2">
					<DashboardControlButton
						enabled={enabled}
						onEnabledChange={setEnabled}
						paused={paused}
						buttonRef={controlButton}
					/>
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
