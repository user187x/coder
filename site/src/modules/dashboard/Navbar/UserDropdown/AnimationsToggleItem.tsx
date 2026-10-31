import { cn } from "cn";
import {
	ChartNoAxesCombinedIcon,
	ChevronDownIcon,
	ImagePlayIcon,
	type LucideIcon,
	MegaphoneIcon,
	MountainIcon,
	SparklesIcon,
	WandSparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { banner as bannerQuery } from "#/api/queries/platform";
import { DropdownMenuItem } from "#/components/DropdownMenu/DropdownMenu";
import {
	type AnimationPart,
	setAnimationPart,
	setAnimationsEnabled,
	useAnimationSettings,
} from "#/hooks/useAnimationSettings";
import {
	setGraphsOn,
	useGraphEveryChoice,
} from "#/modules/resources/metricGraphSettings";

/** Drawn like Coder's Switch; the menu item itself is the control. */
const SwitchLook: React.FC<{ on: boolean }> = ({ on }) => (
	<span
		aria-hidden
		className={cn(
			"ml-auto inline-flex h-4 w-7 shrink-0 items-center rounded-full border-2 border-solid border-transparent transition-colors motion-reduce:transition-none",
			on ? "bg-surface-invert-primary" : "bg-surface-quaternary",
		)}
	>
		<span
			className={cn(
				"block size-3 rounded-full bg-surface-primary shadow-lg transition-transform motion-reduce:transition-none",
				on && "translate-x-3",
			)}
		/>
	</span>
);

const SwitchItem: React.FC<{
	label: string;
	hint: string;
	on: boolean;
	disabled?: boolean;
	onChange: (on: boolean) => void;
	compact?: boolean;
	icon: LucideIcon;
}> = ({ label, hint, on, disabled, onChange, compact, icon: Icon }) => (
	<DropdownMenuItem
		role="menuitemcheckbox"
		aria-checked={on}
		disabled={disabled}
		title={compact ? `${label}: ${on ? "On" : "Off"}. ${hint}` : hint}
		className={compact ? undefined : "pl-8"}
		onSelect={(event) => {
			// Choosing keeps the menu open.
			event.preventDefault();
			onChange(!on);
		}}
	>
		{compact && <Icon />}
		<span className={compact ? "sr-only" : "flex min-w-0 flex-col"}>
			<span>{label}</span>
			<span className="text-2xs text-content-secondary">{hint}</span>
		</span>
		{!compact && <SwitchLook on={on} />}
	</DropdownMenuItem>
);

const PARTS: readonly { part: AnimationPart; label: string; hint: string }[] = [
	{
		part: "effects",
		label: "Effects & transitions",
		hint: "Menus, fades, borders, banners, cables",
	},
	{ part: "gifs", label: "Animated GIFs", hint: "Still on their first frame" },
	{
		part: "background",
		label: "Moving background",
		hint: "Particles and animated backgrounds",
	},
	{
		part: "announcement",
		label: "Announcement animations",
		hint: "Text effects, scrolling and animated pictures",
	},
];

/**
 * Platform: the user menu's Animations (animations.ts): a switch for all of
 * them, and one for each part a slow browser may want still - effects and
 * transitions, animated GIFs, the live metric graphs, the moving background.
 * "Animations" opens them right below it, in the menu (not a hover submenu:
 * one at the screen's edge closes on the way to it); choosing keeps the menu
 * open.
 */
export const AnimationsToggleItem: React.FC<{
	compact?: boolean;
	showDetails?: boolean;
}> = ({ compact = false, showDetails = true }) => {
	const [expanded, setExpanded] = useState(false);
	const s = useAnimationSettings();
	const policy = useQuery(bannerQuery(false));
	const announcementDisabled = policy.data?.animationsDisabled === true;
	const graphs = useGraphEveryChoice() !== "off";
	const parts = PARTS.map(
		({ part }) => s[part] && (part !== "announcement" || !announcementDisabled),
	).concat(graphs);
	const state = !s.all
		? "Off"
		: parts.every(Boolean)
			? "On"
			: parts.some(Boolean)
				? "Some"
				: "Off";
	if (!showDetails)
		return (
			<SwitchItem
				label="Animations"
				hint="Enable or disable dashboard animations"
				on={s.all}
				onChange={setAnimationsEnabled}
				icon={SparklesIcon}
			/>
		);
	return (
		<>
			<DropdownMenuItem
				title={`Animations: ${state}`}
				data-testid="animations-menu"
				aria-expanded={expanded}
				onSelect={(event) => {
					event.preventDefault();
					setExpanded((e) => !e);
				}}
			>
				<SparklesIcon />
				<span className={compact ? "sr-only" : undefined}>Animations</span>
				<span
					className={
						compact ? "sr-only" : "ml-auto pl-3 text-xs text-content-secondary"
					}
				>
					{state}
				</span>
				{!compact && (
					<ChevronDownIcon
						aria-hidden
						className={cn(
							"size-3.5 text-content-secondary transition-transform motion-reduce:transition-none",
							expanded && "rotate-180",
						)}
					/>
				)}
			</DropdownMenuItem>
			{expanded && (
				<>
					<SwitchItem
						compact={compact}
						icon={SparklesIcon}
						label="All animations"
						hint="Off: everything below stands still"
						on={s.all}
						onChange={setAnimationsEnabled}
					/>
					{PARTS.slice(0, 2).map(({ part, label, hint }) => (
						<SwitchItem
							key={part}
							compact={compact}
							icon={part === "effects" ? WandSparklesIcon : ImagePlayIcon}
							label={label}
							hint={hint}
							on={s.all && s[part]}
							disabled={!s.all}
							onChange={(on) => setAnimationPart(part, on)}
						/>
					))}
					<SwitchItem
						label="Live graphs"
						compact={compact}
						icon={ChartNoAxesCombinedIcon}
						hint="The workspace metric graphs"
						on={s.all && graphs}
						disabled={!s.all}
						onChange={setGraphsOn}
					/>
					{PARTS.slice(2).map(({ part, label, hint }) => (
						<SwitchItem
							key={part}
							compact={compact}
							icon={part === "announcement" ? MegaphoneIcon : MountainIcon}
							label={label}
							hint={
								part === "announcement" && announcementDisabled
									? "Disabled by your administrator"
									: hint
							}
							on={
								s.all &&
								s[part] &&
								(part !== "announcement" || !announcementDisabled)
							}
							disabled={
								!s.all || (part === "announcement" && announcementDisabled)
							}
							onChange={(on) => setAnimationPart(part, on)}
						/>
					))}
				</>
			)}
		</>
	);
};
