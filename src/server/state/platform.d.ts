declare module '@mergefoo/platform-store' {
  export function durableObjectStore():Promise<import('./types').StateStore>;
}
