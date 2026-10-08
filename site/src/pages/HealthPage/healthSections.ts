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

/** The health report's sections, in the order General's sidebar lists them, with their pages under /health. */
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

export const WORKSPACE_HEALTH_PATH = "/health/workspace-health";

export const USER_QUOTA_PATH = "/health/user-quota";
