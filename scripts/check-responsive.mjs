import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  startPreview,
  teamId,
  missionId,
  proposalId,
  inviteToken,
} from './responsive-fixtures.mjs';

const browserPath = [
  process.env.RESPONSIVE_BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((file) => file && existsSync(file));
if (!browserPath)
  throw new Error(
    'Set RESPONSIVE_BROWSER_PATH to an installed Chromium browser executable.',
  );
const output = path.resolve('.local/responsive');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, 'browser-'));
const preview = await startPreview();
const browser = spawn(
  browserPath,
  [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let socket;
let call;
const checks = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = Number(
        (
          await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0],
      );
      break;
    } catch {
      await delay(100);
    }
  }
  if (!port) throw new Error('Headless browser did not start.');
  const tab = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    })
  ).json();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    }
  });
  call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => {
        pending.delete(key);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 15000);
      pending.set(key, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.enable');
  const base = `teams/${teamId}`;
  const pages = [
    ['login', 'login'],
    ['register', 'register'],
    ['dashboard', 'dashboard'],
    ['create-team', 'teams/new'],
    ['team-workspace', base],
    ['mission-list', `${base}/tasks`],
    ['board', `${base}/board`],
    ['create-mission', `${base}/tasks/new`],
    ['edit-mission', `${base}/tasks/${missionId}/edit`],
    ['mission-detail', `${base}/tasks/${missionId}`],
    ['proposals', `${base}/proposals`],
    ['proposal-detail', `${base}/tasks/${proposalId}`],
    ['members', `${base}/members`],
    ['invitation', `invitations/${inviteToken}`],
    ['invalid-invitation', 'invitations/invalid'],
  ];
  const variants = [
    ['holy-knight-board', `${base}/board?role=admin`],
    ['holy-knight-propose', `${base}/tasks/new?role=admin`],
    ['commoner-board', `${base}/board?role=member`],
    ['commoner-detail', `${base}/tasks/${missionId}?role=member`],
    ['commoner-proposals', `${base}/proposals?role=member`],
    ['empty-dashboard', 'dashboard?state=empty'],
    ['empty-missions', `${base}/tasks?state=empty`],
    ['empty-board', `${base}/board?state=empty`],
    ['empty-proposals', `${base}/proposals?state=empty`],
    ['empty-discussion', `${base}/tasks/${missionId}?state=empty`],
    ['loading-dashboard', 'dashboard?state=loading'],
    ['error-dashboard', 'dashboard?state=error'],
  ];
  for (const width of [320, 390, 768, 1440]) {
    for (const [name, route] of width < 400 ? [...pages, ...variants] : pages) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
      await call('Page.navigate', { url: `${preview.origin}/${route}` });
      const readyState = name.startsWith('loading-')
        ? '!!document.querySelector(\'[aria-busy="true"]\')'
        : name.startsWith('error-')
          ? '!!document.querySelector(\'[role="alert"]\')'
          : '!document.querySelector(\'[aria-busy="true"]\')';
      for (let attempt = 0; attempt < 150; attempt++) {
        await delay(100);
        if (
          await evaluate(
            `!!document.querySelector('h1') && !document.querySelector('.session-state') && location.pathname + location.search === ${JSON.stringify('/' + route)} && (${readyState})`,
          )
        )
          break;
      }
      await evaluate('document.fonts.ready.then(() => true)');
      await delay(400);
      const metrics = await evaluate(`(() => {
        const intentionalScroll = '.kanban-board,.crew-navigation,.task-table-wrap,.team-tabs';
        const controls = [...document.querySelectorAll('input,textarea,select,button')].filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && !element.closest(intentionalScroll) && (box.left < -1 || box.right > innerWidth + 1);
        }).map((element) => ({ tag: element.tagName, label: element.getAttribute('aria-label') || element.textContent.trim() || element.id }));
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, route: location.pathname, controls, loading: !!document.querySelector('[aria-busy="true"]'), error: !!document.querySelector('[role="alert"]'), heading: document.querySelector('h1')?.textContent };
      })()`);
      const problems = [];
      if (metrics.scrollWidth > width + 1)
        problems.push(`Page overflow: ${metrics.scrollWidth}px`);
      if (metrics.controls.length)
        problems.push(
          `Controls outside viewport: ${JSON.stringify(metrics.controls)}`,
        );
      if (metrics.route !== '/' + route.split('?')[0])
        problems.push(`Unexpected redirect: ${metrics.route}`);
      if (name.startsWith('loading-') && !metrics.loading)
        problems.push('Loading state missing');
      if (name.startsWith('error-') && !metrics.error)
        problems.push('Error state missing');
      if (
        name.startsWith('commoner-') &&
        (await evaluate(
          "!![...document.querySelectorAll('a,button')].find(e=>/^(Create mission|Propose mission|Approve mission|Edit mission)$/.test(e.textContent.trim()))",
        ))
      )
        problems.push('Commoner management control visible');
      checks.push({ name, width, passed: !problems.length, problems, metrics });
      if (width === 390 || problems.length || name === 'login') {
        const screenshot = await call('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        await writeFile(
          path.join(output, `${name}-${width}.png`),
          Buffer.from(screenshot.data, 'base64'),
        );
      }
      console.log(
        `${problems.length ? 'FAIL' : 'PASS'} ${width}px ${name}${problems.length ? ': ' + problems.join('; ') : ''}`,
      );
      if (name === 'mission-detail' && width === 390) {
        await evaluate(
          "[...document.querySelectorAll('button')].find(e=>e.textContent.includes('View history')).click()",
        );
        await delay(300);
        const dialog = await evaluate(
          "(() => { const d=document.querySelector('dialog'); const r=d.getBoundingClientRect(); return {open:d.open, width:r.width,left:r.left,right:r.right,blur:getComputedStyle(d,'::backdrop').backdropFilter,locked:document.body.style.overflow==='hidden'}; })()",
        );
        const passed =
          dialog.open &&
          dialog.left >= 0 &&
          dialog.right <= width &&
          dialog.locked &&
          dialog.blur.includes('blur');
        checks.push({
          name: 'activity-dialog',
          width,
          passed,
          metrics: dialog,
          problems: passed
            ? []
            : ['Dialog bounds/backdrop/scroll locking failed'],
        });
        const shot = await call('Page.captureScreenshot', { format: 'png' });
        await writeFile(
          path.join(output, 'activity-dialog-390.png'),
          Buffer.from(shot.data, 'base64'),
        );
        await call('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
        await call('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
      }
    }
  }
  await call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await call('Page.navigate', { url: `${preview.origin}/login` });
  await delay(500);
  const animated = await evaluate(
    "[...document.querySelectorAll('.auth-ambient-row')].map(row=>({animation:getComputedStyle(row).animationName,pointer:getComputedStyle(document.querySelector('.auth-ambient')).pointerEvents}))",
  );
  checks.push({
    name: 'background-motion',
    width: 390,
    passed: animated.every(
      (layer) => layer.animation !== 'none' && layer.pointer === 'none',
    ),
    metrics: animated,
  });
  await evaluate('document.fonts.ready.then(() => true)');
  const motionSample = () =>
    evaluate(
      "(() => { const heading=document.querySelector('.auth-form h1').getBoundingClientRect(); return { transform:getComputedStyle(document.querySelector('.auth-ambient-row')).transform, textTop:heading.top, textLeft:heading.left }; })()",
    );
  const beforeMotion = await motionSample();
  await delay(350);
  const afterMotion = await motionSample();
  checks.push({
    name: 'moving-background-stationary-text',
    width: 390,
    passed:
      beforeMotion.transform !== afterMotion.transform &&
      beforeMotion.textTop === afterMotion.textTop &&
      beforeMotion.textLeft === afterMotion.textLeft,
  });
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reduced = await evaluate(
    "[...document.querySelectorAll('.auth-ambient-row')].every(row=>getComputedStyle(row).animationName==='none')",
  );
  checks.push({ name: 'reduced-motion', width: 390, passed: reduced });
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ browser: browserPath, checks }, null, 2),
  );
  const failures = checks.filter((check) => !check.passed);
  console.log(
    `Responsive checks: ${checks.length - failures.length}/${checks.length} passed. Report: .local/responsive/report.json`,
  );
  if (failures.length) process.exitCode = 1;
} finally {
  if (call) await call('Browser.close').catch(() => {});
  socket?.close();
  browser.kill();
  preview.server.closeAllConnections();
  await new Promise((resolve) => preview.server.close(resolve));
}
