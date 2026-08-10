// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ColumnasManifiestoPopover } from "@/components/shared/ColumnasManifiestoPopover";
import { usePreferenciaColumnasManifiesto } from "@/hooks/usePreferenciaColumnasManifiesto";
import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import { etiquetaColumna } from "@/lib/manifiesto/etiquetas-columnas";
import { claveColumnas } from "@/lib/manifiesto/preferencia-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";

// ---------------------------------------------------------------------------
// Feature 194 — T9bis. Este archivo cierra dos huecos de trazabilidad:
//
//   · R5 CABLEADO (no inferido): hoy se probaba el fallback de `etiquetaColumna`
//     en aislado, pero NUNCA se renderizaba el popover con una columna publicada
//     SIN etiqueta declarada. Aquí sí: el catálogo se sustituye por uno
//     SINTÉTICO, de modo que el recorrido completo
//     `COLUMNAS_MANIFIESTO -> popover -> etiquetaColumna -> texto de la casilla`
//     queda OBSERVADO.
//
//   · R12 GUARD DE CARRERA: `hooks/usePreferenciaColumnasManifiesto.ts:119`
//     protege el mínimo cuando `alternar` se invoca SIN pasar por la UI
//     deshabilitada (dos superficies vivas del mismo flujo). Una sonda llama a
//     `alternar` directamente y comprueba que no se puede quedar sin columnas.
//
// R23 (conjunto ABIERTO, feature 160/R28) GOBIERNA TAMBIÉN AQUÍ. Que el catálogo
// sea mockeado con tres columnas inventadas ES, en sí mismo, la demostración de
// que nada del código bajo prueba asume las columnas reales ni su número: los
// asertos hablan de presencia, ausencia y orden RELATIVO por clave, y el único
// `toEqual` sobre una lista es contra las claves SINTÉTICAS de este archivo,
// jamás contra las publicadas de verdad.
// ---------------------------------------------------------------------------

/**
 * Catálogo SINTÉTICO. `columna_publicada_manana` NO figura en el mapa de
 * `lib/manifiesto/etiquetas-columnas.ts` — ese es justamente el caso de R5, y el
 * mapa NO se toca para acomodarlo.
 */
vi.mock("@/lib/manifiesto/columnas-publicadas", () => ({
  COLUMNAS_MANIFIESTO: [
    { key: "numGuia", header: "num_guia" },
    { key: "publicadaManana", header: "columna_publicada_manana" },
    { key: "fecha", header: "fecha" },
  ],
}));

const FLUJO: ManifiestoFlujo = "carga_masiva";

/** La columna sintética SIN etiqueta declarada. Derivada, no escrita a mano. */
const SIN_ETIQUETA = COLUMNAS_MANIFIESTO.find(
  (columna) => etiquetaColumna(columna.header) === columna.header,
)!;

/** Las sintéticas que SÍ tienen etiqueta legible declarada. */
const CON_ETIQUETA = COLUMNAS_MANIFIESTO.filter(
  (columna) => etiquetaColumna(columna.header) !== columna.header,
);

function guardar(ocultas: string[]): void {
  window.localStorage.setItem(
    claveColumnas(FLUJO),
    JSON.stringify({ ocultas }),
  );
}

function leerGuardado(): string | null {
  return window.localStorage.getItem(claveColumnas(FLUJO));
}

/** Nombre accesible de una casilla, resuelto por su `aria-labelledby`. */
function nombreDe(casilla: HTMLElement): string {
  const id = casilla.getAttribute("aria-labelledby");
  return (id && document.getElementById(id)?.textContent) || "";
}

async function abrirSelector() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Elegir columnas del manifiesto" }),
  );
  await screen.findByText("Columnas del manifiesto");
  return user;
}

/**
 * Sonda mínima: consume el hook y ofrece un botón por columna sintética que
 * llama `alternar` DIRECTAMENTE, sin pasar por la casilla deshabilitada. Es la
 * única forma de ejercitar el guard de carrera del hook (R12), porque la UI
 * jamás dejaría llegar ese click.
 */
function SondaPreferencia() {
  const { clavesVisibles, alternar } = usePreferenciaColumnasManifiesto(FLUJO);
  return (
    <div>
      <span data-testid="visibles">{clavesVisibles.join(",")}</span>
      {COLUMNAS_MANIFIESTO.map((columna) => (
        <button
          key={columna.key}
          type="button"
          onClick={() => alternar(columna.key)}
        >
          {`alternar-${columna.key}`}
        </button>
      ))}
    </div>
  );
}

function clavesVisiblesEnSonda(): string[] {
  const texto = screen.getByTestId("visibles").textContent ?? "";
  return texto === "" ? [] : texto.split(",");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ColumnasManifiestoPopover — catálogo ABIERTO (catálogo sintético)", () => {
  it("R5 — una columna publicada SIN etiqueta declarada se rinde como casilla, nombrada con su clave máquina", async () => {
    // Premisa del caso: la columna existe en el catálogo y NO tiene etiqueta.
    expect(SIN_ETIQUETA).toBeDefined();
    expect(etiquetaColumna(SIN_ETIQUETA.header)).toBe(SIN_ETIQUETA.header);

    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    await abrirSelector();

    // Aparece: ni se omite ni rompe el render.
    const casilla = screen.getByRole("checkbox", {
      name: new RegExp(`\\(${SIN_ETIQUETA.header}\\)`),
    });
    expect(casilla).toBeInTheDocument();

    // Su nombre accesible es su propia clave máquina, no vacío ni "undefined".
    const nombre = nombreDe(casilla);
    expect(nombre.trim().length).toBeGreaterThan(0);
    expect(nombre).not.toContain("undefined");
    expect(nombre).toBe(
      `${etiquetaColumna(SIN_ETIQUETA.header)} (${SIN_ETIQUETA.header})`,
    );
    expect(nombre).toContain(SIN_ETIQUETA.header);

    // Y las que SÍ tienen etiqueta se rinden con la etiqueta legible ADEMÁS de
    // su clave entre paréntesis. El texto esperado se DERIVA de
    // `etiquetaColumna`, nunca de un literal escrito a mano.
    expect(CON_ETIQUETA.length).toBeGreaterThan(0);
    for (const columna of CON_ETIQUETA) {
      const otra = screen.getByRole("checkbox", {
        name: new RegExp(`\\(${columna.header}\\)`),
      });
      expect(nombreDe(otra)).toBe(
        `${etiquetaColumna(columna.header)} (${columna.header})`,
      );
      expect(nombreDe(otra)).not.toBe(`${columna.header} (${columna.header})`);
    }
  });

  it("R5 — la columna sin etiqueta participa del mecanismo: se desmarca y se persiste su clave", async () => {
    render(<ColumnasManifiestoPopover flujo={FLUJO} />);
    const user = await abrirSelector();

    const casilla = screen.getByRole("checkbox", {
      name: new RegExp(`\\(${SIN_ETIQUETA.header}\\)`),
    });
    expect(casilla).toHaveAttribute("aria-checked", "true");

    await user.click(casilla);

    expect(casilla).toHaveAttribute("aria-checked", "false");
    expect(leerGuardado()).toBe(
      JSON.stringify({ ocultas: [SIN_ETIQUETA.key] }),
    );
  });
});

describe("usePreferenciaColumnasManifiesto — guard de mínimo fuera de la UI", () => {
  it("R12 — `alternar` invocado directamente NO puede ocultar la última columna visible", async () => {
    // Quedan ocultas todas menos una: el escenario de la carrera entre dos
    // superficies vivas, donde la UI de la otra pestaña aún cree que sobran.
    const [unicaVisible, ...ocultasIniciales] = COLUMNAS_MANIFIESTO;
    guardar(ocultasIniciales.map((columna) => columna.key));
    const antes = leerGuardado();

    render(<SondaPreferencia />);
    expect(clavesVisiblesEnSonda()).toEqual([unicaVisible!.key]);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: `alternar-${unicaVisible!.key}` }),
    );

    // El almacenamiento no se movió ni un carácter.
    expect(leerGuardado()).toBe(antes);
    // Y la columna sigue visible.
    expect(clavesVisiblesEnSonda()).toContain(unicaVisible!.key);
  });

  it("R12 — el guard DISCRIMINA: con dos columnas visibles, `alternar` sí oculta una", async () => {
    // Contraste positivo: sin él, el test anterior también pasaría con la
    // función muerta.
    const [primera, segunda, tercera] = COLUMNAS_MANIFIESTO;
    guardar([tercera!.key]);

    render(<SondaPreferencia />);
    expect(clavesVisiblesEnSonda()).toEqual([primera!.key, segunda!.key]);

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: `alternar-${segunda!.key}` }),
    );

    expect(clavesVisiblesEnSonda()).toEqual([primera!.key]);
    expect(leerGuardado()).toBe(
      JSON.stringify({ ocultas: [tercera!.key, segunda!.key] }),
    );
  });
});
