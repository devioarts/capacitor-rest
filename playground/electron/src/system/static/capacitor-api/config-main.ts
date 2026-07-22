// Main-process provider for renderer-side switches that choose native vs web Capacitor implementations.
import { loadConfig, trustedIpcOn } from '../../shared/functions';

type BuiltinCapacitorConfig = {
  preferences: boolean;
};

function getBuiltinCapacitorConfig(): BuiltinCapacitorConfig {
  const { cfg } = loadConfig();

  return {
    preferences: cfg.capacitorPlugins?.preferences !== false,
  };
}

trustedIpcOn('CapElectron-getBuiltinCapacitorConfig', (event) => {
  event.returnValue = getBuiltinCapacitorConfig();
});
