import { cn } from "cn";
import { Spinner } from "#/components/Spinner/Spinner";

/**
 * The page's one save: pinned to the bottom while something is changed (and only then). Its button names what saving
 * does - "Update and restart" (or start) only when build parameters changed, as they take a new build. A new
 * workspace's page has it always (its title, Cancel and Create workspace).
 */
export const SaveBar: React.FC<{
	form: string;
	label: string;
	note: string;
	saving: boolean;
	disabled: boolean;
	onDiscard: () => void;
	title?: string;
	discardLabel?: string;
	/** Its dot: something changed (amber), or ready to go (the accent). */
	tone?: "changed" | "ready";
	className?: string;
}> = ({
	form,
	label,
	note,
	saving,
	disabled,
	onDiscard,
	title = "Unsaved changes",
	discardLabel = "Discard",
	tone = "changed",
	className,
}) => (
	<div
		className={cn("sticky bottom-0 z-10 px-8 pb-5", className)}
		role="region"
		aria-label={title}
		data-testid="save-bar"
	>
		<div className="mx-auto flex max-w-(--ws-bar) flex-wrap items-center justify-between gap-3 rounded-(--ws-r-bar) border border-solid border-(--ws-bar-line) bg-(--ws-raised) py-3 pl-[18px] pr-3 shadow-(--ws-bar-shadow)">
			<div className="flex flex-wrap items-center gap-2.5">
				<span
					className={cn(
						"size-2 rounded-full",
						tone === "ready" ? "bg-(--ws-accent)" : "bg-(--ws-warn)",
					)}
					aria-hidden="true"
				/>
				<span className="font-medium">{title}</span>
				<span className="text-[13px] text-(--ws-muted)">{note}</span>
			</div>
			<div className="flex gap-2">
				<button
					type="button"
					className="ws-hit h-10 cursor-pointer rounded-(--ws-r-md) border border-solid border-(--ws-raised-line) bg-transparent px-4 text-sm font-medium text-(--ws-text) disabled:cursor-not-allowed disabled:opacity-60"
					disabled={saving}
					onClick={onDiscard}
				>
					{discardLabel}
				</button>
				<button
					type="submit"
					form={form}
					className="ws-hit inline-flex h-10 cursor-pointer items-center gap-2 rounded-(--ws-r-md) border-0 bg-(--ws-accent) px-4 text-sm font-semibold text-(--ws-accent-ink) disabled:cursor-not-allowed disabled:opacity-60"
					disabled={disabled}
				>
					{saving && <Spinner loading size="sm" />}
					{label}
				</button>
			</div>
		</div>
	</div>
);
