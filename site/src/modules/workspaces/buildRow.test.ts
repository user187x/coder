import { buildRow } from "./buildRow";

const running = ["updateAndRestart", "stop", "restart"] as const;
const stopped = ["updateAndStart", "start"] as const;
const base = {
	isRestarting: false,
	isUpdating: false,
	before: null,
	running,
	stopped,
};

describe("buildRow", () => {
	it("is nothing while no build runs", () => {
		expect(
			buildRow({ ...base, status: "running", transition: "start" }),
		).toBeNull();
	});

	it("restarting: the running buttons as they were, Restart's place the build's", () => {
		for (const status of ["running", "stopping", "starting"] as const) {
			expect(
				buildRow({
					...base,
					status,
					transition: status === "stopping" ? "stop" : "start",
					isRestarting: true,
					before: running,
				}),
			).toEqual({ actions: running, active: 2 });
		}
	});

	it("restarting without a Restart button: in Update and restart's place", () => {
		expect(
			buildRow({
				...base,
				status: "stopping",
				transition: "stop",
				isRestarting: true,
				before: ["updateAndRestart", "stop"],
			}),
		).toEqual({ actions: ["updateAndRestart", "stop"], active: 0 });
	});

	it("stopping and starting: Stop's or Start's place", () => {
		expect(
			buildRow({
				...base,
				status: "stopping",
				transition: "stop",
				before: running,
			}),
		).toEqual({ actions: running, active: 1 });
		expect(
			buildRow({
				...base,
				status: "starting",
				transition: "start",
				before: ["start"],
			}),
		).toEqual({ actions: ["start"], active: 0 });
		// Waiting for a provisioner, or being canceled: the same place.
		expect(
			buildRow({
				...base,
				status: "pending",
				transition: "start",
				before: ["retry", "debug"],
			}),
		).toEqual({ actions: ["retry", "debug"], active: 0 });
	});

	it("updating: the Update button's place", () => {
		expect(
			buildRow({
				...base,
				status: "starting",
				transition: "start",
				isUpdating: true,
				before: running,
			}),
		).toEqual({ actions: running, active: 0 });
	});

	it("a build this tab did not see start: the buttons of the state it left", () => {
		expect(
			buildRow({ ...base, status: "stopping", transition: "stop" }),
		).toEqual({ actions: running, active: 1 });
		// Start's place, not Update and start's.
		expect(
			buildRow({ ...base, status: "starting", transition: "start" }),
		).toEqual({ actions: stopped, active: 1 });
	});

	it("deleting: its own place", () => {
		expect(
			buildRow({
				...base,
				status: "deleting",
				transition: "delete",
				before: running,
			}),
		).toEqual({ actions: ["deleting"], active: 0 });
	});
});
