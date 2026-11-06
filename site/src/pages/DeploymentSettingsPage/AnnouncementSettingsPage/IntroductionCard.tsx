import { CaptionsIcon } from "lucide-react";
import { useId } from "react";
import { Label } from "#/components/Label/Label";
import { Switch } from "#/components/Switch/Switch";

type IntroductionCardProps = {
	checked: boolean;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
};

/** Section introductions: the announcement banner names the settings section being opened. */
export const IntroductionCard: React.FC<IntroductionCardProps> = ({
	checked,
	disabled,
	onCheckedChange,
}) => {
	const id = useId();
	return (
		<section
			className="rounded-xl border border-solid border-border bg-surface-primary p-4 sm:p-6"
			aria-labelledby={`${id}-heading`}
		>
			<h2
				id={`${id}-heading`}
				className="m-0 flex items-center gap-2 text-base font-semibold"
			>
				<CaptionsIcon className="size-4" />
				Introduction
			</h2>
			<p className="text-sm text-content-secondary">
				When a developer opens another admin settings section, the announcement
				banner shows that section's name for 2 seconds. Nothing shows while no
				announcement banner is showing.
			</p>
			<div className="flex items-center gap-3">
				<Switch
					id={`${id}-switch`}
					checked={checked}
					disabled={disabled}
					onCheckedChange={onCheckedChange}
				/>
				<Label htmlFor={`${id}-switch`}>Show section introductions</Label>
			</div>
		</section>
	);
};
