import axios, { type AxiosAdapter } from "axios";
import { MockWorkspacePowerOperation } from "#/testHelpers/workspacePower";
import { MockWorkspaceTunnel } from "#/testHelpers/workspaceTunnels";

afterEach(() => vi.restoreAllMocks());

it.each([
	["deleteWorkspaceTunnel", "workspace-tunnels", MockWorkspaceTunnel],
	[
		"clearWorkspacePowerOperation",
		"workspace-power/operation",
		MockWorkspacePowerOperation,
	],
] as const)(
	"sends the required JSON and CSRF headers for %s",
	async (method, resource, item) => {
		vi.resetModules();
		const create = axios.create.bind(axios);
		const adapter = vi.fn<AxiosAdapter>(async (config) => ({
			data: {},
			status: 200,
			statusText: "OK",
			headers: {},
			config,
		}));
		vi.spyOn(axios, "create").mockImplementation((config) =>
			create({ ...config, adapter }),
		);
		const { PlatformAPI } = await import("./platform");
		await PlatformAPI[method](item.organization_id, item.id);
		expect(adapter).toHaveBeenCalledOnce();
		const request = adapter.mock.calls[0]?.[0];
		expect(request?.method).toBe("delete");
		expect(request?.data).toBe("{}");
		expect(request?.url).toBe(
			`/__coder-ui/api/organizations/${item.organization_id}/${resource}/${item.id}`,
		);
		expect(request?.headers.get("Content-Type")).toBe("application/json");
		expect(request?.headers.get("X-Requested-With")).toBe("coder-ui");
	},
);

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
		exclude_admins: false,
	});
	expect(request?.headers.get("X-Requested-With")).toBe("coder-ui");
});
