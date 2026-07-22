export interface TestCase {
  group: string;
  name: string;
  run: () => Promise<void>;
}

export interface TestResult {
  group: string;
  name: string;
  pass: boolean;
  durationMs: number;
  message?: string;
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  failures: TestResult[];
  results: TestResult[];
}

export async function runTestCase(test: TestCase): Promise<TestResult> {
  const started = performance.now();
  try {
    await test.run();
    return {
      group: test.group,
      name: test.name,
      pass: true,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      group: test.group,
      name: test.name,
      pass: false,
      durationMs: Math.round(performance.now() - started),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runTests(tests: TestCase[]): Promise<TestReport> {
  const results: TestResult[] = [];
  for (const test of tests) {
    results.push(await runTestCase(test));
  }
  const failures = results.filter((result) => !result.pass);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
    results,
  };
}
