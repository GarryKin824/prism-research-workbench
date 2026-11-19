export { pdfPageRange } from './pdf-intake/policy.mjs';
import { LIMITS } from './pdf-intake/policy.mjs';
import { EXECUTOR, hash } from './pdf-intake/protocol.mjs';
import { validateZoteroMetadata } from './zotero-import-core.mjs';

const importedPrefix = '机器生成 PDF 提取来源（未审核，非独立真实性证据）：';
const extractor = 'PDF.js 6.3.289 derived classic';
const mismatch = () => { throw Error('PDF_SOURCE_MISMATCH'); };

// A saved declaration supplies a candidate hash. The page request must also
// rehash the stored original and reproduce the exact current extracted text.
export function pdfSourceReference(paper) {
  const provenance = paper.documentAttachment?.provenance;
  const attachment = provenance?.kind === 'pdf-extraction';
  if (paper.documentAttachment && !attachment) return null;
  if (!attachment && paper.metadata?.zotero?.extraction) {
    validateZoteroMetadata(paper.metadata,paper.document);
    const {original,extraction}=paper.metadata.zotero;
    return {filename:original.filename,pdfSha256:original.pdfSha256,textSha256:extraction.textSha256,
      byteLength:original.byteLength,pages:extraction.pages,pagesRead:extraction.pagesRead,truncated:extraction.truncated,...(paper.document?.pdfText||original.byteLength>5242880||extraction.pages>50||paper.document?.text.length>16000?{version:2}:{})};
  }
  const imported = typeof paper.source === 'string' && paper.source.startsWith(importedPrefix);
  if (!attachment && !imported) return null;
  let declaration;
  if (attachment) {
    declaration = provenance;
    if (paper.documentAttachment.documentSha256 !== paper.document?.sha256 || provenance.mime !== 'application/pdf') mismatch();
  } else {
    if (paper.source.length > 1000) mismatch();
    try { declaration = JSON.parse(paper.source.slice(importedPrefix.length)); } catch { mismatch(); }
  }
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) mismatch();
  const reference = {
    filename: declaration.filename,
    pdfSha256: attachment ? declaration.pdfSha256 : declaration.pdfSHA256,
    textSha256: attachment ? declaration.textSha256 : declaration.textSHA256,
    byteLength: attachment ? declaration.byteLength : declaration.pdfBytes,
    pages: declaration.pages, pagesRead: declaration.pagesRead, truncated: declaration.truncated,
  };
  if (typeof reference.filename !== 'string' || !reference.filename.length || reference.filename.length > 255
      || /[\x00-\x1f\x7f/\\]/.test(reference.filename)
      || !hash(reference.pdfSha256) || !hash(reference.textSha256) || reference.textSha256 !== paper.document?.sha256
      || !Number.isSafeInteger(reference.byteLength) || reference.byteLength < 5 || reference.byteLength > LIMITS.maxBytes
      || !Number.isInteger(reference.pages) || reference.pages < 1 || reference.pages > LIMITS.maxPages
      || !Number.isInteger(reference.pagesRead) || reference.pagesRead < 1 || reference.pagesRead > reference.pages
      || typeof reference.truncated !== 'boolean' || reference.pagesRead < reference.pages && !reference.truncated
      || declaration.parser !== extractor || declaration.executor !== EXECUTOR
      || (attachment ? declaration.ocrPerformed : declaration.OCR) !== false) mismatch();
  if (paper.document?.pdfText) {
    if (['pages','pagesRead','truncated'].some(key=>reference[key]!==paper.document.pdfText[key])) mismatch();
    reference.version=2;
  }
  return reference;
}

export function verifyPdfSourceResult(reference, document, result) {
  if (reference.pdfSha256 !== result.pdfSha256 || reference.byteLength !== result.byteLength
      || reference.textSha256 !== result.textSha256 || document.sha256 !== result.textSha256
      || document.text !== result.text || reference.pages !== result.documentPages
      || reference.pagesRead !== result.pagesRead || reference.truncated !== result.truncated) mismatch();
}
