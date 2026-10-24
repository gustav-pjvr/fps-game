/** Vite's `?raw` suffix imports a file's text (used by tests that read library source). */
declare module '*?raw' {
  const source: string;
  export default source;
}
