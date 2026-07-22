import React from "react";
import { Button } from "../components/Button";
import { useLogger } from "../components/Logger";
import { CapacitorRestDriver } from "../helpers/capacitorRestDriver";
import { buildRestContractTests } from "../tests/restContract";
import { runTests, type TestReport } from "../tests/testRunner";

export const PageTests: React.FC = () => {
  const log = useLogger();
  const [running, setRunning] = React.useState(false);
  const [report, setReport] = React.useState<TestReport | null>(null);

  const runContract = async () => {
    setRunning(true);
    setReport(null);
    try {
      const tests = buildRestContractTests(() => new CapacitorRestDriver());
      const nextReport = await runTests(tests);
      setReport(nextReport);
      log.info("tests", "contract suite finished", nextReport);
    } catch (error) {
      log.error("tests", "contract suite crashed", error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="primary" onClick={runContract} disabled={running}>
          {running ? "Running..." : "Run contract suite"}
        </Button>
        {report && (
          <span className={`rounded px-2 py-1 text-sm ${report.failed === 0 ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {report.passed}/{report.total} passed
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded border border-slate-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2">Test</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {(report?.results ?? []).map((result) => (
              <tr key={`${result.group}-${result.name}`} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{result.group}</td>
                <td className="px-3 py-2">
                  <div>{result.name}</div>
                  {result.message && <div className="mt-1 font-mono text-xs text-rose-600">{result.message}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-1 text-xs ${result.pass ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                    {result.pass ? "pass" : "fail"}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{result.durationMs}ms</td>
              </tr>
            ))}
            {!report && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-slate-400" colSpan={4}>
                  No test run yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
