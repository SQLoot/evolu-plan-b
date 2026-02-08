"use client";

import type { Evolu } from "@evolu/common/local-first";
import type { ReactNode } from "react";
import { EvoluContext } from "./local-first/EvoluContext.js";

export const EvoluProvider = ({
  children,
  value,
}: {
  readonly children?: ReactNode | undefined;
  readonly value: Evolu<any>;
}): React.ReactElement => (
  <EvoluContext.Provider value={value}>{children}</EvoluContext.Provider>
);
