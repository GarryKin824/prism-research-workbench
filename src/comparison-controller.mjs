import * as comparisonCore from './comparison-core.mjs';
import { createAnnotationController } from './annotation-controller.mjs';

export function createComparisonController({ store, storage, crypto = globalThis.crypto, withLock }) {
  const { prepare, ...controller } = createAnnotationController({ store, storage, crypto, withLock }, {
    code: 'COMPARISON', keySuffix: ':paper-comparison-v1', lockSuffix: ':comparison-write',
    create: comparisonCore.createComparison, load: comparisonCore.loadComparison,
    view: comparisonCore.comparisonView, pack: comparisonCore.exportComparison,
    confirm: comparisonCore.confirmRevision, exportCSV: comparisonCore.exportCSV,
  });
  return { ...controller, prepare: (paperId, fields, expectedSource) =>
    prepare(paperId, expectedSource, { fields }, comparisonCore.prepareRevision) };
}
