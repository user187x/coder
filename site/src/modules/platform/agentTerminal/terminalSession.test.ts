import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import {
	DEFAULT_CUSTOM_COMMAND,
	newSession,
	readCustomCommand,
	startCommand,
	writeCustomCommand,
} from "./terminalSession";

// What the agent does with the start command: the user's shell runs it with -c.
const run = (command: string) =>
	execFileSync("/bin/sh", ["-c", command], {
		env: { PATH: process.env.PATH, HOME: process.env.HOME, SHELL: "/bin/sh" },
		input: "echo shell-took-over\n",
		encoding: "utf8",
	});

describe("startCommand", () => {
	it("starts the login shell and records its process id", () => {
		const session = newSession("linux");
		expect(run(startCommand(session) as string)).toContain("shell-took-over");
		const pidFile = `/tmp/coder-ui-terminal-${session.id}.pid`;
		expect(readFileSync(pidFile, "utf8").trim()).toMatch(/^\d+$/);
		rmSync(pidFile);
	});

	it("runs the custom command first, then the shell takes over", () => {
		const session = newSession(
			"linux",
			`printf '%s\\n' "it's \\$HOME: ok" "naïve"`,
		);
		const command = startCommand(session) as string;
		// Nothing of the command itself outside base64 inside the single quotes.
		expect(command.slice(command.indexOf("'") + 1, -1)).not.toMatch(/'/);
		const out = run(command);
		expect(out).toContain("it's $HOME: ok");
		expect(out).toContain("naïve");
		expect(out.indexOf("naïve")).toBeLessThan(out.indexOf("shell-took-over"));
		rmSync(`/tmp/coder-ui-terminal-${session.id}.pid`, { force: true });
	});

	it("ignores a blank command and Windows", () => {
		expect(newSession("linux", "  ").command).toBeUndefined();
		expect(newSession("windows", "btop")).toMatchObject({ wrapped: false });
		expect(newSession("windows", "btop").command).toBeUndefined();
	});
});

describe("custom command setting", () => {
	beforeEach(() => localStorage.clear());

	it("is off with btop by default and remembered", () => {
		expect(readCustomCommand()).toEqual({
			enabled: false,
			command: DEFAULT_CUSTOM_COMMAND,
		});
		writeCustomCommand({ enabled: true, command: "htop" });
		expect(readCustomCommand()).toEqual({ enabled: true, command: "htop" });
	});
});
