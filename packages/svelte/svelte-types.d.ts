declare function $state<T>(initialValue: T): T;
// biome-ignore lint/suspicious/noConfusingVoidType: void is required by Svelte types
declare function $effect(fn: () => void | (() => void)): void;
