import { QueryClient } from "react-query";
import { WorkspaceQuarantineAPI } from "#/api/workspaceQuarantine";
import { MockWorkspaceQuarantine } from "#/testHelpers/workspaceQuarantine";
import {
	quarantineEnforcementKey,
	setWorkspaceQuarantine,
	workspaceQuarantineKey,
} from "./workspaceQuarantine";

afterEach(() => vi.restoreAllMocks());
it("scopes the reviewed policy change and invalidates previous enforcement proof", async () => {
	const client = new QueryClient();
	const org = MockWorkspaceQuarantine.organization_id;
	const workspace = MockWorkspaceQuarantine.workspace_id;
	client.setQueryData(quarantineEnforcementKey(org, workspace), {
		revision: "previous-revision",
	});
	const set = vi
		.spyOn(WorkspaceQuarantineAPI, "set")
		.mockResolvedValue(MockWorkspaceQuarantine);
	const mutation = setWorkspaceQuarantine(client, org, workspace);
	const request = { enabled: true, reason: "Investigating unexpected traffic" };
	const result = await mutation.mutationFn(request);
	mutation.onSuccess(result);
	expect(set).toHaveBeenCalledExactlyOnceWith(org, workspace, request);
	expect(client.getQueryData(workspaceQuarantineKey(org, workspace))).toEqual(
		MockWorkspaceQuarantine,
	);
	expect(
		client.getQueryState(quarantineEnforcementKey(org, workspace))
			?.isInvalidated,
	).toBe(true);
});
