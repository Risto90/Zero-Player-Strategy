import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(projectRoot, 'server', 'serve.js');
const configuredBasePath = (process.env.BASE_PATH || '/').trim();
const basePath = configuredBasePath === '' || configuredBasePath === '/'
  ? ''
  : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`;
const chromiumPath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  process.env.CHROMIUM_PATH,
  spawnSync('which', ['chromium'], { encoding: 'utf8' }).stdout?.trim(),
  spawnSync('which', ['google-chrome'], { encoding: 'utf8' }).stdout?.trim(),
].find((candidate) => candidate && existsSync(candidate));
const campaignYears = Number(process.env.NOTIFICATION_CAMPAIGN_YEARS ?? 100);
const notificationWaitTimeoutMs = Number(process.env.NOTIFICATION_WAIT_TIMEOUT_MS ?? 180_000);

assert.ok(chromiumPath, 'a Chromium executable is required for the browser notification campaign');
assert.ok(Number.isInteger(campaignYears) && campaignYears > 0,
  'NOTIFICATION_CAMPAIGN_YEARS must be a positive integer');
assert.ok(Number.isInteger(notificationWaitTimeoutMs) && notificationWaitTimeoutMs > 0,
  'NOTIFICATION_WAIT_TIMEOUT_MS must be a positive integer');

async function findFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function publicPath(pathname) {
  return `${basePath}${pathname.startsWith('/') ? pathname : `/${pathname}`}` || '/';
}

function deterministicRandomScript({ seed }) {
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const port = await findFreePort();
const child = spawn('node', [serverScript], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port), BASE_PATH: basePath || '/' },
  stdio: 'inherit',
});
let browser;

async function openApp(role) {
  console.log(`Opening browser UI for ${role} mode...`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(deterministicRandomScript, { seed: 160_100 });
  await context.addInitScript(() => {
    window.__toastSeenNotificationIds = [];
    const observer = new MutationObserver(() => {
      for (const toast of document.querySelectorAll('[id^="notification-"]')) {
        const match = toast.id.match(/^notification-(\d+)$/);
        if (match && !window.__toastSeenNotificationIds.includes(Number(match[1]))) {
          window.__toastSeenNotificationIds.push(Number(match[1]));
        }
      }
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`Browser console: ${message.text()}`);
  });
  await page.goto(`http://127.0.0.1:${port}${publicPath('/')}`);
  console.log(`Home screen loaded for ${role} mode.`);
  await page.getByTestId(`button-role-${role}`).click();
  await page.getByTestId('button-start').click();
  console.log(`Starting browser game in ${role} mode.`);
  await page.getByTestId('button-next').waitFor({ state: 'visible', timeout: 180_000 });
  await page.waitForFunction(() => !!window.__ZERO_STRATEGY_NOTIFICATION_TEST__);
  console.log(`Game screen ready in ${role} mode.`);
  return { context, page, pageErrors };
}

async function runCountryCampaign() {
  const { context, page, pageErrors } = await openApp('country');
  try {
    const startYear = await page.evaluate(() =>
      window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getSnapshot().year,
    );
    const targetYear = startYear + campaignYears;

    while (true) {
      const year = await page.evaluate(() =>
        window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getSnapshot().year,
      );
      if (year >= targetYear) break;
      const result = await page.evaluate(async () => {
        const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
        await bridge.advanceTurn();
        const snapshot = bridge.getSnapshot();
        return {
          year: snapshot.year,
          card: snapshot.card?.type ?? null,
          message: snapshot.message,
          busy: snapshot.busy,
        };
      });
      assert.ok(result.year > year,
        `the campaign did not advance from ${year}: ${JSON.stringify(result)}`);
      if ((year - startYear + 1) % 10 === 0) {
        console.log(`Country browser campaign reached year ${result.year}.`);
      }
    }

    await page.waitForFunction(() => {
      const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
      const snapshot = bridge.getSnapshot();
      const expected = bridge.getNotificationsAfter(0)
        .filter(({ recipient }) =>
          recipient.scope === 'country' &&
          recipient.countryId === snapshot.focusCountry?.id)
        .map(({ id }) => id);
      return JSON.stringify(bridge.getRoutedNotificationIds()) === JSON.stringify(expected);
    }, null, { timeout: notificationWaitTimeoutMs });
    const toastStateBeforeWait = await page.evaluate(() => {
      const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
      const toast = document.querySelector('[data-testid="map-hint-toast"]');
      return {
        displayableCount: bridge.getDisplayableNotificationIds().length,
        displayedCount: window.__toastSeenNotificationIds.length,
        toastId: toast?.id ?? null,
        toastText: toast?.textContent ?? null,
      };
    });
    console.log(`Browser toast state before drain: ${JSON.stringify(toastStateBeforeWait)}.`);
    try {
      await page.waitForFunction(() => {
        const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
        return JSON.stringify(window.__toastSeenNotificationIds) ===
          JSON.stringify(bridge.getDisplayableNotificationIds());
      }, null, { timeout: notificationWaitTimeoutMs });
    } catch (error) {
      const diagnostics = await page.evaluate(() => {
        const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
        return {
          displayableIds: bridge.getDisplayableNotificationIds(),
          displayedIds: window.__toastSeenNotificationIds,
          toastNodes: [...document.querySelectorAll('[data-testid="map-hint-toast"]')]
            .map((toast) => ({ id: toast.id, text: toast.textContent })),
        };
      });
      console.error(`Browser toast wait diagnostics: ${JSON.stringify(diagnostics)}.`);
      throw error;
    }

    const campaign = await page.evaluate(async () => {
      const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const snapshot = bridge.getSnapshot();
      const events = bridge.getNotificationsAfter(0);
      const expectedIds = events
        .filter(({ recipient }) =>
          recipient.scope === 'country' &&
          recipient.countryId === snapshot.focusCountry?.id)
        .map(({ id }) => id);
      return {
        year: snapshot.year,
        focusCountryId: snapshot.focusCountry?.id ?? null,
        activeCountries: bridge.getActiveCountryIds(),
        events,
        expectedIds,
        routedIds: bridge.getRoutedNotificationIds(),
        displayableIds: bridge.getDisplayableNotificationIds(),
        displayedIds: window.__toastSeenNotificationIds,
      };
    });

    assert.equal(campaign.year, targetYear,
      `the browser campaign must complete exactly ${campaignYears} years`);
    assert.ok(campaign.focusCountryId !== null, 'the campaign remains focused on one country');
    assert.ok(campaign.activeCountries.includes(campaign.focusCountryId),
      'the focused country remains present in the world');
    assert.equal(new Set(campaign.events.map(({ id }) => id)).size, campaign.events.length,
      'the notification journal contains no duplicate event IDs');
    assert.deepEqual(campaign.routedIds, campaign.expectedIds,
      'the visible country receives every addressed notification and no other country or world notices');
    assert.ok(campaign.displayableIds.every((id) => campaign.expectedIds.includes(id)),
      'the UI queues only recipient-matched notices separately from active card instructions');
    assert.deepEqual(campaign.displayedIds, campaign.displayableIds,
      'every queued notification is actually rendered exactly once in the browser UI');
    assert.ok(campaign.displayedIds.length > 0,
      'the browser rendered at least one routed notification as a visible toast');
    assert.ok(campaign.displayedIds.every((id) => campaign.expectedIds.includes(id)),
      'the visible notification toast never shows an event for another recipient');
    assert.deepEqual(pageErrors, [], 'the browser campaign has no uncaught page errors');

    return {
      year: campaign.year,
      focusCountryId: campaign.focusCountryId,
      activeCountries: campaign.activeCountries,
      events: campaign.events.map(({ message, recipient }) => ({ message, recipient })),
      routedIds: campaign.routedIds,
    };
  } finally {
    await context.close();
  }
}

async function verifyObserver() {
  const { context, page, pageErrors } = await openApp('observer');
  console.log('Checking observer hints and chronicle in the browser...');
  try {
    await page.getByTestId('button-pause').click();
    await page.waitForFunction(() =>
      window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getSnapshot().paused,
    );
    const initialChronicleLength = await page.evaluate(() =>
      window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getSnapshot().chronicle.length,
    );
    const initialYear = await page.evaluate(() =>
      window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getSnapshot().year,
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await page.evaluate(() =>
        window.__ZERO_STRATEGY_NOTIFICATION_TEST__.advanceTurn(),
      );
      const updated = await page.evaluate(({ year, length }) => {
        const bridge = window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
        const snapshot = bridge.getSnapshot();
        return snapshot.year > year && snapshot.chronicle.length > length;
      }, { year: initialYear, length: initialChronicleLength });
      if (updated) break;
    }
    await page.waitForFunction(({ year, length }) => {
      const snapshot = window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getSnapshot();
      return snapshot.year > year && snapshot.chronicle.length > length;
    },
    { year: initialYear, length: initialChronicleLength },
    );

    assert.equal(await page.getByTestId('button-active-card').count(), 0,
      'observer mode does not show an active player card');
    assert.equal(await page.getByTestId('map-hint-toast').count(), 0,
      'observer mode does not show notification or local hint toasts');
    assert.equal(await page.getByTestId('card-help-tooltip').count(), 0,
      'observer mode does not show card-help tooltips');
    const routedIds = await page.evaluate(() =>
      window.__ZERO_STRATEGY_NOTIFICATION_TEST__.getRoutedNotificationIds(),
    );
    assert.deepEqual(routedIds, [], 'observer mode receives no game notification recipients');

    await page.getByTestId('button-toggle-log').click();
    const chronicle = page.getByTestId('overlay-chronicle');
    await chronicle.waitFor({ state: 'visible' });
    const chronicleText = await chronicle.innerText();
    assert.ok(chronicleText.length > 0, 'observer mode retains access to the shared chronicle');
    assert.ok(initialChronicleLength > 0, 'the observer starts with a populated chronicle');
    assert.deepEqual(pageErrors, [], 'the observer browser session has no uncaught page errors');
  } finally {
    await context.close();
  }
}

try {
  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const firstRun = await runCountryCampaign();
  const repeatedRun = await runCountryCampaign();
  assert.deepEqual(repeatedRun, firstRun,
    `the same seeded ${campaignYears}-year browser campaign repeats with identical events and recipients`);
  await verifyObserver();
  console.log(
    `Browser notification campaign passed: ${campaignYears} years, seed 160100, ${firstRun.events.length} messages, repeated deterministically; observer chronicle verified.`,
  );
} finally {
  await browser?.close();
  child.kill('SIGTERM');
}
