import type { CloudDriveConnections } from "#/api/platform";
import {
	attachmentMessage,
	attachmentPending,
	pendingAttachments,
} from "./attachment";

const connections = (
	extra: Partial<CloudDriveConnections> = {},
): CloudDriveConnections => ({
	disconnected: [],
	older: [],
	shared: [],
	attachment: {},
	...extra,
});

describe("attachmentPending", () => {
	it("is the workspace's word until its drive is attached", () => {
		const data = connections({
			attachment: {
				a: "waiting",
				b: "attached",
				c: "starting",
				d: "unanswered",
			},
		});
		expect(attachmentPending(data, "a")).toBe("waiting");
		expect(attachmentPending(data, "b")).toBeNull();
		expect(attachmentPending(data, "c")).toBe("starting");
		expect(attachmentPending(data, "d")).toBe("unanswered");
		expect(pendingAttachments(data)).toEqual(["a", "c", "d"]);
	});

	it("is nothing where no drive is meant to be, or the workspace does not say", () => {
		const data = connections({
			disconnected: ["off"],
			shared: ["shared"],
			attachment: { off: "detached", shared: "shared", gone: "detached" },
		});
		expect(attachmentPending(data, "off")).toBeNull();
		expect(attachmentPending(data, "shared")).toBeNull();
		// connected, its drive taken out a moment ago (the list has not caught up): still on its way
		expect(attachmentPending(data, "gone")).toBe("detached");
		// a stopped workspace, or one from a template version before it: no word
		expect(attachmentPending(data, "stopped")).toBeNull();
		expect(attachmentPending(undefined, "a")).toBeNull();
		expect(pendingAttachments(undefined)).toEqual([]);
	});

	it("says what it waits for", () => {
		expect(attachmentMessage("waiting")).toMatch(/attaching/);
		expect(attachmentMessage("offline")).toMatch(/source workspace/);
		expect(attachmentMessage("unanswered")).toMatch(/does not answer/);
	});
});
