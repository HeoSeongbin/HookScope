import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const key = env.match(/^ADMIN_KEY=(.+)$/m)![1].trim();

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('개발용 관리 키').fill(key);
  await page.getByRole('button', { name: '관리 콘솔 열기' }).click();
}

test('two tabs update automatically, duplicate events are ignored, reconnect recovers missed captures', async ({ page, context, request }) => {
  let websocket: WebSocketRoute | undefined;
  let lastEvent: string | Buffer | undefined;
  await page.routeWebSocket('**/socket.io/**', ws => {
    websocket = ws;
    const upstream = ws.connectToServer();
    upstream.onMessage(message => {
      if (String(message).includes('webhook:received')) lastEvent = message;
      ws.send(message);
    });
  });
  await login(page);
  const name = `Phase 2 실시간 검증 ${Date.now()}`;
  await page.getByLabel('엔드포인트 이름').fill(name);
  await page.getByTitle('엔드포인트 생성').click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.locator('.phase')).toHaveText('실시간 연결됨');
  await expect.poll(() => !!websocket).toBe(true);
  const url = await page.locator('.url-card code').innerText();
  const tab2 = await context.newPage(); await login(tab2);
  await tab2.getByRole('button', { name, exact: true }).click();
  await expect(tab2.locator('.phase')).toHaveText('실시간 연결됨');
  const first = await request.post(url, { data: { event: 'realtime.first' } });
  expect(first.status()).toBe(200);
  await expect(page.locator('.request')).toHaveCount(1);
  await expect(tab2.locator('.request')).toHaveCount(1);
  await expect.poll(() => !!lastEvent).toBe(true);
  // Replay only the notification frame, without creating another HTTP/DB request.
  const duplicateFetch = page.waitForRequest(r => r.url().includes('/requests?page='), { timeout: 400 }).then(() => true, () => false);
  websocket!.send(lastEvent!);
  expect(await duplicateFetch).toBe(false);
  await expect(page.locator('.request')).toHaveCount(1);

  // Interrupt the actual transport and temporarily deny reconnect handshakes.
  const blocked = '**/socket.io/**';
  await page.route(blocked, route => route.abort());
  await websocket!.close({ code: 1012, reason: 'Phase 2 recovery test' });
  await expect(page.locator('.phase')).not.toHaveText('실시간 연결됨');
  expect((await request.post(url, { data: { event: 'captured.while.disconnected' } })).status()).toBe(200);
  await expect(tab2.locator('.request')).toHaveCount(2);
  await expect(page.locator('.request')).toHaveCount(1);
  await page.unroute(blocked);
  await expect(page.locator('.phase')).toHaveText('실시간 연결됨', { timeout: 15000 });
  await expect(page.locator('.request')).toHaveCount(2);
  await page.locator('.request').first().click();
  await expect(page.locator('pre')).toContainText('captured.while.disconnected');
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/screenshots/phase2-desktop.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/screenshots/phase2-mobile.png', import.meta.url)), fullPage: true });
  await page.getByTitle('로그아웃').click();
  await expect(page.getByLabel('개발용 관리 키')).toBeVisible();
  await tab2.close();
});
