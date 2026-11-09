import { useId } from "react";
import { Switch } from "#/components/Switch/Switch";

/**
 * A card's on/off switch beside its title: the switch and its "Enabled" label in one squircle (User Quota, Global
 * Workspace Scheduler).
 */
export const EnabledToggle: React.FC<{
	/** What it switches, for screen readers: "User quota". */
	label: string;
	title: string;
	checked: boolean;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
}> = ({ label, title, checked, disabled, onCheckedChange }) => {
	const id = useId();
	return (
		<span
			title={title}
			className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-solid border-border bg-surface-secondary py-1 pr-3 pl-1.5"
		>
			<Switch
				id={id}
				aria-label={label}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
			<label
				htmlFor={id}
				className="cursor-pointer text-xs font-medium text-content-primary"
			>
				Enabled
			</label>
		</span>
	);
};
