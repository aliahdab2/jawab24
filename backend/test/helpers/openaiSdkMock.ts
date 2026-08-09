/**
 * Re-export shim — the implementation lives in
 * `src/__tests__/helpers/openaiSdkMock.ts` so suites under `src/__tests__`
 * can import it too (the backend tsconfig pins `rootDir: src`, so src files
 * cannot reach into `test/`). One implementation, two import homes.
 */
export * from '../../src/__tests__/helpers/openaiSdkMock';
