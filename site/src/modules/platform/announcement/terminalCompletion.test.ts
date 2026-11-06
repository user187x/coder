import { completeCommand, terminalCommands } from "./terminalCompletion";

describe("completeCommand", () => {
	const commands = terminalCommands(false);

	it("completes the one command that fits, with a space for one that takes an argument", () => {
		expect(completeCommand("sky", commands)).toEqual({ typed: "skynet" });
		expect(completeCommand("ec", commands)).toEqual({ typed: "echo " });
		expect(completeCommand("/d", commands)).toEqual({ typed: "/dev/mouse" });
	});

	it("grows to what the fitting commands share, then lists them", () => {
		expect(completeCommand("w", commands)).toEqual({ typed: "who" });
		expect(completeCommand("who", commands)).toEqual({
			typed: "who",
			candidates: ["who", "whoami"],
		});
		expect(completeCommand("c", commands).candidates).toEqual([
			"cat",
			"cd",
			"clear",
			"close",
		]);
	});

	it("leaves unknown words and arguments alone", () => {
		expect(completeCommand("cowsay", commands)).toEqual({ typed: "cowsay" });
		expect(completeCommand("echo he", commands)).toEqual({ typed: "echo he" });
	});

	it("offers the terminal connector's commands only on the workspaces page", () => {
		expect(completeCommand("term", commands)).toEqual({ typed: "term" });
		expect(completeCommand("term", terminalCommands(true))).toEqual({
			typed: "terminal",
		});
	});
});
