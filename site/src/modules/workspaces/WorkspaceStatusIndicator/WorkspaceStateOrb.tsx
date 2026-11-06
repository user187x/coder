import { LiveLava } from "#/components/LavaImage/LiveLava";
import {
	LAVA_PICTURE_DEFAULT,
	type LavaSettings,
} from "#/components/LavaImage/lava";

type WorkspaceOrbState =
	| "running"
	| "error"
	| "starting"
	| "warning"
	| "locked"
	| "stopped";
const palette = (primary: string, accent: string): LavaSettings => ({
	...LAVA_PICTURE_DEFAULT,
	primary,
	accent,
	cycle: false,
});
const settings: Record<WorkspaceOrbState, LavaSettings> = {
	running: palette("#22c55e", "#065f46"),
	error: palette("#ef4444", "#7f1d1d"),
	starting: palette("#facc15", "#a16207"),
	warning: palette("#facc15", "#a16207"),
	locked: palette("#f97316", "#9a3412"),
	stopped: palette("#a3a3a3", "#525252"),
};

export const WorkspaceStateOrb: React.FC<{
	state: WorkspaceOrbState;
	/** Any CSS length for both sides. */
	size?: string;
}> = ({ state, size = "1em" }) => (
	<LiveLava
		className="rounded-full"
		settings={settings[state]}
		style={{ width: size, height: size }}
		paused={state === "stopped"}
	/>
);
