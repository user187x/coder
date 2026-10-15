import { cn } from "cn";
import { EyeIcon, EyeOffIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { useQuery } from "react-query";
import { toast } from "sonner";
import type { ChatPeer, ChatPerson } from "#/api/platform";
import { chatPeople } from "#/api/queries/platform";
import { ChatAvatar } from "./ChatAvatar";
import { displayName, setInvisible, useChatSnapshot } from "./chatStore";

/** "online", "active 5 min ago", "active 3 h ago". */
export const presenceText = (
	person: Pick<ChatPerson, "online" | "lastSeen">,
) => {
	if (person.online) {
		return "online";
	}
	const at = person.lastSeen ? Date.parse(person.lastSeen) : Number.NaN;
	if (Number.isNaN(at)) {
		return "active today";
	}
	const minutes = Math.max(1, Math.round((Date.now() - at) / 60_000));
	return minutes < 60
		? `active ${minutes} min ago`
		: `active ${Math.round(minutes / 60)} h ago`;
};

/** A person's avatar with their presence: a green dot online, a grey one otherwise. */
export const PresenceAvatar: React.FC<{
	person: Pick<ChatPerson, "username" | "name" | "online">;
}> = ({ person }) => (
	<span className="relative shrink-0">
		<ChatAvatar peer={person} />
		<span
			aria-hidden
			className={cn(
				"absolute -right-px -bottom-px size-[9px] rounded-full border-2 border-solid border-surface-primary",
				person.online ? "bg-content-success" : "bg-content-disabled",
			)}
		/>
	</span>
);

/** The switch every user has: invisible to everyone but admins in the People list. */
export const InvisibleSwitch: React.FC = () => {
	const { me } = useChatSnapshot();
	if (!me) {
		return null;
	}
	const invisible = Boolean(me.invisible);
	const label = invisible
		? "Invisible: others don't see you in People (admins still do). Click to be visible."
		: "Visible: others see you in People. Click to be invisible (admins still see you).";
	return (
		<button
			type="button"
			role="switch"
			aria-checked={!invisible}
			aria-label={label}
			title={label}
			data-testid="chat-invisible-switch"
			onClick={() =>
				setInvisible(!invisible).catch(() =>
					toast.error("Your visibility could not be changed."),
				)
			}
			className={cn(
				"inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-solid px-2 text-[11px] font-semibold",
				invisible
					? "border-border bg-surface-tertiary text-content-secondary"
					: "border-content-success/40 bg-content-success/10 text-content-success",
			)}
		>
			{invisible ? (
				<EyeOffIcon className="size-3" />
			) : (
				<EyeIcon className="size-3" />
			)}
			{invisible ? "Invisible" : "Visible"}
		</button>
	);
};

type ChatPeopleProps = {
	/** Opens the conversation with this person. */
	onOpen: (peer: ChatPeer) => void;
	/** Leave the admins out (the developers' panel lists them on their own). */
	withoutAdmins?: boolean;
	className?: string;
};

/**
 * Peer-to-peer chat's People list: everyone online now (a tab open) or seen
 * today, online first, with a search once there are more than a few, and the
 * user's own visible / invisible switch. Admins see the invisible too
 * (marked). Choosing someone opens the conversation.
 */
export const ChatPeople: React.FC<ChatPeopleProps> = ({
	onOpen,
	withoutAdmins = false,
	className,
}) => {
	const state = useChatSnapshot();
	const [search, setSearch] = useState("");
	const peopleQuery = useQuery({
		...chatPeople(state.availVersion),
		enabled: Boolean(state.me && (state.peers || state.me.admin)),
	});
	const people = (peopleQuery.data?.people ?? []).filter(
		(p) => !withoutAdmins || !p.admin,
	);
	const needle = search.trim().toLowerCase();
	const shown = needle
		? people.filter(
				(p) =>
					p.username.toLowerCase().includes(needle) ||
					p.name.toLowerCase().includes(needle),
			)
		: people;
	const online = people.filter((p) => p.online).length;

	return (
		<section
			aria-label="People"
			className={cn("flex flex-col", className)}
			data-testid="chat-people"
		>
			<div className="flex items-center gap-2 px-2 pt-2 pb-1">
				<span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-content-secondary">
					People{" "}
					<span className="normal-case tracking-normal">· {online} online</span>
				</span>
				<InvisibleSwitch />
			</div>
			{people.length > 6 && (
				<label className="mx-2 mb-1 flex items-center gap-1.5 rounded-md border border-solid border-border px-2 py-1">
					<SearchIcon className="size-3.5 text-content-secondary" />
					<input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Find someone"
						aria-label="Find someone"
						className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-content-primary outline-none"
					/>
				</label>
			)}
			{peopleQuery.isLoading && (
				<p className="m-2 text-[13px] text-content-secondary">Loading…</p>
			)}
			{!peopleQuery.isLoading && shown.length === 0 && (
				<p className="m-2 text-[13px] text-content-secondary">
					{needle ? "No one by that name." : "No one else is around right now."}
				</p>
			)}
			{shown.map((person) => (
				<button
					key={person.id}
					type="button"
					disabled={person.chatOff}
					title={
						person.chatOff
							? `${displayName(person)} has turned chat off`
							: `Chat with ${displayName(person)}`
					}
					data-testid="chat-person"
					data-online={person.online ? "" : undefined}
					onClick={() => onOpen(person)}
					className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent p-2 text-left text-inherit hover:bg-surface-secondary focus-visible:bg-surface-secondary focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
				>
					<PresenceAvatar person={person} />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate font-semibold">
							{displayName(person)}
						</span>
						<span className="truncate text-xs text-content-secondary">
							@{person.username} · {presenceText(person)}
							{person.admin ? " · admin" : ""}
							{person.chatOff ? " · chat off" : ""}
							{person.invisible ? " · invisible" : ""}
						</span>
					</span>
				</button>
			))}
		</section>
	);
};
