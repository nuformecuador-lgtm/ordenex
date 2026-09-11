import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ConteoCargadasPorDiaRepository } from "@/lib/repositories/ConteoCargadasPorDiaRepository";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { agregarTransicion, crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import {
  consultaDe,
  D,
  D_MAS_1,
  D_MAS_2,
  D_MENOS_1,
  describeSiHayBase,
  leerCohortes,
  rangoDe,
} from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 411 / T4.7 — LA COHORTE NO DIVERGE DE LA SERIE HERMANA (R6, R11).
 *
 * ─── QUE CONTIENE ESTE ARCHIVO, Y POR QUE ES LO MAS IMPORTANTE QUE HAY AQUI ─────────────
 *
 * Esta es la CUARTA escritura del mismo `where` en la vertical de entregas. Las cuatro pueden
 * DIVERGIR, y una divergencia no se ve: los dos numeros siguen siendo enteros razonables, en
 * pantallas distintas, y el dia que no cuadren nadie sabra cual creer.
 *
 * La contencion es esta: sobre el MISMO escenario y con el MISMO filtro, la suma de los cubos de
 * cada cohorte tiene que ser EXACTAMENTE el conteo que devuelve
 * `ConteoCargadasPorDiaRepository.contarCargadasPorDia` — que es la lectura que YA esta en
 * produccion contestando «cuantas ordenes entraron cada dia». Si alguien toca un `where` y no el
 * otro, esto es lo que lo dice.
 *
 * Y de paso prueba R11 sin compararse consigo misma: la igualdad se afirma contra OTRA
 * implementacion, no contra la propia consulta que produjo los cubos.
 *
 * ─── EL ORDEN ES CONTRATO, Y DIVERGE A PROPOSITO ────────────────────────────────────────
 *
 * Esta lectura sale DESCENDENTE (la cohorte mas reciente primero: es lo que se viene a mirar) y
 * la serie hermana ASCENDENTE (pinta un eje temporal, donde el tiempo va hacia la derecha). Por
 * eso la comparacion es POR DIA y jamas por posicion: comparar por indice estaria comparando el
 * primero de una con el ultimo de la otra y saldria verde solo por casualidad cuando hay un dia.
 */

describeSiHayBase("411/T4.7 — la suma de los cubos es el conteo de la serie hermana", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      const cargar = (clave: string, dia: string, hora: string, borrada = false) =>
        crearOrden(tx, base, {
          clave,
          zonaId: base.zonaA,
          tiendaId: base.tienda1,
          createdAt: instanteCR(dia, hora),
          deletedAt: borrada ? instanteCR(dia, "23:00") : null,
        });

      // Dia D: tres ordenes, una entregada, una devuelta a tienda, una viva.
      const d1 = await cargar("D-entregada", D, "09:00");
      await agregarTransicion(tx, base, d1, { at: instanteCR(D, "18:00"), destino: "entregada" });
      const d2 = await cargar("D-devuelta", D, "10:00");
      await agregarTransicion(tx, base, d2, {
        at: instanteCR(D_MAS_2, "18:00"),
        destino: "devuelta_a_tienda",
      });
      await cargar("D-viva", D, "11:00");

      // Dia D+1: dos, una con incidente y una en `devuelta` (que sigue VIVA).
      const e1 = await cargar("D1-incidente", D_MAS_1, "09:00");
      await agregarTransicion(tx, base, e1, {
        at: instanteCR(D_MAS_1, "18:00"),
        destino: "incidente",
      });
      const e2 = await cargar("D1-devuelta", D_MAS_1, "10:00");
      await agregarTransicion(tx, base, e2, {
        at: instanteCR(D_MAS_1, "18:00"),
        destino: "devuelta",
      });

      // Dia D+2: una sola, entregada. Y una BORRADA, que no debe contar en ninguna de las dos.
      const f1 = await cargar("D2-entregada", D_MAS_2, "09:00");
      await agregarTransicion(tx, base, f1, {
        at: instanteCR(D_MAS_2, "20:00"),
        destino: "entregada",
      });
      await cargar("D2-borrada", D_MAS_2, "09:30", true);

      // Y una FUERA del rango: ninguna de las dos lecturas debe verla.
      await cargar("fuera-del-rango", D_MENOS_1, "09:00");

      const consulta = consultaDe(rangoDe(D, D_MAS_2), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });

      return {
        cohortes: await leerCohortes(tx, consulta),
        // La OTRA implementacion, la que ya esta en produccion, sobre la MISMA consulta.
        serie: await new ConteoCargadasPorDiaRepository(
          tx as unknown as PrismaClient,
        ).contarCargadasPorDia(consulta),
      };
    });
  }

  it("dia a dia, la suma de los cubos es el conteo de `contarCargadasPorDia`", async () => {
    const { cohortes, serie } = await escenario();

    expect(cohortes.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);
    expect(serie.length, "la serie hermana no produjo ni un dia").toBeGreaterThan(0);

    const sumaDeCubos = new Map<string, number>();
    for (const fila of cohortes) {
      sumaDeCubos.set(fila.fecha, (sumaDeCubos.get(fila.fecha) ?? 0) + fila.n);
    }

    // Los MISMOS dias, ni uno mas ni uno menos. Por conjunto, nunca por posicion.
    expect([...sumaDeCubos.keys()].sort()).toEqual(serie.map((d) => d.fecha).sort());

    // Y dia a dia. Tres dias distintos: si solo hubiera uno, esta comparacion tambien pasaria
    // con el orden invertido y no diria nada.
    expect(serie.length).toBe(3);
    for (const dia of serie) {
      expect(sumaDeCubos.get(dia.fecha), `el dia ${dia.fecha} no cuadra`).toBe(dia.conteo);
    }
  });

  it("las fechas salen DESCENDENTES aqui y ASCENDENTES alli, y no hay dias vacios", async () => {
    const { cohortes, serie } = await escenario();

    expect(cohortes.length).toBeGreaterThan(0);

    const diasCohorte = [...new Set(cohortes.map((f) => f.fecha))];
    expect(diasCohorte).toEqual([D_MAS_2, D_MAS_1, D]);
    // El contrato contrario de la serie hermana, afirmado aqui para que la divergencia sea
    // DELIBERADA y no un descubrimiento de quien pinte la tabla.
    expect(serie.map((d) => d.fecha)).toEqual([D, D_MAS_1, D_MAS_2]);

    // Ningun dia sin ordenes viaja: el hueco significa cero. `D-1` tiene una orden y esta fuera
    // del rango; ninguno de los tres dias del rango esta vacio, asi que el anti-vacio de esta
    // asercion es que salgan exactamente tres.
    expect(diasCohorte).toHaveLength(3);
    expect(diasCohorte).not.toContain(D_MENOS_1);
  });

  it("el total del recorte coincide con el total de la serie hermana", async () => {
    const { cohortes, serie } = await escenario();

    expect(cohortes.length).toBeGreaterThan(0);

    const totalCohortes = cohortes.reduce((suma, f) => suma + f.n, 0);
    const totalSerie = serie.reduce((suma, d) => suma + d.conteo, 0);

    expect(totalCohortes).toBe(totalSerie);
    // Seis ordenes vivas del rango: la septima esta borrada y la octava esta fuera.
    expect(totalCohortes).toBe(6);
  });
});
