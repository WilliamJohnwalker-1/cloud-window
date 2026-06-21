/* eslint-env node */

/**
 * fs stub for exceljs in React Native.
 * exceljs requires 'fs' for file I/O, but we only use writeBuffer()
 * which operates in-memory. This stub provides empty implementations
 * to satisfy the module resolution without crashing.
 */

module.exports = {
  readFileSync: () => { throw new Error('fs.readFileSync is not available in React Native'); },
  writeFileSync: () => { throw new Error('fs.writeFileSync is not available in React Native'); },
  existsSync: () => false,
  createReadStream: () => { throw new Error('fs.createReadStream is not available in React Native'); },
  createWriteStream: () => { throw new Error('fs.createWriteStream is not available in React Native'); },
  statSync: () => { throw new Error('fs.statSync is not available in React Native'); },
  openSync: () => { throw new Error('fs.openSync is not available in React Native'); },
  closeSync: () => {},
  open: () => { throw new Error('fs.open is not available in React Native'); },
  close: () => {},
  readFile: () => { throw new Error('fs.readFile is not available in React Native'); },
  writeFile: () => { throw new Error('fs.writeFile is not available in React Native'); },
  promises: {},
};
