import { InfoIcon, XIcon } from "lucide-react";
import { Button } from "#/components/Button/Button";

type UpdateCheckNoticeProps = {
	version: string;
	releaseNotesUrl: string;
	onDismiss: () => void;
};

export const UpdateCheckNotice: React.FC<UpdateCheckNoticeProps> = ({
	version,
	releaseNotesUrl,
	onDismiss,
}) => {
	return (
		<div
			data-testid="update-check-notice"
			role="status"
			className="fixed bottom-6 right-6 z-50 flex max-w-[420px] items-start gap-4 rounded border border-solid border-highlight-sky bg-surface-primary p-4 text-sm text-content-primary shadow-sm"
		>
			<InfoIcon className="mt-0.5 size-icon-sm shrink-0 text-highlight-sky" />
			<div className="flex flex-col gap-1">
				<p className="m-0 font-semibold">Coder {version} is now available. </p>
				<p className="m-0 flex-1 leading-5">
					View the{" "}
					<a
						href={releaseNotesUrl}
						target="_blank"
						rel="noreferrer"
						className="text-content-link underline hover:no-underline"
					>
						release notes
					</a>{" "}
					and for more information.
				</p>
			</div>
			<Button
				aria-label="Dismiss"
				size="icon"
				variant="subtle"
				onClick={onDismiss}
				className="-m-2"
			>
				<XIcon />
			</Button>
		</div>
	);
};
