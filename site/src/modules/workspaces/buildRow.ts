import type { Workspace } from "#/api/typesGenerated";
import type { ActionType } from "./actions";

/** The buttons that bring the workspace up without updating it. */
const STARTS: readonly ActionType[] = ["start", "retry", "debug", "activate"];
const UPDATES: readonly ActionType[] = [
	"updateAndRestart",
	"updateAndRestartRequireActiveVersion",
	"updateAndStart",
	"updateAndStartRequireActiveVersion",
];
/** Statuses of a build in progress (or waiting, or being canceled). */
const BUSY: readonly Workspace["latest_build"]["status"][] = [
	"starting",
	"stopping",
	"pending",
	"canceling",
	"deleting",
];

export type BuildRow = {
	/** The buttons, in the order the workspace showed them before the build. */
	actions: readonly ActionType[];
	/** Where the build's own button is (Cancel, or its in-progress label); the others wait. -1: after them. */
	active: number;
};

type BuildRowInput = {
	status: Workspace["latest_build"]["status"];
	transition: Workspace["latest_build"]["transition"];
	isRestarting: boolean;
	isUpdating: boolean;
	/** The buttons the workspace showed before the build (in this tab), if known. */
	before: readonly ActionType[] | null;
	/** The buttons of a running and of a stopped workspace, for a build that started before this tab saw it. */
	running: readonly ActionType[];
	stopped: readonly ActionType[];
};

/**
 * Platform: the workspace page's buttons while a build runs. They stay as
 * they were, in their order; the one that started the build becomes its
 * Cancel (or, when it cannot be canceled, says what it is doing), and the
 * others wait. Null when no build is running: the usual buttons.
 */
export const buildRow = ({
	status,
	transition,
	isRestarting,
	isUpdating,
	before,
	running,
	stopped,
}: BuildRowInput): BuildRow | null => {
	if (!isRestarting && !isUpdating && !BUSY.includes(status)) {
		return null;
	}
	if (status === "deleting" || transition === "delete") {
		return { actions: ["deleting"], active: 0 };
	}
	const actions =
		before ?? (isRestarting || transition === "stop" ? running : stopped);
	const first = (candidates: readonly ActionType[]) =>
		actions.findIndex((action) => candidates.includes(action));
	let active: number;
	if (isRestarting) {
		active = actions.indexOf("restart");
		if (active < 0) {
			active = first([
				"updateAndRestart",
				"updateAndRestartRequireActiveVersion",
			]);
		}
	} else if (isUpdating) {
		active = first(UPDATES);
	} else if (transition === "stop") {
		active = actions.indexOf("stop");
	} else {
		active = first(STARTS);
		if (active < 0) {
			active = first(UPDATES);
		}
	}
	return { actions, active };
};
