// The workbench runs in its own document so a new remote session can start in the same browser tab.
const workbench = new URL(document.currentScript.dataset.workbench, document.baseURI);
workbench.searchParams.set("coderRecovery", "1");
if (window.parent !== window) {
	window.addEventListener("DOMContentLoaded", () => import(workbench.href), { once: true });
} else {
	const frame = document.createElement("iframe");
	frame.title = "Workspace editor";
	frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0";
	frame.allow = "clipboard-read; clipboard-write; fullscreen";
	frame.src = window.location.href;
	document.body.replaceChildren(frame);

	window.addEventListener("message", (event) => {
		if (event.origin !== window.location.origin || event.source !== frame.contentWindow ||
			event.data !== "coder-editor-session-expired") {
			return;
		}
		const editor = frame.contentDocument;
		// Keep the workbench's recovery prompt if an open editor may contain unsaved changes.
		if (!editor?.querySelector(".monaco-workbench") ||
			editor.querySelector(".tab.dirty, .editor-group-container.dirty, .monaco-list-row.dirty")) {
			return;
		}
		const next = new URL(frame.contentWindow.location.href);
		if (next.origin === window.location.origin) {
			frame.src = next.href;
		}
	});
}
