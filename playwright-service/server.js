import 'dotenv/config';
import express from 'express';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3001);
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const DEFAULT_TIMEOUT_MS = Number(process.env.DEFAULT_TIMEOUT_MS || 15000);
const ARTIFACT_DIR = path.resolve(process.env.ARTIFACT_DIR || './artifacts');

await fs.mkdir(ARTIFACT_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value) => String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

function required(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
  return value;
}

async function screenshot(page, filename) {
  const target = path.join(ARTIFACT_DIR, filename);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function visibleText(page) {
  return (await page.locator('body').innerText().catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

async function clickFirst(page, locators, description) {
  for (const locator of locators) {
    const candidate = page.locator(locator).first();
    if (await candidate.count() && await candidate.isVisible().catch(() => false)) {
      await candidate.click();
      return locator;
    }
  }
  throw new Error(`Could not find visible ${description}`);
}

async function fillFirst(page, locators, value, description) {
  for (const locator of locators) {
    const candidate = page.locator(locator).first();
    if (await candidate.count() && await candidate.isVisible().catch(() => false)) {
      await candidate.fill(String(value));
      return locator;
    }
  }
  throw new Error(`Could not find visible ${description}`);
}

async function selectRole(page, roleName) {
  // Prefer an actual native select.
  const selects = page.locator('select');
  for (let i = 0; i < await selects.count(); i++) {
    const select = selects.nth(i);
    if (!(await select.isVisible().catch(() => false))) continue;
    const options = await select.locator('option').allTextContents().catch(() => []);
    if (options.some((x) => x.trim().toLowerCase() === roleName.toLowerCase())) {
      await select.selectOption({ label: roleName });
      return 'native-select';
    }
  }

  // Common accessible combobox patterns.
  const combos = [
    'select[aria-label*="role" i]',
    '[role="combobox"][aria-label*="role" i]',
    '[role="combobox"]'
  ];
  for (const css of combos) {
    const combo = page.locator(css).first();
    if (await combo.count() && await combo.isVisible().catch(() => false)) {
      await combo.click();
      const option = page.getByRole('option', { name: new RegExp(`^${roleName}$`, 'i') }).first();
      if (await option.count() && await option.isVisible().catch(() => false)) {
        await option.click();
        return css;
      }
      const textOption = page.getByText(roleName, { exact: true }).last();
      if (await textOption.count() && await textOption.isVisible().catch(() => false)) {
        await textOption.click();
        return css;
      }
    }
  }

  // Fallback: click a visible element whose accessible/name text indicates Role.
  const roleLabels = page.getByText(/^Role$/i).first();
  if (await roleLabels.count() && await roleLabels.isVisible().catch(() => false)) {
    const parent = roleLabels.locator('..');
    const control = parent.locator('button, [role="combobox"], select, input').first();
    if (await control.count() && await control.isVisible().catch(() => false)) {
      await control.click();
      const option = page.getByText(roleName, { exact: true }).last();
      if (await option.count() && await option.isVisible().catch(() => false)) {
        await option.click();
        return 'role-label-parent';
      }
    }
  }

  throw new Error(`Could not select role '${roleName}'`);
}

async function executeWorkflow(input) {
  const baseUrl = input.url || process.env.BASE_URL;
  const admin = input.admin || { username: input.username, password: input.password };
  const data = required(input.data, 'data');
  required(admin?.username, 'admin.username');
  required(admin?.password, 'admin.password');
  required(data.firstName, 'data.firstName');
  required(data.lastName, 'data.lastName');
  required(data.email, 'data.email');
  required(data.password, 'data.password');
  required(data.phone, 'data.phone');
  const role = data.role || 'Customer';

  const runId = `${Date.now()}-${safe(data.email)}`;
  const contextInfo = { runId, username: admin.username, targetEmail: data.email };
  const result = {
    success: false,
    runId,
    username: admin.username,
    targetEmail: data.email,
    steps: { login: false, userManagement: false, addUser: false, dataEntry: false, roleSelection: false, creation: false, logout: false },
    startedAt: new Date().toISOString()
  };

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Login: supports common label/name/placeholder patterns.
    await fillFirst(page, [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="username" i]',
      'input[type="text"]'
    ], admin.username, 'login username/email');

    await fillFirst(page, [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="password" i]'
    ], admin.password, 'login password');

    await clickFirst(page, [
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'input[type="submit"]',
      'button[type="submit"]'
    ], 'login button');

    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(500);
    result.steps.login = true;

    // Navigate to User Management by visible text first; URL fallback is intentionally generic.
    await clickFirst(page, [
      'a:has-text("User Management")',
      'button:has-text("User Management")',
      '[role="link"]:has-text("User Management")',
      'text=User Management'
    ], 'User Management navigation');
    await page.waitForLoadState('networkidle').catch(() => {});
    result.steps.userManagement = true;

    await clickFirst(page, [
      'button:has-text("Add New User")',
      'button:has-text("Add new User")',
      'button:has-text("Add User")',
      'a:has-text("Add New User")',
      'text=Add New User'
    ], 'Add New User button');
    result.steps.addUser = true;

    await fillFirst(page, [
      'input[name="firstName"]', 'input[name="first_name"]', 'input[placeholder*="First Name" i]',
      'input[aria-label*="First Name" i]'
    ], data.firstName, 'First Name');
    await fillFirst(page, [
      'input[name="lastName"]', 'input[name="last_name"]', 'input[placeholder*="Last Name" i]',
      'input[aria-label*="Last Name" i]'
    ], data.lastName, 'Last Name');
    await fillFirst(page, [
      'input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]'
    ], data.email, 'user email');
    await fillFirst(page, [
      'input[name="password"]', 'input[placeholder*="password" i]', 'input[type="password"]'
    ], data.password, 'user password');
    await fillFirst(page, [
      'input[name="phone"]', 'input[name="phoneNumber"]', 'input[name="phone_number"]',
      'input[placeholder*="phone" i]', 'input[type="tel"]'
    ], data.phone, 'phone');
    result.steps.dataEntry = true;

    await selectRole(page, role);
    result.steps.roleSelection = true;

    await clickFirst(page, [
      'button:has-text("Create User")',
      'button:has-text("Create user")',
      'button:has-text("Create")',
      'button[type="submit"]'
    ], 'Create User button');

    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(700);

    const body = (await visibleText(page)).toLowerCase();
    const successIndicators = [
      'user created successfully', 'created successfully', 'successfully created',
      'user added successfully', 'user added', 'user created'
    ];
    const hasSuccessText = successIndicators.some((x) => body.includes(x));
    const targetVisible = body.includes(String(data.email).toLowerCase());
    result.steps.creation = hasSuccessText || targetVisible;
    if (!result.steps.creation) {
      // Still treat navigation away from form as a weak success signal, but record the evidence.
      result.creationEvidence = body.slice(0, 1500);
    }

    // Logout is attempted regardless of creation verification.
    try {
      await clickFirst(page, [
        'button:has-text("Logout")',
        'button:has-text("Log out")',
        'a:has-text("Logout")',
        'a:has-text("Log out")',
        '[role="button"]:has-text("Logout")'
      ], 'logout control');
      await page.waitForLoadState('networkidle').catch(() => {});
      result.steps.logout = true;
    } catch (logoutError) {
      result.logoutError = logoutError.message;
    }

    if (result.steps.creation) {
      result.success = true;
    } else {
      throw new Error('Create User could not be verified from the page');
    }

    result.finishedAt = new Date().toISOString();
    return result;
  } catch (error) {
    result.success = false;
    result.error = error.message;
    result.urlAtFailure = page.url();
    result.pageTitleAtFailure = await page.title().catch(() => '');
    result.visibleTextAtFailure = await visibleText(page);
    try {
      result.screenshot = await screenshot(page, `${safe(contextInfo.runId)}-failure.png`);
    } catch {}
    result.finishedAt = new Date().toISOString();
    return result;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'awash-user-automation-playwright' }));

app.post('/execute', async (req, res) => {
  try {
    const result = await executeWorkflow(req.body || {});
    res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Playwright service listening on http://localhost:${PORT}`);
  console.log(`Headless: ${HEADLESS}`);
});
