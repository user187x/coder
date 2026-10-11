import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";

export const AIBridgeSetupAlert: React.FC = () => {
	return (
		<Alert className="mb-12" severity="warning" prominent>
			<AlertTitle>
				AI Gateway is included in your license, but not set up yet.
			</AlertTitle>
			<AlertDescription>
				You have access to AI Governance, but it still needs to be set up.
			</AlertDescription>
		</Alert>
	);
};
