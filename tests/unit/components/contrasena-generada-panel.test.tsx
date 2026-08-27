// @vitest-environment jsdom
//
// FEATURE 287 (T9) — el panel de «se muestra UNA sola vez».
//
// Requisitos que se afirman aqui: **R24 (mitad de cliente), R25, R28, R29**.
//
// La mitad de cliente de R24 no la cubria nadie: el backend probo que el claro no se PERSISTE
// en la base (R12), pero «ningun almacen» incluye `localStorage`, `sessionStorage` y la cookie
// del navegador, y eso solo se puede afirmar aqui. Se comprueba de las dos formas que se
// complementan: leyendo los almacenes DESPUES del flujo completo (mata un `setItem` real) y
// leyendo el ARBOL del componente (mata el que nadie ejecuta en test).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";
import { ContrasenaGeneradaPanel } from "@/app/(app)/configuracion/_components/ContrasenaGeneradaPanel";

const CLARO = "Xk7#mQp2Lz9!";

const RUTA_PANEL = "app/(app)/configuracion/_components/ContrasenaGeneradaPanel.tsx";

/**
 * El CODIGO del panel, sin comentarios. La cabecera del archivo explica en prosa por que no
 * usa `localStorage` —y esa prosa NOMBRA el almacen—: leer el archivo en bruto haria que la
 * explicacion se leyera como la infraccion. Es el mismo quitador con el que miden las 171
 * suites del arnes (feature 283).
 */
function codigoDelPanel(): string {
  return codigoSinComentarios(RUTA_PANEL);
}

function pintar(contrasena = CLARO) {
  return render(
    <ContrasenaGeneradaPanel
      contrasena={contrasena}
      encabezado="Contraseña nueva de Ana Pérez."
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ContrasenaGeneradaPanel — muestra el claro y avisa de que no vuelve (R28)", () => {
  it("pinta el valor, el encabezado y el aviso de que no se volvera a mostrar (R28)", () => {
    pintar();

    expect(screen.getByLabelText("Contraseña generada")).toHaveValue(CLARO);
    expect(screen.getByText("Contraseña nueva de Ana Pérez.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Guárdala ahora: no se volverá a mostrar.",
    );
  });

  it("copia al portapapeles el valor EXACTO y lo confirma en pantalla (R28)", async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: escribir },
      configurable: true,
      writable: true,
    });
    // `userEvent.setup()` instala su propio stub de clipboard: el nuestro va DESPUES.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: escribir },
      configurable: true,
      writable: true,
    });

    pintar();
    await user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(escribir).toHaveBeenCalledTimes(1);
    expect(escribir).toHaveBeenCalledWith(CLARO);
    expect(await screen.findByRole("button", { name: "Copiada" })).toBeInTheDocument();
    // La confirmacion tambien se anuncia a quien no ve el boton.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Contraseña copiada al portapapeles",
    );
  });

  it("si el portapapeles no existe no revienta, y la contrasena sigue en pantalla", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    pintar();
    await user.click(screen.getByRole("button", { name: "Copiar" }));

    // No cambia a «Copiada» —porque no copio— pero el valor sigue visible y seleccionable,
    // que es la via que siempre funciona.
    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña generada")).toHaveValue(CLARO);
  });
});

describe("ContrasenaGeneradaPanel — no hay donde ESCRIBIR una contrasena (R25)", () => {
  it("el unico campo es de SOLO LECTURA y no es de tipo password", () => {
    const { container } = pintar();

    const inputs = [...container.querySelectorAll("input")];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("readonly");
    expect(inputs[0]!.type).not.toBe("password");
  });

  it("escribir en el campo no cambia su valor: el maestro RESTABLECE, no FIJA (R25/A3)", async () => {
    const user = userEvent.setup();
    pintar();

    const campo = screen.getByLabelText("Contraseña generada");
    await user.click(campo);
    await user.keyboard("elegida-por-el-maestro");

    expect(campo).toHaveValue(CLARO);
  });
});

describe("ContrasenaGeneradaPanel — ninguna via de volver a pedirla (R29)", () => {
  it("el unico control del panel es copiar: no hay «ver», «mostrar» ni «reenviar»", () => {
    const { container } = pintar();
    const panel = within(container.querySelector("[data-testid='contrasena-generada-panel']")!);

    const botones = panel.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(botones).toEqual(["Copiar"]);
  });

  it("el componente no conoce al usuario ni importa ninguna Server Action (R29)", () => {
    const codigo = codigoDelPanel();

    // Anti-vacuidad: el quitador no devolvio un archivo en blanco y es el que creemos.
    expect(codigo.trim().length).toBeGreaterThan(200);
    expect(codigo).toContain("export function ContrasenaGeneradaPanel");
    // Sin import de acciones no hay forma de volver a pedir NADA desde aqui.
    expect(codigo).not.toMatch(/from\s+"@\/lib\/actions\//);
    expect(codigo).not.toMatch(/\busuarioId\b/);
  });
});

describe("ContrasenaGeneradaPanel — la mitad de cliente de R24: ningun almacen", () => {
  it("tras pintar y copiar, `localStorage`, `sessionStorage` y la cookie siguen vacios", async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: escribir },
      configurable: true,
      writable: true,
    });

    pintar();
    await user.click(screen.getByRole("button", { name: "Copiar" }));

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    // Y por si algun dia hay otras claves en el almacen: el claro no esta en ninguna.
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(CLARO);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(CLARO);
  });

  it("el CODIGO del componente no nombra ningun almacen persistente (R24)", () => {
    const codigo = codigoDelPanel();
    const almacenes = ["localStorage", "sessionStorage", "document.cookie", "indexedDB"];

    for (const almacen of almacenes) {
      expect(
        codigo,
        `el panel usa \`${almacen}\`: por ahi se filtra el claro fuera de la vida del componente`,
      ).not.toContain(almacen);
    }

    // ⭑ Autocomprobacion: sin esto el bloque estaria verde por no mirar nada. El detector se
    // prueba contra un texto que SI infringe y otro que no.
    const infractor = `${codigo}\nwindow.localStorage.setItem("p", contrasena);`;
    expect(almacenes.some((a) => infractor.includes(a))).toBe(true);
    expect(almacenes.some((a) => "const x = 1;".includes(a))).toBe(false);
  });
});
