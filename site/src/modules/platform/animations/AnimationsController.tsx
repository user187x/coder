import { useEffect } from "react";
import { animated, useAnimationSettings } from "./animations";
import { freezeAll, freezeImage, thawAll } from "./gifFreezer";
import "./animations.css";

/**
 * Applies the user menu's Animations to the whole dashboard: <html
 * data-animations> for CSS (effects: every animation and transition ends at
 * once, animations.css), and, while GIFs are off, every animated GIF on the
 * page - including ones that appear or change later - stands still.
 */
export const AnimationsController: React.FC = () => {
	const s = useAnimationSettings();
	const effects = animated(s, "effects");
	const gifs = animated(s, "gifs");
	useEffect(() => {
		document.documentElement.dataset.animations = effects ? "on" : "off";
	}, [effects]);
	useEffect(() => {
		if (gifs) {
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
	}, [gifs]);
	return null;
};
