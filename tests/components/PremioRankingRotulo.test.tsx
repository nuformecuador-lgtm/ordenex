// @vitest-environment jsdom
// Feature 293 (T5.4, R34) — **«Premio del ranking» se lee así en las DOS superficies que
// quedan**: el estado de cuenta del mensajero en la oficina y el archivo que sale de él.
//
// Eran CUATRO. La ficha 336 (2026-08-30) borró `/mis-pagos`, y con ella se fueron las otras dos
// —el desglose del propio mensajero y su descarga— junto al mapa de rótulos `mis-pagos-labels`.
// FICHA 458-D (T D.8, D14): el desglose del maestro se retiró; la superficie que lo sustituye es el
// ESTADO DE CUENTA del mensajero (`/wallet/mensajeros/[mensajeroId]`) y su descarga. Siguen siendo DOS.
// Lo que el desglose tenía y el estado de cuenta todavía NO: el enlace de la fila del premio a SU
// cierre (la fila del estado de cuenta no trae el origen con entidad; pendiente de servidor en
// `progress/impl_458-D.md`). El premio se encuentra ahora por su CHIP («Premios»).
//
// Es literalmente lo que el humano pidió ver: «que en el detalle se vea QUÉ PARTE de la cuenta
// es premio» (decisión (d) de la ficha). Por eso la categoría es propia y no se reusó
// `ajuste_devengo`, que se rotula «Ajuste (devengo)» y donde ya viven los contraasientos de la
// anulación de liquidaciones: mezclados, la pregunta no se puede responder sin leer
// descripciones a ojo.
//
// **Las aserciones van contra el LITERAL**, nunca contra `CATEGORIA_PAGO_LABEL[...]`. Comparar
// un texto con la función que lo genera está verde por construcción —ya pasó en este repo— y
// dejaría pasar exactamente el fallo que este archivo persigue: que el premio se rotule igual
// que un ajuste.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ToastProvider } from "@/providers/ToastProvider";
import { estado, fila } from "@/tests/fixtures/estado-cuenta";

/** El rótulo, escrito a mano. Si alguien lo cambia, este archivo se pone rojo y lo dice. */
const ROTULO_PREMIO = "Premio del ranking";
/** El del ajuste, con el que NO se puede confundir (decisión (d)). */
const ROTULO_AJUSTE_DEVENGO = "Ajuste (devengo)";

vi.mock("@/lib/actions/estado-cuenta", () => ({ verEstadoCuentaAction: vi.fn(async () => ({ status: "forbidden" })) }));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));

import { EstadoCuentaMensajero, ROTULOS_MENSAJERO } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { lineaDeFila } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { CATEGORIA_PAGO_LABEL as CATEGORIA_MAESTRO } from "@/app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels";

// --- Datos ---------------------------------------------------------------

/** El premio tal como lo trae el estado de cuenta: devengo propio, chip «Premios», su descripción. */
const PREMIO = fila({
  n: 1,
  libro: "mensajero",
  fecha: "2026-08-27",
  categoria: "premio_ranking",
  origenTipo: "cierre_dia",
  chip: "premios",
  abono: "5000.00",
  saldoCorrido: "5000.00",
  descripcion: "Premio del ranking 2026-08-26 · posición 1 · Bono por buen rendimiento",
  registro: { nombre: null, automatico: { accion: "premio_del_ranking", por: null } },
  anulable: true,
  naceDeUnCierre: false,
});

/** Un ajuste manual, para que el rótulo del premio tenga con qué NO confundirse. */
const AJUSTE = fila({
  n: 2,
  libro: "mensajero",
  fecha: "2026-08-27",
  categoria: "ajuste_devengo",
  origenTipo: "manual",
  chip: "correcciones",
  abono: "500.00",
  saldoCorrido: "5500.00",
  descripcion: "Ajuste manual",
  registro: { nombre: "Ana Admin", automatico: null },
  naceDeUnCierre: false,
});

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>
        <EstadoCuentaMensajero
          inicial={estado({ tipo: "mensajero", nombre: "Kevin Rojas", filas: [PREMIO, AJUSTE], total: 2 })}
          puedeRegistrar={false}
        />
      </ToastProvider>
    </SWRConfig>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

// =========================================================================

describe("R34 — el estado de cuenta del MAESTRO rotula el premio", () => {
  it("la fila del premio dice «Premio del ranking», con su importe y la descripción congelada", () => {
    montar();
    const tabla = screen.getByRole("table", { name: "Estado de cuenta de Kevin Rojas" });
    const fila = within(tabla).getByText(ROTULO_PREMIO).closest("tr") as HTMLElement;
    // Money-safe: el STRING del servidor, formateado y nada más (feature 230: sin céntimos).
    expect(within(fila).getAllByText("₡5.000").length).toBeGreaterThan(0);
    expect(within(fila).getByText(/Premio del ranking 2026-08-26 · posición 1/)).toBeInTheDocument();
    expect(fila.textContent).toContain("Registró: Automático · Premio del ranking");
  });

  it("no se confunde con un ajuste: los dos rótulos conviven y son distintos; el premio tiene su chip", () => {
    montar();
    const tabla = screen.getByRole("table", { name: "Estado de cuenta de Kevin Rojas" });
    expect(within(tabla).getByText(ROTULO_PREMIO)).toBeInTheDocument();
    expect(within(tabla).getByText(ROTULO_AJUSTE_DEVENGO)).toBeInTheDocument();
    expect(ROTULO_PREMIO).not.toBe(ROTULO_AJUSTE_DEVENGO);
    // «Qué parte de esta cuenta es premio» se pregunta con el chip «Premios» (D10).
    expect(screen.getByRole("button", { name: "Premios" })).toBeInTheDocument();
  });
});

describe("R34 — la descarga lleva el mismo rótulo que la pantalla", () => {
  it("la del estado de cuenta emite «Premio del ranking» en la columna del movimiento", () => {
    const linea = lineaDeFila(PREMIO, ROTULOS_MENSAJERO);
    expect(linea.movimiento).toBe(ROTULO_PREMIO);
    // Money-safe (R7 de la 170): el monto sale como el STRING del servidor, sin símbolo.
    expect(linea.abono).toBe("5000.00");
  });

  it("y no lo confunde con un ajuste", () => {
    expect(lineaDeFila(AJUSTE, ROTULOS_MENSAJERO).movimiento).toBe(ROTULO_AJUSTE_DEVENGO);
  });
});

describe("T1.6 — el mapa de rótulos dice «Premio del ranking», y no lo que dice el ajuste", () => {
  // Eran DOS mapas y se comparaban entre sí; `mis-pagos-labels` se fue con la pantalla (336).
  // El que queda se afirma contra el LITERAL, que es como estaba escrito el requisito: comparar
  // un mapa con el otro nunca dijo cuál era el texto, solo que coincidían.
  it("wallet-mensajeros-labels rotula `premio_ranking` como «Premio del ranking»", () => {
    expect(CATEGORIA_MAESTRO.premio_ranking).toBe(ROTULO_PREMIO);
    // El requisito no es «tiene rótulo», es «tiene un rótulo DISTINGUIBLE del de los ajustes».
    expect(CATEGORIA_MAESTRO.premio_ranking).not.toBe(CATEGORIA_MAESTRO.ajuste_devengo);
    expect(CATEGORIA_MAESTRO.premio_ranking).not.toBe(CATEGORIA_MAESTRO.ajuste_pago);
  });
});
