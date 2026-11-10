import type { CloudDriveConnectionsOverview } from "#/api/platform";

export const MockCloudDriveConnectionsOverview: CloudDriveConnectionsOverview =
	{
		drives: [
			{
				owner: { id: "3f0c2a52-7d7e-4c5b-9a3e-2f4b8c1d0e9a", username: "ann" },
				encrypted: true,
				source: null,
				workspaces: [
					{ id: "ws-ann-dev", name: "dev", state: "connected" },
					{ id: "ws-ann-ci", name: "ci", state: "disconnected" },
					{ id: "ws-ann-pair", name: "pairing", state: "shared" },
				],
			},
			{
				owner: { id: "4a1d3b63-8e8f-4d6c-8b4f-3a5c9d2e1f0b", username: "bob" },
				encrypted: false,
				source: "ws-bob-data",
				workspaces: [
					{ id: "ws-bob-data", name: "data", state: "connected" },
					{ id: "ws-bob-api", name: "api", state: "connected" },
				],
			},
		],
	};
