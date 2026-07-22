import React, { useState } from "react";
import { Button } from "../components/Button.tsx";
import { Input, TextArea, Label } from "../components/Input.tsx";
import { useLogger } from "../components/Logger.tsx";
import { Capacitor } from "@capacitor/core";

const Section: React.FC<{ dot: string; title: string; children: React.ReactNode }> = ({ dot, title, children }) => (
  <section>
    <div className="flex items-center gap-2 mb-4">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-slate-400 flex-shrink-0">{title}</span>
      <div className="flex-1 border-t border-dashed border-slate-200" />
    </div>
    {children}
  </section>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-4">
    <span className="text-[10px] font-mono text-slate-400 w-20 flex-shrink-0 pt-2">{label}</span>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

const Divider = () => <div className="border-t border-slate-100" />;

const Badge: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = "bg-slate-100 text-slate-600" }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono ${color}`}>{children}</span>
);

const KV: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="font-mono text-slate-400 w-28 flex-shrink-0">{k}</span>
    <span className="font-mono text-slate-700 truncate">{v}</span>
  </div>
);

export const PageShowcase: React.FC = () => {
  const log = useLogger();

  const [textVal, setTextVal] = useState("");
  const [emailVal, setEmailVal] = useState("");
  const [numberVal, setNumberVal] = useState("");
  const [taVal, setTaVal] = useState("");
  const [jsonVal, setJsonVal] = useState('{\n  "key": "value"\n}');
  const [callResult, setCallResult] = useState<string | null>(null);

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Buttons ───────────────────────────────── */}
      <Section dot="bg-indigo-400" title="Buttons — variants">
        <div className="space-y-3">
          <Row label="default">
            <Button type="primary"  onClick={() => log.info("btn", "primary")}>primary</Button>
            <Button type="green"    onClick={() => log.info("btn", "green")}>green</Button>
            <Button type="red"      onClick={() => log.info("btn", "red")}>red</Button>
            <Button type="neutral"  onClick={() => log.info("btn", "neutral")}>neutral</Button>
            <Button type="yellow"   onClick={() => log.info("btn", "yellow")}>yellow</Button>
          </Row>
          <Row label="disabled">
            <Button type="primary"  disabled>primary</Button>
            <Button type="green"    disabled>green</Button>
            <Button type="red"      disabled>red</Button>
            <Button type="neutral"  disabled>neutral</Button>
            <Button type="yellow"   disabled>yellow</Button>
          </Row>
          <Row label="long label">
            <Button type="primary"  onClick={() => log.info("btn", "long label clicked")}>getLongMethodNameResult</Button>
            <Button type="neutral"  onClick={() => log.info("btn", "another long")}>requestPermissionsAsync</Button>
          </Row>
        </div>
      </Section>

      <Divider />

      {/* ── Badges ───────────────────────────────── */}
      <Section dot="bg-violet-400" title="Status badges">
        <div className="flex flex-wrap gap-2">
          <Badge color="bg-emerald-100 text-emerald-700">success</Badge>
          <Badge color="bg-rose-100 text-rose-700">error</Badge>
          <Badge color="bg-amber-100 text-amber-700">warning</Badge>
          <Badge color="bg-indigo-100 text-indigo-700">info</Badge>
          <Badge color="bg-slate-100 text-slate-600">neutral</Badge>
          <Badge color="bg-sky-100 text-sky-700">pending</Badge>
        </div>
      </Section>

      <Divider />

      {/* ── Inputs ───────────────────────────────── */}
      <Section dot="bg-emerald-400" title="Form inputs">
        <div className="grid grid-cols-1 gap-3 max-w-sm">
          <Label label="Text input">
            <Input
              type="text"
              value={textVal}
              onChange={(e) => setTextVal(e.target.value)}
              placeholder="Enter text…"
            />
          </Label>
          <Label label="Email">
            <Input
              type="email"
              value={emailVal}
              onChange={(e) => setEmailVal(e.target.value)}
              placeholder="user@example.com"
            />
          </Label>
          <Label label="Number">
            <Input
              type="number"
              value={numberVal}
              onChange={(e) => setNumberVal(e.target.value)}
              placeholder="0"
            />
          </Label>
          <Label label="Disabled input">
            <Input disabled value="read-only value" />
          </Label>
          <Label label="TextArea">
            <TextArea
              value={taVal}
              onChange={(e) => setTaVal(e.target.value)}
              placeholder="Multi-line content…"
              rows={3}
            />
          </Label>
          <Label label="JSON payload">
            <TextArea
              value={jsonVal}
              onChange={(e) => setJsonVal(e.target.value)}
              rows={5}
              className="font-mono text-xs"
            />
          </Label>
          <Button
            type="neutral"
            onClick={() => log.info("form", "snapshot", { text: textVal, email: emailVal, number: numberVal, textarea: taVal })}
          >
            Log form values →
          </Button>
        </div>
      </Section>

      <Divider />

      {/* ── Method call simulation ────────────────── */}
      <Section dot="bg-sky-400" title="Plugin method call">
        <div className="space-y-3 max-w-sm">
          <Label label="Options (JSON)">
            <TextArea
              value={jsonVal}
              onChange={(e) => setJsonVal(e.target.value)}
              rows={4}
              className="font-mono text-xs"
            />
          </Label>
          <div className="flex gap-2">
            <Button
              type="primary"
              onClick={() => {
                try {
                  const parsed = JSON.parse(jsonVal);
                  log.info("plugin", "callMethod()", parsed);
                  setCallResult("OK");
                } catch {
                  log.error("plugin", "Invalid JSON", jsonVal);
                  setCallResult("Error: invalid JSON");
                }
              }}
            >
              callMethod()
            </Button>
            <Button type="neutral" onClick={() => { setCallResult(null); log.info("plugin", "reset"); }}>
              Reset
            </Button>
          </div>
          {callResult && (
            <div className={`text-xs font-mono px-3 py-2 rounded border ${
              callResult.startsWith("Error")
                ? "bg-rose-50 border-rose-200 text-rose-700"
                : "bg-emerald-50 border-emerald-200 text-emerald-700"
            }`}>
              Result: {callResult}
            </div>
          )}
        </div>
      </Section>

      <Divider />

      {/* ── Logger levels ─────────────────────────── */}
      <Section dot="bg-amber-400" title="Logger — levels">
        <div className="space-y-3">
          <Row label="info">
            <Button type="primary" onClick={() => log.info("showcase", "Simple info message")}>
              plain
            </Button>
            <Button type="primary" onClick={() => log.info("showcase", "Info with object", { id: 42, name: "test", active: true })}>
              with object
            </Button>
            <Button type="primary" onClick={() => log.info("showcase", "Info with array", [1, 2, 3, "four"])}>
              with array
            </Button>
          </Row>
          <Row label="warn">
            <Button type="yellow" onClick={() => log.warn("showcase", "Simple warning")}>
              plain
            </Button>
            <Button type="yellow" onClick={() => log.warn("showcase", "Warn with data", { code: 429, retry: true })}>
              with data
            </Button>
          </Row>
          <Row label="error">
            <Button type="red" onClick={() => log.error("showcase", "Simple error")}>
              plain
            </Button>
            <Button type="red" onClick={() => log.error("showcase", "Error with details", { code: 500, message: "Internal error", stack: "Error at line 42" })}>
              with details
            </Button>
          </Row>
        </div>
      </Section>

      <Divider />

      {/* ── Capacitor info ───────────────────────── */}
      <Section dot="bg-rose-400" title="Capacitor — runtime info">
        <div className="space-y-2 mb-3">
          <KV k="platform" v={Capacitor.getPlatform()} />
          <KV k="isNative" v={String(Capacitor.isNativePlatform())} />
          <KV k="userAgent" v={navigator.userAgent.slice(0, 60) + "…"} />
          <KV k="language" v={navigator.language} />
          <KV k="online" v={String(navigator.onLine)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="primary" onClick={() => log.info("capacitor", "getPlatform()", { platform: Capacitor.getPlatform() })}>
            getPlatform()
          </Button>
          <Button type="neutral" onClick={() => log.info("capacitor", "isNativePlatform()", { native: Capacitor.isNativePlatform() })}>
            isNativePlatform()
          </Button>
          <Button type="neutral" onClick={() => log.info("navigator", "info", { language: navigator.language, online: navigator.onLine, platform: navigator.platform })}>
            navigator info
          </Button>
        </div>
      </Section>

      <Divider />

      {/* ── Data types ───────────────────────────── */}
      <Section dot="bg-teal-400" title="Logger — data types">
        <div className="flex flex-wrap gap-2">
          <Button type="neutral" onClick={() => log.info("types", "string", "hello world")}>string</Button>
          <Button type="neutral" onClick={() => log.info("types", "number", 3.14159)}>number</Button>
          <Button type="neutral" onClick={() => log.info("types", "boolean", true)}>boolean</Button>
          <Button type="neutral" onClick={() => log.info("types", "null", null)}>null</Button>
          <Button type="neutral" onClick={() => log.info("types", "undefined", undefined)}>undefined</Button>
          <Button type="neutral" onClick={() => log.info("types", "array", [1, "two", true, null, { nested: true }])}>array</Button>
          <Button type="neutral" onClick={() => log.info("types", "nested object", { a: { b: { c: { d: "deep" } } } })}>nested obj</Button>
          <Button type="neutral" onClick={() => log.info("types", "Uint8Array", new Uint8Array([0, 1, 2, 255]))}>Uint8Array</Button>
          <Button type="neutral" onClick={() => {
            const data = Array.from({ length: 20 }, (_, i) => ({ id: i, value: Math.random() }));
            log.info("types", "large array", data);
          }}>large array</Button>
        </div>
      </Section>

      <Divider />

      {/* ── Stress test ──────────────────────────── */}
      <Section dot="bg-orange-400" title="Logger — stress">
        <div className="flex flex-wrap gap-2">
          <Button
            type="yellow"
            onClick={() => {
              for (let i = 0; i < 10; i++) {
                log.info("stress", `Burst message ${i + 1}/10`, { i, ts: Date.now() });
              }
            }}
          >
            burst ×10
          </Button>
          <Button
            type="yellow"
            onClick={() => {
              for (let i = 0; i < 50; i++) {
                const level = i % 3 === 0 ? "error" : i % 3 === 1 ? "warn" : "info";
                log[level]("stress", `Mixed message ${i + 1}/50`, { i });
              }
            }}
          >
            mixed ×50
          </Button>
          <Button
            type="red"
            onClick={() => {
              for (let i = 0; i < 5; i++) {
                log.error("stress", `Error burst ${i + 1}/5`, new Error(`Demo error ${i}`));
              }
            }}
          >
            errors ×5
          </Button>
        </div>
      </Section>

    </div>
  );
};
