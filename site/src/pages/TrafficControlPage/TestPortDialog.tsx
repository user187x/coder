import { useId, useState } from "react";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import type { TestKind } from "./connectivityTests";

/** Asks which port a workspace's connectivity test emits to or listens on. */
export const TestPortDialog: React.FC<{
	kind: TestKind;
	workspace: string;
	/** The other ends of its tunnels, where an emitter sends. */
	peers: number;
	onStart: (port: number) => void;
	onCancel: () => void;
}> = ({ kind, workspace, peers, onStart, onCancel }) => {
	const id = useId();
	const [port, setPort] = useState("7777");
	const n = Number(port);
	const valid = Number.isInteger(n) && n >= 1 && n <= 65535;
	const blocked = kind === "emit" && peers === 0;
	return (
		<Dialog open onOpenChange={(open) => !open && onCancel()}>
			<DialogContent overlayClassName="backdrop-blur-md" className="max-w-md">
				<DialogTitle>
					{kind === "emit" ? "Test Emit" : "Test Listen"}: {workspace}
				</DialogTitle>
				<DialogDescription>
					{kind === "emit"
						? `Sends "ACK" every second on this port to the other end of each of ${workspace}'s tunnels.`
						: `Listens on this port in ${workspace}; its orb ripples green at each "ACK" received.`}
				</DialogDescription>
				<form
					id={`${id}-form`}
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (valid && !blocked) onStart(n);
					}}
				>
					<Label htmlFor={`${id}-port`}>Port</Label>
					<Input
						id={`${id}-port`}
						type="number"
						min={1}
						max={65535}
						inputMode="numeric"
						autoFocus
						value={port}
						onChange={(e) => setPort(e.target.value)}
					/>
				</form>
				{blocked && (
					<p className="m-0 text-sm text-content-warning">
						{workspace} has no tunnel: there is nowhere to emit to.
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button
						type="submit"
						form={`${id}-form`}
						disabled={!valid || blocked}
					>
						{kind === "emit" ? "Start emitting" : "Start listening"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
