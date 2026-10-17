import {
	GlobeIcon,
	LayoutGridIcon,
	PlusIcon,
	RadioIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { useId, useState } from "react";
import type {
	WorkspaceAgentListeningPort,
	WorkspaceApp,
} from "#/api/typesGenerated";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { ExternalImage } from "#/components/ExternalImage/ExternalImage";
import { Input } from "#/components/Input/Input";
import { Label } from "#/components/Label/Label";
import { webAddress } from "./AgentLinkPanels";
import type { PanelContent } from "./agentPanelsStore";

type AddPanelTabProps = {
	/** The apps that can go in a panel (canBePanel). */
	apps: readonly WorkspaceApp[];
	/** The ports listening in the workspace; none where port forwarding is not offered. */
	ports: readonly WorkspaceAgentListeningPort[];
	/** How the listening ports are opened (Open ports' choice). */
	protocol: "http" | "https";
	/** The workspace is not ready yet (agentAppsReady). */
	disabled: boolean;
	onAdd: (content: PanelContent) => void;
};

/**
 * A half-moon tab peeking out above the top panel's right end, over the card's
 * content above it (whichever panel is on top), with a round "+" inside it in
 * the theme's accent colour: it adds an accordion panel (AccordionPanel) with
 * any app - one of the workspace's (served from it, a command in a terminal,
 * an external page), a port listening in it, or any web address.
 */
export const AddPanelTab: React.FC<AddPanelTabProps> = ({
	apps,
	ports,
	protocol,
	disabled,
	onAdd,
}) => {
	const [asking, setAsking] = useState(false);
	return (
		<div
			className="pointer-events-none absolute right-6 top-0 z-20 -translate-y-full"
			data-testid="add-panel-tab"
		>
			{/* A semicircle (twice as wide as it is tall, rounded on top); -mb-px: it covers the panel's top border, so
			    the two are one. The "+" sits at its foot, centred on the panel's border. */}
			<div className="pointer-events-auto -mb-px flex h-[19px] w-[38px] items-end justify-center rounded-t-full border border-b-0 border-solid border-border bg-surface-primary">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							disabled={disabled}
							aria-label="Add a panel"
							title={
								disabled
									? "Opens when the workspace is ready"
									: "Add a panel with an app"
							}
							className="relative z-10 flex size-[15px] translate-y-[7px] cursor-pointer items-center justify-center rounded-full border-0 bg-content-link p-0 text-content-invert shadow-[0_0_0_2px_hsl(var(--content-link)/0.18)] transition-[filter,box-shadow] hover:brightness-110 hover:shadow-[0_0_0_3px_hsl(var(--content-link)/0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-link disabled:cursor-not-allowed disabled:opacity-50"
							data-testid="add-panel-button"
						>
							<PlusIcon className="size-[11px]" strokeWidth={3} aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						className="max-h-[70vh] min-w-56 overflow-y-auto"
					>
						<DropdownMenuLabel>Add a panel with</DropdownMenuLabel>
						{apps.map((app) => (
							<DropdownMenuItem
								key={app.id}
								onSelect={() => onAdd({ kind: "app", slug: app.slug })}
							>
								{app.icon ? (
									<ExternalImage src={app.icon} className="size-4" />
								) : app.command ? (
									<SquareTerminalIcon />
								) : app.external ? (
									<GlobeIcon />
								) : (
									<LayoutGridIcon />
								)}
								<span>{app.display_name || app.slug}</span>
								{app.command && (
									<span className="ml-auto text-2xs text-content-secondary">
										terminal
									</span>
								)}
								{app.external && !app.command && (
									<span className="ml-auto text-2xs text-content-secondary">
										external
									</span>
								)}
							</DropdownMenuItem>
						))}
						{apps.length === 0 && (
							<DropdownMenuItem disabled>No apps</DropdownMenuItem>
						)}
						{ports.length > 0 && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuLabel>Open ports</DropdownMenuLabel>
								{ports.map((port) => (
									<DropdownMenuItem
										key={port.port}
										onSelect={() =>
											onAdd({
												kind: "port",
												port: port.port,
												protocol,
												process: port.process_name || undefined,
											})
										}
									>
										<RadioIcon />
										<span className="tabular-nums">{port.port}</span>
										{port.process_name && (
											<span className="truncate text-content-secondary">
												{port.process_name}
											</span>
										)}
									</DropdownMenuItem>
								))}
							</>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => setAsking(true)}>
							<GlobeIcon />
							<span>A web address…</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<WebAddressDialog
				open={asking}
				onClose={() => setAsking(false)}
				onAdd={(url, name) => {
					setAsking(false);
					onAdd({ kind: "web", url, name: name || undefined });
				}}
			/>
		</div>
	);
};

const WebAddressDialog: React.FC<{
	open: boolean;
	onClose: () => void;
	onAdd: (url: string, name: string) => void;
}> = ({ open, onClose, onAdd }) => {
	const urlId = useId();
	const nameId = useId();
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");
	const address = webAddress(url);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
					setUrl("");
					setName("");
				}
			}}
		>
			<DialogContent className="max-w-md">
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (address) {
							onAdd(address.href, name.trim());
							setUrl("");
							setName("");
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>A panel with a web page</DialogTitle>
						<DialogDescription>
							Any http or https address. A page that does not allow being shown
							inside another page stays blank: Pop out opens it.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor={urlId}>Address</Label>
						<Input
							id={urlId}
							autoFocus
							placeholder="https://…"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							aria-invalid={url.trim() !== "" && !address}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor={nameId}>Name (optional)</Label>
						<Input
							id={nameId}
							placeholder={address?.host ?? "Its host"}
							value={name}
							maxLength={60}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={!address}>
							Add the panel
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
