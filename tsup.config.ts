import { defineConfig } from "tsup"

// Declarations are emitted by tsc (see the build script): tsup's dts bundler
// needs the TypeScript compiler API, which TypeScript 7 no longer ships.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
})
