// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecuperacionDesactivadaAviso } from "@/app/recuperar-contrasena/_components/RecuperacionDesactivadaAviso";

/**
 * Desactivacion del 2026-09-04. Lo que este archivo defiende es el CONTENIDO del mensaje, que
 * es la parte acordada con el humano y la unica que le sirve a quien se quedo fuera: decir a
 * QUIEN acudir. Un «vuelve mas tarde» o un error tecnico dejarian esta pantalla igual de inutil
 * que el formulario que sustituye —el formulario tampoco fallaba a la vista, respondia `ok` y
 * no enviaba nada—.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Literal, escrito a mano. Derivarlo del componente seria compararlo consigo mismo.
const MENSAJE =
  "Para recuperar tu contraseña, pídele a un administrador que te la restablezca.";

describe("RecuperacionDesactivadaAviso — el mensaje que sustituye al formulario", () => {
  it("dice a quien acudir, con el texto acordado", () => {
    render(<RecuperacionDesactivadaAviso />);

    expect(screen.getByText(MENSAJE)).toBeInTheDocument();
  });

  it("encabeza con la pregunta que trae quien llega, como titulo de nivel 1", () => {
    render(<RecuperacionDesactivadaAviso />);

    const titulo = screen.getByRole("heading", { level: 1 });
    expect(titulo).toHaveTextContent("¿Olvidaste tu contraseña?");
  });

  it("ofrece la vuelta al login: la ruta no puede ser un callejon sin salida", () => {
    render(<RecuperacionDesactivadaAviso />);

    expect(screen.getByRole("link", { name: "Volver a iniciar sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("no pide ningun dato: ni correo, ni codigo, ni contrasena", () => {
    render(<RecuperacionDesactivadaAviso />);

    // El fallo que esto ataja es el peor de todos: una pantalla que SIGUE pidiendo el correo
    // y sigue sin enviar nada. Cero controles de formulario, no «los del paso 1 escondidos».
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(document.querySelectorAll("form")).toHaveLength(0);
  });

  it("no enseña el error tecnico del correo a quien solo quiere entrar", () => {
    render(<RecuperacionDesactivadaAviso />);

    // La causa (535 / SMTP / EAUTH) vive en los comentarios del codigo, que es donde le sirve
    // a quien lo lea dentro de tres meses. En pantalla no pinta nada.
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/535|SMTP|EAUTH|correo electrónico no|error/i);
  });
});
