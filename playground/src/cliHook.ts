import { CapacitorRestDriver } from "./helpers/capacitorRestDriver";
import { buildRestContractTests } from "./tests/restContract";
import { runTests } from "./tests/testRunner";

declare global {
  interface Window {
    __capRestSuite?: {
      runAll: () => Promise<unknown>;
    };
  }
}

window.__capRestSuite = {
  runAll: async () => runTests(buildRestContractTests(() => new CapacitorRestDriver())),
};
