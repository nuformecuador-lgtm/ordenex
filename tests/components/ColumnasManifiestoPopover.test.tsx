// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnasManifiestoPopover } from "@/components/shared/ColumnasManifiestoPopover";
import { claveColumnas } from "@/lib/manifiesto/preferencia-columnas";
import { etiquetaColumna } from "@/lib/manifiesto/etiquetas-columnas";
import { COLUMNAS_MANIFIESTO } from "@/lib/utils/manifiesto-xlsx";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";

// ---------------------------------------------------------------------------
// Feature 194 — T9. R23 ES LA REGLA QUE GOBIERNA ESTE ARCHIVO: el conjunto de
// columnas del manifiesto es ABIERTO (feature 160/R28). NINGUN aserto puede
// afirmar "exactamente N columnas". Todo se expresa como presencia, ausencia u
// orden RELATIVO por clave, y cuando hace falta un total se DERIVA de
// `COLUMNAS_MANIFIESTO`, jamás de un literal.
// ---------------------------------------------------------------------------

const FLUJO: ManifiestoFlujo = "carga_masiva";

/** Cabeceras publicadas, en el orden del archivo. Derivado, nunca escrito a mano. */
const HEADERS = COLUMNAS_MANIFIESTO.map((columna) => columna.header);

/** Primera columna publicada: se usa como "la que queda" en los casos de mínimo. */
const PRIMERA = COLUMNAS_MANIFIESTO[0]!;

function guardar(flujo: ManifiestoFlujo, ocultas: string[]): void {
  window.localStorage.setItem(
    claveColumnas(flujo),
    JSON.stringify({ ocultas }),
  );
}

function leerGuardado(flujo: ManifiestoFlujo): string | null {
  return window.localStorage.getItem(claveColumnas(flujo));
}

/** Nombre accesible de una casilla, resuelto por su `aria-labelledby`. */
function nombreDe(casilla: HTMLElement): string {
  const id = casilla.getAttribute("aria-labelledby");
  return (id && document.getElementById(id)?.textContent) || "";
}

/** Cabeceras tal y como aparecen en el DOM, extraídas del `(clave_maquina)`. */
function headersEnPantalla(): string[] {
  return screen.getAllByRole("checkbox").map((casilla) => {
    const nombre = nombreDe(casilla);
    const encontrado = /\(([^()]+)\)\s*$/.exec(nombre);
    return encontrado ? encontrado[1]! : nombre;
  });
}

async function abrirSelector() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Elegir columnas del manifiesto" }),
  );
  await screen.findByText("Columnas del manifiesto");
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ColumnasManifiestoPopover", () => {
  it("R1 — ofrece un control propio que abre la elección de columnas del manifiesto", async () => {
    render(<ColumnasManifiestoPopover flujo={FLUJO} />);

    const control = screen.getByRole("button", {
      name: "Elegir columnas del manifiesto",
    });
    expect(control).toBeInTheDocument();
    expect(screen.queryByText("Columnas del manifiesto")).toBeNull();

    const user = userEvent.setup();
    await user.click(control);

    expect(await screen.findByText("Columnas del manifiesto")).toBeVisible();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("R2 — presenta una casilla por columna publicada, en el orden del archivo", async () => {
    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    // Presencia: ninguna columna publicada falta.
    for (const header of HEADERS) {
      expect(
        screen.getByRole("checkbox", { name: new RegExp(`\\(${header}\\)`) }),
      ).toBeInTheDocument();
    }

    // Orden RELATIVO: la secuencia del DOM es la de `COLUMNAS_MANIFIESTO`.
    expect(headersEnPantalla()).toEqual(HEADERS);
  });

  it("R3 — refleja marcada la columna visible y desmarcada la oculta según lo guardado", async () => {
    const ocultada = COLUMNAS_MANIFIESTO[3]!;
    guardar(FLUJO, [ocultada.key]);

    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    expect(
      screen.getByRole("checkbox", {
        name: new RegExp(`\\(${ocultada.header}\\)`),
      }),
    ).toHaveAttribute("aria-checked", "false");

    for (const columna of COLUMNAS_MANIFIESTO) {
      if (columna.key === ocultada.key) continue;
      expect(
        screen.getByRole("checkbox", {
          name: new RegExp(`\\(${columna.header}\\)`),
        }),
      ).toHaveAttribute("aria-checked", "true");
    }
  });

  it("R4 — el nombre accesible de cada casilla contiene la clave máquina de su cabecera", async () => {
    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    for (const columna of COLUMNAS_MANIFIESTO) {
      const casilla = screen.getByRole("checkbox", {
        name: new RegExp(`\\(${columna.header}\\)`),
      });
      expect(nombreDe(casilla)).toContain(columna.header);
    }
  });

  it("R5 — una columna sin etiqueta declarada se muestra con su propia clave máquina", async () => {
    // El texto de cada opción es `etiquetaColumna(header) (header)`. Con el fallback al
    // propio header, una cabecera publicada mañana sin etiqueta se rinde igualmente, con
    // su clave como texto legible. No se toca el mapa de etiquetas.
    expect(etiquetaColumna("columna_inventada")).toBe("columna_inventada");

    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    // Y ninguna casilla queda sin texto: toda columna publicada aparece nombrada.
    for (const casilla of screen.getAllByRole("checkbox")) {
      expect(nombreDe(casilla).trim().length).toBeGreaterThan(0);
    }
  });

  it("R6 — «Restablecer» deja todas las columnas publicadas marcadas y guarda la lista vacía", async () => {
    guardar(
      FLUJO,
      COLUMNAS_MANIFIESTO.slice(1, 3).map((columna) => columna.key),
    );

    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    const user = await abrirSelector();

    await user.click(screen.getByRole("button", { name: "Restablecer" }));

    for (const columna of COLUMNAS_MANIFIESTO) {
      expect(
        screen.getByRole("checkbox", {
          name: new RegExp(`\\(${columna.header}\\)`),
        }),
      ).toHaveAttribute("aria-checked", "true");
    }
    expect(leerGuardado(FLUJO)).toBe(JSON.stringify({ ocultas: [] }));
  });

  it("R12 — con una sola columna marcada, esa casilla se deshabilita y el aviso de mínimo es visible", async () => {
    guardar(
      FLUJO,
      COLUMNAS_MANIFIESTO.filter((columna) => columna.key !== PRIMERA.key).map(
        (columna) => columna.key,
      ),
    );

    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    const ultima = screen.getByRole("checkbox", {
      name: new RegExp(`\\(${PRIMERA.header}\\)`),
    });
    expect(ultima).toHaveAttribute("aria-checked", "true");
    // Base UI rinde la casilla como `role="checkbox"` no nativo: el estado deshabilitado
    // viaja en `aria-disabled`, que es lo que lee la tecnología asistiva.
    expect(ultima).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Debe quedar al menos una columna")).toBeVisible();

    // Las desmarcadas siguen disponibles: el mínimo bloquea quitar, nunca añadir.
    const otra = screen.getByRole("checkbox", {
      name: new RegExp(`\\(${COLUMNAS_MANIFIESTO[1]!.header}\\)`),
    });
    expect(otra).not.toHaveAttribute("aria-disabled", "true");
  });

  it("R12 — un click sobre la última casilla marcada NO la desmarca ni altera lo guardado", async () => {
    // La afordancia (`aria-disabled` + ayuda visible) ya está probada arriba. Este caso
    // prueba la PROHIBICIÓN: aunque el click llegue al elemento, el estado no se mueve.
    guardar(
      FLUJO,
      COLUMNAS_MANIFIESTO.filter((columna) => columna.key !== PRIMERA.key).map(
        (columna) => columna.key,
      ),
    );
    const antes = leerGuardado(FLUJO);

    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    const ultima = screen.getByRole("checkbox", {
      name: new RegExp(`\\(${PRIMERA.header}\\)`),
    });

    // Base UI rinde la casilla como `role="checkbox"` NO nativo y deshabilitado vía
    // `aria-disabled`. Se usa `fireEvent` en vez de `userEvent` a propósito: user-event se
    // negaría a entregar el click (`pointer-events: none`) y el caso quedaría sin probar.
    // `fireEvent` lo entrega igualmente, que es justo lo que hay que demostrar: ni un click
    // que SÍ llega al elemento cambia el estado. No se relaja producción para que pase.
    fireEvent.click(ultima);

    expect(ultima).toHaveAttribute("aria-checked", "true");
    expect(leerGuardado(FLUJO)).toBe(antes);
    expect(screen.getByText("Debe quedar al menos una columna")).toBeVisible();
  });

  it("R12 — sin llegar al mínimo, el aviso no se muestra y las casillas quedan operables", async () => {
    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    expect(screen.queryByText("Debe quedar al menos una columna")).toBeNull();
    for (const casilla of screen.getAllByRole("checkbox")) {
      expect(casilla).not.toHaveAttribute("aria-disabled", "true");
    }
  });
});
