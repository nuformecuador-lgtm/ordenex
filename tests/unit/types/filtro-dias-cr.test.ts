import { describe, it, expect } from "vitest";

import { desdeDiaCRSchema, diaCalendarioSchema, hastaDiaCRSchema } from "@/lib/types/filtro-dias-cr";
import { listarMovimientosSchema, listarMovimientosCompletoSchema } from "@/lib/types/wallet";
import { listarMovimientosTiendaSchema, listarMovimientosTiendaCompletoSchema } from "@/lib/types/wallet-tienda";
import { listarPagosDeMensajeroSchema, listarPagosDeMensajeroCompletoSchema } from "@/lib/types/wallet-mensajero";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R72 (auditoria de la wallet, T1) — el BORDE de los filtros por dia de los tres libros.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El fallo medido por la auditoria: `z.coerce.date()` sobre `2026-09-25` daba la MEDIANOCHE UTC
// (18:00 CR del 24) y el repositorio comparaba `<= hasta`: «hoy» devolvia 2 de 7 movimientos y «ayer»
// ninguno de 16. Aqui se fija la traduccion exacta —y que los SEIS schemas (paginado + descarga de
// cada libro) la comparten—; lo que el `WHERE` hace con esos instantes se mide contra Postgres en
// `tests/integration/db/wallet-filtro-dia-cr-461.test.ts`.

describe("461/R72 — `desde` y `hasta` como dias de Costa Rica", () => {
  it("`desde` es el INICIO del dia en CR: 06:00Z, no la medianoche UTC", () => {
    expect(desdeDiaCRSchema.parse("2026-09-25")).toEqual(new Date("2026-09-25T06:00:00.000Z"));
    // La mutacion «volver a `z.coerce.date()`» daria la medianoche UTC; queda dicho por su nombre.
    expect(desdeDiaCRSchema.parse("2026-09-25")).not.toEqual(new Date("2026-09-25T00:00:00.000Z"));
  });

  it("`hasta` es el inicio del dia SIGUIENTE en CR: la cota EXCLUSIVA que hace inclusivo al dia", () => {
    expect(hastaDiaCRSchema.parse("2026-09-25")).toEqual(new Date("2026-09-26T06:00:00.000Z"));
    // Un solo dia: `desde` y `hasta` iguales cubren exactamente 24 h de pared en CR.
    const desde = desdeDiaCRSchema.parse("2026-09-25");
    const hasta = hastaDiaCRSchema.parse("2026-09-25");
    expect(hasta.getTime() - desde.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("los cambios de mes y de año se resuelven por calendario, no sumando dias a mano", () => {
    expect(hastaDiaCRSchema.parse("2026-09-30")).toEqual(new Date("2026-10-01T06:00:00.000Z"));
    expect(hastaDiaCRSchema.parse("2026-12-31")).toEqual(new Date("2027-01-01T06:00:00.000Z"));
    expect(hastaDiaCRSchema.parse("2028-02-28")).toEqual(new Date("2028-02-29T06:00:00.000Z")); // bisiesto
  });

  it.each([
    ["2026-13-01", "mes 13"],
    ["2026-02-31", "31 de febrero: rueda al 3 de marzo si nadie lo mira"],
    ["25/09/2026", "otro formato"],
    ["2026-9-5", "sin ceros"],
    ["", "vacio"],
    ["2026-09-25T00:00:00.000Z", "un instante ISO no es un dia"],
  ])("«%s» (%s) muere en el borde", (valor) => {
    expect(diaCalendarioSchema.safeParse(valor).success).toBe(false);
    expect(desdeDiaCRSchema.safeParse(valor).success).toBe(false);
    expect(hastaDiaCRSchema.safeParse(valor).success).toBe(false);
  });

  it("una `Date` ya no se acepta: el borde recibe el texto del formulario, no un instante", () => {
    // `z.coerce.date()` aceptaba `Date` y cualquier cadena parseable. El schema nuevo es la puerta
    // unica: todo entra como `YYYY-MM-DD` y se traduce una sola vez.
    expect(listarMovimientosSchema.safeParse({ desde: new Date("2026-09-25T00:00:00.000Z") }).success).toBe(false);
  });

  it("los SEIS schemas de los tres libros traducen igual (paginado y descarga)", () => {
    const entrada = { desde: "2026-09-25", hasta: "2026-09-25" };
    const esperado = { desde: new Date("2026-09-25T06:00:00.000Z"), hasta: new Date("2026-09-26T06:00:00.000Z") };
    const salidas = [
      listarMovimientosSchema.parse(entrada),
      listarMovimientosCompletoSchema.parse(entrada),
      listarMovimientosTiendaSchema.parse(entrada),
      listarMovimientosTiendaCompletoSchema.parse(entrada),
      listarPagosDeMensajeroSchema.parse({ ...entrada, mensajeroId: "m-1" }),
      listarPagosDeMensajeroCompletoSchema.parse({ ...entrada, mensajeroId: "m-1" }),
    ];
    for (const salida of salidas) expect(salida).toMatchObject(esperado);
    // Sin fechas, ninguno inventa un rango.
    expect(listarMovimientosSchema.parse({})).not.toHaveProperty("desde");
    expect(listarMovimientosSchema.parse({})).not.toHaveProperty("hasta");
  });
});
