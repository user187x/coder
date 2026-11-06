/** The commands the announcement terminal knows (BannerScrollView, TerminalAnswers), for Tab completion. */
const COMMANDS = [
	"/dev/mouse",
	"cat",
	"cd",
	"clear",
	"close",
	"date",
	"dir",
	"doom",
	"echo",
	"exit",
	"health",
	"ip",
	"ls",
	"matrix",
	"rm",
	"skynet",
	"time",
	"who",
	"whoami",
] as const;

/** Only on /workspaces: they arm the terminal connector there. */
const WORKSPACES_COMMANDS = ["connect", "terminal"] as const;

/** Commands that take an argument: completed with a space after them, as a shell does. */
const TAKES_ARGUMENT = new Set(["cat", "cd", "dir", "echo", "ls", "rm"]);

export const terminalCommands = (onWorkspaces: boolean): string[] =>
	[...COMMANDS, ...(onWorkspaces ? WORKSPACES_COMMANDS : [])].sort();

type Completion = {
	/** The line after Tab. */
	typed: string;
	/** More than one command fits and the line cannot grow: list them, as a second Tab in a shell does. */
	candidates?: string[];
};

/**
 * Tab at the prompt, like a shell's: the command being typed (the first word) is completed when one command fits,
 * grown to what every fitting command shares when several do, and the fitting commands are listed when it cannot grow.
 * Arguments are not completed; nothing fits, nothing changes.
 */
export const completeCommand = (
	typed: string,
	commands: readonly string[],
): Completion => {
	const word = typed.trimStart();
	if (/\s/.test(word)) {
		return { typed };
	}
	const lower = word.toLowerCase();
	const fits = commands.filter((c) => c.startsWith(lower));
	if (fits.length === 0) {
		return { typed };
	}
	if (fits.length === 1) {
		const [only] = fits;
		return { typed: TAKES_ARGUMENT.has(only) ? `${only} ` : only };
	}
	let shared = fits[0];
	for (const c of fits) {
		while (!c.startsWith(shared)) {
			shared = shared.slice(0, -1);
		}
	}
	return shared.length > lower.length
		? { typed: shared }
		: { typed, candidates: fits };
};
