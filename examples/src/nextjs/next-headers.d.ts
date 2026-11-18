// `next` is not a dev dependency of this repo. Next.js documents `headers()` as an async
// function returning a read-only Web Headers object; this declares only that.
declare module 'next/headers' {
  export function headers(): Promise<Headers>;
}
