import React from "react";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { CapacitorREST, handleRequests, type RestRequest, type ServerInfo } from "@devioarts/capacitor-rest";
import { Button } from "../components/Button";
import { Input, Label, TextArea } from "../components/Input";
import { useLogger } from "../components/Logger";
import { localBaseUrl } from "../helpers/capacitorRestDriver";

const defaultToken = "dev-token";
type AuthMode = "none" | "bearer";

export const PageServer: React.FC = () => {
  const log = useLogger();
  const [port, setPort] = React.useState("8080");
  const [authMode, setAuthMode] = React.useState<AuthMode>("bearer");
  const [token, setToken] = React.useState(defaultToken);
  const [info, setInfo] = React.useState<ServerInfo | null>(null);
  const [requestPath, setRequestPath] = React.useState("/orders/42?expand=items");
  const [requestMethod, setRequestMethod] = React.useState("GET");
  const [requestBody, setRequestBody] = React.useState('{"sku":"REST-1","qty":3}');
  const [lastResponse, setLastResponse] = React.useState<unknown>(null);
  const requestListener = React.useRef<PluginListenerHandle | null>(null);

  React.useEffect(() => {
    let mounted = true;
    CapacitorREST.getInfo().then((nextInfo) => {
      if (mounted && nextInfo.running) {
        setInfo(nextInfo);
      }
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const startDemoServer = async () => {
    try {
      await requestListener.current?.remove().catch(() => undefined);
      requestListener.current = null;
      await CapacitorREST.stop().catch(() => undefined);
      await CapacitorREST.clearRoutes();

      const nextInfo = await CapacitorREST.start({
        host: "0.0.0.0",
        port: Number(port),
        auth: authMode === "bearer" ? { type: "bearer", token } : { type: "none" },
        cors: { enabled: true, origins: ["*"] },
        requestTimeoutMs: 5000,
        jobRetentionMs: 300000,
      });

      await CapacitorREST.registerRoute({ method: "GET", path: "/orders/:id" });
      await CapacitorREST.registerRoute({ method: "POST", path: "/orders" });
      await CapacitorREST.registerRoute({ method: "POST", path: "/imports", mode: "async" });

      requestListener.current = await handleRequests(async (request) => routeDemoRequest(request));

      setInfo(nextInfo);
      log.info("server", "started", nextInfo);
    } catch (error) {
      log.error("server", "start failed", error);
    }
  };

  const stopServer = async () => {
    await requestListener.current?.remove().catch(() => undefined);
    requestListener.current = null;
    await CapacitorREST.stop();
    setInfo(null);
    log.info("server", "stopped");
  };

  const sendRequest = async () => {
    if (!info) {
      log.warn("client", "server is not running");
      return;
    }

    try {
      const body = requestMethod === "GET" ? undefined : JSON.parse(requestBody || "null");
      const headers = {
        "content-type": "application/json",
        ...(authMode === "bearer" ? { authorization: `Bearer ${token}` } : {}),
      };
      const response = info.mock
        ? await CapacitorREST.mockRequest({
          method: requestMethod as any,
          path: requestPath,
          headers,
          body,
          bodyType: body === undefined ? "empty" : "json",
        })
        : await fetchRest(info, requestMethod, requestPath, headers, body);
      setLastResponse(response);
      log.info("client", `${requestMethod} ${requestPath}`, response);
    } catch (error) {
      log.error("client", "request failed", error);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <Label label="Port">
            <Input value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
          </Label>
          <Label label="Auth mode">
            <select
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
              value={authMode}
              onChange={(event) => setAuthMode(event.target.value as AuthMode)}
            >
              <option value="none">none</option>
              <option value="bearer">bearer</option>
            </select>
          </Label>
          {authMode === "bearer" && (
            <Label label="Bearer token">
              <Input value={token} onChange={(event) => setToken(event.target.value)} />
            </Label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="green" onClick={startDemoServer}>Start demo server</Button>
            <Button type="red" onClick={stopServer} disabled={!info?.running}>Stop</Button>
            <Button type="neutral" onClick={() => log.info("capacitor", "platform", { platform: Capacitor.getPlatform(), native: Capacitor.isNativePlatform() })}>
              Platform
            </Button>
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="font-mono text-xs uppercase text-slate-400">Server info</span>
            <span className={`rounded px-2 py-1 text-xs ${info?.running ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
              {info?.running ? "running" : "stopped"}
            </span>
          </div>
          <pre className="max-h-48 overflow-auto rounded bg-white p-2 text-xs text-slate-700">
            {JSON.stringify(info ?? { running: false }, null, 2)}
          </pre>
          {info?.running && (
            <div className="mt-3 space-y-1 text-xs text-slate-600">
              <div><span className="font-mono text-slate-400">local</span> {info.mock ? "web mock" : localBaseUrl(info)}</div>
              {info.urls.map((url) => (
                <div key={url}><span className="font-mono text-slate-400">lan</span> {url}</div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded border border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <select className="rounded border border-slate-300 bg-white px-2 py-1 text-sm" value={requestMethod} onChange={(event) => setRequestMethod(event.target.value)}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}
          </select>
          <Input value={requestPath} onChange={(event) => setRequestPath(event.target.value)} />
          <Button type="primary" onClick={sendRequest} disabled={!info?.running}>Send</Button>
        </div>
        {requestMethod !== "GET" && (
          <Label label="JSON body">
            <TextArea value={requestBody} onChange={(event) => setRequestBody(event.target.value)} rows={4} className="font-mono text-xs" />
          </Label>
        )}
        <pre className="min-h-24 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
          {JSON.stringify(lastResponse ?? { status: "idle" }, null, 2)}
        </pre>
      </section>
    </div>
  );
};

async function routeDemoRequest(request: RestRequest) {
  if (request.method === "GET" && request.route === "/orders/:id") {
    return {
      status: 200,
      bodyType: "json" as const,
      body: {
        id: request.params.id,
        status: "ready",
        query: request.query,
      },
    };
  }

  if (request.method === "POST" && request.route === "/orders") {
    return {
      status: 201,
      bodyType: "json" as const,
      body: {
        created: true,
        body: request.body,
      },
    };
  }

  if (request.method === "POST" && request.route === "/imports") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      status: 201,
      bodyType: "json" as const,
      body: {
        imported: true,
        jobId: request.jobId,
      },
    };
  }

  return {
    status: 404,
    bodyType: "json" as const,
    body: { error: "Resource not found" },
  };
}

async function fetchRest(info: ServerInfo, method: string, path: string, headers: Record<string, string>, body: unknown) {
  const response = await fetch(`${localBaseUrl(info)}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const bodyType = response.status === 204
    ? "empty"
    : response.headers.get("content-type")?.includes("application/json")
      ? "json"
      : "text";
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    bodyType,
    body: bodyType === "empty" ? undefined : bodyType === "json" ? await response.json() : await response.text(),
  };
}
