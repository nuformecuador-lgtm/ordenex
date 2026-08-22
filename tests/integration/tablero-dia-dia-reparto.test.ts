import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FilaTableroDia } from "@/lib/types/tablero-dia";
import { ventanaDelDiaEnCursoCR, type VentanaDiaCR } from "@/lib/utils/ventana-dia-cr";

import {
  FECHA_CR,
  VENTANA,
  crearOrden,
  diaReparto,
  instanteCR,
  repositorio,
  sembrarBase,
  sumaDeLosOcho,
  type BaseSembrada,
  type TxDeTest,
} from "./_semilla-tablero-dia";
import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
} from "./db/_postgres-real";

// Feature 259 (T3.2) — R2, R3, R4, R5, R6, R7, R12, R22. **DONDE SE DECIDE SI LA FICHA ESTÁ BIEN.**
//
// El cambio de esta ficha es un `WHERE`, y un test de servicio con dobles NO VE EL SQL: en este
// repo una mutación del `WHERE` ya dejó once tests de servicio en verde. Por eso los seis casos de
// abajo se siembran en Postgres REAL, dentro de una transacción que siempre se revierte.
//
// LAS DOS RAMAS, para leer los casos sin volver al spec:
//   (a) `fecha_reparto = <día representado>`  — la orden RESERVADA para ese día.
//   (b) `fecha_reparto IS NULL` Y `asignado_at ∈ [desde, hasta)` — el RESPALDO de las órdenes
//       anteriores a la 246, que nunca tendrán la columna porque no hay backfill.
// Son DISJUNTAS por construcción, y C7 lo mide: cada orden aparece en EXACTAMENTE un día.
//
// Cada caso vuelve a afirmar la identidad de los ocho sumandos (192/R25): el cambio de universo no
// puede dejar una orden contada dos veces ni caída de todos los cubos.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const AYER_CR = "2001-06-14";
const MANANA_CR = "2001-06-16";

/** Las tres ventanas. Salen del MISMO helper que usa la Server Action: una sola definición del día. */
const VENTANA_AYER = ventanaDelDiaEnCursoCR(instanteCR(AYER_CR, "19:00"));
const VENTANA_MANANA = ventanaDelDiaEnCursoCR(instanteCR(MANANA_CR, "19:00"));

const PAGINA_GRANDE = { pagina: 1, pageSize: 100 };

describeSiHayBase("tablero del día — el criterio es el DÍA DE REPARTO (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra y cuenta con las ventanas pedidas, todo dentro de la misma transacción revertida. */
  async function contarCon(
    sembrar: (tx: TxDeTest, base: BaseSembrada) => Promise<void>,
    ventanas: readonly VentanaDiaCR[],
  ): Promise<readonly FilaTableroDia[][]> {
    return enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);
      await sembrar(tx, base);
      const repo = repositorio(tx);
      const salida: FilaTableroDia[][] = [];
      for (const ventana of ventanas) {
        const filas = await repo.contarPorMensajero(ventana, { tipo: "global" });
        salida.push(filas.filter((f) => f.mensajeroNombre.endsWith("Prueba")));
      }
      return salida;
    });
  }

  function identidad(filas: readonly FilaTableroDia[]): void {
    for (const f of filas) expect(f.asignadas).toBe(sumaDeLosOcho(f));
  }

  it("C1 · asignada HOY y reservada para HOY: cuenta hoy (R2)", async () => {
    const [hoy] = await contarCon(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "c1-hoy-para-hoy",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
        fechaReparto: diaReparto(FECHA_CR),
      });
    }, [VENTANA]);

    expect(hoy).toHaveLength(1);
    expect(hoy[0]).toMatchObject({ asignadas: 1, sinRecoger: 1 });
    identidad(hoy);
  });

  it("C2 · asignada HOY para MAÑANA: no cuenta hoy, y sí mañana sin tocar la orden (R3, R22)", async () => {
    // EL CASO QUE ABRIÓ LA FICHA. Con el criterio viejo caía hoy en `sinRecoger`, cuya ayuda dice
    // «el mensajero todavía no arrancó con ellas»: la pantalla acusaba a Ana de ir retrasada por
    // trabajo que todavía no era suyo.
    const [hoy, manana] = await contarCon(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "c2-hoy-para-manana",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "14:00"),
        fechaReparto: diaReparto(MANANA_CR),
      });
    }, [VENTANA, VENTANA_MANANA]);

    expect(hoy).toEqual([]);
    // R22 — aparece en el tablero de mañana por el solo hecho de cambiar el día representado:
    // sin ninguna escritura sobre la orden y sin ninguna invalidación manual.
    expect(manana).toHaveLength(1);
    expect(manana[0]).toMatchObject({ asignadas: 1, sinRecoger: 1 });
    identidad(manana);
  });

  it("C3 · asignada AYER y reservada para HOY: cuenta hoy (R4)", async () => {
    const [hoy] = await contarCon(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "c3-ayer-para-hoy",
        estatus: "en_reparto",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(AYER_CR, "16:00"),
        fechaReparto: diaReparto(FECHA_CR),
      });
    }, [VENTANA]);

    expect(hoy).toHaveLength(1);
    expect(hoy[0]).toMatchObject({ asignadas: 1, enReparto: 1 });
    identidad(hoy);
  });

  it("C4 · asignada HOY y SIN día de reparto: cuenta hoy por el respaldo (R6)", async () => {
    // La rama (b). No es una lista congelada de órdenes viejas: es la respuesta correcta para
    // cualquier orden que llegue a tener mensajero por una vía que no estampe la columna.
    const [hoy] = await contarCon(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "c4-hoy-sin-dia",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(FECHA_CR, "07:00"),
      });
    }, [VENTANA]);

    expect(hoy).toHaveLength(1);
    expect(hoy[0]).toMatchObject({ asignadas: 1, sinRecoger: 1 });
    identidad(hoy);
  });

  it("C5 · asignada AYER y SIN día de reparto: no cuenta hoy, cuenta ayer (R6)", async () => {
    const [hoy, ayer] = await contarCon(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "c5-ayer-sin-dia",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(AYER_CR, "07:00"),
      });
    }, [VENTANA, VENTANA_AYER]);

    expect(hoy).toEqual([]);
    expect(ayer).toHaveLength(1);
    expect(ayer[0]).toMatchObject({ asignadas: 1 });
    identidad(ayer);
  });

  it("C6 · reservada para AYER: no cuenta hoy — la rama (a) es una IGUALDAD (R5)", async () => {
    // Una reserva vencida no es trabajo de hoy. Si la rama (a) fuera `<=`, todo lo que quedó
    // pendiente de días anteriores se acumularía en la pantalla de hoy.
    const [hoy, ayer] = await contarCon(async (tx, base) => {
      await crearOrden(tx, base, {
        clave: "c6-para-ayer",
        estatus: "por_recoger",
        mensajeroId: base.mensajero1,
        asignadoAt: instanteCR(AYER_CR, "07:00"),
        fechaReparto: diaReparto(AYER_CR),
      });
    }, [VENTANA, VENTANA_AYER]);

    expect(hoy).toEqual([]);
    expect(ayer).toHaveLength(1);
    identidad(ayer);
  });

  it("C7 · las seis a la vez: cada orden aparece EXACTAMENTE UNA VEZ en los tres días (R7, R12)", async () => {
    const resultado = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase(tx);

      const sembradas = {
        c1: await crearOrden(tx, base, {
          clave: "c7-c1",
          estatus: "por_recoger",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
          fechaReparto: diaReparto(FECHA_CR),
        }),
        c2: await crearOrden(tx, base, {
          clave: "c7-c2",
          estatus: "por_recoger",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "14:00"),
          fechaReparto: diaReparto(MANANA_CR),
        }),
        c3: await crearOrden(tx, base, {
          clave: "c7-c3",
          estatus: "en_reparto",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(AYER_CR, "16:00"),
          fechaReparto: diaReparto(FECHA_CR),
        }),
        c4: await crearOrden(tx, base, {
          clave: "c7-c4",
          estatus: "por_recoger",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(FECHA_CR, "07:00"),
        }),
        c5: await crearOrden(tx, base, {
          clave: "c7-c5",
          estatus: "por_recoger",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(AYER_CR, "07:00"),
        }),
        c6: await crearOrden(tx, base, {
          clave: "c7-c6",
          estatus: "por_recoger",
          mensajeroId: base.mensajero1,
          asignadoAt: instanteCR(AYER_CR, "07:00"),
          fechaReparto: diaReparto(AYER_CR),
        }),
      };

      const repo = repositorio(tx);
      const porDia: { fecha: string; filas: FilaTableroDia[]; ids: string[] }[] = [];
      for (const ventana of [VENTANA_AYER, VENTANA, VENTANA_MANANA]) {
        const filas = (await repo.contarPorMensajero(ventana, { tipo: "global" })).filter((f) =>
          f.mensajeroNombre.endsWith("Prueba"),
        );
        const ids: string[] = [];
        for (const fila of filas) {
          const pagina = await repo.listarOrdenesDelDia(
            ventana,
            { tipo: "global" },
            fila.mensajeroId,
            PAGINA_GRANDE,
          );
          // R14 — el detalle de esa tarjeta trae exactamente lo que la tarjeta dice.
          expect(pagina.total).toBe(fila.asignadas);
          ids.push(...pagina.filas.map((f) => f.ordenId));
        }
        porDia.push({ fecha: ventana.fecha, filas, ids });
      }
      return { sembradas, porDia };
    });

    const [ayer, hoy, manana] = resultado.porDia;
    const { c1, c2, c3, c4, c5, c6 } = resultado.sembradas;

    // Cada día, exactamente las órdenes que le tocan.
    expect(ayer.ids.sort()).toEqual([c5, c6].sort());
    expect(hoy.ids.sort()).toEqual([c1, c3, c4].sort());
    expect(manana.ids).toEqual([c2]);

    // Y LA PROPIEDAD QUE SOSTIENE R7: sumando los tres días, cada orden aparece UNA sola vez.
    // Sin la cláusula `fecha_reparto IS NULL` de la rama (b), C2 saldría dos veces (hoy por
    // `asignado_at` y mañana por `fecha_reparto`) y esto contaría 7 apariciones para 6 órdenes.
    const todas = [...ayer.ids, ...hoy.ids, ...manana.ids];
    expect(todas).toHaveLength(6);
    expect(new Set(todas).size).toBe(6);
    for (const id of [c1, c2, c3, c4, c5, c6]) {
      expect(todas.filter((x) => x === id), `la orden ${id} no aparece exactamente una vez`)
        .toHaveLength(1);
    }

    // R12 — la identidad de los ocho sumandos, en CADA tarjeta de CADA día.
    for (const dia of resultado.porDia) {
      for (const fila of dia.filas) expect(fila.asignadas).toBe(sumaDeLosOcho(fila));
    }
  });
});
