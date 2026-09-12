declare const process: any;
declare const Buffer: any;
declare type Buffer = any;
declare const __dirname: string;
declare const __filename: string;

declare namespace NodeJS {
  interface ProcessEnv { [key: string]: string | undefined; }
  type Signals = string;
  type Timeout = ReturnType<typeof setTimeout>;
}

declare module 'node:fs/promises' {
  const fs: any;
  export default fs;
  export const access: any;
  export const mkdir: any;
  export const readFile: any;
  export const writeFile: any;
  export const rm: any;
  export const rename: any;
  export const copyFile: any;
  export const readdir: any;
  export const stat: any;
  export const lstat: any;
}

declare module 'node:fs' {
  const fs: any;
  export default fs;
}

declare module 'node:path' {
  const path: any;
  export default path;
}

declare module 'node:crypto' {
  export const randomUUID: any;
  export const createHash: any;
}

declare module 'node:child_process' {
  export const spawn: any;
  export const execFile: any;
}

declare module 'node:util' {
  export const promisify: any;
}

declare module 'node:readline' {
  const readline: any;
  export default readline;
}

declare module 'node:net' {
  const net: any;
  export default net;
}

declare module 'node:zlib' {
  export const deflateSync: any;
}
