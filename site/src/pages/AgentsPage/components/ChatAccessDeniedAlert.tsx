import { Alert, AlertDescription, AlertTitle } from "#/components/Alert/Alert";
import { Button } from "#/components/Button/Button";

export const ChatAccessDeniedAlert: React.FC = () => {
	return (
		<Alert
			severity="info"
			actions={
				<Button size="sm" onClick={() => location.reload()}>
					Refresh
				</Button>
			}
		>
			<AlertTitle>Permission required</AlertTitle>
			<AlertDescription>
				You don't have permission to use Coder Agents. Your existing chats are
				kept and reappear when your access is restored. Contact your Coder
				administrator, then refresh this page.
			</AlertDescription>
		</Alert>
	);
};
