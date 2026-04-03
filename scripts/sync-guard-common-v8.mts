process.stderr.write(
  "[deprecated] sync-guard-common-v8.mts now forwards to sync-guard-upstream.mts; use bun run sync:guard:upstream instead.\n",
);

import "./sync-guard-upstream.mts";
