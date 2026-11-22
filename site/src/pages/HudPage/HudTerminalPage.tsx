import { ArrowLeftIcon, TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "react-query";
import { Link } from "react-router";
import { getErrorMessage } from "#/api/errors";
import { Button } from "#/components/Button/Button";
import { Input } from "#/components/Input/Input";
import { Margins } from "#/components/Margins/Margins";
import { useAuthenticated } from "#/hooks/useAuthenticated";
import { pageTitle } from "#/utils/page";
import { parseTerminalCommand, runTerminalCommand } from "./terminalCommands";

type Entry = {
	id: number;
	input: string;
	output?: string;
};

function ClusterTerminal() {
	const client = useQueryClient();
	const terminal = useRef<HTMLElement>(null);
	const transcript = useRef<HTMLDivElement>(null);
	const nextID = useRef(0);
	const [entries, setEntries] = useState<readonly Entry[]>([]);
	const [input, setInput] = useState("");
	const [historyIndex, setHistoryIndex] = useState<number>();
	useEffect(() => {
		const log = transcript.current;
		if (entries.length && log) log.scrollTop = log.scrollHeight;
	}, [entries]);

	async function execute(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const submitted = input.trim();
		if (!submitted || !terminal.current) return;
		const id = nextID.current++;
		setEntries((items) => [...items, { id, input: submitted }]);
		setInput("");
		setHistoryIndex(undefined);
		let output: string;
		try {
			output = await runTerminalCommand(
				client,
				parseTerminalCommand(submitted),
				terminal.current,
			);
		} catch (error) {
			output = getErrorMessage(error, "The command could not be completed.");
		}
		setEntries((items) =>
			items.map((item) => (item.id === id ? { ...item, output } : item)),
		);
	}

	function recall(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		if (!entries.length) return;
		event.preventDefault();
		const current = historyIndex ?? entries.length;
		const next = Math.min(
			entries.length,
			Math.max(0, current + (event.key === "ArrowUp" ? -1 : 1)),
		);
		setInput(entries[next]?.input ?? "");
		setHistoryIndex(next === entries.length ? undefined : next);
	}

	return (
		<section
			ref={terminal}
			aria-label="Cluster diagnostics terminal"
			className="dashboard-panel flex min-h-0 flex-col gap-3 [&:fullscreen]:rounded-none [&:fullscreen]:bg-surface-primary [&:fullscreen_[role=log]]:flex-1"
		>
			<div
				ref={transcript}
				role="log"
				aria-label="Command output"
				className="h-[min(56vh,38rem)] min-h-0 overflow-auto rounded-xl border border-solid border-border bg-surface-primary p-4 font-mono text-sm"
			>
				<p className="mt-0 text-content-secondary">
					Enter <code>help</code> to see the diagnostic commands.
				</p>
				{entries.map((entry) => (
					<div key={entry.id} className="mb-3">
						<p className="m-0 break-words text-content-link">$ {entry.input}</p>
						<pre className="m-0 mt-1">{entry.output ?? "Running…"}</pre>
					</div>
				))}
			</div>
			<form className="flex gap-2" onSubmit={(event) => void execute(event)}>
				<Input
					aria-label="Diagnostic command"
					autoComplete="off"
					spellCheck={false}
					placeholder="help"
					value={input}
					maxLength={540}
					className="min-w-0 font-mono"
					onKeyDown={recall}
					onChange={(event) => {
						setInput(event.target.value);
						setHistoryIndex(undefined);
					}}
				/>
				<Button type="submit" disabled={!input.trim()}>
					Run
				</Button>
			</form>
		</section>
	);
}

export default function HudTerminalPage() {
	const { permissions } = useAuthenticated();
	if (!permissions.viewDeploymentConfig) {
		return (
			<p className="px-6 py-10 text-content-secondary">
				The cluster terminal is for administrators.
			</p>
		);
	}

	return (
		<Margins className="flex grow flex-col gap-4 py-6">
			<title>{pageTitle("Cluster terminal")}</title>
			<header className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="m-0 flex items-center gap-2 text-xl font-semibold">
					<TerminalIcon aria-hidden className="size-5" />
					Cluster terminal
				</h1>
				<Button asChild variant="outline" size="sm">
					<Link to="/hud">
						<ArrowLeftIcon aria-hidden /> HUD
					</Link>
				</Button>
			</header>
			<ClusterTerminal />
		</Margins>
	);
}
