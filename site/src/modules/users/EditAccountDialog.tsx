import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { toast } from "sonner";
import { roles } from "#/api/queries/roles";
import {
	type AccountEditRequest,
	type AccountEditResult,
	updateAccount,
} from "#/api/queries/users";
import type { UpdateUserProfileRequest, User } from "#/api/typesGenerated";
import { ErrorAlert } from "#/components/Alert/ErrorAlert";
import { Button } from "#/components/Button/Button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/Dialog/Dialog";
import { getRoleNames } from "#/modules/roles";
import { RoleSelector } from "#/modules/roles/RoleSelector";
import { EditUserForm } from "#/pages/EditUserPage/EditUserForm";

const profileOf = (user: User): UpdateUserProfileRequest => ({
	username: user.username,
	name: user.name ?? "",
	avatar_url: user.avatar_url ?? "",
});
const sameRoles = (a: readonly string[], b: readonly string[]) =>
	[...a].sort().join("\n") === [...b].sort().join("\n");

/** Keeps successful changes saved when the other independently authorized endpoint fails. */
export const EditAccountDialog: React.FC<{
	user: User;
	rolesReadOnly?: boolean;
	onClose: () => void;
}> = ({ user, rolesReadOnly = false, onClose }) => {
	const client = useQueryClient();
	const available = useQuery({ ...roles(), enabled: !rolesReadOnly });
	const [savedProfile, setSavedProfile] = useState(() => profileOf(user));
	const [savedRoles, setSavedRoles] = useState(() => getRoleNames(user.roles));
	const [selectedRoles, setSelectedRoles] = useState(
		() => new Set(getRoleNames(user.roles)),
	);
	const [result, setResult] = useState<AccountEditResult>();
	const save = useMutation(updateAccount(user, client));
	const roleChanges =
		!rolesReadOnly && !sameRoles(savedRoles, [...selectedRoles]);
	const retry =
		result?.profile.state === "failed" || result?.roles.state === "failed";
	const submit = (values: UpdateUserProfileRequest) => {
		if (
			save.isPending ||
			(roleChanges && (available.isLoading || available.isError))
		)
			return;
		const request: AccountEditRequest = {};
		if (JSON.stringify(values) !== JSON.stringify(savedProfile))
			request.profile = values;
		if (roleChanges) request.roles = [...selectedRoles];
		save.mutate(request, {
			onSuccess: (next) => {
				setResult(next);
				if (next.profile.state === "saved" && request.profile)
					setSavedProfile(request.profile);
				if (next.roles.state === "saved" && request.roles)
					setSavedRoles(request.roles);
				if (next.profile.state !== "failed" && next.roles.state !== "failed") {
					toast.success("Account updated successfully.");
					onClose();
				}
			},
		});
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !save.isPending) onClose();
			}}
		>
			<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Edit {user.username}</DialogTitle>
					<DialogDescription>
						Update the profile and deployment roles. These save separately;
						successful changes remain saved if another change fails.
					</DialogDescription>
				</DialogHeader>
				<fieldset
					disabled={save.isPending}
					className="m-0 min-w-0 border-0 p-0"
				>
					<EditUserForm
						embedded
						initialValues={savedProfile}
						canEditAvatar={
							user.login_type === "password" || user.login_type === "none"
						}
						isLoading={save.isPending}
						error={
							result?.profile.state === "failed"
								? result.profile.error
								: undefined
						}
						submitLabel={retry ? "Retry remaining changes" : "Save"}
						submitDisabled={
							roleChanges && (available.isLoading || available.isError)
						}
						onSubmit={submit}
						onCancel={onClose}
					>
						{result?.profile.state === "saved" && (
							<p role="status" className="m-0 text-sm text-content-success">
								Profile saved.
							</p>
						)}
						{result?.profile.state === "failed" && (
							<div>
								<p className="text-sm">Profile was not saved.</p>
								<ErrorAlert error={result.profile.error} />
							</div>
						)}
						{result?.roles.state === "saved" && (
							<p role="status" className="m-0 text-sm text-content-success">
								Roles saved.
							</p>
						)}
						{result?.roles.state === "failed" && (
							<div>
								<p className="text-sm">
									Roles were not saved. Your profile changes remain independent.
								</p>
								<ErrorAlert error={result.roles.error} />
							</div>
						)}
						{save.error ? <ErrorAlert error={save.error} /> : null}
						{rolesReadOnly ? (
							<section aria-label="Roles">
								<h3 className="text-sm">Roles</h3>
								<p className="text-sm">
									{user.roles
										.map((role) => role.display_name || role.name)
										.join(", ") || "Member"}
								</p>
								<p className="text-xs text-content-secondary">
									Roles are managed by OIDC role synchronization.
								</p>
							</section>
						) : (
							<>
								<RoleSelector
									availableRoles={available.data}
									loading={available.isLoading}
									error={available.error}
									selectedRoles={selectedRoles}
									onChange={setSelectedRoles}
								/>
								{available.isError && (
									<Button
										variant="outline"
										onClick={() => void available.refetch()}
									>
										Retry loading roles
									</Button>
								)}
							</>
						)}
					</EditUserForm>
				</fieldset>
			</DialogContent>
		</Dialog>
	);
};
