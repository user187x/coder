import { CircleIcon, CpuIcon, MemoryStickIcon } from "lucide-react";
import { HUD_ICON_IDS, hudIcon } from "./hudIcons";

// Every figure the platform service's HUD sends (ui-service.py, the hud metrics).
const SERVICE_IDS = [
	"disk-total",
	"disk-used",
	"disk-free",
	"disk-claimed",
	"max-volume",
	"max-volume-claim",
	"volume-count",
	"users",
	"workspaces",
	"active",
	"cpu-used",
	"memory-used",
	"cpu",
	"memory",
	"gpu",
	"top-cpu",
	"top-memory",
	"top-gpu",
	"top-workspaces",
	"top-online",
	"top-failures",
	"top-ping",
	"long-failure",
	"cluster-cpu",
	"cluster-memory",
	"median-ping",
	"disconnected",
	"unhealthy-apps",
];

describe("hudIcon", () => {
	it("has an icon for every figure the service sends", () => {
		expect([...HUD_ICON_IDS].sort()).toEqual([...SERVICE_IDS].sort());
	});

	it("gives figures of the same kind the same icon", () => {
		for (const id of ["cpu-used", "cpu", "top-cpu", "cluster-cpu"]) {
			expect(hudIcon(id)).toBe(CpuIcon);
		}
		for (const id of [
			"memory-used",
			"memory",
			"top-memory",
			"cluster-memory",
		]) {
			expect(hudIcon(id)).toBe(MemoryStickIcon);
		}
	});

	it("falls back to a plain circle for an unknown figure", () => {
		expect(hudIcon("something-new")).toBe(CircleIcon);
	});
});
