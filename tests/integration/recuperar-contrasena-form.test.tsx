// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecuperarContrasenaForm } from "@/app/recuperar-contrasena/_components/RecuperarContrasenaForm";
import {
  solicitarRecuperacion,
  verificarCodigoRecuperacion,
  restablecerContrasena,
} from "@/lib/actions/password-reset";

// Mock de las Server Actions reales que consume el formulario. Nunca se toca
// lib/actions/password-reset.ts; solo se reemplaza su implementacion.
vi.mock("@/lib/actions/password-reset", () => ({
  solicitarRecuperacion: vi.fn(),
  verificarCodigoRecuperacion: vi.fn(),
  restablecerContrasena: vi.fn(),
}));

// next/link como ancla simple (sin router de app).
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockedSolicitar = vi.mocked(solicitarRecuperacion);
const mockedVerificar = vi.mocked(verificarCodigoRecuperacion);
const mockedRestablecer = vi.mocked(restablecerContrasena);

beforeEach(() => {
  vi.clearAllMocks();
});

async function avanzarAFaseCodigo(user: ReturnType<typeof userEvent.setup>) {
  mockedSolicitar.mockResolvedValue({ status: "ok" });
  await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await user.click(screen.getByRole("button", { name: "Enviar código" }));
  await screen.findByLabelText("Código de verificación");
}

async function avanzarAFasePassword(user: ReturnType<typeof userEvent.setup>) {
  await avanzarAFaseCodigo(user);
  mockedVerificar.mockResolvedValue({ status: "ok" });
  await user.type(screen.getByLabelText("Código de verificación"), "123456");
  await user.click(screen.getByRole("button", { name: "Verificar código" }));
  await screen.findByLabelText("Nueva contraseña");
}

describe("RecuperarContrasenaForm — fase email (R16)", () => {
  it("avanza de email a código tras solicitar con respuesta genérica ok", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);

    mockedSolicitar.mockResolvedValue({ status: "ok" });
    await user.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    await waitFor(() =>
      expect(mockedSolicitar).toHaveBeenCalledWith({ email: "ana@example.com" }),
    );
    expect(await screen.findByLabelText("Código de verificación")).toBeInTheDocument();
    expect(screen.queryByLabelText("Correo electrónico")).not.toBeInTheDocument();
  });

  it("bloquea el envío y no invoca la action con un correo inválido", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);

    await user.type(screen.getByLabelText("Correo electrónico"), "no-es-correo");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(await screen.findByText("Correo electrónico inválido")).toBeInTheDocument();
    expect(mockedSolicitar).not.toHaveBeenCalled();
  });
});

describe("RecuperarContrasenaForm — fase código (R6/R16)", () => {
  it("muestra un error genérico con código inválido y no distingue la causa", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFaseCodigo(user);

    mockedVerificar.mockResolvedValue({ status: "invalid_or_expired" });
    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar código" }));

    expect(
      await screen.findByText(/El código es inválido o ha expirado/),
    ).toBeInTheDocument();
    // Se mantiene en la fase de código (no avanza a nueva contraseña).
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("avanza a nueva contraseña tras verificar con éxito", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    expect(screen.getByLabelText("Nueva contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmar contraseña")).toBeInTheDocument();
  });
});

describe("RecuperarContrasenaForm — fase contraseña (R7/R17)", () => {
  it("muestra confirmación y enlace a login tras restablecer con éxito", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    mockedRestablecer.mockResolvedValue({ status: "ok" });
    await user.type(screen.getByLabelText("Nueva contraseña"), "Abcdef1!");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "Abcdef1!");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    expect(await screen.findByText("Contraseña actualizada")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ir a iniciar sesión" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("bloquea el envío con confirmación distinta y no invoca la action", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    await user.type(screen.getByLabelText("Nueva contraseña"), "Abcdef1!");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "Distinta1!");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    expect(await screen.findByText("Las contraseñas no coinciden")).toBeInTheDocument();
    expect(mockedRestablecer).not.toHaveBeenCalled();
  });

  it("muestra error genérico si el desafío ya no está activo (invalid_or_expired)", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    mockedRestablecer.mockResolvedValue({ status: "invalid_or_expired" });
    await user.type(screen.getByLabelText("Nueva contraseña"), "Abcdef1!");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "Abcdef1!");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    expect(
      await screen.findByText(/El código es inválido o ha expirado/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Contraseña actualizada")).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// Feature 286 — el ojito, en la fase de contraseña
// ─────────────────────────────────────────────────────────────────────────────────────

describe("RecuperarContrasenaForm — el ojito de cada contraseña (286: R1, R9, R13, R14)", () => {
  it("R1/R14: los dos campos de la fase tienen ojito, con su propio nombre accesible", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    expect(screen.getByLabelText("Nueva contraseña")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("Confirmar contraseña")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByRole("button", { name: "Nueva contraseña: oculta. Mostrar." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmar contraseña: oculta. Mostrar." }),
    ).toBeInTheDocument();
  });

  it("R9: revelar «Nueva contraseña» NO revela «Confirmar contraseña», ni al reves", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    const nueva = screen.getByLabelText("Nueva contraseña");
    const confirmar = screen.getByLabelText("Confirmar contraseña");

    await user.click(
      screen.getByRole("button", { name: "Nueva contraseña: oculta. Mostrar." }),
    );
    expect(nueva).toHaveAttribute("type", "text");
    expect(confirmar).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: "Confirmar contraseña: oculta. Mostrar." }),
    );
    expect(nueva).toHaveAttribute("type", "text");
    expect(confirmar).toHaveAttribute("type", "text");

    await user.click(
      screen.getByRole("button", { name: "Nueva contraseña: visible. Ocultar." }),
    );
    expect(nueva).toHaveAttribute("type", "password");
    expect(confirmar).toHaveAttribute("type", "text");
  });

  it("R10: pulsar el ojito no restablece nada ni pierde lo tecleado", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    await user.type(screen.getByLabelText("Nueva contraseña"), "Abcdef1!");
    await user.click(
      screen.getByRole("button", { name: "Nueva contraseña: oculta. Mostrar." }),
    );

    expect(mockedRestablecer).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nueva contraseña")).toHaveValue("Abcdef1!");
  });

  it("R13: el `ref` sigue llegando al input — al fallar la validacion, el foco va al campo", async () => {
    const user = userEvent.setup();
    render(<RecuperarContrasenaForm />);
    await avanzarAFasePassword(user);

    // Contraseña que no cumple la politica: la validacion de cliente falla y el
    // formulario mueve el foco al campo por su `ref`. Si el `ref` se hubiera quedado en
    // el envoltorio, esto dejaria de enfocar el input y nadie se enteraria.
    await user.type(screen.getByLabelText("Nueva contraseña"), "corta");
    await user.type(screen.getByLabelText("Confirmar contraseña"), "corta");
    await user.click(screen.getByRole("button", { name: "Restablecer contraseña" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Nueva contraseña")).toHaveFocus(),
    );
    expect(mockedRestablecer).not.toHaveBeenCalled();
  });
});
