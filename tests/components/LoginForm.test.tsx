// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/app/login/_components/LoginForm";
import { login, verifyChallenge } from "@/lib/actions/auth";
import type { LoginResult } from "@/lib/types/auth";

// Mock de las Server Actions reales que consume LoginForm (nunca se toca
// lib/actions/auth.ts; solo se reemplaza su implementacion en el test).
// LoginForm importa el schema/OTP_CODE_LENGTH del modulo real
// "@/lib/types/auth" (no mockeado): la validacion de cliente que se
// ejercita en estos tests es la real del componente, no una reimplementada.
vi.mock("@/lib/actions/auth", () => ({
  login: vi.fn(),
  verifyChallenge: vi.fn(),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const mockedLogin = vi.mocked(login);
const mockedVerifyChallenge = vi.mocked(verifyChallenge);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LoginForm — render de campos (R1, R2, R19)", () => {
  it("renderiza email, password y el boton de envio con labels asociadas", () => {
    render(<LoginForm redirectParam={null} />);

    const emailInput = screen.getByLabelText("Correo electrónico");
    const passwordInput = screen.getByLabelText("Contraseña");
    const submitButton = screen.getByRole("button", { name: "Iniciar sesión" });

    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toHaveAttribute("id", "email");
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toHaveAttribute("id", "password");
    expect(submitButton).toHaveAttribute("type", "submit");
  });
});

describe("LoginForm — validacion de cliente (R3, R4)", () => {
  it("R3: bloquea el envio y muestra error cuando el correo es invalido, sin invocar login", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "no-es-un-correo");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("Correo electrónico inválido")).toBeInTheDocument();
    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it("R4: bloquea el envio y muestra error cuando la contraseña esta vacia, sin invocar login", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("La contraseña es requerida")).toBeInTheDocument();
    expect(mockedLogin).not.toHaveBeenCalled();
  });
});

describe("LoginForm — invocacion de login (R5, R6, R6a)", () => {
  it("R5: invoca login exactamente una vez con { email, password } cuando la validacion pasa", async () => {
    mockedLogin.mockResolvedValue({ status: "invalid_credentials" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(1));
    expect(mockedLogin).toHaveBeenCalledWith({ email: "ana@example.com", password: "clave123" });
  });

  it("R6, R6a: deshabilita el boton mientras login esta pendiente e impide doble-submit", async () => {
    const pending = deferred<LoginResult>();
    mockedLogin.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    const submitButton = screen.getByRole("button", { name: "Iniciar sesión" });
    await user.click(submitButton);

    await waitFor(() => expect(submitButton).toBeDisabled());
    // Intento de doble-submit mientras esta pendiente: el boton deshabilitado
    // no dispara un segundo click real en el navegador/jsdom.
    await user.click(submitButton);
    expect(mockedLogin).toHaveBeenCalledTimes(1);

    pending.resolve({ status: "invalid_credentials" });
    await waitFor(() => expect(submitButton).not.toBeDisabled());
  });
});

describe("LoginForm — resultados de login (R7-R12)", () => {
  it("R7: status ok redirige a redirectParam cuando es una ruta interna valida", async () => {
    mockedLogin.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam="/dashboard" />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("R7: status ok redirige a /dashboard cuando no hay redirectParam (feature 86, R14)", async () => {
    mockedLogin.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("R7: status ok redirige a /dashboard cuando redirectParam es un open-redirect ('//evil.com') (feature 86, R15)", async () => {
    mockedLogin.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam="//evil.com" />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("R8: invalid_credentials muestra mensaje generico y conserva el correo", async () => {
    mockedLogin.mockResolvedValue({ status: "invalid_credentials" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-mala");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("Correo o contraseña inválidos")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@example.com");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("R9: account_unavailable muestra un mensaje distinguible", async () => {
    mockedLogin.mockResolvedValue({ status: "account_unavailable" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(
      await screen.findByText("Esta cuenta no está disponible para iniciar sesión"),
    ).toBeInTheDocument();
  });

  it("R10: account_locked muestra el valor de retryAfterMinutes recibido", async () => {
    mockedLogin.mockResolvedValue({ status: "account_locked", retryAfterMinutes: 17 });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const alert = await screen.findByRole("alert", { name: /Cuenta bloqueada/ }).catch(() => null);
    const message = alert ?? (await screen.findByText(/Cuenta bloqueada/));
    expect(message.textContent).toContain("17");
  });

  it("R11: validation_error del servidor muestra el error bajo el campo correspondiente", async () => {
    mockedLogin.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { email: ["Formato de correo rechazado por el servidor"] },
    });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const error = await screen.findByText("Formato de correo rechazado por el servidor");
    const errorContainer = error.closest('[role="alert"]');
    expect(errorContainer).not.toBeNull();
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "aria-describedby",
      errorContainer!.id,
    );
  });

  it("R12: challenge_required transiciona a la fase de verificacion sin recargar la pagina", async () => {
    mockedLogin.mockResolvedValue({ status: "challenge_required", challengeId: "challenge-1" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByLabelText("Código de verificación")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).not.toBeInTheDocument();
  });
});

async function goToChallengePhase(user: ReturnType<typeof userEvent.setup>) {
  mockedLogin.mockResolvedValue({ status: "challenge_required", challengeId: "challenge-1" });
  await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await user.type(screen.getByLabelText("Contraseña"), "clave123");
  await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));
  await screen.findByLabelText("Código de verificación");
}

describe("LoginForm — fase OTP (R13-R18)", () => {
  it("R13: renderiza el campo de codigo con label y un boton de envio separado", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);
    await goToChallengePhase(user);

    const codeInput = screen.getByLabelText("Código de verificación");
    expect(codeInput).toHaveAttribute("id", "code");
    expect(screen.getByRole("button", { name: "Verificar código" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("R14: bloquea el envio si el codigo no son 6 digitos y no invoca verifyChallenge", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);
    await goToChallengePhase(user);

    await user.type(screen.getByLabelText("Código de verificación"), "123");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));

    expect(
      await screen.findByText("El código debe ser exactamente 6 dígitos numéricos"),
    ).toBeInTheDocument();
    expect(mockedVerifyChallenge).not.toHaveBeenCalled();
  });

  it("R15: invoca verifyChallenge con { challengeId, code } cuando el codigo es valido", async () => {
    mockedVerifyChallenge.mockResolvedValue({ status: "otp_invalid" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);
    await goToChallengePhase(user);

    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));

    await waitFor(() => expect(mockedVerifyChallenge).toHaveBeenCalledTimes(1));
    expect(mockedVerifyChallenge).toHaveBeenCalledWith({
      challengeId: "challenge-1",
      code: "123456",
    });
  });

  it("R16: status ok en verifyChallenge redirige igual que R7", async () => {
    mockedVerifyChallenge.mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam="/cuenta" />);
    await goToChallengePhase(user);

    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/cuenta"));
  });

  it("R17: otp_invalid muestra error y mantiene la fase de verificacion", async () => {
    mockedVerifyChallenge.mockResolvedValue({ status: "otp_invalid" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);
    await goToChallengePhase(user);

    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));

    expect(await screen.findByText("El código es inválido o ha expirado")).toBeInTheDocument();
    // Se mantiene en la fase de verificacion (no vuelve a mostrar email/password).
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("R18: validation_error de verifyChallenge muestra el error bajo el campo de codigo", async () => {
    mockedVerifyChallenge.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { code: ["El servidor rechazo el codigo"] },
    });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);
    await goToChallengePhase(user);

    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));

    const error = await screen.findByText("El servidor rechazo el codigo");
    const errorContainer = error.closest('[role="alert"]');
    expect(errorContainer).not.toBeNull();
    expect(screen.getByLabelText("Código de verificación")).toHaveAttribute(
      "aria-describedby",
      errorContainer!.id,
    );
  });
});

describe("LoginForm — accesibilidad (R19-R23)", () => {
  it("R20: los errores se anuncian con role=alert y aria-describedby los asocia al campo", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    const emailInput = await screen.findByLabelText("Correo electrónico");
    const describedBy = emailInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy!);
    expect(errorNode).toHaveAttribute("role", "alert");
  });

  it("R21: coloca el foco inicial en el campo de correo al montar", () => {
    render(<LoginForm redirectParam={null} />);
    expect(screen.getByLabelText("Correo electrónico")).toHaveFocus();
  });

  it("R22: mueve el foco al campo de correo cuando el error es de email (primer submit)", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Contraseña"), "clave123");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(screen.getByLabelText("Correo electrónico")).toHaveFocus());
  });

  it("R22: mueve el foco al campo de contraseña cuando SOLO ese campo tiene error (primer submit)", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toHaveFocus());
  });

  it("R23: Enter dentro del campo de contraseña envia el formulario de credenciales", async () => {
    mockedLogin.mockResolvedValue({ status: "invalid_credentials" });
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123{Enter}");

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(1));
  });

  // AMPLIADO por la feature 286 (R11), no relajado: el ojito de la contraseña es un
  // control alcanzable con teclado, así que ocupa un sitio en el recorrido —justo detrás
  // de su propio campo—. Las tres paradas que este caso afirmaba desde la feature 86
  // siguen aquí, en el mismo orden y con la misma aserción; lo que hay es una parada MÁS
  // en medio. La alternativa era ponerle `tabIndex={-1}` al botón para conservar el
  // recorrido intacto, y está descartada por escrito: dejaría el control fuera del
  // teclado, que es lo contrario de lo que se pidió y lo que WCAG 2.1.1 prohíbe.
  it("R23 (+286 R11): el orden de tabulacion es email -> password -> ojito -> submit", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    const email = screen.getByLabelText("Correo electrónico");
    const password = screen.getByLabelText("Contraseña");
    const ojito = screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." });
    const submit = screen.getByRole("button", { name: "Iniciar sesión" });

    expect(email).toHaveFocus();
    await user.tab();
    expect(password).toHaveFocus();
    await user.tab();
    expect(ojito).toHaveFocus();
    await user.tab();
    expect(submit).toHaveFocus();
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// Feature 286 — el ojito, integrado en el formulario de verdad
// ───────────────────────────────────────────────────────────────────────────────────────

describe("LoginForm — el ojito de la contraseña (286: R1, R6, R7, R10, R13, R15.1)", () => {
  it("R1/R6/R7: el campo de contraseña tiene ojito y alterna su `type` en los dos sentidos", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    const password = screen.getByLabelText("Contraseña");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(password).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Contraseña: visible. Ocultar." }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("R10: pulsar el ojito NO envia el formulario ni pierde lo tecleado", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave123");

    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));

    // Ni la Server Action, ni la validacion de cliente: pulsar el ojito no es enviar.
    expect(mockedLogin).not.toHaveBeenCalled();
    expect(screen.queryByText("La contraseña es requerida")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toHaveValue("clave123");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
  });

  it("R15.1: el ojito no estrena ningun `role=\"status\"` ni `role=\"alert\"` en la pantalla", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectParam={null} />);

    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));

    // Si la region viva llevara `role="alert"`, el `findByRole("alert")` EN SINGULAR de la
    // suite de errores de mas abajo se volveria ambiguo y se caeria por otra razon.
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("LoginForm — distinguibilidad de mensajes de error (R27)", () => {
  it("presenta un texto distinto por cada status de error y account_locked incluye los minutos", async () => {
    const user = userEvent.setup();
    const cases: Array<{ result: LoginResult; expectSubstring: string }> = [
      { result: { status: "invalid_credentials" }, expectSubstring: "Correo o contraseña inválidos" },
      {
        result: { status: "account_unavailable" },
        expectSubstring: "Esta cuenta no está disponible para iniciar sesión",
      },
      {
        result: { status: "account_locked", retryAfterMinutes: 9 },
        expectSubstring: "9",
      },
    ];

    const seenTexts = new Set<string>();

    for (const { result, expectSubstring } of cases) {
      mockedLogin.mockResolvedValue(result);
      const { unmount } = render(<LoginForm redirectParam={null} />);

      await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
      await user.type(screen.getByLabelText("Contraseña"), "clave123");
      await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(expectSubstring);
      expect(seenTexts.has(alert.textContent ?? "")).toBe(false);
      seenTexts.add(alert.textContent ?? "");

      unmount();
    }

    expect(seenTexts.size).toBe(cases.length);
  });
});
