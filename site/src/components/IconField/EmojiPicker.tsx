import data from "@emoji-mart/data/sets/15/apple.json";
import EmojiMart from "@emoji-mart/react";
import { useEffect } from "react";
import { DEPRECATED_ICONS } from "#/theme/deprecatedIcons";
import icons from "#/theme/icons.json";

const builtInIcons = {
	id: "icons",
	name: "Icons",
	emojis: icons
		.filter((icon) => !DEPRECATED_ICONS.includes(icon))
		.map((icon) => {
			const id = icon.split(".")[0];

			return {
				id,
				name: id,
				keywords: id.split("-"),
				skins: [{ src: `/icon/${icon}` }],
			};
		}),
};

/** An icon uploaded to Coder, offered in its own "Uploaded" category. */
export type UploadedIcon = { name: string; url: string };

type EmojiPickerProps = Omit<
	React.ComponentProps<typeof EmojiMart>,
	"custom" | "data" | "set" | "theme" | "getSpritesheetURL"
> & {
	uploadedIcons?: readonly UploadedIcon[];
};

const EmojiPicker: React.FC<EmojiPickerProps> = ({
	uploadedIcons = [],
	...props
}) => {
	const custom = uploadedIcons.length
		? [
				{
					id: "uploaded",
					name: "Uploaded",
					emojis: uploadedIcons.map((icon) => ({
						// Prefixed so an uploaded icon never shares an id with a built-in one.
						id: `uploaded-${icon.name}`,
						name: icon.name,
						keywords: icon.name.split(/[-_.]/),
						skins: [{ src: icon.url }],
					})),
				},
				builtInIcons,
			]
		: [builtInIcons];

	/**
	 * Workaround for a bug in the emoji-mart library where custom emoji images render improperly.
	 * Setting the image width to 100% ensures they display correctly.
	 *
	 * Issue:   https://github.com/missive/emoji-mart/issues/805
	 * Open PR: https://github.com/missive/emoji-mart/pull/806
	 */
	useEffect(() => {
		const picker = document.querySelector("em-emoji-picker")?.shadowRoot;
		if (!picker) {
			return;
		}
		const css = document.createElement("style");
		css.textContent = ".emoji-mart-emoji img { width: 100% }";
		picker.appendChild(css);
	}, []);

	return (
		<EmojiMart
			theme="dark"
			set="apple"
			emojiVersion="15"
			data={data}
			custom={custom}
			getSpritesheetURL={() => "/emojis/spritesheet.png"}
			{...props}
		/>
	);
};

export default EmojiPicker;
