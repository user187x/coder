import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "#/components/Button/Button";

const STORAGE_KEY = "security-collapsed-cards";

const readOverrides = (key: string): string[] => {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(value)
			? value.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
};

/**
 * A Security page card that folds to its title: the chevron at its top right collapses or expands it, and each card's
 * state is remembered in this browser. Its content keeps its own heading, shown while open.
 */
export const CollapsibleSecurityCard: React.FC<{
	/** Remembers this card's state; unique on the page. */
	id: string;
	title: string;
	children: React.ReactNode;
	defaultOpen?: boolean;
}> = ({ id, title, children, defaultOpen = true }) => {
	const contentId = useId();
	const storageKey = defaultOpen ? STORAGE_KEY : "security-expanded-cards";
	const [open, setOpen] = useState(
		() => defaultOpen !== readOverrides(storageKey).includes(id),
	);
	const toggle = () => {
		const next = !open;
		setOpen(next);
		try {
			const others = readOverrides(storageKey).filter((card) => card !== id);
			localStorage.setItem(
				storageKey,
				JSON.stringify(next === defaultOpen ? others : [...others, id]),
			);
		} catch {
			// a browser without storage still folds, for this visit
		}
	};
	return (
		<section
			aria-label={title}
			className="relative rounded-xl border border-solid border-border bg-surface-primary p-6"
		>
			<Button
				variant="subtle"
				size="icon"
				className="absolute right-3 top-3"
				aria-expanded={open}
				aria-controls={contentId}
				aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
				onClick={toggle}
			>
				<ChevronDownIcon
					className={cn(
						"transition-transform duration-200 motion-reduce:transition-none",
						!open && "-rotate-90",
					)}
				/>
			</Button>
			<div id={contentId} className="pr-12">
				{open ? children : <h2 className="m-0 text-lg">{title}</h2>}
			</div>
		</section>
	);
};
