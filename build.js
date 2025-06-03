const esbuild = require("esbuild");
const { readFileSync } = require("fs");

const packageVersion = `"v${
  JSON.parse(readFileSync("./package.json", "utf8")).version
}"`;

esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  platform: "node",
  define: { packageVersion },
  target: "node20",
  outdir: "dist",
});
