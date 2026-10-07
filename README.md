<<<<<<< HEAD
# awash-n8n-playwright-automation
=======
# Awash Portal — Playwright + n8n Multi-User Automation

This project automates an authorized test workflow:

1. Open the Awash test portal.
2. Log in with an admin/test account.
3. Open **User Management**.
4. Click **Add New User**.
5. Fill First Name, Last Name, Email, Password and Phone.
6. Select **Customer** from Role.
7. Click **Create User**.
8. Verify creation from the resulting page.
9. Log out.
10. Repeat for additional records.

## Architecture

`n8n -> HTTP POST /execute -> Playwright -> test portal`

n8n is the orchestrator and data source. Playwright owns browser state and performs deterministic UI actions. Each execution creates a fresh browser context so cookies/session data are isolated.

## Requirements

- Node.js 20+
- npm
- n8n (local, Docker, or hosted)
- Chromium installed by Playwright

## 1. Install Playwright service

```bash
cd playwright-service
npm install
npx playwright install chromium
copy .env.example .env
```

On macOS/Linux use `cp .env.example .env`.

Start the service:

```bash
npm start
```

Health check:

```text
http://localhost:3001/health
```

Expected response:

```json
{"ok":true,"service":"awash-user-automation-playwright"}
```

## 2. Discover exact portal selectors

Because application UI selectors can change, run the discovery script once against the authorized test system.

Put the test admin credentials in `playwright-service/.env`:

```env
ADMIN_USERNAME=your-test-admin
ADMIN_PASSWORD=your-test-password
```

Then:

```bash
npm run discover
```

The browser opens visibly, logs in, opens User Management and Add New User when those labels are found, and saves screenshots plus element metadata under `playwright-service/artifacts/`.

This is useful for confirming the exact controls in the current version of the test portal.

## 3. Configure n8n

Import:

`n8n/awash-create-users.json`

The workflow contains a Code node called **Build Test Users**. Replace its placeholder password and test records with authorized test data.

The HTTP Request node calls:

`POST http://localhost:3001/execute`

If n8n runs in Docker while Playwright runs on the host, `localhost` inside the n8n container refers to the container itself. Use the appropriate host gateway/address, for example `http://host.docker.internal:3001` where supported.

## 4. Example API request

```json
{
  "url": "https://awash-portal.vercel.app/",
  "admin": {
    "username": "test-admin@example.com",
    "password": "TEST_ONLY_PASSWORD"
  },
  "data": {
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane.doe@example.com",
    "password": "Customer@12345",
    "phone": "0912345678",
    "role": "Customer"
  }
}
```

## 5. Result

Successful execution returns structured data similar to:

```json
{
  "success": true,
  "username": "test-admin@example.com",
  "targetEmail": "jane.doe@example.com",
  "steps": {
    "login": true,
    "userManagement": true,
    "addUser": true,
    "dataEntry": true,
    "roleSelection": true,
    "creation": true,
    "logout": true
  }
}
```

On failure the service returns the failed step context and saves a full-page screenshot in `playwright-service/artifacts/`.

## Multi-user design

The n8n input is an array of user records. Add more records in **Build Test Users**. The HTTP Request node receives one item per record, so n8n can execute the same browser procedure repeatedly.

For multiple admin accounts, assign an admin credential to each record or implement a separate credential pool. Do not hard-code production credentials into the workflow JSON.

## Important implementation notes

- The service does not bypass CAPTCHA, MFA, anti-bot protections, or access controls.
- Use only credentials and systems you are authorized to automate.
- For production, store credentials in n8n Credentials or a secrets manager rather than JavaScript nodes.
- The current selectors intentionally use accessible labels/text and common HTML patterns so the first run can work across ordinary React/Next.js forms. The discovery script is included so exact selectors can be tightened after inspecting the test application's current DOM.
- For a client-facing POC, record the n8n build, a successful run, and a failure/retry case at 1080p.
>>>>>>> ce381c8 (A browser automation with n8n and puppeter)
