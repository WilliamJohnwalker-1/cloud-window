/* eslint-env node */

/**
 * zlib stub for exceljs in React Native.
 * exceljs uses zlib for compression (xlsx is a zip format), but jszip
 * handles the actual zip operations. This stub provides pako-based
 * implementations for the zlib API that exceljs may reference.
 */

const pako = require('pako');

function notAvailable(method) {
  return function () {
    throw new Error(`zlib.${method} is not available in React Native`);
  };
}

module.exports = {
  deflate: pako.deflate,
  deflateSync: pako.deflate,
  inflate: pako.inflate,
  inflateSync: pako.inflate,
  deflateRaw: pako.deflateRaw,
  deflateRawSync: pako.deflateRaw,
  inflateRaw: pako.inflateRaw,
  inflateRawSync: pako.inflateRaw,
  gzip: notAvailable('gzip'),
  gunzip: notAvailable('gunzip'),
  createDeflate: notAvailable('createDeflate'),
  createDeflateRaw: notAvailable('createDeflateRaw'),
  createGunzip: notAvailable('createGunzip'),
  createGzip: notAvailable('createGzip'),
  createInflate: notAvailable('createInflate'),
  createInflateRaw: notAvailable('createInflateRaw'),
  createUnzip: notAvailable('createUnzip'),
  createZip: notAvailable('createZip'),
  unzip: notAvailable('unzip'),
  constants: {
    Z_NO_FLUSH: 0,
    Z_PARTIAL_FLUSH: 1,
    Z_SYNC_FLUSH: 2,
    Z_FULL_FLUSH: 3,
    Z_FINISH: 4,
    Z_BLOCK: 5,
    Z_TREES: 6,
    Z_OK: 0,
    Z_STREAM_END: 1,
    Z_NEED_DICT: 2,
    Z_ERRNO: -1,
    Z_STREAM_ERROR: -2,
    Z_DATA_ERROR: -3,
    Z_BUF_ERROR: -5,
  },
};
