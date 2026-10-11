import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";

type AgentAlertProps = {
	title: string;
	detail: React.ReactNode;
	severity: "info" | "warning";
	prominent: boolean;
	/** Not shown (Coder's online docs, by default): kept so callers need not change. */
	troubleshootingURL?: string;
};

export const AgentAlert: React.FC<AgentAlertProps> = ({
	title,
	detail,
	severity,
	prominent,
}) => {
	return (
		<Alert severity={severity} prominent={prominent}>
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				{/* Platform: no troubleshooting docs button (Coder's online docs, by default). */}
				<div>{detail}</div>
			</AlertDescription>
		</Alert>
	);
};
