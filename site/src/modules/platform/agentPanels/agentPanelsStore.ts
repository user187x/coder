import { useState } from "react";
import { generateUUID } from "#/utils/random";

/**
 * The workspace page's drop-down panels under an agent card: Coder's "Logs",
 * the "Terminal", and the panels the user adds - any app (one of the
 * workspace's, a port listening in it, a web page). Per workspace and agent
 * (agent ids change with every build), in this browser: the panels' order and
 * the added panels.
 */
export const BUILT_IN_PANELS = ["logs", "terminal"] as const;

/** What a panel the user added shows. */
export type PanelContent =
	| { kind: "app"; slug: string }
	| {
			kind: "port";
			port: number;
			protocol: "http" | "https";
			/** What listened there when it was added. */
			process?: string;
	  }
	| { kind: "web"; url: string; name?: string };

export type AppPanel = PanelContent & {
	id: string;
	/** The height the user gave the app's box (px), if any. */
	height?: number;
};

type StoredPanels = { order: string[]; apps: AppPanel[] };

const storageKey = (workspaceId: string, agentName: string) =>
	`coder-ui-agent-panels:${workspaceId}:${agentName}`;

/** A remembered panel, or null; one kept before panels had kinds is an app's. */
const toAppPanel = (value: unknown): AppPanel | null => {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const v = value as Record<string, unknown>;
	if (typeof v.id !== "string" || !v.id.startsWith("app:")) {
		return null;
	}
	const height =
		typeof v.height === "number" && v.height > 0 ? v.height : undefined;
	const kind = v.kind ?? "app";
	if (kind === "app" && typeof v.slug === "string") {
		return { id: v.id, kind, slug: v.slug, height };
	}
	if (
		kind === "port" &&
		typeof v.port === "number" &&
		Number.isInteger(v.port) &&
		(v.protocol === "http" || v.protocol === "https")
	) {
		return {
			id: v.id,
			kind,
			port: v.port,
			protocol: v.protocol,
			process: typeof v.process === "string" ? v.process : undefined,
			height,
		};
	}
	if (kind === "web" && typeof v.url === "string") {
		return {
			id: v.id,
			kind,
			url: v.url,
			name: typeof v.name === "string" ? v.name : undefined,
			height,
		};
	}
	return null;
};

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
					? parsed.apps
							.map(toAppPanel)
							.filter((app): app is AppPanel => app !== null)
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
		/** A new panel, at the end; its id. */
		add: (content: PanelContent): string => {
			const id = `app:${generateUUID()}`;
			update({
				order: [...order, id],
				apps: [...stored.apps, { ...content, id }],
			});
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
