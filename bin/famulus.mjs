#!/usr/bin/env node
import("../dist/cli.js").catch((err) => {
  console.error("[famulus] failed to load CLI:", err.message);
  console.error("[famulus] did you run `npm run build`?");
  process.exit(1);
});
