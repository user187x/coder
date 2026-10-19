import { cn } from "cn";
import { Fragment, useEffect, useMemo, useState } from "react";

export type SettingsNavLink = {
	/** The card's id (its anchor). */
	id: string;
	label: string;
	icon: React.ReactNode;
};

/** A row of At a glance: what the page's form holds now, changed or not. */
export type GlanceRow = { label: string; value: string; mono?: boolean };

/** The section in view: the last one whose top has passed a third of the window (the first until then). */
const useSectionInView = (ids: readonly string[]) => {
	const [current, setCurrent] = useState<string>(ids[0]);
	useEffect(() => {
		const update = () => {
			const line = window.innerHeight / 3;
			let found = ids[0];
			for (const id of ids) {
				const top = document.getElementById(id)?.getBoundingClientRect().top;
				if (top !== undefined && top <= line) {
					found = id;
				}
			}
			// At the very bottom, the last section (it may never reach the line).
			if (
				window.innerHeight + window.scrollY >=
				document.documentElement.scrollHeight - 2
			) {
				found = ids[ids.length - 1];
			}
			setCurrent(found);
		};
		update();
		window.addEventListener("scroll", update, { passive: true, capture: true });
		window.addEventListener("resize", update);
		return () => {
			window.removeEventListener("scroll", update, { capture: true });
			window.removeEventListener("resize", update);
		};
	}, [ids]);
	return current;
};

/** A value with a place to break after each _ and - (troubling_ / holmes10), not in the middle of a word. */
const breakable = (value: string) =>
	value.split(/(?<=[_-])/).map((part, i) => (
		<Fragment key={i}>
			{i > 0 && <wbr />}
			{part}
		</Fragment>
	));

/**
 * A settings page's left column: a link to each card (the one in view marked), and At a glance - what the page's
 * form holds now, changed or not.
 */
export const SettingsNav: React.FC<{
	links: readonly SettingsNavLink[];
	glance: readonly GlanceRow[];
	/** Over the links. */
	heading?: string;
}> = ({ links, glance, heading = "Settings" }) => {
	const key = links.map((l) => l.id).join(" ");
	const ids = useMemo(() => links.map((l) => l.id), [key]);
	const current = useSectionInView(ids);

	return (
		<nav
			aria-label="Settings sections"
			className="flex max-w-[220px] flex-[1_1_200px] flex-col gap-0.5 lg:sticky lg:top-6"
		>
			<div className="ws-eyebrow px-3 pb-2">{heading}</div>
			{links.map((link) => (
				<a
					key={link.id}
					href={`#${link.id}`}
					className="ws-nav-link ws-hit"
					aria-current={current === link.id ? "true" : undefined}
				>
					{link.icon}
					{link.label}
				</a>
			))}

			<div
				className="ws-panel mt-5 flex flex-col gap-2.5 p-3.5"
				aria-label="At a glance"
				role="group"
				data-testid="at-a-glance"
			>
				<div className="ws-eyebrow">At a glance</div>
				{glance.map((row) => (
					<div key={row.label} className="flex justify-between gap-3">
						<span className="shrink-0 text-(--ws-muted)">{row.label}</span>
						{/* A long value without spaces (a version's name) breaks inside the panel, not past it */}
						<span
							className={cn(
								"min-w-0 text-right [overflow-wrap:anywhere]",
								row.mono && "ws-mono",
							)}
						>
							{breakable(row.value)}
						</span>
					</div>
				))}
			</div>
		</nav>
	);
};
