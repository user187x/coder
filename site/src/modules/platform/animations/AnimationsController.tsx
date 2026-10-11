import { useEffect } from "react";
import { useAnimationsEnabled } from "./animations";
import { freezeAll, freezeImage, thawAll } from "./gifFreezer";

/**
 * Applies the "Animations" switch to the whole dashboard: <html
 * data-animations> for CSS, and, while it is off, every animated GIF on the
 * page - including ones that appear or change later - stands still.
 */
export const AnimationsController: React.FC = () => {
	const enabled = useAnimationsEnabled();
	useEffect(() => {
		document.documentElement.dataset.animations = enabled ? "on" : "off";
		if (enabled) {
			thawAll();
			return;
		}
		freezeAll(document);
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				if (record.type === "attributes") {
					if (record.target instanceof HTMLImageElement) {
						void freezeImage(record.target);
					}
					continue;
				}
				for (const node of record.addedNodes) {
					if (node instanceof HTMLImageElement) {
						void freezeImage(node);
					} else if (node instanceof Element) {
						freezeAll(node);
					}
				}
			}
		});
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["src"],
		});
		return () => observer.disconnect();
	}, [enabled]);
	return null;
};
