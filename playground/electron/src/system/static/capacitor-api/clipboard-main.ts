// Electron implementation of @capacitor/clipboard
import { clipboard, nativeImage } from 'electron';
import { registerPlugin, type AnyRecord } from '../../shared/functions';

/**
 * Capacitor Clipboard maps cleanly to Electron's native clipboard module.
 *
 * Electron can store richer payloads than the web Clipboard API in some cases,
 * but this bridge intentionally sticks to Capacitor's small API surface:
 * text/url strings plus image data URLs.
 */
class Clipboard {
  async write(opts: AnyRecord): Promise<void> {
    const image = typeof opts['image'] === 'string' ? opts['image'] : undefined;
    const url = typeof opts['url'] === 'string' ? opts['url'] : undefined;
    const str = typeof opts['string'] === 'string' ? opts['string'] : undefined;

    if (image) {
      const img = nativeImage.createFromDataURL(image);
      if (img.isEmpty()) throw new Error('Clipboard image must be a valid data URL');
      clipboard.write({ image: img });
      return;
    }

    clipboard.writeText(url ?? str ?? '');
  }

  async read(): Promise<{ value: string; type: string }> {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      return { value: image.toDataURL(), type: 'image/png' };
    }

    return { value: clipboard.readText(), type: 'text/plain' };
  }
}

registerPlugin('Clipboard', new Clipboard() as unknown as AnyRecord, ['write', 'read']);
