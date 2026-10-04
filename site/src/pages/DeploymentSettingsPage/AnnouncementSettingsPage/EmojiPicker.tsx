import data from "@emoji-mart/data/sets/15/apple.json";
import EmojiMart from "@emoji-mart/react";

type EmojiPickerProps = {
	onPick: (emoji: string) => void;
};

/** Unicode emoji only: they go into the announcement's text. */
const EmojiPicker: React.FC<EmojiPickerProps> = ({ onPick }) => (
	<EmojiMart
		theme="dark"
		set="apple"
		emojiVersion="15"
		data={data}
		custom={[]}
		getSpritesheetURL={() => "/emojis/spritesheet.png"}
		onEmojiSelect={(emoji: { native?: string }) => {
			if (emoji.native) {
				onPick(emoji.native);
			}
		}}
	/>
);

export default EmojiPicker;
