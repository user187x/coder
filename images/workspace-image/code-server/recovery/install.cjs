const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const [root, client] = process.argv.slice(2);
const workbench = join(root, "lib/vscode/out/vs/code/browser/workbench");

function replaceOnce(path, needle, replacement) {
	const contents = readFileSync(path, "utf8");
	if (contents.split(needle).length !== 2) {
		throw new Error(`Expected exactly one recovery patch anchor in ${path}`);
	}
	writeFileSync(path, contents.replace(needle, () => replacement));
}

const start = '<script type="module" src="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/workbench.js"></script>';
replaceOnce(join(workbench, "workbench.html"), start,
	'<script nonce="{{WORKBENCH_SCRIPT_NONCE}}" data-workbench="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/workbench.js">' +
	readFileSync(client, "utf8") + '</script>');

// The pinned build classifies a missing server-side session as a permanent connection error.
const failure = 'if(l.code==="VSCODE_CONNECTION_ERROR"){this._options.logService.error(`${e} A permanent error occurred';
replaceOnce(join(workbench, "workbench.js"), failure,
	'if(l.code==="VSCODE_CONNECTION_ERROR"){if(l.message.includes("Unknown reconnection token")&&window.parent!==window)' +
	'window.parent.postMessage("coder-editor-session-expired",window.location.origin);' +
	failure.slice(failure.indexOf("this._options")));
