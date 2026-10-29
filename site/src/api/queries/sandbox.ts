import type { QueryClient } from "react-query";
import { API } from "../api";
import { platformGet, platformPost } from "../platform";
import { lockdownRootKey } from "./platform";
export type SandboxGroup = {
	id: string;
	organization_id: string;
	workspaces: { id: string; name: string }[];
};
export type SandboxState = { groups: SandboxGroup[]; error?: string | null };
export const sandboxKey = (org: string) => ["sandbox", org] as const;
export const SandboxAPI = {
	groups: (org: string) =>
		platformGet<SandboxState>(
			`/__coder-ui/api/sandbox/${encodeURIComponent(org)}`,
		),
};
export const sandboxGroups = (org: string) => ({
	queryKey: sandboxKey(org),
	queryFn: () => SandboxAPI.groups(org),
	refetchInterval: 5000,
});
export const sandboxWorkspaces = (org: string) => ({
	queryKey: ["sandbox-workspaces", org] as const,
	queryFn: () => API.getWorkspaces({ limit: 100, q: `organization:${org}` }),
});
export const updateSandbox = (client: QueryClient, org: string) => ({
	mutationFn: (body: {
		workspace_ids: string[];
		group_id?: string;
		release?: boolean;
	}) =>
		platformPost<SandboxState>(
			`/__coder-ui/api/sandbox/${encodeURIComponent(org)}`,
			body,
		),
	onSettled: () => {
		void client.invalidateQueries({ queryKey: sandboxKey(org) });
		void client.invalidateQueries({ queryKey: lockdownRootKey });
	},
});
