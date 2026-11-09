import { useSyncExternalStore } from "react";
import { terminalWebsocketUrl } from "#/utils/terminal";

/**
 * Traffic Control's connectivity tests: a workspace emits "ACK" every second on a port (to its tunnels' other ends,
 * or, from the browser, to one of its shared ports), and a workspace listens on a port, its orb rippling green at
 * each "ACK" that arrives. A test is a command run in the workspace through its agent's terminal (no session of the
 * user's own is used), stopped with Ctrl-C when the test stops or the page closes.
 */

export type TestKind = "emit" | "listen";

type Running = { port: number; stop: () => void; sent: number; failed: number };

type State = {
	/** Workspace ID -> its running tests. */
	tests: ReadonlyMap<string, Partial<Record<TestKind, Running>>>;
	/** Workspace ID -> how many ACKs it has received (each one a ripple). */
	received: ReadonlyMap<string, number>;
	/** Input orb key -> its browser emitter. */
	shareEmits: ReadonlyMap<string, Running>;
};

let state: State = {
	tests: new Map(),
	received: new Map(),
	shareEmits: new Map(),
};
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
};

export const useConnectivityTests = () =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state,
	);

const shellWord = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

/** Every second, "ACK" to each address on the port, with python3 or, without it, bash. */
const emitCommand = (port: number, addresses: readonly string[]) => {
	const py = `import socket,sys,time
p=int(sys.argv[1])
while True:
  for a in sys.argv[2:]:
    try:
      s=socket.create_connection((a,p),timeout=1);s.sendall(b"ACK");s.close();print("SENT",a,flush=True)
    except Exception as e:
      print("FAIL",a,e,flush=True)
  time.sleep(1)`;
	const targets = addresses.map(shellWord).join(" ");
	const bash = `while :; do for a in ${targets}; do if (printf ACK > /dev/tcp/$a/${port}) 2>/dev/null; then echo SENT $a; else echo FAIL $a; fi; done; sleep 1; done`;
	return `sh -c ${shellWord(`if command -v python3 >/dev/null; then exec python3 -u -c ${shellWord(py)} ${port} ${targets}; else exec bash -c ${shellWord(bash)}; fi`)}`;
};

/** A listener on the port, printing RECV for each connection that carries "ACK". */
const listenCommand = (port: number) => {
	const py = `import socket,sys
p=int(sys.argv[1]);s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("0.0.0.0",p));s.listen(16);print("LISTEN",p,flush=True)
while True:
  c,a=s.accept();c.settimeout(2)
  try:
    d=c.recv(4096)
  except Exception:
    d=b""
  c.close()
  if b"ACK" in d: print("RECV",a[0],flush=True)`;
	return `sh -c ${shellWord(`exec python3 -u -c ${shellWord(py)} ${port}`)}`;
};

/** Runs a command in the workspace's agent terminal; each output line goes to onLine. Returns its stop. */
const run = async (
	agentId: string,
	command: string,
	onLine: (line: string) => void,
	onEnd: () => void,
) => {
	const reconnect = crypto.randomUUID();
	const url = await terminalWebsocketUrl(
		undefined,
		reconnect,
		agentId,
		command,
		24,
		120,
		undefined,
		undefined,
		crypto.randomUUID(),
	);
	const socket = new WebSocket(url);
	socket.binaryType = "arraybuffer";
	const decoder = new TextDecoder();
	let buffer = "";
	socket.addEventListener("message", (event) => {
		buffer +=
			typeof event.data === "string"
				? event.data
				: decoder.decode(event.data as ArrayBuffer, { stream: true });
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) onLine(line.trim());
	});
	socket.addEventListener("close", onEnd);
	return () => {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(new TextEncoder().encode(JSON.stringify({ data: "\x03" })));
		}
		window.setTimeout(() => socket.close(), 200);
	};
};

const putTest = (workspaceId: string, kind: TestKind, test?: Running) => {
	const tests = new Map(state.tests);
	const current = { ...tests.get(workspaceId) };
	if (test) current[kind] = test;
	else delete current[kind];
	tests.set(workspaceId, current);
	set({ tests });
};

const counting = (workspaceId: string, kind: TestKind, line: string) => {
	const test = state.tests.get(workspaceId)?.[kind];
	if (!test) return;
	if (line.startsWith("SENT"))
		putTest(workspaceId, kind, { ...test, sent: test.sent + 1 });
	if (line.startsWith("FAIL"))
		putTest(workspaceId, kind, { ...test, failed: test.failed + 1 });
};

/** Starts a workspace's test (stopping one of the same kind it runs). */
export const startTest = async (
	kind: TestKind,
	workspaceId: string,
	agentId: string,
	port: number,
	addresses: readonly string[] = [],
) => {
	stopTest(workspaceId, kind);
	const command =
		kind === "emit" ? emitCommand(port, addresses) : listenCommand(port);
	const stop = await run(
		agentId,
		command,
		(line) => {
			if (kind === "listen" && line.startsWith("RECV")) {
				const received = new Map(state.received);
				received.set(workspaceId, (received.get(workspaceId) ?? 0) + 1);
				set({ received });
			}
			counting(workspaceId, kind, line);
		},
		() => {
			if (state.tests.get(workspaceId)?.[kind]?.stop === stop)
				putTest(workspaceId, kind);
		},
	);
	putTest(workspaceId, kind, { port, stop, sent: 0, failed: 0 });
};

export const stopTest = (workspaceId: string, kind: TestKind) => {
	const test = state.tests.get(workspaceId)?.[kind];
	if (!test) return;
	test.stop();
	putTest(workspaceId, kind);
};

/** From the browser, "ACK" every second to a shared port through Coder's port sharing (its address). */
export const startShareEmit = (orbKey: string, url: string, port: number) => {
	stopShareEmit(orbKey);
	const timer = window.setInterval(() => {
		void fetch(url, {
			method: "POST",
			body: "ACK",
			mode: "no-cors",
			credentials: "include",
		}).catch(() => undefined);
	}, 1000);
	const shareEmits = new Map(state.shareEmits);
	shareEmits.set(orbKey, {
		port,
		stop: () => window.clearInterval(timer),
		sent: 0,
		failed: 0,
	});
	set({ shareEmits });
};

export const stopShareEmit = (orbKey: string) => {
	const emit = state.shareEmits.get(orbKey);
	if (!emit) return;
	emit.stop();
	const shareEmits = new Map(state.shareEmits);
	shareEmits.delete(orbKey);
	set({ shareEmits });
};

// A test never outlives the page.
window.addEventListener("pagehide", () => {
	for (const [id, tests] of state.tests) {
		for (const kind of Object.keys(tests) as TestKind[]) stopTest(id, kind);
	}
	for (const key of state.shareEmits.keys()) stopShareEmit(key);
});
