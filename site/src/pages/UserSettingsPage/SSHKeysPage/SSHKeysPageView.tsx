import { ChevronDownIcon, FileKeyIcon, RefreshCwIcon } from "lucide-react";
import { Link as RouterLink } from "react-router";
import type { GitSSHKey } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import { CodeExample } from "#/components/CodeExample/CodeExample";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/DropdownMenu/DropdownMenu";
import { Spinner } from "#/components/Spinner/Spinner";

/** Platform: the key types Regenerate Key offers (the API's algorithm names). */
export const SSH_KEY_TYPES = [
	{ algorithm: "rsa4096", label: "RSA", detail: "4096-bit" },
	{ algorithm: "ed25519", label: "ED25519", detail: "Curve25519" },
] as const;

export type SSHKeyAlgorithm = (typeof SSH_KEY_TYPES)[number]["algorithm"];

type SSHKeysPageViewProps = {
	isLoading: boolean;
	getSSHKeyError?: unknown;
	sshKey?: GitSSHKey;
	onRegenerateClick: (algorithm: SSHKeyAlgorithm) => void;
};

export const SSHKeysPageView: React.FC<SSHKeysPageViewProps> = ({
	isLoading,
	getSSHKeyError,
	sshKey,
	onRegenerateClick,
}) => {
	if (isLoading) {
		return (
			<div className="p-8">
				<Spinner size="lg" loading />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Regenerating the key is not an option if getSSHKey fails.
        Only one of the error messages will exist at a single time */}
			{Boolean(getSSHKeyError) && <ErrorAlert error={getSSHKeyError} />}

			{sshKey && (
				<>
					<p className="m-0 text-sm text-content-secondary">
						The following public key is used to authenticate Git in workspaces.
						You may add it to Git services (such as GitHub) that you need to
						access from your workspace. Coder configures authentication via{" "}
						<code className="rounded-sm border border-border bg-surface-secondary px-1 py-0.5 text-xs text-content-primary">
							$GIT_SSH_COMMAND
						</code>
						.
					</p>
					<CodeExample secret={false} code={sshKey.public_key.trim()} />
					<div className="flex flex-wrap gap-2">
						{/* Platform: a new key of the type picked (RSA or ED25519). */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button data-testid="regenerate" variant="outline">
									<RefreshCwIcon aria-hidden />
									Regenerate Key
									<ChevronDownIcon aria-hidden />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="min-w-48">
								{SSH_KEY_TYPES.map((type) => (
									<DropdownMenuItem
										key={type.algorithm}
										data-testid={`regenerate-${type.algorithm}`}
										onSelect={() => onRegenerateClick(type.algorithm)}
									>
										<span className="flex-1">{type.label}</span>
										<span className="text-xs text-content-secondary">
											{type.detail}
										</span>
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						{/* Platform: the private key of the user's .p12 instead, on the Certificates page. */}
						<Button variant="outline" asChild>
							<RouterLink
								to="/settings/certificates?ssh-key"
								title="Use the private key of your .p12 certificate as your SSH key"
							>
								<FileKeyIcon aria-hidden />
								P12
							</RouterLink>
						</Button>
					</div>
				</>
			)}
		</div>
	);
};
