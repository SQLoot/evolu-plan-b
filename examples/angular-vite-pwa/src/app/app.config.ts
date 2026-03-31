import {
  type ApplicationConfig,
  InjectionToken,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from "@angular/core";
import {
  AppName,
  createAppOwner,
  createEvolu,
  createOwnerSecret,
  type Evolu,
  type EvoluDeps,
  Mnemonic,
  mnemonicToOwnerSecret,
} from "@evolu/common";
import { createEvoluDeps, createRun } from "@evolu/web";
import { Schema } from "./schema";

const appName = AppName.orThrow("angular-vite-pwa-minimal");
const storedMnemonicKey = `${appName}.mnemonic`;

const loadStoredAppOwner = () => {
  const storedMnemonic = globalThis.localStorage?.getItem(storedMnemonicKey);
  if (storedMnemonic == null) return undefined;

  const mnemonic = Mnemonic.from(storedMnemonic);
  if (!mnemonic.ok) {
    globalThis.localStorage?.removeItem(storedMnemonicKey);
    return undefined;
  }

  return createAppOwner(mnemonicToOwnerSecret(mnemonic.value));
};

export const persistStoredMnemonic = (mnemonic: Mnemonic): void => {
  globalThis.localStorage?.setItem(storedMnemonicKey, mnemonic);
};

export const clearStoredMnemonic = (): void => {
  globalThis.localStorage?.removeItem(storedMnemonicKey);
};

const evoluDeps = createEvoluDeps();
const run = createRun(evoluDeps);
const storedAppOwner = loadStoredAppOwner();

const evolu = await run.orThrow(
  createEvolu(Schema, {
    appName,
    appOwner: storedAppOwner ?? createAppOwner(createOwnerSecret(evoluDeps)),

    // ...(typeof window !== "undefined" &&
    //   window.location.hostname === "localhost" && {
    //     transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    //   }),
  }),
);

persistStoredMnemonic(evolu.appOwner.mnemonic);

// This injection token allows us to use Angular's dependency injection to get
// the Evolu instance above within Angular components and services.
export const EVOLU = new InjectionToken<Evolu<typeof Schema>>("Evolu");
export const EVOLU_DEPS = new InjectionToken<EvoluDeps>("EvoluDeps");

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    { provide: EVOLU, useValue: evolu },
    { provide: EVOLU_DEPS, useValue: evoluDeps },
  ],
};
