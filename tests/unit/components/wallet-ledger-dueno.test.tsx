// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readdirSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { codigoSinComentarios } from "@/tests/fixtures/money-safe";

vi.mock("@/lib/actions/wallet-egresos", () => ({
  reversarEgresoAdministrativoAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { WalletLedger } from "@/app/(app)/wallet/_components/WalletLedger";
import { DUENO_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";

/**
 * Feature 231 (T5.4) — la columna «Dueño» del libro de la caja.
 *
 * El libro de la caja mezcla en el mismo listado dinero de Ordenex y dinero que solo PASA por
 * la caja a nombre de las tiendas. Hasta ahora había que saberse de memoria qué categoría era
 * de quién; esta columna lo dice.
 *
 * Las dos cosas que esta suite protege:
 *
 *  - que la columna sea PUNTO + TEXTO y no una insignia (R33). La tabla ya lleva una pastilla
 *    por fila —la del tipo—, y una segunda al lado convierte cada renglón en un semáforo doble
 *    donde ninguna de las dos se lee.
 *  - que el dueño lo derive el SERVIDOR (R31/R36). Si el cliente lo dedujera de la categoría,
 *    habría dos definiciones del mismo hecho y la tabla podría acabar diciendo una cosa y la
 *    descarga otra.
 */
const INGRESO_PROPIO: WalletMovimientoDTO = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tipo: "ingreso",
  categoria: "ingreso_flete",
  monto: "1500.00",
  origenTipo: "cierre_dia",
  origenId: "cierre-1",
  descripcion: "Flete del día",
  registradoPor: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "propio",
};

const INGRESO_DE_TERCEROS: WalletMovimientoDTO = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tipo: "ingreso",
  categoria: "ingreso_cod_recaudado",
  monto: "10000.00",
  origenTipo: "cierre_dia",
  origenId: "cierre-1",
  descripcion: "Contra-entrega del día",
  registradoPor: null,
  fechaMovimiento: "2026-07-12T10:00:00.000Z",
  dueno: "terceros",
};

const RAIZ = path.resolve(__dirname, "../../..");
const CARPETA_WALLET = "app/(app)/wallet";

function renderLedger(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Todas las fuentes vivas bajo `app/(app)/wallet/`, recursivamente. */
function fuentesDeWallet(dir = CARPETA_WALLET, acc: string[] = []): string[] {
  for (const entrada of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const ruta = `${dir}/${entrada.name}`;
    if (entrada.isDirectory()) fuentesDeWallet(ruta, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(ruta);
  }
  return acc;
}

/** El índice de la columna «Dueño» y las celdas de cada fila de datos. */
function tablaDelLibro() {
  const tabla = screen.getByRole("table", { name: "Libro de movimientos" });
  const encabezados = within(tabla)
    .getAllByRole("columnheader")
    .map((c) => c.textContent);
  const columna = encabezados.indexOf("Dueño");
  expect(columna, "el libro no tiene columna «Dueño»").toBeGreaterThan(-1);
  const filas = within(tabla).getAllByRole("row").slice(1);
  return { tabla, columna, filas };
}

afterEach(() => {
  cleanup();
});

describe("WalletLedger — la columna «Dueño» (R31/R33)", () => {
  it("R33: la celda es punto + texto, no un `Badge`", () => {
    renderLedger(<WalletLedger movimientos={[INGRESO_PROPIO, INGRESO_DE_TERCEROS]} />);

    const { columna, filas } = tablaDelLibro();
    expect(filas).toHaveLength(2);

    for (const fila of filas) {
      const celdas = within(fila).getAllByRole("cell");
      const celdaDueno = celdas[columna];

      // El punto: un elemento redondo, pequeño y DECORATIVO — quien no ve color lee la palabra.
      const punto = celdaDueno.querySelector<HTMLElement>("[aria-hidden='true']");
      expect(punto, "la celda no tiene punto de color").not.toBeNull();
      expect(punto?.className).toContain("rounded-full");
      expect(punto?.className).toContain("size-2");
      // Y el texto, al lado.
      expect((celdaDueno.textContent ?? "").trim().length).toBeGreaterThan(0);

      // NO es una insignia.
      expect(
        celdaDueno.querySelector('[data-slot="badge"]'),
        "la celda de «Dueño» es un Badge",
      ).toBeNull();

      // CONTROL DE NO-VACUIDAD del `not`: el detector SÍ encuentra insignias donde las hay.
      // La misma fila lleva una —la del tipo—; sin esta comprobación, un selector mal escrito
      // dejaría la aserción de arriba pasando por no mirar nada.
      const insigniasEnLaFila = fila.querySelectorAll('[data-slot="badge"]');
      expect(insigniasEnLaFila.length, "la fila no tiene ninguna insignia").toBeGreaterThan(0);
      for (const insignia of insigniasEnLaFila) {
        expect(celdaDueno.contains(insignia)).toBe(false);
      }
    }
  });

  it("R31: un movimiento propio y uno de terceros se leen distinto", () => {
    renderLedger(<WalletLedger movimientos={[INGRESO_PROPIO, INGRESO_DE_TERCEROS]} />);

    const { columna, filas } = tablaDelLibro();
    const textos = filas.map((f) => within(f).getAllByRole("cell")[columna].textContent);

    expect(textos).toEqual([DUENO_LABEL.propio, DUENO_LABEL.terceros]);
    // Las dos palabras son distintas: si fueran la misma, la columna no diría nada y este
    // caso pasaría igual.
    expect(DUENO_LABEL.propio).not.toBe(DUENO_LABEL.terceros);
    // Y el punto tampoco es el mismo color en las dos filas.
    const puntos = filas.map(
      (f) =>
        within(f).getAllByRole("cell")[columna].querySelector<HTMLElement>(
          "[aria-hidden='true']",
        )?.className ?? "",
    );
    expect(puntos[0]).not.toBe(puntos[1]);

    // El dato llega del DTO, no de la categoría: mismo movimiento, `dueno` cambiado a mano.
    cleanup();
    renderLedger(
      <WalletLedger movimientos={[{ ...INGRESO_PROPIO, dueno: "terceros" }]} />,
    );
    const segundo = tablaDelLibro();
    expect(
      within(segundo.filas[0]).getAllByRole("cell")[segundo.columna].textContent,
    ).toBe(DUENO_LABEL.terceros);
  });
});

describe("WalletLedger — el dueño no se deriva en el cliente (R36)", () => {
  it("R36: ninguna fuente de `app/wallet` deriva el dueño", () => {
    const fuentes = fuentesDeWallet();

    // CONTROL DE NO-VACUIDAD: una ausencia solo prueba algo si lo ausente existe. Si la ruta
    // estuviera mal escrita, el barrido de abajo no miraría ni un archivo.
    expect(fuentes.length, "el censo de `app/wallet` no encontró fuentes").toBeGreaterThan(20);
    expect(fuentes).toContain("app/(app)/wallet/_components/WalletLedger.tsx");
    expect(fuentes).toContain(
      "app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts",
    );

    for (const ruta of fuentes) {
      const codigo = codigoSinComentarios(ruta);
      // Ni la clasificación…
      expect(codigo, `${ruta} importa la clasificación de categorías`).not.toContain(
        "NATURALEZA_POR_CATEGORIA",
      );
      expect(codigo, `${ruta} importa el módulo que la declara`).not.toContain(
        "caja-tesoreria",
      );
      // …ni una reconstrucción a mano con condicionales sobre la categoría.
      expect(codigo, `${ruta} deduce el dueño de la categoría`).not.toMatch(
        /categoria\s*===|categoria\.startsWith\s*\(|categoria\.includes\s*\(/,
      );
    }

    // Y la única fuente de la palabra es el campo del DTO: quien la pinta la lee, no la calcula.
    const ledger = codigoSinComentarios(
      "app/(app)/wallet/_components/WalletLedger.tsx",
    );
    expect(ledger).toMatch(/m\.dueno|movimiento\.dueno|dueno=\{/);
    const descarga = codigoSinComentarios(
      "app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts",
    );
    expect(descarga).toContain("movimiento.dueno");
  });
});
