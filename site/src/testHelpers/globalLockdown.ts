import type {
	GlobalControlStatus,
	GlobalLockdownState,
} from "#/api/typesGenerated";

export const MockGlobalLockdownState: GlobalLockdownState = {
	enabled: false,
	admin: true,
	revision: "lockdown-1",
	updated_by: "admin",
	updated_at: "2026-10-23T20:00:00Z",
	confirmed: false,
	agents_total: 2,
	agents_pending: 0,
	agents: [],
	users: [
		{
			id: "owner-1",
			username: "admin",
			avatar_url: "",
			admin: true,
			connected: true,
			disconnected: false,
		},
		{
			id: "member-1",
			username: "developer",
			avatar_url: "",
			admin: false,
			connected: true,
			disconnected: false,
		},
	],
};

export const MockGlobalControlStatus: GlobalControlStatus = {
	configured: true,
};
export const MockGlobalControlGrant: GlobalControlStatus = {
	configured: true,
	token: "test-only-control-token",
	expires_at: "2100-01-01T00:00:00Z",
};
