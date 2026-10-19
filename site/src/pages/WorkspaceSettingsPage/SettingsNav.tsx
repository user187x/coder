import { useEffect, useState } from "react";
import {
	ChipGlyph,
	ClockGlyph,
	GearGlyph,
	MonitorGlyph,
	PeopleGlyph,
} from "./settingsIcons";
import type { Section } from "./settingsParts";

const LINKS: { id: Section; label: string; icon: React.ReactNode }[] = [
	{ id: "general", label: "General", icon: <GearGlyph /> },
	{ id: "resources", label: "Resources", icon: <ChipGlyph /> },
	{ id: "environment", label: "Environment", icon: <MonitorGlyph /> },
	{ id: "schedule", label: "Schedule", icon: <ClockGlyph /> },
	{ id: "sharing", label: "Sharing", icon: <PeopleGlyph /> },
];

/** The section in view: the last one whose top has passed a third of the window (the first until then). */
const useSectionInView = (ids: readonly Section[]) => {
	const [current, setCurrent] = useState<Section>(ids[0]);
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

export type Glance = {
	cpu: string;
	memory: string;
	gpu: string;
	disk: string;
	theme: string;
};

/**
 * The page's left column: a link to each card (the one in view marked), and At a glance - the workspace's resources
 * and theme as the form holds them now, changed or not.
 */
export const SettingsNav: React.FC<{
	sharing: boolean;
	glance: Glance;
}> = ({ sharing, glance }) => {
	const links = sharing ? LINKS : LINKS.filter((l) => l.id !== "sharing");
	const [ids] = useState(() => links.map((l) => l.id));
	const current = useSectionInView(ids);
	const rows: { label: string; value: string; mono: boolean }[] = [
		{ label: "CPU", value: glance.cpu, mono: true },
		{ label: "Memory", value: glance.memory, mono: true },
		{ label: "GPU", value: glance.gpu, mono: false },
		{ label: "Disk", value: glance.disk, mono: true },
		{ label: "Theme", value: glance.theme, mono: false },
	];

	return (
		<nav
			aria-label="Settings sections"
			className="flex max-w-[220px] flex-[1_1_200px] flex-col gap-0.5 lg:sticky lg:top-6"
		>
			<div className="ws-eyebrow px-3 pb-2">Settings</div>
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
				{rows.map((row) => (
					<div key={row.label} className="flex justify-between gap-3">
						<span className="text-(--ws-muted)">{row.label}</span>
						<span className={row.mono ? "ws-mono" : undefined}>
							{row.value}
						</span>
					</div>
				))}
			</div>
		</nav>
	);
};
