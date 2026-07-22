// Main-process error guardian that forwards uncaught failures to renderer diagnostics.
import { BrowserWindow } from 'electron';

function sendToAllWindows(payload: {
  message: string;
  stack: string | undefined;
  type: 'exception' | 'rejection';
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send('electronError', payload); } catch { /* ignore */ }
    }
  }
}

// Exclusive — a second call (e.g. from a plugin) throws ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET,
// which this same handler then catches.
process.setUncaughtExceptionCaptureCallback((err) => {
  console.error('[process-guardian] uncaughtException:', err);
  try {
    sendToAllWindows({ message: err.message, stack: err.stack, type: 'exception' });
  } catch { /* ignore */ }
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[process-guardian] unhandledRejection:', err);
  try {
    sendToAllWindows({ message: err.message, stack: err.stack, type: 'rejection' });
  } catch { /* ignore */ }
});
