// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "@/app/login/_components/LoginForm";

// Las Server Actions no se ejercitan en este test; se mockean para aislar el
// render del enlace de recuperacion (R18).
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

describe("LoginForm — enlace de recuperación (R18)", () => {
  it("muestra un enlace hacia la ruta de reset en la fase de credenciales", () => {
    render(<LoginForm redirectParam={null} />);

    const link = screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" });
    expect(link).toHaveAttribute("href", "/recuperar-contrasena");
  });
});
