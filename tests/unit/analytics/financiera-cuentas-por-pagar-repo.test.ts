import { describe, it, expect } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { CuentasPorPagarAnaliticaRepository } from "@/lib/repositories/CuentasPorPagarAnaliticaRepository";
import {
  fakePrismaDinero,
  type FilaLedgerMensajero,
  type FilaLedgerTienda,
} from "./_fake-prisma-dinero";

// Feature 127 / T C.3 — `CuentasPorPagarAnaliticaRepository`: R21, R14, R28.
//
// El "hecho cuando" de la tarea es literalmente una mutacion: **un devengo anterior al rango
// entra en el saldo, y añadir `>= desde` lo pone rojo**. Se comprueba por los dos lados:
//   - por el VALOR: el saldo incluye lo de hace tres meses (con `>= desde` se caeria a la mitad);
//   - por la FORMA del `where`: `fechaMovimiento` no tiene `gte` ni `gt`. La segunda asercion
//     existe porque la primera sola se podria "arreglar" moviendo el corte a otro sitio.
//
// Un saldo al corte que se sirviera como flujo del periodo no rompe nada: da una cifra menor,
// creible, y alguien paga de menos. Por eso no basta con que el numero salga; tiene que salir
// POR EL MOTIVO correcto.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-08-02T15:00:00.000Z");
const DESDE = new Date("2026-08-02T06:00:00.000Z");
const HASTA = new Date("2026-08-03T06:00:00.000Z");
const DENTRO = new Date("2026-08-02T14:00:00.000Z");
const HACE_TRES_MESES = new Date("2026-05-04T14:00:00.000Z");

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/* -------------------------------------------------------------------------- */
/* Los dos libros                                                              */
/* -------------------------------------------------------------------------- */

const LEDGER_TIENDA: readonly FilaLedgerTienda[] = [
  // ANTERIOR al rango: es lo que se le sigue debiendo. Tiene que entrar.
  { tiendaId: "tienda-a", categoria: "cod_recaudado", tipo: "credito", monto: "1000.00", fechaMovimiento: HACE_TRES_MESES },
  { tiendaId: "tienda-a", categoria: "flete", tipo: "debito", monto: "200.00", fechaMovimiento: DENTRO },
  { tiendaId: "tienda-b", categoria: "cod_recaudado", tipo: "credito", monto: "500.00", fechaMovimiento: DENTRO },
  // En el corte exacto (`hasta`), que es EXCLUSIVO: fuera.
  { tiendaId: "tienda-a", categoria: "cod_recaudado", tipo: "credito", monto: "777.00", fechaMovimiento: HASTA },
];

const LEDGER_MENSAJERO: readonly FilaLedgerMensajero[] = [
  { mensajeroId: "m-1", categoria: "pago_devengado", tipo: "devengo", monto: "5000.00", fechaMovimiento: HACE_TRES_MESES },
  { mensajeroId: "m-2", categoria: "pago_devengado", tipo: "devengo", monto: "1200.00", fechaMovimiento: DENTRO },
  { mensajeroId: "m-1", categoria: "pago_efectivo", tipo: "pago", monto: "2000.00", fechaMovimiento: DENTRO },
  { mensajeroId: "m-2", categoria: "pago_devengado", tipo: "devengo", monto: "999.00", fechaMovimiento: HASTA },
];

function repositorio(
  ledgerTienda: readonly FilaLedgerTienda[] = LEDGER_TIENDA,
  ledgerMensajero: readonly FilaLedgerMensajero[] = LEDGER_MENSAJERO,
) {
  const fake = fakePrismaDinero({ ledgerTienda, ledgerMensajero });
  return { repo: new CuentasPorPagarAnaliticaRepository(fake.cliente), fake };
}

/** El `where` de la ultima llamada, para juzgar la FORMA de la consulta y no solo el numero. */
function whereDe(fake: ReturnType<typeof repositorio>["fake"], i = 0): Record<string, unknown> {
  return fake.llamadas[i].args.where as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* R21 — saldo AL CORTE: sin cota inferior                                     */
/* -------------------------------------------------------------------------- */

describe("R21 · la cuenta por pagar a tiendas es un saldo al corte, no el flujo del periodo", () => {
  it("un credito de hace tres meses SIGUE en el saldo de hoy", async () => {
    const { repo } = repositorio();
    const filas = await repo.saldoPorTiendaAlCorte(consultaDe("cuenta_por_pagar_tienda"));

    expect(filas).toEqual([
      { tiendaId: "tienda-a", tipo: "credito", suma: "1000.00" },
      { tiendaId: "tienda-a", tipo: "debito", suma: "200.00" },
      { tiendaId: "tienda-b", tipo: "credito", suma: "500.00" },
    ]);
    // Con `fecha_movimiento >= desde`, la primera fila desapareceria entera.
    expect(filas.some((f) => f.suma === "1000.00")).toBe(true);
  });

  it("y el `where` no tiene cota inferior: solo el corte estricto por `hasta`", async () => {
    const { repo, fake } = repositorio();
    await repo.saldoPorTiendaAlCorte(consultaDe("cuenta_por_pagar_tienda"));

    const fecha = whereDe(fake).fechaMovimiento as Record<string, unknown>;
    expect(Object.keys(fecha)).toEqual(["lt"]);
    expect(fecha.lt).toEqual(HASTA);
    expect(fecha).not.toHaveProperty("gte");
    expect(fecha).not.toHaveProperty("gt");
    // Y `desde` no se usa para nada mas: no aparece en ninguna parte del `where`.
    expect(JSON.stringify(whereDe(fake))).not.toContain(DESDE.toISOString());
  });

  it("el corte por `hasta` SI es estricto: el movimiento de las 00:00 CR del dia siguiente no entra", async () => {
    const { repo } = repositorio();
    const filas = await repo.saldoPorTiendaAlCorte(consultaDe("cuenta_por_pagar_tienda"));
    // Si el corte fuera `lte`, el credito de tienda-a seria 1777.00.
    expect(filas[0].suma).toBe("1000.00");
  });

  it("la cuenta por pagar a mensajeros hace lo mismo: el devengo viejo cuenta", async () => {
    const { repo, fake } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosAlCorte(
      consultaDe("cuenta_por_pagar_mensajero"),
    );

    expect(filas).toEqual([
      { tipo: "devengo", suma: "6200.00" }, // 5000 (viejo) + 1200 (hoy); el de `hasta` no
      { tipo: "pago", suma: "2000.00" },
    ]);
    const fecha = whereDe(fake).fechaMovimiento as Record<string, unknown>;
    expect(Object.keys(fecha)).toEqual(["lt"]);
  });
});

/* -------------------------------------------------------------------------- */
/* R14 — ni un identificador de mensajero cruza la frontera                    */
/* -------------------------------------------------------------------------- */

describe("R14 · la cuenta por pagar a mensajeros se sirve como TOTAL, sin ids de persona", () => {
  it("ninguna fila lleva mensajeroId, ni siquiera como clave del groupBy", async () => {
    const { repo, fake } = repositorio();
    const filas = await repo.cuentaPorPagarMensajerosAlCorte(
      consultaDe("cuenta_por_pagar_mensajero"),
    );

    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) expect(Object.keys(fila).sort()).toEqual(["suma", "tipo"]);
    expect(JSON.stringify(filas)).not.toContain("m-1");
    expect(JSON.stringify(filas)).not.toContain("m-2");
    expect(fake.llamadas[0].args.by).toEqual(["tipo"]);
  });
});

/* -------------------------------------------------------------------------- */
/* R28 — orden estable                                                         */
/* -------------------------------------------------------------------------- */

describe("R28 · las dos consultas piden orden explicito y son reproducibles", () => {
  it("saldo por tienda: (tienda_id, tipo), con mas de una fila", async () => {
    const { repo, fake } = repositorio();
    const consulta = consultaDe("cuenta_por_pagar_tienda");
    const a = await repo.saldoPorTiendaAlCorte(consulta);
    const b = await repo.saldoPorTiendaAlCorte(consulta);

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ tiendaId: "asc" }, { tipo: "asc" }]);
  });

  it("cuenta de mensajeros: por tipo", async () => {
    const { repo, fake } = repositorio();
    const consulta = consultaDe("cuenta_por_pagar_mensajero");
    const a = await repo.cuentaPorPagarMensajerosAlCorte(consulta);
    const b = await repo.cuentaPorPagarMensajerosAlCorte(consulta);

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ tipo: "asc" }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Ni un caso pasa por conjunto vacio                                          */
/* -------------------------------------------------------------------------- */

describe("los tests de arriba no pasan por conjunto vacio", () => {
  it("los dos libros tienen filas anteriores al rango y filas en el corte exacto", () => {
    expect(LEDGER_TIENDA.some((f) => f.fechaMovimiento < DESDE)).toBe(true);
    expect(LEDGER_TIENDA.some((f) => f.fechaMovimiento.getTime() === HASTA.getTime())).toBe(true);
    expect(LEDGER_MENSAJERO.some((f) => f.fechaMovimiento < DESDE)).toBe(true);
    expect(LEDGER_MENSAJERO.some((f) => f.fechaMovimiento.getTime() === HASTA.getTime())).toBe(true);
  });

  it("y las dos consultas devuelven filas con importe distinto de cero", async () => {
    const { repo } = repositorio();
    const tiendas = await repo.saldoPorTiendaAlCorte(consultaDe("cuenta_por_pagar_tienda"));
    const mensajeros = await repo.cuentaPorPagarMensajerosAlCorte(
      consultaDe("cuenta_por_pagar_mensajero"),
    );

    expect(tiendas.length).toBe(3);
    expect(mensajeros.length).toBe(2);
    expect([...tiendas, ...mensajeros].every((f) => f.suma !== "0.00")).toBe(true);
  });
});
