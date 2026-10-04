import { SmileIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "#/components/Button/Button";
import { Loader } from "#/components/Loader/Loader";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/Popover/Popover";

const EmojiPicker = lazy(() => import("./EmojiPicker"));

type EmojiButtonProps = {
	onPick: (emoji: string) => void;
};

export const EmojiButton: React.FC<EmojiButtonProps> = ({ onPick }) => {
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					<SmileIcon />
					Emoji
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-auto border-0 bg-transparent p-0 shadow-none"
			>
				<Suspense fallback={<Loader />}>
					<EmojiPicker
						onPick={(emoji) => {
							onPick(emoji);
							setOpen(false);
						}}
					/>
				</Suspense>
			</PopoverContent>
		</Popover>
	);
};
