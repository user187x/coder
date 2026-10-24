import type { CloudDrivePeers, CloudDriveShare } from "#/api/platform";

export const MockAccountCloudDriveShare: CloudDriveShare = {
	id: "a".repeat(32),
	owner: "3f0c2a52-7d7e-4c5b-9a3e-2f4b8c1d0e9a",
	ownerName: "ann",
	from: "4a1d3b63-8e8f-4d6c-8b4f-3a5c9d2e1f0b",
	fromName: "bob",
	kind: "folder",
	path: "docs/plans",
	access: "read",
	asked: "read",
	state: "active",
	by: "owner",
	askedAt: 1760000000,
};

export const MockAccountCloudDrivePeers: CloudDrivePeers = {
	admin: true,
	me: "6c3f5d85-a0a1-4f8e-ad6b-5c7ebf4a3b2d",
	settings: {
		enabled: true,
		adminApproval: true,
		updatedAt: null,
		updatedBy: null,
	},
	asked: [],
	ofMine: [],
	all: [MockAccountCloudDriveShare],
};
