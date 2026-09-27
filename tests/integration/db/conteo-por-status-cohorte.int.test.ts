import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { ConteoPorStatusRepository } from "@/lib/repositories/ConteoPorStatusRepository";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearGestion, crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import { consultaDe, D, D_MAS_1, describeSiHayBase, rangoDe } from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 441 — LA VENTANA DEL DESGLOSE POR STATUS CAE SOBRE LA CARGA, NO SOBRE LA GESTION.
 *
 * ESTE ES EL DEFECTO QUE LA FICHA REPARA, y el archivo que impide que vuelva.
 *
 * Hasta el 2026-09-17 `condicionesDeConsulta` acotaba `COALESCE(u."created_at", o."created_at")`
 * —la fecha de la ULTIMA GESTION VIGENTE, y solo la de creacion si la orden nunca se gestiono—.
 * Con eso, «ayer» significaba «actividad de ayer» y no «cargadas ayer». MEDIDO CONTRA PRODUCCION
 * para el dia anterior: 210 ordenes y 49,0 % de efectividad por fecha efectiva, contra 75 y
 * 14,7 % por cohorte de carga. **152 de aquellas 210 se habian cargado antes del dia pedido.**
 *
 * ⚠ POR QUE NO BASTA EL TEST DE TEXTO. `conteo-por-status-sql.test.ts` mira el SQL que sale de la
 * funcion pura y afirma que dice `o."created_at"`. Eso mata una mutacion escrita a mano, pero no
 * mide NADA de lo que Postgres hace con el `LEFT JOIN LATERAL` que sigue estando en la consulta:
 * una ventana mal puesta no lanza, no descuadra ningun tipo y devuelve conteos plausibles. Lo
 * unico que distingue una poblacion de la otra es sembrar las dos y contarlas.
 *
 * ─── LAS TRES ORDENES, Y HACEN FALTA LAS TRES ────────────────────────────────────────────
 *
 * | orden | cargada        | gestionada        | que debe pasar                                |
 * | ----- | -------------- | ----------------- | --------------------------------------------- |
 * | A     | FUERA (D-10)   | DENTRO (D)        | NO cuenta. Es el caso EXACTO de las 152.       |
 * | B     | DENTRO (D)     | FUERA (D+10)      | SI cuenta, y en el bucket de SU gestion.       |
 * | C     | DENTRO (D)     | nunca             | SI cuenta, por el `value` de su `order_status`.|
 *
 * Los RESULTADOS de A y B son distintos —A `rechazada`, B `entregada`— y eso no es decoracion:
 * con los dos iguales, la ventana vieja y la nueva producirian EL MISMO desglose (un bucket con
 * 1 y el de C con 1) y el archivo entero estaria verde con la mutacion puesta. Con resultados
 * distintos, la ventana vieja pinta `rechazada` donde la nueva pinta `entregada`.
 *
 * C mata una tercera mutacion, la de cambiar el `LEFT JOIN LATERAL` por un `INNER`: las ordenes
 * que nadie ha tocado son justamente la mayoria de una cohorte joven, y sin ellas el denominador
 * del KPI se desploma sin que ninguna cifra parezca rara.
 */

/** Cargada DIEZ dias antes del rango. Su gestion SI cae dentro. */
const D_MENOS_10 = "2001-06-05";
/** Gestionada nueve dias DESPUES del ultimo dia pedido. */
const D_MAS_10 = "2001-06-25";

describeSiHayBase("441 — el desglose por status cuenta las CARGADAS, no las gestionadas", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** El repositorio REAL sobre la transaccion: nunca una copia del SQL escrita en el test. */
  async function leer(
    tx: Parameters<typeof serializarEscriturasReales>[0],
    consulta: ConsultaConteoEntregas,
  ): Promise<readonly ConteoDeStatus[]> {
    return new ConteoPorStatusRepository(tx as unknown as PrismaClient).contarPorStatus(consulta);
  }

  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      // A — cargada DIEZ DIAS ANTES del rango, gestionada DENTRO. El arrastre.
      const a = await crearOrden(tx, base, {
        clave: "A-cargada-fuera-gestionada-dentro",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D_MENOS_10, "10:00"),
      });
      await crearGestion(tx, {
        ordenId: a,
        mensajeroId: base.mensajero1,
        resultado: "devolucion_a_origen_por_rechazo",
        at: instanteCR(D, "11:00"),
      });

      // B — cargada DENTRO del rango, gestionada NUEVE DIAS DESPUES del `hasta`.
      const b = await crearOrden(tx, base, {
        clave: "B-cargada-dentro-gestionada-despues",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "09:00"),
      });
      await crearGestion(tx, {
        ordenId: b,
        mensajeroId: base.mensajero1,
        resultado: "entregado",
        at: instanteCR(D_MAS_10, "09:00"),
      });

      // C — cargada DENTRO y nunca gestionada: el cubo vivo de la cohorte.
      await crearOrden(tx, base, {
        clave: "C-cargada-dentro-sin-gestion",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "08:00"),
      });

      const consulta = consultaDe(rangoDe(D, D_MAS_1), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      return { filas: await leer(tx, consulta) };
    });
  }

  it("una orden cargada FUERA y gestionada DENTRO no entra (el caso de las 152)", async () => {
    const { filas } = await escenario();

    // ANTI-VACIO, primero: si el fixture no produjera ninguna fila, todo lo de abajo seria un
    // `passed` que no comprueba nada.
    expect(filas.length, "el fixture no produjo ni un bucket").toBeGreaterThan(0);

    const porStatus = new Map(filas.map((f) => [f.status, f.conteo]));

    // ⭑ LA MITAD QUE MUERE con la ventana vieja: A se cuela y pinta un bucket `rechazada`.
    expect(
      porStatus.get("devolucion_a_origen_por_rechazo"),
      "entro una orden cargada antes del rango, solo porque se gestiono dentro",
    ).toBeUndefined();
  });

  it("una orden cargada DENTRO y gestionada DESPUES cuenta, y en el bucket de su gestion", async () => {
    const { filas } = await escenario();
    const porStatus = new Map(filas.map((f) => [f.status, f.conteo]));

    // ⭑ LA OTRA MITAD: con la ventana vieja, B se cae del rango porque su fecha efectiva es
    // nueve dias posterior al `hasta`.
    expect(
      porStatus.get("entregado"),
      "se perdio una orden cargada en el rango por gestionarse despues",
    ).toBe(1);
  });

  it("una orden cargada DENTRO y nunca gestionada cuenta por el estatus de la orden", async () => {
    const { filas } = await escenario();

    // Sin nombrar el `value` concreto del catalogo: lo que se afirma es que existe un bucket que
    // no es ninguno de los dos desenlaces sembrados y que trae exactamente esa orden.
    const sinGestion = filas.filter((f) => f.status !== "entregado" && f.status !== "devolucion_a_origen_por_rechazo");

    expect(sinGestion, "la orden sin gestion desaparecio (¿el LATERAL dejo de ser LEFT?)").toHaveLength(
      1,
    );
    expect(sinGestion[0]?.conteo).toBe(1);
  });

  it("el universo del recorte son DOS ordenes: las dos cargadas en la ventana", async () => {
    const { filas } = await escenario();
    const total = filas.reduce((suma, f) => suma + f.conteo, 0);

    // La cifra que el KPI divide. Con la ventana vieja tambien serian dos —A y C en vez de B y
    // C—, y por eso este caso NO va solo: lo que separa las dos lecturas son los buckets de
    // arriba. Se afirma igual porque es el denominador que la pantalla escribe al lado del
    // porcentaje, y una ventana que colara una tercera orden lo movería sin tocar ningún bucket.
    expect(total).toBe(2);
  });
});
