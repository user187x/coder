import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { MockAccountCloudDriveShare } from "#/testHelpers/cloudDriveShares";
import {
	AccountShareDragLayer,
	type AccountShareReview,
} from "./AccountShareDragLayer";
import { shareEdges } from "./shareCables";

const accounts = [
	{
		id: MockAccountCloudDriveShare.owner,
		username: MockAccountCloudDriveShare.ownerName,
	},
	{
		id: MockAccountCloudDriveShare.from,
		username: MockAccountCloudDriveShare.fromName,
	},
	{ id: "third-account", username: "eve" },
];
const edges = shareEdges(
	[MockAccountCloudDriveShare],
	new Set(accounts.map((account) => account.id)),
).edges;
const setup = (review: (value: AccountShareReview) => void) => {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			const index = accounts.findIndex(
				(account) => this.dataset.testid === `user-${account.id}`,
			);
			return index < 0
				? new DOMRect(0, 0, 800, 400)
				: new DOMRect(0, 100 + index * 60, 800, 60);
		},
	);
	const Example = () => {
		const area = useRef<HTMLDivElement>(null);
		return (
			<div ref={area}>
				<table aria-label="Accounts">
					<tbody>
						{accounts.map((account) => (
							<tr key={account.id} data-testid={`user-${account.id}`}>
								<td>{account.username}</td>
							</tr>
						))}
					</tbody>
				</table>
				<AccountShareDragLayer
					area={area}
					accounts={accounts}
					edges={edges}
					onReview={review}
					onDragging={vi.fn()}
				/>
			</div>
		);
	};
	render(<Example />);
	return userEvent.setup();
};
afterEach(() => vi.restoreAllMocks());

it("reviews the exact existing grant when its plug is pulled off a row", async () => {
	const review = vi.fn();
	const user = setup(review);
	const plug = await screen.findByRole("button", {
		name: /Drag ann's Cloud Drive/,
	});
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: plug,
			coords: { clientX: 815, clientY: 190 },
		},
		{ target: document.body, coords: { clientX: 980, clientY: 320 } },
		{
			keys: "[/MouseLeft]",
			target: document.body,
			coords: { clientX: 980, clientY: 320 },
		},
	]);
	await waitFor(() =>
		expect(review).toHaveBeenCalledExactlyOnceWith({
			shareId: MockAccountCloudDriveShare.id,
		}),
	);
});

it("preselects owner and recipient for review instead of creating a new grant", async () => {
	const review = vi.fn();
	const user = setup(review);
	const socket = await screen.findByRole("button", {
		name: "Review Cloud Drive connections for ann",
	});
	await user.pointer([
		{
			keys: "[MouseLeft>]",
			target: socket,
			coords: { clientX: 807, clientY: 130 },
		},
		{ target: document.body, coords: { clientX: 810, clientY: 250 } },
		{
			keys: "[/MouseLeft]",
			target: document.body,
			coords: { clientX: 810, clientY: 250 },
		},
	]);
	await waitFor(() =>
		expect(review).toHaveBeenCalledExactlyOnceWith({
			ownerId: MockAccountCloudDriveShare.owner,
			recipientId: accounts[2].id,
		}),
	);
});

it("cancels a held plug with Escape without reviewing or changing a connection", async () => {
	const review = vi.fn();
	const user = setup(review);
	const plug = await screen.findByRole("button", {
		name: /Drag ann's Cloud Drive/,
	});
	await user.pointer({
		keys: "[MouseLeft>]",
		target: plug,
		coords: { clientX: 815, clientY: 190 },
	});
	await user.keyboard("{Escape}");
	await user.pointer({
		keys: "[/MouseLeft]",
		target: document.body,
		coords: { clientX: 980, clientY: 320 },
	});
	expect(review).not.toHaveBeenCalled();
});

it("opens an account's connection review from the keyboard", async () => {
	const review = vi.fn();
	const user = setup(review);
	(
		await screen.findByRole("button", {
			name: "Review Cloud Drive connections for ann",
		})
	).focus();
	await user.keyboard("{Enter}");
	expect(review).toHaveBeenCalledExactlyOnceWith({
		ownerId: MockAccountCloudDriveShare.owner,
	});
});
