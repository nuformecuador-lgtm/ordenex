import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { agregarTransicion, crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import {
  cargadasDe,
  consultaDe,
  cubosDelDia,
  D,
  describeSiHayBase,
  leerCohortes,
  rangoDe,
} from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 411 / T4.3 — MANDA LA ULTIMA TRANSICION TERMINAL, Y LA ORDEN CUENTA UNA VEZ (R9).
 *
 * ─── POR QUE LA ULTIMA Y NO LA PRIMERA ──────────────────────────────────────────────────
 *
 * El caso es real y esta en el mapa de transiciones: una orden entra a un estado terminal,
 * alguien lo REVIERTE (las reversiones #54-#58 del camino del admin) y la orden vuelve a
 * circular hasta entrar en otro. Con la PRIMERA, la cohorte diria «entregada» de un paquete que
 * acabo volviendo a la tienda, y el reloj pararia en un cierre que se deshizo.
 *
 * Es el MISMO criterio que ya usa el producto para el ciclo de vida
 * (`DISTINCT ON (orden_id) ... ORDER BY created_at DESC, id DESC`) y se hereda a conciencia:
 * escribir aqui una variante daria dos «desenlaces» distintos en el mismo producto y nadie
 * sabria cual mirar.
 *
 * ─── EL DESEMPATE POR `id` NO ES DEFENSIVO ──────────────────────────────────────────────
 *
 * Dos transiciones pueden compartir `created_at` —un lote cerrado de golpe escribe N filas con
 * el MISMO instante, y eso solo pasa de verdad dentro de una transaccion de Postgres—. Sin el
 * `id DESC`, el `DISTINCT ON` elegiria una u otra entre ejecuciones: la tabla cambiaria de
 * numeros sin que nadie tocara un dato. Un doble no puede demostrar esto; el motor si.
 */

/** Ids EXPLICITOS para las dos terminales que empatan en `created_at`. `...b` > `...a`. */
const ID_EMPATE_A = "00000000-0000-4000-8000-0000000000aa";
const ID_EMPATE_B = "00000000-0000-4000-8000-0000000000bb";

describeSiHayBase("411/T4.3 — la ULTIMA transicion terminal clasifica, y solo una vez", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function escenarioReversion() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      // entregada -> (se deshace) en_reparto -> devuelta_a_tienda. El desenlace es el ULTIMO.
      const orden = await crearOrden(tx, base, {
        clave: "revertida-y-devuelta",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "08:00"),
      });
      await agregarTransicion(tx, base, orden, {
        at: instanteCR(D, "10:00"),
        destino: "entregada",
      });
      await agregarTransicion(tx, base, orden, {
        at: instanteCR(D, "12:00"),
        destino: "en_reparto",
      });
      await agregarTransicion(tx, base, orden, {
        at: instanteCR(D, "14:00"),
        destino: "devuelta_a_tienda",
      });

      const consulta = consultaDe(rangoDe(D, D), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      return { filas: await leerCohortes(tx, consulta) };
    });
  }

  it("una orden entregada, revertida y devuelta cuenta UNA vez y en `devuelta_a_tienda`", async () => {
    const { filas } = await escenarioReversion();

    expect(filas.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);

    const cubos = cubosDelDia(filas, D);
    expect([...cubos.keys()]).toEqual(["devuelta_a_tienda"]);
    expect(cubos.get("devuelta_a_tienda")?.n).toBe(1);
    // UNA sola vez: dos transiciones terminales, una contribucion. Sin el `DISTINCT ON`, la
    // misma orden estaria en dos cubos y las cargadas del dia saldrian 2 con una sola orden.
    expect(cargadasDe(filas, D)).toBe(1);

    // Y el reloj para en la ULTIMA (14:00), no en la primera (10:00): seis horas, no dos.
    expect(cubos.get("devuelta_a_tienda")?.segundosAcum).toBe(6 * 3600);
  });

  it("dos transiciones terminales con el MISMO `created_at` dan un resultado estable", async () => {
    // Se lee CINCO veces dentro de la misma transaccion: sin el desempate por `id`, Postgres
    // puede devolver cualquiera de las dos filas y el resultado bailaria entre ejecuciones.
    const lecturas = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      const orden = await crearOrden(tx, base, {
        clave: "empate-de-instante",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "08:00"),
      });
      const mismoInstante = instanteCR(D, "16:00");
      await agregarTransicion(tx, base, orden, {
        id: ID_EMPATE_A,
        at: mismoInstante,
        destino: "entregada",
      });
      await agregarTransicion(tx, base, orden, {
        id: ID_EMPATE_B,
        at: mismoInstante,
        destino: "incidente",
      });

      const consulta = consultaDe(rangoDe(D, D), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      const salidas = [];
      for (let i = 0; i < 5; i += 1) salidas.push(await leerCohortes(tx, consulta));
      return salidas;
    });

    expect(lecturas.length).toBe(5);
    for (const filas of lecturas) {
      expect(filas.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);
    }

    // Las cinco lecturas son IDENTICAS, y ademas gana el `id` mayor (`...bb` = `incidente`), que
    // es lo que dice `ORDER BY ..., h."id" DESC`.
    const primera = JSON.stringify(lecturas[0]);
    for (const filas of lecturas) expect(JSON.stringify(filas)).toBe(primera);
    expect([...cubosDelDia(lecturas[0], D).keys()]).toEqual(["incidente"]);
    expect(cargadasDe(lecturas[0], D)).toBe(1);
  });
});
