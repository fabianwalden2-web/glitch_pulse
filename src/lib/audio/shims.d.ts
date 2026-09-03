// Vite asset-URL imports (e.g. `import url from './x.js?url'`).
declare module '*?url' {
  const url: string;
  export default url;
}

declare module '*?worker' {
  const workerCtor: {
    new (): Worker;
  };
  export default workerCtor;
}
