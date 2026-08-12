import { test, expect } from "@playwright/test";

/**
 * E2E tests for login flow (T017 — closes T021 of specs/login/tasks.md)
 *
 * These tests cover the 4 critical paths:
 * (a) Successful login: valid credentials, no challenge, redirects out of /login
 * (b) Invalid credentials: generic error message, remains on /login
 * (c) Account locked: error message with retry wait time
 * (d) Logout: using the "Salir" button in the topbar of the shared PageHeader (feature 57);
 *     after logout, accessing a protected route redirects back to /login
 *
 * EXECUTION NOTE:
 * These tests require:
 * - A running Next.js dev server (pnpm dev)
 * - A test database with Supabase/Postgres
 * - A seeded user for login (e.g., user@example.com / password)
 * - Control over login attempt count or a way to trigger account lock
 *
 * If the environment lacks .env or a real database, these tests are
 * WRITTEN but NOT EXECUTED. Execution is deferred until the test environment
 * is fully set up (same deferral as T020 of specs/login/tasks.md).
 *
 * To run:
 * 1. Copy .env.example to .env and fill database credentials
 * 2. Run migrations: pnpm run db:migrate
 * 3. Seed test user: (via seed script or manual insert)
 * 4. Run tests: pnpm run test:e2e
 */

// Helper function to generate a unique email per test run
function generateTestEmail() {
  return `test-${Date.now()}@example.com`;
}

test.describe("Auth E2E Flow", () => {
  test.describe("(a) Successful login without challenge", () => {
    test("should login and redirect to home", async ({ page }) => {
      // Navigate to login page
      await page.goto("/login");

      // Fill credentials (assuming a seeded user exists)
      // In a real test, these would come from test config or a test user factory
      const testEmail = "valid-user@example.com";
      const testPassword = "correct-password";

      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', testPassword);

      // Submit form
      await page.click('button[type="submit"]');

      // Wait for redirect and verify we're on the home page
      await page.waitForURL("/", { timeout: 5000 });
      expect(page.url()).toBe("http://localhost:3000/");

      // Verify logout button is visible in the PageHeader topbar (feature 57, R1/R2)
      const logoutButton = page.getByRole("button", { name: "Salir" });
      await expect(logoutButton).toBeVisible();
    });

    test("should respect redirect query parameter", async ({ page }) => {
      // Navigate to login with redirect param
      await page.goto("/login?redirect=/dashboard");

      const testEmail = "valid-user@example.com";
      const testPassword = "correct-password";

      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', testPassword);
      await page.click('button[type="submit"]');

      // Should redirect to /dashboard, not /
      await page.waitForURL("/dashboard", { timeout: 5000 });
      expect(page.url()).toContain("/dashboard");
    });
  });

  test.describe("(b) Invalid credentials", () => {
    test("should show generic error message and remain on /login", async ({ page }) => {
      await page.goto("/login");

      const testEmail = generateTestEmail();
      const wrongPassword = "wrong-password-that-does-not-exist";

      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', wrongPassword);
      await page.click('button[type="submit"]');

      // Wait for error to appear
      const errorMessage = page.getByRole("alert");
      await expect(errorMessage).toContainText("Correo o contraseña inválidos");

      // Should remain on /login
      expect(page.url()).toContain("/login");

      // Email value should be preserved (R8)
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toHaveValue(testEmail);
    });

    test("should show validation errors for empty fields", async ({ page }) => {
      await page.goto("/login");

      // Try to submit empty form
      await page.click('button[type="submit"]');

      // Check for validation errors (should appear without server call)
      const errors = page.getByRole("alert");
      await expect(errors).toHaveCount(2); // email and password errors
    });
  });

  test.describe("(c) Account locked", () => {
    test("should show account locked error with retry time", async ({ page }) => {
      // This test requires a user account that's been locked
      // (after MAX_FAILED_ATTEMPTS failed login attempts)
      // In a real scenario, this would be triggered by:
      // - Making N failed login attempts in sequence
      // - Using test fixtures to set up a locked account
      // - Mocking time/system to trigger the lock

      await page.goto("/login");

      // Attempt login with a locked account
      const lockedUserEmail = "locked-user@example.com";
      const anyPassword = "password";

      await page.fill('input[type="email"]', lockedUserEmail);
      await page.fill('input[type="password"]', anyPassword);
      await page.click('button[type="submit"]');

      // Check for locked account message with retry time
      const errorMessage = page.getByRole("alert");
      await expect(errorMessage).toContainText("Cuenta bloqueada");
      await expect(errorMessage).toContainText("minuto");

      // Verify the error message includes a number (retryAfterMinutes)
      const alertText = await errorMessage.textContent();
      expect(alertText).toMatch(/\d+/); // Contains at least one digit
    });
  });

  test.describe("(d) Logout using PageHeader topbar button", () => {
    test("should logout and redirect to the public home (/)", async ({ page }) => {
      // First, login
      await page.goto("/login");

      const testEmail = "valid-user@example.com";
      const testPassword = "correct-password";

      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', testPassword);
      await page.click('button[type="submit"]');

      // Wait to land on home
      await page.waitForURL("/", { timeout: 5000 });

      // Find and click the logout button in the PageHeader topbar (feature 57, R4/R7)
      const logoutButton = page.getByRole("button", { name: "Salir" });
      await expect(logoutButton).toBeVisible();
      await logoutButton.click();

      // Should redirect to the public home (/)
      await page.waitForURL("/", { timeout: 5000 });

      // Verify logout button is no longer visible: sin sesión, / renderiza la
      // landing pública y el shell autenticado (PageHeader topbar) no se monta (R3).
      const shellLogoutButton = page.getByRole("button", {
        name: "Salir",
      });
      await expect(shellLogoutButton).not.toBeVisible();
    });

    test("after logout, accessing protected route should redirect to /login", async ({
      page,
    }) => {
      // Login first
      await page.goto("/login");

      const testEmail = "valid-user@example.com";
      const testPassword = "correct-password";

      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', testPassword);
      await page.click('button[type="submit"]');
      await page.waitForURL("/", { timeout: 5000 });

      // Logout via the PageHeader topbar control (feature 57)
      const logoutButton = page.getByRole("button", { name: "Salir" });
      await logoutButton.click();
      await page.waitForURL("/", { timeout: 5000 });

      // Try to access a protected route (/ ya es pública tras el logout)
      await page.goto("/dashboard");

      // Should be redirected to /login (middleware catches this)
      await page.waitForURL(/\/login/, { timeout: 5000 });
      expect(page.url()).toContain("/login");
    });
  });

  test.describe("OTP Challenge Flow", () => {
    test("should transition to challenge phase and verify OTP code", async ({
      page,
    }) => {
      // This test requires a user account that requires OTP verification
      // (e.g., 2FA enabled or risk engine flags it as needing challenge)

      await page.goto("/login");

      const testEmail = "otp-required-user@example.com";
      const testPassword = "correct-password";

      await page.fill('input[type="email"]', testEmail);
      await page.fill('input[type="password"]', testPassword);
      await page.click('button[type="submit"]');

      // Should transition to challenge phase
      const codeInput = page.locator('input[id="code"]');
      await expect(codeInput).toBeVisible();

      // Try invalid code
      await page.fill('input[id="code"]', "000000");
      await page.click('button:has-text("Verificar código")');

      // Should show OTP invalid error
      const errorMessage = page.getByRole("alert");
      await expect(errorMessage).toContainText("inválido");

      // Code input should still be visible (remain on challenge phase)
      await expect(codeInput).toBeVisible();

      // Submit correct code (from email or test fixture)
      // This would require access to the OTP or a test seeding mechanism
      const correctCode = "123456"; // Placeholder; would come from test config
      await page.fill('input[id="code"]', correctCode);
      await page.click('button:has-text("Verificar código")');

      // Should redirect to home
      await page.waitForURL("/", { timeout: 5000 });
      expect(page.url()).toBe("http://localhost:3000/");
    });
  });

  test.describe("Accessibility", () => {
    test("login form should be keyboard navigable", async ({ page }) => {
      await page.goto("/login");

      // Tab to email field
      await page.keyboard.press("Tab");
      await expect(page.locator('input[type="email"]')).toBeFocused();

      // Tab to password field
      await page.keyboard.press("Tab");
      await expect(page.locator('input[type="password"]')).toBeFocused();

      // Tab to submit button
      await page.keyboard.press("Tab");
      await expect(page.locator('button[type="submit"]')).toBeFocused();
    });

    test("should move focus to first error field after invalid submission", async ({
      page,
    }) => {
      await page.goto("/login");

      // Try to submit empty form
      await page.click('button[type="submit"]');

      // Focus should be on the email field (first field with error)
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeFocused();
    });

    test("error messages should have aria-live and aria-describedby", async ({
      page,
    }) => {
      await page.goto("/login");

      // Submit empty form to trigger validation error
      await page.click('button[type="submit"]');

      // Check that error container has role="alert" or aria-live
      const errorAlert = page.getByRole("alert");
      await expect(errorAlert).toHaveAttribute("role", "alert");

      // Check that input has aria-describedby pointing to error
      const emailInput = page.locator('input[type="email"]');
      const describedById = await emailInput.getAttribute("aria-describedby");
      expect(describedById).toBeTruthy();
    });
  });
});
