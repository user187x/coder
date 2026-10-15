import { servicePort } from "./AgentAppPanel";

describe("servicePort", () => {
	it("is the health check's: the service itself, not a proxy in front of it", () => {
		expect(
			servicePort({
				url: "http://localhost:8081",
				healthcheck: {
					url: "http://localhost:8080/nifi-api/flow/about",
					interval: 5,
					threshold: 60,
				},
			}),
		).toEqual({ protocol: "HTTP", port: 8080 });
	});

	it("is the URL's without a health check; the protocol's own port when none is given", () => {
		expect(servicePort({ url: "https://localhost/app/" })).toEqual({
			protocol: "HTTPS",
			port: 443,
		});
		expect(
			servicePort({ url: "http://localhost:8090/@a/b.main/apps/airflow/" }),
		).toEqual({
			protocol: "HTTP",
			port: 8090,
		});
	});

	it("is nothing for an app without an address, or another kind", () => {
		expect(servicePort({})).toBeNull();
		expect(servicePort({ url: "vscode://open" })).toBeNull();
		expect(servicePort({ url: "not a url" })).toBeNull();
	});
});
