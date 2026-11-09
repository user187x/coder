import { useState } from "react";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { FillControls } from "./FillControls";
import { DEFAULT_FILL, type FillSettings, fillCSS, fillFile } from "./fill";

export const FillDialog = ({
	open,
	onOpenChange,
	onPick,
	onSettings,
	size,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (file: File) => void;
	onSettings?: (value: FillSettings) => void;
	size?: number;
}) => {
	const [value, setValue] = useState(DEFAULT_FILL);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>();
	const choose = async () => {
		setBusy(true);
		setError(undefined);
		try {
			if (onSettings) onSettings(value);
			else onPick(await fillFile(value, size));
			onOpenChange(false);
		} catch (error) {
			setError(error);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(open) => {
				if (!busy) onOpenChange(open);
			}}
		>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Color or gradient</DialogTitle>
					<DialogDescription>
						Choose a solid color or blend two colors. Preview before applying.
					</DialogDescription>
				</DialogHeader>
				<div
					role="img"
					aria-label="Fill preview"
					className="h-32 rounded-lg border border-solid border-border bg-surface-primary"
					style={{ background: fillCSS(value) }}
				/>
				<FillControls value={value} onChange={setValue} disabled={busy} />
				{error ? <ErrorAlert error={error} /> : null}
				<DialogFooter>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button disabled={busy} onClick={() => void choose()}>
						Use fill
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
