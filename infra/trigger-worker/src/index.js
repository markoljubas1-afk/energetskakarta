/**
 * Starts the data workflows on time (Faza 36, precondition).
 *
 * GitHub's own schedule is best-effort: on 2026-11-16 the hourly `live-hourly` (cron "12 * * * *") was
 * started three times in about twenty hours, and the daily jobs eight to ten hours late. A map that says
 * "live" cannot depend on that. Cloudflare's cron triggers fire on the minute, so this Worker does one
 * thing: once an hour it asks GitHub to run the workflows that are due, exactly as a person pressing
 * "Run workflow" would. It reads no data and publishes nothing; the workflows themselves are unchanged
 * and keep their own schedule as a fallback.
 *
 * Needs one secret, GITHUB_TOKEN: a fine-grained personal access token limited to this one repository
 * with the permission "Actions: Read and write" (infra/README.md, part D). Without it every run fails
 * loudly in the Worker's log and nothing else happens.
 */

const REPOSITORY = "markoljubas1-afk/energetskakarta";
const BRANCH = "main";

/**
 * Which workflows are due in which hour (UTC). The Worker runs at minute 12 of every hour; a daily job is
 * listed under the first run at or after the minute its own cron names.
 */
const EVERY_HOUR = ["live-hourly.yml"];
const DAILY = {
  // energy-daily: 05:30 UTC, after the platform has published the previous day
  6: ["energy-daily.yml"],
  // hep-daily: 06:23 UTC
  7: ["hep-daily.yml"],
  // gas-daily: 07:40 UTC
  8: ["gas-daily.yml"],
  // prices-daily: 12:25 UTC, after the day-ahead auction
  13: ["prices-daily.yml"],
};

/** The workflows due at `date`, hourly ones first. */
export function due(date) {
  return [...EVERY_HOUR, ...(DAILY[date.getUTCHours()] ?? [])];
}

async function start(workflow, token) {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "energymap-trigger",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: BRANCH }),
    },
  );
  // 204 No Content is GitHub's "started"; anything else is said in full, never swallowed
  if (response.status !== 204) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`${workflow}: GitHub answered HTTP ${response.status} ${detail}`);
  }
}

export default {
  async scheduled(controller, env) {
    if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set (wrangler secret put GITHUB_TOKEN)");
    const workflows = due(new Date(controller.scheduledTime));
    const results = await Promise.allSettled(workflows.map((workflow) => start(workflow, env.GITHUB_TOKEN)));
    const failed = results.flatMap((result) => (result.status === "rejected" ? [String(result.reason)] : []));
    console.log(JSON.stringify({ started: workflows.length - failed.length, asked: workflows, failed }));
    // one workflow failing to start must not hide that the others did, but the run is still a failure
    if (failed.length > 0) throw new Error(failed.join("; "));
  },

  // The Worker has no public purpose; a visitor to its address learns only that.
  fetch() {
    return new Response("energymap trigger: nothing to see here\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
