import * as dictionaryCore from './dictionary-core.mjs';
import { createAnnotationController } from './annotation-controller.mjs';

export function createDictionaryController({ store, storage, crypto = globalThis.crypto, withLock }) {
  const { prepare, ...controller } = createAnnotationController({ store, storage, crypto, withLock }, {
    code: 'DICTIONARY', keySuffix: ':variable-dictionary-v1', lockSuffix: ':dictionary-write',
    create: dictionaryCore.createDictionary, load: dictionaryCore.loadDictionary,
    view: dictionaryCore.dictionaryView, pack: dictionaryCore.exportDictionary,
    confirm: dictionaryCore.confirmRevision, exportCSV: dictionaryCore.exportCSV,
  });
  return { ...controller,
    prepare: ({ entryId = null, paperId, label, fields, expectedSource }) =>
      prepare(paperId, expectedSource, { entryId, label, fields }, dictionaryCore.prepareRevision),
    prepareArchive: ({ entryId, paperId, archived, expectedSource }) =>
      prepare(paperId, expectedSource, { entryId, archived }, dictionaryCore.prepareArchive),
  };
}
