const esbuild = require("esbuild");

esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: false,
  platform: "node",
  outdir: "dist",
});
