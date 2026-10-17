import type { HealthcheckReport } from "#/api/typesGenerated";

type HealthSectionKey = keyof Pick<
	HealthcheckReport,
	| "access_url"
	| "database"
	| "derp"
	| "provisioner_daemons"
	| "websocket"
	| "workspace_proxy"
>;

/** The health report's sections, with their anchors on the Health page. */
export const HEALTH_SECTIONS: readonly {
	key: HealthSectionKey;
	label: string;
	path: string;
}[] = [
	{ key: "access_url", label: "Access URL", path: "/health/access-url" },
	{ key: "database", label: "Database", path: "/health/database" },
	{ key: "derp", label: "DERP", path: "/health/derp" },
	{
		key: "provisioner_daemons",
		label: "Provisioner Daemons",
		path: "/health/provisioner-daemons",
	},
	{ key: "websocket", label: "Websocket", path: "/health/websocket" },
	{
		key: "workspace_proxy",
		label: "Workspace Proxy",
		path: "/health/workspace-proxy",
	},
];

/** Health's cards on its one page, in order; each id is the card's anchor (/health#database) and a former page's path. */
export const HEALTH_CARD_IDS = [
	"workspace-health",
	"provisioner-daemons",
	"access-url",
	"database",
	"derp",
	"websocket",
	"workspace-proxy",
] as const;
export type HealthCardId = (typeof HEALTH_CARD_IDS)[number];
