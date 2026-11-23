interface ImportMetaEnv {
  /** "1" in builds for tests against the local Firebase emulators. */
  readonly PUBLIC_TG_EMULATOR?: string;
  /** Base URL of the sign-in service; defaults to the deployed Cloud Function. */
  readonly PUBLIC_TG_API?: string;
}
