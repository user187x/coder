import { cn } from "cn";
import { SparklesIcon } from "lucide-react";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import {
	setAnimationsEnabled,
	useAnimationsEnabled,
} from "#/modules/platform/animations/animations";

/**
 * Platform: the user menu's "Animations" switch (animations.ts): off gives the
 * workspace cards Coder's solid borders and stops animated GIFs. Choosing it
 * keeps the menu open.
 */
export const AnimationsToggleItem: React.FC = () => {
	const enabled = useAnimationsEnabled();
	return (
		<DropdownMenuItem
			role="menuitemcheckbox"
			aria-checked={enabled}
			onSelect={(event) => {
				event.preventDefault();
				setAnimationsEnabled(!enabled);
			}}
		>
			<SparklesIcon />
			<span>Animations</span>
			{/* Drawn like Coder's Switch; the menu item itself is the control. */}
			<span
				aria-hidden
				className={cn(
					"ml-auto inline-flex h-4 w-7 shrink-0 items-center rounded-full border-2 border-solid border-transparent transition-colors motion-reduce:transition-none",
					enabled ? "bg-surface-invert-primary" : "bg-surface-quaternary",
				)}
			>
				<span
					className={cn(
						"block size-3 rounded-full bg-surface-primary shadow-lg transition-transform motion-reduce:transition-none",
						enabled && "translate-x-3",
					)}
				/>
			</span>
		</DropdownMenuItem>
	);
};
