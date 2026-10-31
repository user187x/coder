import { useEffect, useState } from "react";
import { staticImageFrame } from "../animations/gifFreezer";
import { useAnnouncementMotion } from "./useAnnouncementMotion";

export const useAnnouncementImage = (src: string) => {
	const { pictures } = useAnnouncementMotion();
	const [frame, setFrame] = useState<{ src: string; still?: string }>();
	useEffect(() => {
		if (pictures || !src) return;
		let current = true;
		void staticImageFrame(src).then((still) => {
			if (current) setFrame({ src, still });
		});
		return () => {
			current = false;
		};
	}, [src, pictures]);
	// Never flash an animated original while decoding or when cross-origin copying fails.
	return pictures ? src : frame?.src === src ? frame.still : undefined;
};
