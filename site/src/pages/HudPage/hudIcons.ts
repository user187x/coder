import {
	CircleIcon,
	CirclePlayIcon,
	CircleXIcon,
	ClockIcon,
	CpuIcon,
	GaugeIcon,
	GpuIcon,
	HardDriveIcon,
	HeartCrackIcon,
	HourglassIcon,
	LayersIcon,
	type LucideIcon,
	MemoryStickIcon,
	UnplugIcon,
	UsersIcon,
} from "lucide-react";

/**
 * The icon before each HUD figure's name, for what it measures: every CPU
 * figure (in use, claimed, the top account's, the cluster's) has the CPU
 * icon, every memory figure the memory icon, and so on. Keyed by the
 * figure's id (the platform service's hud metrics).
 */
const HUD_ICONS: Record<string, LucideIcon> = {
	"disk-total": HardDriveIcon,
	"disk-used": HardDriveIcon,
	"disk-free": HardDriveIcon,
	"disk-claimed": HardDriveIcon,
	"max-volume": HardDriveIcon,
	"max-volume-claim": HardDriveIcon,
	"volume-count": HardDriveIcon,
	users: UsersIcon,
	workspaces: LayersIcon,
	"top-workspaces": LayersIcon,
	active: CirclePlayIcon,
	"cpu-used": CpuIcon,
	cpu: CpuIcon,
	"top-cpu": CpuIcon,
	"cluster-cpu": CpuIcon,
	"memory-used": MemoryStickIcon,
	memory: MemoryStickIcon,
	"top-memory": MemoryStickIcon,
	"cluster-memory": MemoryStickIcon,
	gpu: GpuIcon,
	"top-gpu": GpuIcon,
	"top-online": ClockIcon,
	"top-failures": CircleXIcon,
	"long-failure": HourglassIcon,
	"top-ping": GaugeIcon,
	"median-ping": GaugeIcon,
	disconnected: UnplugIcon,
	"unhealthy-apps": HeartCrackIcon,
};

/** A figure's icon; a plain circle for one this dashboard does not know yet. */
export const hudIcon = (id: string): LucideIcon => HUD_ICONS[id] ?? CircleIcon;

/** The ids with an icon of their own (for the test against the service's list). */
export const HUD_ICON_IDS = Object.keys(HUD_ICONS);
