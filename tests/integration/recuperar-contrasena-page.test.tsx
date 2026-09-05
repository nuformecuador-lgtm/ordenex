// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mocks de las dependencias server-side de app/recuperar-contrasena/page.tsx.
// El page.tsx (Server Component real) se importa sin mockear: se ejercita su
// logica real de R12 (publico; redirige si hay sesion valida).
//
// 2026-09-04 — LA PAGINA YA NO MONTA EL FORMULARIO. Monta `RecuperacionDesactivadaAviso`
// porque el envio del OTP falla siempre (SMTP de Gmail, `535 Username and Password not
// accepted`) y lo hace en silencio. Aqui el aviso se renderiza DE VERDAD, sin stub: lo que se
// comprueba es el texto que la persona lee, no que la pagina importe un modulo.
const cookieGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const redirectMock = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

const findValidByIdMock = vi.fn();
vi.mock("@/lib/repositories/SessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(function SessionRepositoryMock(this: {
    findValidById: typeof findValidByIdMock;
  }) {
    this.findValidById = findValidByIdMock;
  }),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** El texto acordado con el humano, escrito LITERAL. No se deriva del componente: comparar el
 *  mensaje con la constante que lo genera estaria verde siempre, incluso con la pantalla vacia. */
const MENSAJE =
  "Para recuperar tu contraseña, pídele a un administrador que te la restablezca.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("app/recuperar-contrasena/page.tsx — sesion activa (R12)", () => {
  it("redirige a /dashboard cuando la cookie de sesion es valida segun SessionRepository.findValidById", async () => {
    const { default: RecuperarContrasenaPage } = await import(
      "@/app/recuperar-contrasena/page"
    );
    cookieGetMock.mockReturnValue({ value: "session-abc" });
    findValidByIdMock.mockResolvedValue({
      id: "session-abc",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000 * 60),
      createdAt: new Date(),
    });

    await expect(RecuperarContrasenaPage()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(findValidByIdMock).toHaveBeenCalledWith("session-abc");
  });

  it("sin cookie de sesion dice a quien acudir en vez de pedir un correo", async () => {
    const { default: RecuperarContrasenaPage } = await import(
      "@/app/recuperar-contrasena/page"
    );
    cookieGetMock.mockReturnValue(undefined);

    const element = await RecuperarContrasenaPage();
    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText(MENSAJE)).toBeInTheDocument();

    // NO es un callejon sin salida: hay camino de vuelta al login (R12 sigue siendo una
    // pagina publica alcanzable sin sesion).
    expect(screen.getByRole("link", { name: "Volver a iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );

    // Y NO queda ni un campo del flujo viejo: si el formulario volviera a montarse aqui, la
    // persona escribiria su correo, no le llegaria nada y no se enteraria de por que.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(
      screen.queryByRole("heading", { name: "Recuperar contraseña" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar|Verificar/ })).not.toBeInTheDocument();
  });

  it("con la sesion de la cookie expirada/invalida muestra el mismo aviso, no el formulario", async () => {
    const { default: RecuperarContrasenaPage } = await import(
      "@/app/recuperar-contrasena/page"
    );
    cookieGetMock.mockReturnValue({ value: "session-expired" });
    findValidByIdMock.mockResolvedValue(null);

    const element = await RecuperarContrasenaPage();
    render(element);

    expect(redirectMock).not.toHaveBeenCalled();
    expect(screen.getByText(MENSAJE)).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
