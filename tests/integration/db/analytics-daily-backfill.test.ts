import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { planificarBackfill } from "@/lib/analytics/backfill-rango";
import { AnaliticaBackfillService } from "@/lib/services/AnaliticaBackfillService";
import type { LineaFecha, ModoBackfill } from "@/lib/interfaces/services/IAnaliticaBackfillService";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import {
  FECHA_D,
  FECHA_D_MAS_1,
  FECHA_D_MENOS_1,
  agregarTransicion,
  crearGestion,
  crearOrden,
  crearServicio,
  instanteCR,
  leerFilas,
  sembrarBase,
  type BaseSembrada,
  type TxDeTest,
} from "./_semilla-rollup";

/**
 * Feature 125 / T5.1 — el backfill contra el Postgres local, con el agregador REAL de la 124.
 * Cubre R12 y la primera mitad de R35, y sobre todo DEMUESTRA la limitacion L1 en vez de
 * afirmarla.
 *
 * Aislamiento: se reutiliza tal cual el arnes de la 124 (`_semilla-rollup.ts`) —transaccion que
 * SIEMPRE se revierte y fecha objetivo en 2001, donde la base de desarrollo no tiene nada—. El
 * primer caso comprueba el aislamiento: sin siembra, cero filas.
 *
 * Que las fechas de 2001 caigan bajo el horizonte del historial no es un accidente incomodo: es
 * material. Demuestra R21 con datos reales —bajo el horizonte se procesa IGUAL, y si la orden SI
 * tiene historial, las filas se escriben— y separa la etiqueta del comportamiento.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("backfill historico contra Postgres (feature 125)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  function conBase<T>(fn: (tx: TxDeTest, base: BaseSembrada) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => fn(tx, await sembrarBase(tx)));
  }

  /** Una pasada REAL del backfill sobre un rango, con el agregador de la 124 de verdad. */
  async function backfill(
    tx: TxDeTest,
    desde: string,
    hasta: string,
    modo: ModoBackfill = "escritura",
    previo?: ReadonlyMap<string, { fecha: string; filasEscritas: number }>,
  ) {
    const plan = planificarBackfill({ desde, hasta, ahora: new Date() });
    if (!plan.ok) throw new Error(plan.motivo);
    const lineas: LineaFecha[] = [];
    const servicio = new AnaliticaBackfillService(crearServicio(tx), {
      now: () => new Date(),
      dormir: async () => {},
      progreso: {
        linea: (l) => void lineas.push(l),
        falla: (f) => {
          throw f.error;
        },
        aviso: () => {},
      },
    });
    const resumen = await servicio.ejecutar({ plan: plan.plan, modo, previo });
    return { resumen, lineas, porFecha: new Map(lineas.map((l) => [l.fecha, l])) };
  }

  /* ------------------------------------------------------------------ R12 */

  describe("R12 · dos pasadas seguidas sobre el mismo rango: la segunda da filasRetiradas 0 y el mismo filasEscritas", () => {
    it("un rango de tres dias sembrados se recomputa entero y queda estable", async () => {
      await conBase(async (tx, base) => {
        // Un dia con una orden nacida y viva, otro con una entrega, y el tercero vacio.
        const naceEnD = instanteCR(FECHA_D_MENOS_1, "09:00");
        const a = await crearOrden(tx, base, {
          clave: "a",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: naceEnD,
        });
        await agregarTransicion(tx, base, a, { at: naceEnD, destino: "pendiente" });

        const entregaAt = instanteCR(FECHA_D, "14:00");
        await crearGestion(tx, {
          ordenId: a,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: entregaAt,
        });
        await agregarTransicion(tx, base, a, { at: entregaAt, destino: "entregada" });

        const primera = await backfill(tx, FECHA_D_MENOS_1, FECHA_D_MAS_1);
        expect(primera.resumen.fallidas).toBe(0);
        expect(primera.resumen.fechasDelRango).toBe(3);
        expect(primera.resumen.filasEscritas).toBeGreaterThan(0);

        const segunda = await backfill(tx, FECHA_D_MENOS_1, FECHA_D_MAS_1);
        expect(segunda.resumen.fallidas).toBe(0);
        for (const fecha of [FECHA_D_MENOS_1, FECHA_D, FECHA_D_MAS_1]) {
          const uno = primera.porFecha.get(fecha);
          const dos = segunda.porFecha.get(fecha);
          expect(dos?.filasEscritas, `filasEscritas de ${fecha}`).toBe(uno?.filasEscritas);
          expect(dos?.filasRetiradas, `filasRetiradas de ${fecha}`).toBe(0);
        }
        expect(segunda.resumen.filasRetiradas).toBe(0);
        expect(segunda.resumen.filasEscritas).toBe(primera.resumen.filasEscritas);
      });
    });

    it("el modo verificacion sobre un rango que no cambio deja todas las fechas estables o no comparables", async () => {
      await conBase(async (tx, base) => {
        const nace = instanteCR(FECHA_D, "08:00");
        const o = await crearOrden(tx, base, {
          clave: "v",
          zonaId: base.zonaB,
          tiendaId: base.tienda2,
          createdAt: nace,
        });
        await agregarTransicion(tx, base, o, { at: nace, destino: "pendiente" });

        const escritura = await backfill(tx, FECHA_D, FECHA_D_MAS_1);
        const previo = new Map(
          escritura.lineas.map((l) => [l.fecha, { fecha: l.fecha, filasEscritas: l.filasEscritas }]),
        );

        const verificacion = await backfill(tx, FECHA_D, FECHA_D_MAS_1, "verificacion", previo);
        expect(verificacion.resumen.cambiadas).toBe(0);
        expect(verificacion.resumen.fallidas).toBe(0);
        expect(verificacion.resumen.codigoSalida).toBe(0);
        // Estas fechas son de 2001: bajo el horizonte, asi que la etiqueta manda sobre «estable».
        for (const linea of verificacion.lineas) {
          expect(linea.clasificacion).toBe("no_comparable");
        }
      });
    });
  });

  /* ------------------------------------------------------------------ L1 */

  describe("L1 · bajo el horizonte no se pierde solo el embudo: se pierde TODO", () => {
    it("una orden SIN historial anterior al corte no entra en NINGUN cubo, aunque tenga entrega ese dia", async () => {
      // Este es el hecho que hace que el backfill util arranque el 2026-07-13, y no una
      // suposicion: las cinco consultas del agregador unen contra `estatus_al_corte`, que exige
      // al menos una transicion anterior al corte. La migracion que creo el historial fue
      // aditiva y no backfilleo nada, asi que TODA orden anterior a ella esta en esta situacion.
      await conBase(async (tx, base) => {
        const nace = instanteCR(FECHA_D, "07:00");
        const huerfana = await crearOrden(tx, base, {
          clave: "sin-historial",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: nace,
        });
        // Se le pone TODO lo que un dia normal tendria... menos una fila de historial.
        await crearGestion(tx, {
          ordenId: huerfana,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "15:00"),
        });

        const { resumen, porFecha } = await backfill(tx, FECHA_D, FECHA_D);

        // La corrida NO falla: reconcilia 0 contra 0 y termina con exito.
        expect(resumen.fallidas).toBe(0);
        expect(resumen.filasEscritas).toBe(0);
        expect(porFecha.get(FECHA_D)?.filasEscritas).toBe(0);
        // Y la tabla se queda igual de vacia: ni la orden creada, ni el stock, ni la entrega.
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
        // La etiqueta es lo unico que distingue este cero del cero de un dia sin actividad.
        expect(porFecha.get(FECHA_D)?.clasificacion).toBe("no_comparable");
        expect(resumen.noComparables).toBe(1);
      });
    });

    it("la MISMA orden, con una sola transicion anterior al corte, ya produce filas: no es la fecha, es el historial", async () => {
      // El contrapeso que convierte el caso anterior en una medida y no en un test vacio: si el
      // cero de arriba viniera de que el arnes no siembra bien, aqui tampoco habria filas.
      await conBase(async (tx, base) => {
        const nace = instanteCR(FECHA_D, "07:00");
        const o = await crearOrden(tx, base, {
          clave: "con-historial",
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          mensajeroId: base.mensajero1,
          createdAt: nace,
        });
        await agregarTransicion(tx, base, o, { at: nace, destino: "pendiente" });
        await crearGestion(tx, {
          ordenId: o,
          mensajeroId: base.mensajero1,
          resultado: "entregada",
          at: instanteCR(FECHA_D, "15:00"),
        });

        const { resumen, porFecha } = await backfill(tx, FECHA_D, FECHA_D);
        expect(resumen.filasEscritas).toBeGreaterThan(0);
        expect((await leerFilas(tx, base, FECHA_D)).length).toBeGreaterThan(0);
        // R21 — bajo el horizonte se procesa IGUAL: la etiqueta no toca ni una medida.
        expect(porFecha.get(FECHA_D)?.clasificacion).toBe("no_comparable");
      });
    });

    it("un dia sin nada sembrado termina con exito, cero filas y clasificado no_comparable", async () => {
      await conBase(async (tx, base) => {
        const { resumen, porFecha } = await backfill(tx, FECHA_D, FECHA_D);
        expect(resumen.fallidas).toBe(0);
        expect(resumen.filasEscritas).toBe(0);
        expect(porFecha.get(FECHA_D)?.clasificacion).toBe("no_comparable");
        // Contrapeso del archivo entero: si la base de desarrollo se colara, aqui habria filas.
        expect(await leerFilas(tx, base, FECHA_D)).toEqual([]);
      });
    });
  });

  /* ------------------------------------------------------------------ R11/R15 con el agregador real */

  describe("el recorrido real llama al agregador una vez por fecha y en orden", () => {
    it("un rango de tres dias produce tres lineas, ascendentes y sin repetidos", async () => {
      await conBase(async (tx) => {
        const { lineas, resumen } = await backfill(tx, FECHA_D_MENOS_1, FECHA_D_MAS_1);
        expect(lineas.map((l) => l.fecha)).toEqual([FECHA_D_MENOS_1, FECHA_D, FECHA_D_MAS_1]);
        expect(resumen.procesadas).toBe(3);
        expect(resumen.codigoSalida).toBe(0);
        for (const linea of lineas) expect(linea.ms).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
