import {
	CloudIcon,
	ContainerIcon,
	DatabaseIcon,
	KeyRoundIcon,
	MonitorIcon,
	NetworkIcon,
	ServerIcon,
	WebhookIcon,
} from "lucide-react";
import { formatMs, seconds } from "./clusterFormat";
import {
	componentIcon,
	groupByKind,
	KIND_ORDER,
	KINDS,
	kindOf,
} from "./componentKinds";

describe("kindOf", () => {
	it("takes the kind the platform service sends", () => {
		expect(kindOf({ kind: "replicator", role: "add-on", name: "x" })).toBe(
			"replicator",
		);
	});

	it("falls back on an older service's role, then on the pod's name", () => {
		expect(kindOf({ role: "coder", name: "coder-5d9f7c" })).toBe("coder");
		expect(kindOf({ role: "database", name: "coder-db-1" })).toBe("database");
		expect(kindOf({ role: "add-on", name: "coder-ui-updates-6c-x" })).toBe(
			"platform",
		);
		expect(
			kindOf({ role: "add-on", name: "coder-code-server-replicator-5d-a" }),
		).toBe("replicator");
		expect(kindOf({ role: "add-on", name: "coder-cs-111111112222-g3" })).toBe(
			"code-server",
		);
		expect(
			kindOf({ role: "add-on", name: "coder-user-storage-minio-6f-q" }),
		).toBe("storage");
		expect(kindOf({ role: "add-on", name: "metrics-server-65-9" })).toBe(
			"other",
		);
		expect(
			kindOf({ kind: "nonsense", role: "add-on", name: "traefik-d5" }),
		).toBe("gateway");
	});
});

describe("KINDS", () => {
	it("gives every kind its own colour, in light and in dark mode", () => {
		const light = KIND_ORDER.map(
			(k) => KINDS[k].color.match(/^\[--kind:(#[0-9a-f]{6})\]/)?.[1],
		);
		const dark = KIND_ORDER.map(
			(k) => KINDS[k].color.match(/dark:\[--kind:(#[0-9a-f]{6})\]$/)?.[1],
		);
		expect(light.every(Boolean)).toBe(true);
		expect(dark.every(Boolean)).toBe(true);
		expect(new Set(light).size).toBe(KIND_ORDER.length);
		expect(new Set(dark).size).toBe(KIND_ORDER.length);
		expect(Object.keys(KINDS).sort()).toEqual([...KIND_ORDER].sort());
	});
});

describe("groupByKind", () => {
	it("groups in the legend's order, whatever order the items come in", () => {
		const items = [
			{ n: "a", k: "other" as const },
			{ n: "b", k: "coder" as const },
			{ n: "c", k: "gateway" as const },
			{ n: "d", k: "coder" as const },
		];
		expect(
			groupByKind(items, (i) => i.k).map(([k, list]) => [
				k,
				list.map((i) => i.n),
			]),
		).toEqual([
			["gateway", ["c"]],
			["coder", ["b", "d"]],
			["other", ["a"]],
		]);
	});
});

describe("formatMs", () => {
	it("keeps microseconds under a millisecond and rounds above", () => {
		expect(formatMs(null)).toBe("N/A");
		expect(formatMs(0.004)).toBe("<0.01 ms");
		expect(formatMs(0.443)).toBe("0.44 ms");
		expect(formatMs(1.53)).toBe("1.5 ms");
		expect(formatMs(42.4)).toBe("42 ms");
		expect(formatMs(1530)).toBe("1.53 s");
	});

	it("gives a lease's seconds without their sign", () => {
		expect(seconds(27.5)).toBe("28 s");
		expect(seconds(-3)).toBe("3 s");
		expect(seconds(600)).toBe("10 min");
		expect(seconds(null)).toBe("N/A");
	});
});

describe("componentIcon", () => {
	it("names what a component is: by its name where a kind holds several things, else by its kind", () => {
		expect(componentIcon("database", "coder-db-1")).toBe(DatabaseIcon);
		expect(componentIcon("gateway", "traefik")).toBe(NetworkIcon);
		expect(componentIcon("platform", "coder-image-registry")).toBe(
			ContainerIcon,
		);
		expect(componentIcon("platform", "coder-platform-webhook")).toBe(
			WebhookIcon,
		);
		expect(componentIcon("platform", "coder-ui-logs-db")).toBe(DatabaseIcon);
		expect(componentIcon("storage", "coder-user-storage-minio")).toBe(
			CloudIcon,
		);
		expect(componentIcon("other", "keycloak")).toBe(KeyRoundIcon);
		expect(componentIcon("coder", "coder")).toBe(ServerIcon);
		expect(componentIcon("workspace", "admin/look")).toBe(MonitorIcon);
	});
});
