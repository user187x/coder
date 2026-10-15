import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { getErrorDetail, getErrorMessage } from "#/api/errors";
import { regenerateUserSSHKey, userSSHKey } from "#/api/queries/sshKeys";
import { ConfirmDialog } from "#/components/Dialog/ConfirmDialog/ConfirmDialog";
import {
	SettingsHeader,
	SettingsHeaderTitle,
} from "#/components/SettingsHeader/SettingsHeader";
import {
	SSH_KEY_TYPES,
	type SSHKeyAlgorithm,
	SSHKeysPageView,
} from "./SSHKeysPageView";

const SSHKeysPage: React.FC = () => {
	// Platform: the key type being confirmed (Regenerate Key > RSA or ED25519).
	const [confirming, setConfirming] = useState<SSHKeyAlgorithm | null>(null);
	const keyType = SSH_KEY_TYPES.find((t) => t.algorithm === confirming);

	const userSSHKeyQuery = useQuery(userSSHKey("me"));
	const queryClient = useQueryClient();
	const regenerateSSHKeyMutation = useMutation(
		regenerateUserSSHKey("me", queryClient),
	);

	return (
		<>
			<SettingsHeader>
				<SettingsHeaderTitle>SSH keys</SettingsHeaderTitle>
			</SettingsHeader>
			<SSHKeysPageView
				isLoading={userSSHKeyQuery.isLoading}
				getSSHKeyError={userSSHKeyQuery.error}
				sshKey={userSSHKeyQuery.data}
				onRegenerateClick={setConfirming}
			/>

			<ConfirmDialog
				type="delete"
				hideCancel={false}
				open={confirming !== null}
				confirmLoading={regenerateSSHKeyMutation.isPending}
				title={`Regenerate SSH key as ${keyType?.label ?? ""}?`}
				description={`A new ${keyType ? `${keyType.label} (${keyType.detail})` : ""} key replaces the current one. You will need to replace the public SSH key on services you use it with, and you'll need to rebuild existing workspaces.`}
				confirmText="Confirm"
				onClose={() => setConfirming(null)}
				onConfirm={async () => {
					try {
						await regenerateSSHKeyMutation.mutateAsync(confirming ?? undefined);
						toast.success(
							`SSH Key regenerated successfully (${keyType?.label ?? ""}).`,
						);
					} catch (error) {
						toast.error(
							getErrorMessage(error, "Failed to regenerate SSH key"),
							{
								description: getErrorDetail(error),
							},
						);
					} finally {
						setConfirming(null);
					}
				}}
			/>
		</>
	);
};

export default SSHKeysPage;
