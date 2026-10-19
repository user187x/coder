import { cn } from "cn";
import { Loader } from "#/components/Loader/Loader";

/**
 * The settings pages' parts (a workspace's, a template's): one page of cards in the same look (settingsPage.css,
 * under .ws-settings), a list of them on the left (SettingsNav), one save bar (SaveBar).
 */

/** A card of the page: its icon tile, title and line, something on the right, then its body. */
export const SettingsCard: React.FC<{
	id: string;
	title: string;
	description: string;
	icon: React.ReactNode;
	aside?: React.ReactNode;
	children: React.ReactNode;
}> = ({ id, title, description, icon, aside, children }) => (
	<section
		id={id}
		aria-labelledby={`h-${id}`}
		className="ws-card"
		data-testid={`workspace-settings-${id}`}
	>
		<div className="ws-card-head">
			<div className="flex items-center gap-3.5">
				<div className="ws-icon-tile">{icon}</div>
				<div>
					<h2 id={`h-${id}`} className="m-0 text-base font-semibold">
						{title}
					</h2>
					<p className="m-0 text-[13px] text-(--ws-muted)">{description}</p>
				</div>
			</div>
			{aside}
		</div>
		{children}
	</section>
);

/** Waiting for what a card shows (the template's parameters, the template). */
export const CardLoader: React.FC = () => (
	<div className="p-6">
		<Loader />
	</div>
);

/** An on/off switch: a button that says it is pressed (aria-pressed), 44px to touch. */
export const PressSwitch: React.FC<{
	pressed: boolean;
	onChange: (pressed: boolean) => void;
	disabled?: boolean;
	label?: string;
	labelledBy?: string;
	describedBy?: string;
	testId?: string;
}> = ({
	pressed,
	onChange,
	disabled,
	label,
	labelledBy,
	describedBy,
	testId,
}) => (
	<button
		type="button"
		className="ws-switch ws-hit"
		aria-pressed={pressed}
		aria-label={label}
		aria-labelledby={labelledBy}
		aria-describedby={describedBy}
		disabled={disabled}
		onClick={() => onChange(!pressed)}
		data-testid={testId}
	>
		<span />
	</button>
);

/** "2 Cores" → 2 / cores, "16 GB" → 16 / GB: an option's name as a tile's number and unit. */
export const tileLabel = (name: string) => {
	const m = /^\s*([\d.]+)\s*(.*)$/.exec(name);
	if (!m) {
		return { n: name, unit: "" };
	}
	const unit = m[2].trim();
	return {
		n: m[1],
		unit: /^[A-Z]{2,}$/.test(unit) ? unit : unit.toLowerCase(),
	};
};

export type TileOption = { value: string; name: string };

/** A choice as tiles (CPU, memory): each a button, the chosen one pressed. */
export const OptionTiles: React.FC<{
	legend: string;
	hint: string;
	options: readonly TileOption[];
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	testId?: string;
	error?: React.ReactNode;
}> = ({ legend, hint, options, value, onChange, disabled, testId, error }) => (
	<fieldset className="m-0 min-w-0 border-0 p-0" data-testid={testId}>
		<legend className="mb-3 flex w-full items-baseline justify-between p-0">
			<span className="font-medium">{legend}</span>
			<span className="text-[13px] text-(--ws-muted)">{hint}</span>
		</legend>
		<div className="ws-tiles">
			{options.map((option) => {
				const { n, unit } = tileLabel(option.name);
				return (
					<button
						key={option.value}
						type="button"
						className="ws-tile"
						aria-pressed={option.value === value}
						aria-label={option.name}
						disabled={disabled}
						onClick={() => onChange(option.value)}
					>
						<span className="ws-tile-n">{n}</span>
						{unit && <span className="ws-tile-unit">{unit}</span>}
					</button>
				);
			})}
		</div>
		{error}
	</fieldset>
);

/** A parameter's problems, as the backend reports them (validation, a removed option). */
export const ParameterProblems: React.FC<{
	problems: readonly { summary: string; detail: string; severity: string }[];
	className?: string;
}> = ({ problems, className }) =>
	problems.length > 0 ? (
		<div className={cn("flex flex-col gap-1", className)}>
			{problems.map((p, i) => (
				<p
					key={i}
					className={cn(
						"m-0 text-[12.5px]",
						p.severity === "error"
							? "text-content-destructive"
							: "text-content-warning",
					)}
				>
					{p.summary}
					{p.detail && p.detail !== p.summary ? `: ${p.detail}` : ""}
				</p>
			))}
		</div>
	) : null;

/**
 * A 44px touch around an input drawn smaller (the schedule's 40px fields): inputs take no pseudo-element, so this
 * wrapper's (ws-hit) does, and a press on it focuses the input.
 */
export const InputHitArea: React.FC<{
	children: React.ReactNode;
	className?: string;
}> = ({ children, className }) => (
	<div
		className={cn("ws-hit", className)}
		onMouseDown={(event) => {
			if (event.target === event.currentTarget) {
				event.preventDefault();
				event.currentTarget.querySelector("input")?.focus();
			}
		}}
	>
		{children}
	</div>
);

/** An on/off setting in a card: its name and what it does on the left, its switch on the right (named by them). */
export const ToggleRow: React.FC<{
	id: string;
	label: React.ReactNode;
	description?: React.ReactNode;
	pressed: boolean;
	onChange: (pressed: boolean) => void;
	disabled?: boolean;
	/** Beside the name (a lock: set for the whole deployment). */
	badge?: React.ReactNode;
	/** Under the description: why it cannot change, what it affects. */
	note?: React.ReactNode;
}> = ({ id, label, description, pressed, onChange, disabled, badge, note }) => (
	<div
		className="flex items-start justify-between gap-6 border-0 border-b border-solid border-(--ws-row-line) py-[18px] last:border-b-0"
		data-testid={`toggle-${id}`}
	>
		<div className="min-w-0">
			<div
				id={`${id}-label`}
				className="flex flex-wrap items-center gap-2 font-medium"
			>
				{label}
				{badge}
			</div>
			{description && (
				<div id={`${id}-help`} className="ws-desc">
					{description}
				</div>
			)}
			{note && <div className="ws-help">{note}</div>}
		</div>
		<PressSwitch
			pressed={pressed}
			onChange={onChange}
			disabled={disabled}
			labelledBy={`${id}-label`}
			describedBy={description ? `${id}-help` : undefined}
			testId={`switch-${id}`}
		/>
	</div>
);
