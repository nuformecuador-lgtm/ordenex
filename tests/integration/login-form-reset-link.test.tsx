// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "@/app/login/_components/LoginForm";

/**
 * ESTE ARCHIVO CAMBIÓ DE SIGNO EL 2026-09-04, y el nombre se conserva a propósito para que la
 * historia siga siendo legible: nació para exigir el enlace «¿Olvidaste tu contraseña?»
 * (R18 de la feature 20) y ahora exige lo contrario, que NO esté.
 *
 * Por qué: el destino de ese enlace, `/recuperar-contrasena`, manda un OTP por correo y el SMTP
 * de Gmail rechaza la credencial con `535-5.7.8 Username and Password not accepted`. El envío
 * falla siempre y falla MUDO —el paso 1 responde un `ok` genérico anti-enumeración—, así que
 * medido en producción hubo 12 intentos de 2 personas reales sin un solo correo entregado.
 *
 * Cuando el correo vuelva a funcionar, este archivo se revierte junto con el enlace: el caso
 * original está abajo, escrito, para que reponerlo sea copiar y pegar.
 */

// Las Server Actions no se ejercitan en este test; se mockean para aislar el render.
vi.mock("@/lib/actions/auth", () => ({
  login: vi.fn(),
  verifyChallenge: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("LoginForm — el enlace de recuperación está retirado (2026-09-04)", () => {
  it("no ofrece ningún enlace hacia /recuperar-contrasena en la fase de credenciales", () => {
    render(<LoginForm redirectParam={null} />);

    // CONTROL DE NO-VACUIDAD: el formulario SÍ se renderizó. Sin esto, cualquier fallo de
    // montaje (un import roto, un throw en el render) dejaría este test verde con la pantalla
    // de login caída, que es exactamente el fallo mudo que esta ficha vino a quitar.
    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();

    const enlaces = screen.getAllByRole("link");
    expect(enlaces.map((a) => a.getAttribute("href"))).not.toContain(
      "/recuperar-contrasena",
    );
    expect(
      screen.queryByRole("link", { name: "¿Olvidaste tu contraseña?" }),
    ).not.toBeInTheDocument();
  });

  it("conserva el enlace de postulación pública, que NO entra en esta desactivación", () => {
    render(<LoginForm redirectParam={null} />);

    // La otra mitad del par: retirar el de recuperación no puede llevarse por delante el de
    // postulación (feature 21, única vía de auto-registro). Es el control que distingue
    // «quitaron UN enlace» de «se cayó el bloque de enlaces entero».
    const postulacion = screen.getByRole("link", {
      name: "¿Quieres ser mensajero? Postúlate aquí",
    });
    expect(postulacion).toHaveAttribute("href", "/postulacion");
  });
});

/*
 * EL CASO ORIGINAL, para reponerlo tal cual cuando el correo vuelva a enviar:
 *
 *   it("muestra un enlace hacia la ruta de reset en la fase de credenciales", () => {
 *     render(<LoginForm redirectParam={null} />);
 *
 *     const link = screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" });
 *     expect(link).toHaveAttribute("href", "/recuperar-contrasena");
 *   });
 */
