import { useState } from "react";
import { generateUUID } from "#/utils/random";

/**
 * The workspace page's drop-down panels under an agent card: Coder's "Logs",
 * the "Terminal", and the app panels the user adds (an app embedded in the
 * page). Per workspace and agent (agent ids change with every build), in this
 * browser: the panels' order and the added app panels.
 */
export const BUILT_IN_PANELS = ["logs", "terminal"] as const;

export type AppPanel = {
	id: string;
	slug: string;
	/** The height the user gave the app's box (px), if any. */
	height?: number;
};

type StoredPanels = { order: string[]; apps: AppPanel[] };

const storageKey = (workspaceId: string, agentName: string) =>
	`coder-ui-agent-panels:${workspaceId}:${agentName}`;

const isAppPanel = (value: unknown): value is AppPanel =>
	typeof value === "object" &&
	value !== null &&
	"id" in value &&
	typeof value.id === "string" &&
	value.id.startsWith("app:") &&
	"slug" in value &&
	typeof value.slug === "string" &&
	(!("height" in value) ||
		value.height === undefined ||
		(typeof value.height === "number" && value.height > 0));

export const readPanels = (
	workspaceId: string,
	agentName: string,
): StoredPanels => {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(storageKey(workspaceId, agentName)) ?? "null",
		);
		if (typeof parsed === "object" && parsed !== null) {
			const apps =
				"apps" in parsed && Array.isArray(parsed.apps)
					? parsed.apps.filter(isAppPanel)
					: [];
			const order =
				"order" in parsed && Array.isArray(parsed.order)
					? parsed.order.filter((id): id is string => typeof id === "string")
					: [];
			return { order, apps };
		}
	} catch {
		// Nothing remembered.
	}
	return { order: [], apps: [] };
};

const writePanels = (
	workspaceId: string,
	agentName: string,
	panels: StoredPanels,
) => {
	try {
		localStorage.setItem(
			storageKey(workspaceId, agentName),
			JSON.stringify(panels),
		);
	} catch {
		// For this page only.
	}
};

/**
 * Every panel once, in the remembered order; panels it does not know yet
 * (new, or never moved) go at the end, built-in ones first.
 */
export const panelOrder = (stored: StoredPanels): string[] => {
	const all = [...BUILT_IN_PANELS, ...stored.apps.map((app) => app.id)];
	const known = stored.order.filter(
		(id, index) => all.includes(id) && stored.order.indexOf(id) === index,
	);
	return [...known, ...all.filter((id) => !known.includes(id))];
};

export const useAgentPanels = (workspaceId: string, agentName: string) => {
	const [stored, setStored] = useState(() =>
		readPanels(workspaceId, agentName),
	);
	const update = (next: StoredPanels) => {
		setStored(next);
		writePanels(workspaceId, agentName, next);
	};
	const order = panelOrder(stored);
	return {
		order,
		apps: stored.apps,
		reorder: (next: string[]) => update({ ...stored, order: next }),
		/** A new panel for the app, at the end; its id. */
		add: (slug: string): string => {
			const id = `app:${generateUUID()}`;
			update({ order: [...order, id], apps: [...stored.apps, { id, slug }] });
			return id;
		},
		setHeight: (id: string, height: number) =>
			update({
				...stored,
				apps: stored.apps.map((app) =>
					app.id === id ? { ...app, height: Math.round(height) } : app,
				),
			}),
		remove: (id: string) =>
			update({
				order: order.filter((panel) => panel !== id),
				apps: stored.apps.filter((app) => app.id !== id),
			}),
	};
};
