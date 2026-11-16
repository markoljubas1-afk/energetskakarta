// node --test infra/trigger-worker
import assert from "node:assert/strict";
import { test } from "node:test";

import worker, { due } from "./src/index.js";

const at = (hour) => new Date(Date.UTC(2026, 10, 16, hour, 12));

test("the live job is due every hour, the daily ones once, after their own minute", () => {
  assert.deepEqual(due(at(0)), ["live-hourly.yml"]);
  assert.deepEqual(due(at(6)), ["live-hourly.yml", "energy-daily.yml"]);
  assert.deepEqual(due(at(7)), ["live-hourly.yml", "hep-daily.yml"]);
  assert.deepEqual(due(at(8)), ["live-hourly.yml", "gas-daily.yml"]);
  assert.deepEqual(due(at(13)), ["live-hourly.yml", "prices-daily.yml"]);
  const daily = Array.from({ length: 24 }, (_, hour) => due(at(hour)).slice(1)).flat();
  assert.deepEqual(daily.sort(), ["energy-daily.yml", "gas-daily.yml", "hep-daily.yml", "prices-daily.yml"]);
});

test("asks GitHub to start each due workflow on main, and fails loudly when one is refused", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, body: init.body });
    return new Response(url.includes("energy-daily") ? "Not Found" : null, {
      status: url.includes("energy-daily") ? 404 : 204,
    });
  };
  try {
    await worker.scheduled({ scheduledTime: at(0).getTime() }, { GITHUB_TOKEN: "t" });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.github.com/repos/markoljubas1-afk/energetskakarta/actions/workflows/live-hourly.yml/dispatches",
    );
    assert.equal(calls[0].auth, "Bearer t");
    assert.equal(calls[0].body, '{"ref":"main"}');
    // the hourly job still starts when the daily one is refused, and the run says which one failed
    await assert.rejects(
      worker.scheduled({ scheduledTime: at(6).getTime() }, { GITHUB_TOKEN: "t" }),
      /energy-daily\.yml: GitHub answered HTTP 404/,
    );
    assert.equal(calls.length, 3);
    await assert.rejects(worker.scheduled({ scheduledTime: at(0).getTime() }, {}), /GITHUB_TOKEN is not set/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("has nothing to show a visitor", async () => {
  assert.equal(worker.fetch().status, 404);
});
