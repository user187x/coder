import { cn } from "cn";
import { useEffect, useRef } from "react";
export const ShareVideo = ({
	stream,
	paused = false,
	fill = false,
	className,
	videoRef,
}: {
	stream: MediaStream | null;
	paused?: boolean;
	fill?: boolean;
	className?: string;
	videoRef?: React.RefObject<HTMLVideoElement | null>;
}) => {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const video = ref.current;
		if (video) video.srcObject = stream;
		return () => {
			if (video) video.srcObject = null;
		};
	}, [stream]);
	useEffect(() => {
		if (paused) ref.current?.pause();
		else void ref.current?.play()?.catch(() => {});
	}, [paused, stream]);
	return (
		<video
			ref={(video) => {
				ref.current = video;
				if (videoRef) videoRef.current = video;
			}}
			aria-label="Live shared desktop"
			autoPlay
			playsInline
			muted
			className={cn(
				"block w-full bg-black",
				fill ? "object-cover" : "object-contain",
				className,
			)}
		/>
	);
};
