import { shellExited } from "./WorkspaceTerminal";

// Platform: an exit is told from a dropped connection by the shell's last line.
describe("shellExited", () => {
	const esc = String.fromCharCode(27);
	const bel = String.fromCharCode(7);
	it.each([
		[
			"exit typed at a coloured prompt",
			`${esc}]0;admin@look: ~${bel}${esc}[01;32madmin@look${esc}[00m:~$ exit\r\n`,
		],
		["Ctrl-D in bash", "admin@look:~$ \r\nexit\r\n"],
		["a login shell's logout", "admin@look:~$ logout\r\n"],
		["zsh", "% exit\n"],
	])("%s: exited", (_, tail) => {
		expect(shellExited(tail)).toBe(true);
	});
	it.each([
		["a prompt", "admin@look:~$ "],
		[
			"output mentioning exit mid-line",
			"the exit code was 0\r\nadmin@look:~$ ",
		],
		["a word ending in exit", "admin@look:~$ echo noexit\r\nnoexit\r\n"],
		["nothing", ""],
	])("%s: not exited", (_, tail) => {
		expect(shellExited(tail)).toBe(false);
	});
});
