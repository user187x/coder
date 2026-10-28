import type { QuotaRequest } from "#/api/quotaRequests";
import { MockOrganization, MockUserMember } from "#/testHelpers/entities";

export const MockQuotaRequest: QuotaRequest = {
	id: "00000000-0000-4000-8000-000000000001",
	organization_id: MockOrganization.id,
	user_id: MockUserMember.id,
	username: MockUserMember.username,
	resources: { cpu: 2, memory: 4, workspaces: 1, disk: 0 },
	reason: "Run the integration test suite alongside my development workspace.",
	status: "pending",
	created_at: 1792800000,
};
