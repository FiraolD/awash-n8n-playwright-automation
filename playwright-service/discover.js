import dotenv from "dotenv";
import { chromium } from "playwright";
import fs from "fs";

dotenv.config();

const BASE_URL =
  process.env.BASE_URL || "https://awash-portal.vercel.app/";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const ARTIFACT_DIR = "./artifacts";

if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function waitForUrlContaining(page, text, timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const currentUrl = page.url();

    if (currentUrl.includes(text)) {
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

async function saveFailure(page, name) {
  try {
    await page.screenshot({
      path: `${ARTIFACT_DIR}/${name}.png`,
      fullPage: true
    });

    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}.html`,
      await page.content(),
      "utf8"
    );

    fs.writeFileSync(
      `${ARTIFACT_DIR}/${name}.txt`,
      await page.locator("body").innerText(),
      "utf8"
    );
  } catch (error) {
    console.error(
      "Could not save failure artifacts:",
      error.message
    );
  }
}

async function dumpForm(page) {
  console.log("\n==============================");
  console.log("FORM INPUTS");
  console.log("==============================");

  const inputs = await page.locator("input").evaluateAll(
    elements =>
      elements.map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        value: input.value,
        required: input.required,
        autocomplete: input.autocomplete,
        ariaLabel:
          input.getAttribute("aria-label"),
        ariaDescribedBy:
          input.getAttribute("aria-describedby")
      }))
  );

  console.log(
    JSON.stringify(inputs, null, 2)
  );

  console.log("\n==============================");
  console.log("SELECT ELEMENTS");
  console.log("==============================");

  const selects = await page.locator("select").evaluateAll(
    elements =>
      elements.map(select => ({
        name: select.name,
        id: select.id,
        value: select.value,
        options: Array.from(
          select.options
        ).map(option => ({
          text: option.text,
          value: option.value
        }))
      }))
  );

  console.log(
    JSON.stringify(selects, null, 2)
  );

  console.log("\n==============================");
  console.log("COMBOBOXES");
  console.log("==============================");

  const comboboxes = await page
    .locator('[role="combobox"]')
    .evaluateAll(
      elements =>
        elements.map(element => ({
          tag: element.tagName,
          text: element.innerText,
          value: element.value,
          name:
            element.getAttribute("name"),
          id: element.id,
          ariaLabel:
            element.getAttribute(
              "aria-label"
            ),
          ariaExpanded:
            element.getAttribute(
              "aria-expanded"
            ),
          ariaControls:
            element.getAttribute(
              "aria-controls"
            )
        }))
    );

  console.log(
    JSON.stringify(
      comboboxes,
      null,
      2
    )
  );

  console.log("\n==============================");
  console.log("BUTTONS");
  console.log("==============================");

  const buttons = await page
    .locator("button")
    .evaluateAll(
      elements =>
        elements.map(
          (button, index) => ({
            index,
            text:
              button.innerText.trim(),
            type:
              button.type,
            disabled:
              button.disabled,
            ariaLabel:
              button.getAttribute(
                "aria-label"
              ),
            title:
              button.getAttribute("title"),
            testId:
              button.getAttribute(
                "data-testid"
              )
          })
        )
    );

  console.log(
    JSON.stringify(
      buttons,
      null,
      2
    )
  );
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be configured in .env"
    );
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 900
    }
  });

  const page = await context.newPage();

  page.on("console", msg => {
    console.log(
      `[BROWSER ${msg.type()}] ${msg.text()}`
    );
  });

  page.on("pageerror", error => {
    console.log(
      "[PAGE ERROR]",
      error.message
    );
  });

  try {
    // =====================================================
    // LOGIN
    // =====================================================

    console.log("\nOpening:", BASE_URL);

    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    console.log(
      "Initial URL:",
      page.url()
    );

    // Wait for login fields

    const emailInput =
      page.locator("#email");

    const passwordInput =
      page.locator("#password");

    await emailInput.waitFor({
      state: "visible",
      timeout: 15000
    });

    await passwordInput.waitFor({
      state: "visible",
      timeout: 15000
    });

    console.log(
      "Login form detected."
    );

    // Fill credentials

    await emailInput.fill(
      ADMIN_EMAIL
    );

    await passwordInput.fill(
      ADMIN_PASSWORD
    );

    console.log(
      "Credentials entered."
    );

    // Submit

    const submitButton =
      page
        .locator(
          'button[type="submit"]'
        )
        .first();

    await submitButton.waitFor({
      state: "visible",
      timeout: 15000
    });

    await submitButton.click();

    console.log(
      "Sign in clicked."
    );

    // =====================================================
    // WAIT FOR DASHBOARD WITHOUT waitForURL()
    // =====================================================

    console.log(
      "\nWaiting for dashboard..."
    );

    const dashboardReached =
      await waitForUrlContaining(
        page,
        "/dashboard",
        30000
      );

    if (!dashboardReached) {
      console.log(
        "Dashboard URL was not detected."
      );

      console.log(
        "Current URL:",
        page.url()
      );

      await saveFailure(
        page,
        "login-failed"
      );

      throw new Error(
        `Login did not reach dashboard. Current URL: ${page.url()}`
      );
    }

    console.log(
      "\nLOGIN SUCCESSFUL"
    );

    console.log(
      "Dashboard URL:",
      page.url()
    );

    console.log(
      "Title:",
      await page.title()
    );

    await page.screenshot({
      path:
        `${ARTIFACT_DIR}/dashboard.png`,
      fullPage: true
    });

    // Give React a moment to render sidebar

    await page.waitForTimeout(1000);

    // =====================================================
    // USER MANAGEMENT LINK
    // =====================================================

    console.log(
      "\n=============================="
    );

    console.log(
      "LOCATING USER MANAGEMENT"
    );

    console.log(
      "=============================="
    );

    const userManagementLink =
      page.getByRole(
        "link",
        {
          name:
            /^User Management$/i
        }
      );

    const linkCount =
      await userManagementLink.count();

    console.log(
      "User Management links found:",
      linkCount
    );

    if (linkCount === 0) {
      await saveFailure(
        page,
        "user-management-link-not-found"
      );

      throw new Error(
        "User Management link was not found on dashboard."
      );
    }

    console.log(
      "\nUser Management link:"
    );

    console.log(
      await userManagementLink
        .first()
        .evaluate(
          element => ({
            tag:
              element.tagName,
            text:
              element.innerText,
            href:
              element.getAttribute(
                "href"
              ),
            className:
              element.className,
            outerHTML:
              element.outerHTML
          })
        )
    );

    // =====================================================
    // CLICK USER MANAGEMENT
    // =====================================================

    console.log(
      "\nClicking User Management..."
    );

    await userManagementLink
      .first()
      .click();

    await page.waitForTimeout(
      1500
    );

    console.log(
      "Current URL:",
      page.url()
    );

    console.log(
      "Current title:",
      await page.title()
    );

    const pageText =
      await page
        .locator("body")
        .innerText();

    console.log(
      "\nPAGE TEXT:"
    );

    console.log(
      pageText.substring(
        0,
        12000
      )
    );

    // =====================================================
    // CHECK 404
    // =====================================================

    if (
      pageText.includes(
        "404: NOT_FOUND"
      ) ||
      pageText.includes(
        "This page doesn’t exist"
      ) ||
      pageText.includes(
        "This page doesn't exist"
      )
    ) {
      await saveFailure(
        page,
        "user-management-404"
      );

      throw new Error(
        "User Management link leads to a 404 page."
      );
    }

    // =====================================================
    // USER MANAGEMENT PAGE
    // =====================================================

    console.log(
      "\nUSER MANAGEMENT PAGE LOADED"
    );

    await page.screenshot({
      path:
        `${ARTIFACT_DIR}/user-management.png`,
      fullPage: true
    });

    // =====================================================
    // BUTTONS
    // =====================================================

    const pageButtons =
      await page
        .locator("button")
        .evaluateAll(
          elements =>
            elements.map(
              (button, index) => ({
                index,
                text:
                  button.innerText.trim(),
                type:
                  button.type,
                disabled:
                  button.disabled,
                ariaLabel:
                  button.getAttribute(
                    "aria-label"
                  ),
                title:
                  button.getAttribute(
                    "title"
                  ),
                testId:
                  button.getAttribute(
                    "data-testid"
                  )
              })
            )
        );

    console.log(
      "\nPAGE BUTTONS:"
    );

    console.log(
      JSON.stringify(
        pageButtons,
        null,
        2
      )
    );

    // =====================================================
    // FIND ADD NEW USER
    // =====================================================

    const candidates = [
      page.getByRole(
        "button",
        {
          name:
            /add\s*new\s*user/i
        }
      ),

      page.getByRole(
        "link",
        {
          name:
            /add\s*new\s*user/i
        }
      ),

      page.getByText(
        /add\s*new\s*user/i,
        {
          exact: false
        }
      )
    ];

    let addUserButton = null;

    for (
      const candidate
      of candidates
    ) {
      if (
        await candidate.count() >
        0
      ) {
        addUserButton =
          candidate.first();

        break;
      }
    }

    if (!addUserButton) {
      await saveFailure(
        page,
        "add-user-not-found"
      );

      throw new Error(
        "Add New User control was not found."
      );
    }

    console.log(
      "\nADD NEW USER FOUND:"
    );

    console.log(
      await addUserButton.evaluate(
        element => ({
          tag:
            element.tagName,
          text:
            element.innerText,
          type:
            element.getAttribute(
              "type"
            ),
          href:
            element.getAttribute(
              "href"
            ),
          className:
            element.className,
          testId:
            element.getAttribute(
              "data-testid"
            ),
          outerHTML:
            element.outerHTML
        })
      )
    );

    // =====================================================
    // OPEN FORM
    // =====================================================

    await addUserButton.click();

    await page.waitForTimeout(
      500
    );

    console.log(
      "\nAdd New User clicked."
    );

    await page.screenshot({
      path:
        `${ARTIFACT_DIR}/add-user-form.png`,
      fullPage: true
    });

    // =====================================================
    // DUMP FORM
    // =====================================================

    await dumpForm(page);

    // Save text/html

    const formText =
      await page
        .locator("body")
        .innerText();

    fs.writeFileSync(
      `${ARTIFACT_DIR}/add-user-form.txt`,
      formText,
      "utf8"
    );

    fs.writeFileSync(
      `${ARTIFACT_DIR}/add-user-form.html`,
      await page.content(),
      "utf8"
    );

    console.log(
      "\n=============================="
    );

    console.log(
      "DISCOVERY COMPLETED SUCCESSFULLY"
    );

    console.log(
      "=============================="
    );

    await page.waitForTimeout(
      10000
    );

  } catch (error) {
    console.error(
      "\n=============================="
    );

    console.error(
      "DISCOVERY FAILED"
    );

    console.error(
      "=============================="
    );

    console.error(
      error
    );

    process.exitCode = 1;

  } finally {
    await browser.close();
  }
}

main();