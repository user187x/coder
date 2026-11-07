import { cn } from "cn";
import {
	ArrowBigUpDashIcon,
	ArrowBigUpIcon,
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ChevronUpIcon,
	CornerDownLeftIcon,
	DeleteIcon,
	GlobeIcon,
	KeyboardIcon,
	SmileIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "#/components/Button/Button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import "./chatKeyboard.css";

const LAYOUTS = {
	qwerty: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
	qwertz: ["qwertzuiop", "asdfghjkl", "yxcvbnm"],
	azerty: ["azertyuiop", "qsdfghjkl", "wxcvbnm"],
} as const;
const NUMBERS = ["1234567890", "@#$%&*()-", "!?/\"':;"];
const SYMBOLS = ["[]{}<>+=_~", "\\|^`€£¥¢©", "¡¿§°±×÷"];
const EMOJI = [
	["😀", "😊", "😂", "😍", "🤔", "😎", "😢", "😮", "😴", "🎉"],
	["👍", "👎", "👏", "🙏", "👋", "💪", "❤️", "✅", "❌"],
	["⚠️", "🚀", "💻", "🔧", "💡", "📌", "✨"],
];

type Selection = {
	text: string;
	start: number;
	end: number;
	direction: "forward" | "backward" | "none";
};
const readSelection = (input: HTMLTextAreaElement): Selection => ({
	text: input.value,
	start: input.selectionStart,
	end: input.selectionEnd,
	direction: input.selectionDirection,
});
const cursorPosition = (
	text: string,
	at: number,
	key: string,
	word: boolean,
) => {
	if (key === "ArrowUp" || key === "ArrowDown") {
		const lineStart = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
		const column = at - lineStart;
		if (key === "ArrowUp") {
			if (lineStart === 0) return 0;
			const previousStart =
				lineStart === 1 ? 0 : text.lastIndexOf("\n", lineStart - 2) + 1;
			return Math.min(previousStart + column, lineStart - 1);
		}
		const lineEnd = text.indexOf("\n", at);
		if (lineEnd < 0) return text.length;
		const nextEnd = text.indexOf("\n", lineEnd + 1);
		return Math.min(lineEnd + 1 + column, nextEnd < 0 ? text.length : nextEnd);
	}
	if (word) {
		return key === "ArrowLeft"
			? at - (text.slice(0, at).match(/\s*\S+\s*$/u)?.[0].length ?? at)
			: at +
					(text.slice(at).match(/^\s*\S+\s*/u)?.[0].length ?? text.length - at);
	}
	const boundaries = [
		...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
	].map((part) => part.index);
	return key === "ArrowLeft"
		? (boundaries.findLast((index) => index < at) ?? 0)
		: (boundaries.find((index) => index > at) ?? text.length);
};

/** How long a struck key stays lit without its keyup (key repeat re-lights it while held). */
const STRUCK_FALLBACK_MS = 600;

/** Physical keys held right now, by the on-screen key label they match. */
const StruckKeys = createContext<ReadonlySet<string>>(new Set());

/** The on-screen key label a physical key matches (characters compare case-insensitively), if any. */
export const struckLabel = (event: Pick<KeyboardEvent, "key" | "code">) => {
	switch (event.code) {
		case "ShiftLeft":
			return "Left Shift";
		case "ShiftRight":
			return "Right Shift";
		case "ControlLeft":
		case "ControlRight":
			return "Ctrl";
		case "AltLeft":
		case "AltRight":
			return "Alt";
		case "CapsLock":
			return "Caps Lock";
		case "Space":
			return "Space";
		case "ArrowUp":
			return "Cursor up";
		case "ArrowDown":
			return "Cursor down";
		case "ArrowLeft":
			return "Cursor left";
		case "ArrowRight":
			return "Cursor right";
	}
	if (event.key === "Tab" || event.key === "Backspace" || event.key === "Enter")
		return event.key;
	return [...event.key].length === 1 ? event.key.toLowerCase() : undefined;
};

const KeyboardKey = ({
	label,
	children,
	onClick,
	units = 2,
	pressed,
	disabled,
}: {
	label: string;
	children: React.ReactNode;
	onClick?: () => void;
	units?: number;
	pressed?: boolean;
	disabled: boolean;
}) => {
	const struck = useContext(StruckKeys).has(
		[...label].length === 1 ? label.toLowerCase() : label,
	);
	return (
		<Button
			variant="outline"
			aria-label={label}
			aria-pressed={pressed}
			data-character={[...label].length === 1}
			data-struck={struck || undefined}
			title={label}
			disabled={disabled}
			className={cn("chat-key", (pressed || struck) && "chat-key-active")}
			style={{ gridColumn: `span ${units}` }}
			onPointerDown={(event) => {
				if (event.button === 0) event.preventDefault();
			}}
			onClick={onClick}
		>
			{children}
		</Button>
	);
};

/** A touch keyboard for the active chat composer, including selection and clipboard editing. */
export const ChatKeyboard = ({
	inputRef,
	onChange,
	onClose,
	disabled = false,
}: {
	inputRef: React.RefObject<HTMLTextAreaElement | null>;
	onChange: (text: string) => void;
	onClose: () => void;
	disabled?: boolean;
}) => {
	const [shift, setShift] = useState(false);
	const [caps, setCaps] = useState(false);
	const [ctrl, setCtrl] = useState(false);
	const [alt, setAlt] = useState(false);
	const [layer, setLayer] = useState<"letters" | "numbers" | "emoji">(
		"letters",
	);
	const [layout, setLayout] = useState<keyof typeof LAYOUTS>("qwerty");
	const [error, setError] = useState("");
	const undo = useRef<Selection[]>([]);
	const redo = useRef<Selection[]>([]);
	const generation = useRef(0);
	// Typing on the physical keyboard lights the matching on-screen key: while it is held (key repeat keeps it lit),
	// and briefly after a press whose keyup never arrives (focus moved away).
	const [struck, setStruck] = useState<ReadonlySet<string>>(new Set());
	useEffect(() => {
		const timers = new Map<string, number>();
		const set = (label: string, down: boolean) =>
			setStruck((current) => {
				if (current.has(label) === down) return current;
				const next = new Set(current);
				if (down) next.add(label);
				else next.delete(label);
				return next;
			});
		const release = (label: string) => {
			window.clearTimeout(timers.get(label));
			timers.delete(label);
			set(label, false);
		};
		const keyDown = (event: KeyboardEvent) => {
			const label = struckLabel(event);
			if (!label) return;
			window.clearTimeout(timers.get(label));
			timers.set(
				label,
				window.setTimeout(() => release(label), STRUCK_FALLBACK_MS),
			);
			set(label, true);
		};
		const keyUp = (event: KeyboardEvent) => {
			const label = struckLabel(event);
			if (label) release(label);
		};
		const releaseAll = () => {
			for (const timer of timers.values()) window.clearTimeout(timer);
			timers.clear();
			setStruck(new Set());
		};
		window.addEventListener("keydown", keyDown, true);
		window.addEventListener("keyup", keyUp, true);
		window.addEventListener("blur", releaseAll);
		return () => {
			releaseAll();
			window.removeEventListener("keydown", keyDown, true);
			window.removeEventListener("keyup", keyUp, true);
			window.removeEventListener("blur", releaseAll);
		};
	}, []);
	useEffect(() => {
		const input = inputRef.current;
		const beforeInput = () => {
			if (!input) return;
			undo.current = [...undo.current.slice(-99), readSelection(input)];
			redo.current = [];
			generation.current++;
		};
		input?.addEventListener("beforeinput", beforeInput);
		return () => {
			input?.removeEventListener("beforeinput", beforeInput);
			generation.current++;
		};
	}, [inputRef]);

	const apply = (input: HTMLTextAreaElement, value: Selection) => {
		flushSync(() => onChange(value.text));
		input.focus({ preventScroll: true });
		input.setSelectionRange(value.start, value.end, value.direction);
	};
	const insert = (
		input: HTMLTextAreaElement,
		value: string,
		start = input.selectionStart,
		end = input.selectionEnd,
	) => {
		const previous = readSelection(input);
		const room =
			input.maxLength < 0
				? value.length
				: Math.max(0, input.maxLength - previous.text.length + end - start);
		let accepted = "";
		for (const part of new Intl.Segmenter(undefined, {
			granularity: "grapheme",
		}).segment(value)) {
			if (accepted.length + part.segment.length > room) break;
			accepted += part.segment;
		}
		const next =
			previous.text.slice(0, start) + accepted + previous.text.slice(end);
		if (next === previous.text) return;
		undo.current = [...undo.current.slice(-99), previous];
		redo.current = [];
		generation.current++;
		apply(input, {
			text: next,
			start: start + accepted.length,
			end: start + accepted.length,
			direction: "none",
		});
	};
	const pressKey = async (key: string) => {
		const input = inputRef.current;
		if (!input || input.disabled || disabled) return;
		setError("");
		const previous = readSelection(input);
		input.focus({ preventScroll: true });
		// The console owns shortcuts and sending. Browser default text editing is handled below.
		const event = new KeyboardEvent("keydown", {
			key,
			ctrlKey: ctrl,
			altKey: alt,
			shiftKey: shift,
			bubbles: true,
			cancelable: true,
		});
		if (!input.dispatchEvent(event)) return;
		if (alt) return;
		if (ctrl) {
			const command = key.toLowerCase();
			if (command === "a") {
				input.select();
				return;
			}
			if (command === "z" || command === "y") {
				const forward = command === "y" || shift;
				const source = forward ? redo : undo;
				const destination = forward ? undo : redo;
				const value = source.current.pop();
				if (value) {
					destination.current.push(previous);
					generation.current++;
					apply(input, value);
				}
				return;
			}
			if (["c", "x", "v"].includes(command)) {
				const revision = generation.current;
				try {
					if (command === "v") {
						const value = await navigator.clipboard.readText();
						if (
							revision === generation.current &&
							input.isConnected &&
							input.value === previous.text &&
							!input.disabled
						)
							insert(input, value, previous.start, previous.end);
					} else {
						await navigator.clipboard.writeText(
							previous.text.slice(previous.start, previous.end),
						);
						if (
							command === "x" &&
							revision === generation.current &&
							input.isConnected &&
							input.value === previous.text &&
							!input.disabled
						)
							insert(input, "", previous.start, previous.end);
					}
				} catch {
					setError(
						"Clipboard access was denied. Use your device's copy or paste controls.",
					);
				}
				return;
			}
			if (!key.startsWith("Arrow") && key !== "Backspace") return;
		}
		if (key.startsWith("Arrow")) {
			const backward = previous.direction === "backward";
			const at = backward ? previous.start : previous.end;
			const anchor = backward ? previous.end : previous.start;
			let next = cursorPosition(previous.text, at, key, ctrl);
			if (
				!shift &&
				previous.start !== previous.end &&
				(key === "ArrowLeft" || key === "ArrowRight")
			)
				next = key === "ArrowLeft" ? previous.start : previous.end;
			input.setSelectionRange(
				shift ? Math.min(anchor, next) : next,
				shift ? Math.max(anchor, next) : next,
				shift && next < anchor ? "backward" : "forward",
			);
		} else if (key === "Backspace") {
			insert(
				input,
				"",
				previous.start === previous.end
					? cursorPosition(previous.text, previous.start, "ArrowLeft", ctrl)
					: previous.start,
				previous.end,
			);
		} else if (key === "Tab") {
			insert(input, "\t");
		} else if (key === "Enter") {
			insert(input, "\n");
		} else {
			insert(input, key);
		}
	};

	const press = (key: string) => {
		if (disabled) return;
		void pressKey(key);
		setCtrl(false);
		setAlt(false);
		setShift(false);
	};
	const rows =
		layer === "emoji"
			? EMOJI
			: (layer === "numbers"
					? shift
						? SYMBOLS
						: NUMBERS
					: LAYOUTS[layout]
				).map((row) => [...row]);
	const characterKeys = (keys: string[]) =>
		keys.map((key) => {
			const text =
				layer === "letters" && shift !== caps ? key.toUpperCase() : key;
			return (
				<KeyboardKey
					key={text}
					label={text}
					onClick={() => press(text)}
					disabled={disabled}
				>
					{text}
				</KeyboardKey>
			);
		});
	return (
		<StruckKeys.Provider value={struck}>
			<section aria-label="On-screen keyboard" className="chat-keyboard">
				{error && (
					<p role="alert" className="m-0 mb-1 text-xs text-content-destructive">
						{error}
					</p>
				)}
				<div className="chat-keyboard-row">
					<KeyboardKey
						label="Tab"
						onClick={() => press("Tab")}
						disabled={disabled}
					>
						Tab
					</KeyboardKey>
					{characterKeys(rows[0])}
					<KeyboardKey
						label="Backspace"
						onClick={() => press("Backspace")}
						units={4}
						disabled={disabled}
					>
						<DeleteIcon />
					</KeyboardKey>
				</div>
				<div className="chat-keyboard-row">
					<KeyboardKey
						label="Caps Lock"
						onClick={() => setCaps(!caps)}
						units={3}
						pressed={caps}
						disabled={disabled}
					>
						<ArrowBigUpDashIcon />
					</KeyboardKey>
					{characterKeys(rows[1])}
					<KeyboardKey
						label="Enter"
						onClick={() => press("Enter")}
						units={5}
						disabled={disabled}
					>
						<CornerDownLeftIcon />
					</KeyboardKey>
				</div>
				<div className="chat-keyboard-row">
					<KeyboardKey
						label="Left Shift"
						onClick={() => setShift(!shift)}
						units={4}
						pressed={shift}
						disabled={disabled}
					>
						<ArrowBigUpIcon />
					</KeyboardKey>
					{characterKeys(rows[2])}
					<KeyboardKey label="." onClick={() => press(".")} disabled={disabled}>
						.
					</KeyboardKey>
					<KeyboardKey
						label="Cursor up"
						onClick={() => press("ArrowUp")}
						disabled={disabled}
					>
						<ChevronUpIcon />
					</KeyboardKey>
					<KeyboardKey
						label="Right Shift"
						onClick={() => setShift(!shift)}
						units={4}
						pressed={shift}
						disabled={disabled}
					>
						<ArrowBigUpIcon />
					</KeyboardKey>
				</div>
				<div className="chat-keyboard-row">
					<KeyboardKey
						label="Ctrl"
						onClick={() => setCtrl(!ctrl)}
						units={2}
						pressed={ctrl}
						disabled={disabled}
					>
						Ctrl
					</KeyboardKey>
					<KeyboardKey
						label="Numbers and symbols"
						onClick={() =>
							setLayer(layer === "numbers" ? "letters" : "numbers")
						}
						units={2}
						pressed={layer === "numbers"}
						disabled={disabled}
					>
						{layer === "numbers" ? "ABC" : "?123"}
					</KeyboardKey>
					<KeyboardKey
						label="Alt"
						onClick={() => setAlt(!alt)}
						units={2}
						pressed={alt}
						disabled={disabled}
					>
						Alt
					</KeyboardKey>
					<KeyboardKey
						label="Space"
						onClick={() => press(" ")}
						units={8}
						disabled={disabled}
					>
						{" "}
					</KeyboardKey>
					<KeyboardKey
						label="Emoji"
						onClick={() => setLayer(layer === "emoji" ? "letters" : "emoji")}
						units={2}
						pressed={layer === "emoji"}
						disabled={disabled}
					>
						<SmileIcon />
					</KeyboardKey>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								className="chat-key"
								disabled={disabled}
								style={{ gridColumn: "span 2" }}
								aria-label="Keyboard layout"
								title="Keyboard layout"
							>
								<GlobeIcon />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuRadioGroup
								value={layout}
								onValueChange={(value) => {
									if (
										value === "qwerty" ||
										value === "qwertz" ||
										value === "azerty"
									)
										setLayout(value);
								}}
							>
								{Object.keys(LAYOUTS).map((value) => (
									<DropdownMenuRadioItem key={value} value={value}>
										{value.toUpperCase()}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<KeyboardKey
						label="Cursor left"
						onClick={() => press("ArrowLeft")}
						disabled={disabled}
					>
						<ArrowLeftIcon />
					</KeyboardKey>
					<KeyboardKey
						label="Cursor down"
						onClick={() => press("ArrowDown")}
						disabled={disabled}
					>
						<ArrowDownIcon />
					</KeyboardKey>
					<KeyboardKey
						label="Cursor right"
						onClick={() => press("ArrowRight")}
						disabled={disabled}
					>
						<ArrowRightIcon />
					</KeyboardKey>
					<Button
						variant="outline"
						className="chat-key flex-col gap-0"
						aria-label="Hide on-screen keyboard"
						title="Hide on-screen keyboard"
						onClick={onClose}
						style={{ gridColumn: "span 2" }}
					>
						<KeyboardIcon />
						<ArrowDownIcon className="!size-3" />
					</Button>
				</div>
			</section>
		</StruckKeys.Provider>
	);
};
