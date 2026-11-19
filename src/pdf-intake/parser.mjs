import { AnnotationMode, getDocument, PDFWorker } from './vendor/pdf.mjs';
import workerSource from './vendor/worker-classic-source.mjs';
import assets from './vendor/binary-assets.mjs';
import { checkBytes, extractText, PAGE_IMAGE_LIMITS, pdfExcerptLocation } from './policy.mjs';
import { digest } from './protocol.mjs';

class LocalBinaryDataFactory {
  async fetch({ kind, filename }) {
    if (!['cMapUrl', 'standardFontDataUrl'].includes(kind) || !Object.hasOwn(assets[kind], filename)) {
      throw Error('PDF_LOCAL_RESOURCE_UNAVAILABLE');
    }
    return Uint8Array.from(atob(assets[kind][filename]), character => character.charCodeAt(0));
  }
}

async function renderPage(pdf, number, race) {
  const page = await race(pdf.getPage(number));
  let canvas, task, rendered = false;
  try {
    const original = page.getViewport({ scale: 1 });
    if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width <= 0 || original.height <= 0) {
      throw Error('PDF_PAGE_RENDER_FAILED');
    }
    const scale = Math.min(2, PAGE_IMAGE_LIMITS.width / original.width, PAGE_IMAGE_LIMITS.height / original.height);
    const viewport = page.getViewport({ scale });
    canvas = document.createElement('canvas');
    const width = canvas.width = Math.min(PAGE_IMAGE_LIMITS.width, Math.ceil(viewport.width));
    const height = canvas.height = Math.min(PAGE_IMAGE_LIMITS.height, Math.ceil(viewport.height));
    const canvasContext = canvas.getContext('2d');
    if (width < 1 || height < 1 || !canvasContext) throw Error('PDF_PAGE_RENDER_FAILED');
    // Static rendering runs without animation frames, which are paused in the hidden isolation frame.
    task = page.render({ canvas, canvasContext, viewport, intent: 'print',
      annotationMode: AnnotationMode.DISABLE, background: '#ffffff' });
    await race(task.promise);
    rendered = true;
    const blob = await race(new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    if (blob?.type !== 'image/png' || !blob.size || blob.size > PAGE_IMAGE_LIMITS.bytes) throw Error('PDF_PAGE_RENDER_FAILED');
    return { number, width, height, blob };
  } finally {
    if (!rendered) task?.cancel();
    page.cleanup();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

export async function parseBytes(bytes, { deadline, signal, onEvent = () => {}, onProgress, inspection = null }) {
  if (typeof Worker !== 'function') throw Error('REAL_WORKER_REQUIRED');
  checkBytes(bytes);
  let worker, url, bridge, loading, timer, rejectStop, settled = false, stopCode = null, terminated = false;
  const stop = new Promise((_, reject) => { rejectStop = reject; });
  stop.catch(() => {});
  const race = promise => Promise.race([promise, stop]);
  const terminate = () => {
    if (worker && !terminated) {
      terminated = true;
      worker.terminate();
      onEvent('worker-terminate-called');
    }
  };
  const halt = code => {
    if (settled || stopCode) return;
    stopCode = code;
    terminate();
    rejectStop(Error(code));
  };
  const abort = () => halt('PDF_CANCELLED');
  signal.addEventListener('abort', abort, { once: true });
  try {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('PDF_TIMEOUT');
    timer = setTimeout(() => halt('PDF_TIMEOUT'), remaining);
    if (signal.aborted) throw Error('PDF_CANCELLED');
    url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    worker = new Worker(url, { type: 'classic', name: 'prism-pdf-intake' });
    onEvent('worker-created');
    worker.onerror = () => halt('PDF_WORKER_FAILED');
    worker.onmessageerror = () => halt('PDF_WORKER_FAILED');
    await race(new Promise(resolve => worker.addEventListener('message', event => {
      if (event.data?.type === 'PRISM_PDF_WORKER_READY') {
        onEvent('worker-ready');
        resolve();
      }
    })));
    if (stopCode || signal.aborted) throw Error(stopCode || 'PDF_CANCELLED');
    bridge = PDFWorker.create({ port: worker });
    loading = getDocument({
      data: bytes, worker: bridge, BinaryDataFactory: LocalBinaryDataFactory, cMapPacked: true,
      useWorkerFetch: false, useWasm: false, enableXfa: false, stopAtErrors: true, isEvalSupported: false,
      disableFontFace: true, disableAutoFetch: true, disableStream: true,
    });
    loading.onPassword = () => halt('PDF_PASSWORD_REQUIRED');
    const pdf = await race(loading.promise);
    const result = await extractText(pdf, { signal, race, onProgress, includePageSpans: true, legacy: inspection !== null && inspection.version !== 2 });
    if (inspection) {
      const textHash = await race(digest(new TextEncoder().encode(result.text)));
      if (textHash !== inspection.textSha256) throw Error('PDF_SOURCE_MISMATCH');
    }
    if (inspection && !inspection.mapOnly) {
      const { pages } = pdfExcerptLocation(result, inspection.start, inspection.end);
      const target = inspection.page ?? pages[0];
      if (!pages.includes(target)) throw Error('PDF_SOURCE_PAGE_MISSING');
      try {
        result.pageImage = await renderPage(pdf, target, race);
      } catch {
        throw Error(stopCode || 'PDF_PAGE_RENDER_FAILED');
      }
    }
    if (stopCode || Date.now() >= deadline) throw Error(stopCode || 'PDF_TIMEOUT');
    return result;
  } finally {
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    try { if (loading) await Promise.race([loading.destroy(), new Promise(resolve => setTimeout(resolve, 300))]); } catch {}
    try { bridge?.destroy(); } catch {}
    terminate();
    if (url) {
      URL.revokeObjectURL(url);
      onEvent('blob-url-revoked');
    }
    onEvent('cleanup-finished');
  }
}
