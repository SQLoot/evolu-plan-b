declare module "@evolu/common/polyfills" {
  export const installPolyfills: () => void;
}

declare module "next/dynamic" {
  const dynamic: (
    loader: () => Promise<unknown>,
    options?: {
      readonly ssr?: boolean;
    },
  ) => (props: Record<string, unknown>) => JSX.Element;

  export default dynamic;
}

declare namespace JSX {
  type Element = object;

  interface IntrinsicElements {
    div: Record<string, unknown>;
  }
}
