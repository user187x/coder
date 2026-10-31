import { createContext, useContext } from "react";
import { animated, useAnimationSettings } from "#/hooks/useAnimationSettings";

export const AnnouncementMotionDisabled = createContext(false);

export const useAnnouncementMotion = (disabled = false) => {
	const inherited = useContext(AnnouncementMotionDisabled);
	const settings = useAnimationSettings();
	const enabled = !disabled && !inherited && animated(settings, "announcement");
	return {
		enabled,
		effects: enabled && animated(settings, "effects"),
		pictures: enabled && animated(settings, "gifs"),
	};
};
