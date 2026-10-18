// The engine's runtime.ts is type-checked here because project.ts imports its
// type; it is never bundled into the server. It looks these up at run time
// (falling back to timers), so declaring them is enough.
declare function requestAnimationFrame(callback: (time: number) => void): number
declare function cancelAnimationFrame(handle: number): void
