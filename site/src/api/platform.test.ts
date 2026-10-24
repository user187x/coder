import axios, { type AxiosAdapter } from "axios";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";

afterEach(() => vi.restoreAllMocks());

it("sends the CSRF headers required when deleting a workspace tunnel", async () => {
	vi.resetModules();
	const create = axios.create.bind(axios);
	const adapter = vi.fn<AxiosAdapter>(async (config) => ({
		data: { tunnel: { ...MockWorkspaceTunnel, status: "disconnecting" } },
		status: 200,
		statusText: "OK",
		headers: {},
		config,
	}));
	vi.spyOn(axios, "create").mockImplementation((config) =>
		create({ ...config, adapter }),
	);
	const { PlatformAPI } = await import("./platform");
	await PlatformAPI.deleteWorkspaceTunnel(
		MockWorkspaceTunnel.organization_id,
		MockWorkspaceTunnel.id,
	);
	expect(adapter).toHaveBeenCalledOnce();
	const request = adapter.mock.calls[0]?.[0];
	expect(request?.method).toBe("delete");
	expect(request?.data).toBe("{}");
	expect(request?.url).toBe(
		`/__coder-ui/api/organizations/${MockWorkspaceTunnel.organization_id}/workspace-tunnels/${MockWorkspaceTunnel.id}`,
	);
	expect(request?.headers.get("Content-Type")).toBe("application/json");
	expect(request?.headers.get("X-Requested-With")).toBe("coder-ui");
});

it("submits only reviewed workspace IDs with explicit power-action confirmation", async () => {
	vi.resetModules();
	const create = axios.create.bind(axios);
	const adapter = vi.fn<AxiosAdapter>(async (config) => ({
		data: {},
		status: 202,
		statusText: "Accepted",
		headers: {},
		config,
	}));
	vi.spyOn(axios, "create").mockImplementation((config) =>
		create({ ...config, adapter }),
	);
	const { PlatformAPI } = await import("./platform");
	await PlatformAPI.startWorkspacePower("reviewed-organization", "terminate", [
		"reviewed-workspace",
	]);
	const request = adapter.mock.calls[0]?.[0];
	expect(request?.method).toBe("post");
	expect(request?.url).toBe(
		"/__coder-ui/api/organizations/reviewed-organization/workspace-power",
	);
	expect(JSON.parse(request?.data)).toEqual({
		action: "terminate",
		workspace_ids: ["reviewed-workspace"],
		confirmation: "terminate",
	});
	expect(request?.headers.get("X-Requested-With")).toBe("coder-ui");
});
