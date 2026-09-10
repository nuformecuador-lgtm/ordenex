import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { agregarTransicion, crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import {
  consultaDe,
  cubosDelDia,
  D,
  describeSiHayBase,
  leerCohortes,
  rangoDe,
} from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 411 / T4.5 — EL RELOJ: NUMERADOR Y DENOMINADOR, NUNCA EL PROMEDIO (R14, R16, R18).
 *
 * ─── QUE MIDE EL RELOJ, Y CON QUE DEFINICION ────────────────────────────────────────────
 *
 * Segundos entre `orden.created_at` y la transicion terminal que clasifica la orden. Es la MISMA
 * definicion de ciclo que ya usa el producto (`CicloVidaRepository`, y antes la consulta Q5 del
 * rollup diario), y se hereda a proposito: una variante propia —arrancar en la primera
 * asignacion, parar en la primera terminal— daria dos «tiempos» distintos en el mismo producto.
 *
 * ─── LO QUE ESTE ARCHIVO NO DEJA PASAR ──────────────────────────────────────────────────
 *
 * 1. **Que salga el promedio ya calculado.** Viajan `segundosAcum` y `n`: dos recortes se vuelven
 *    a agregar sumando numeradores y denominadores; promediar promedios da un numero que no
 *    corresponde a nada.
 * 2. **Que el cubo `viva` traiga CERO.** Tiene que traer AUSENTE. Cero segundos es una
 *    afirmacion —«cerraron al instante»— y lo que pasa es que no hay reloj que parar. Si alguien
 *    envuelve el `SUM` en un `COALESCE(..., 0)`, este archivo se pone rojo.
 * 3. **Que el reloj arranque en la primera asignacion** en vez de en la creacion de la orden.
 */

describeSiHayBase("411/T4.5 — el reloj de la cohorte", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const UN_DIA_S = 24 * 3600;

  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      // Dos entregadas con deltas EXACTOS y conocidos: 2 dias y 4 dias.
      const dosDias = await crearOrden(tx, base, {
        clave: "entregada-en-2-dias",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "08:00"),
      });
      await agregarTransicion(tx, base, dosDias, {
        at: instanteCR("2001-06-17", "08:00"),
        destino: "entregada",
      });

      const cuatroDias = await crearOrden(tx, base, {
        clave: "entregada-en-4-dias",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "08:00"),
      });
      // Una transicion INTERMEDIA no terminal, doce horas despues de la creacion: si el reloj
      // arrancara en la primera asignacion en vez de en `created_at`, esta orden mediria 3,5
      // dias en vez de 4 y la suma bajaria doce horas.
      await agregarTransicion(tx, base, cuatroDias, {
        at: instanteCR(D, "20:00"),
        destino: "en_reparto",
      });
      await agregarTransicion(tx, base, cuatroDias, {
        at: instanteCR("2001-06-19", "08:00"),
        destino: "entregada",
      });

      // Y una que sigue VIVA: sin transicion terminal, no tiene reloj que parar.
      await crearOrden(tx, base, {
        clave: "sigue-viva",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "08:00"),
      });

      const consulta = consultaDe(rangoDe(D, D), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      return { filas: await leerCohortes(tx, consulta) };
    });
  }

  it("`segundosAcum` es la suma EXACTA en segundos y `n` su denominador", async () => {
    const { filas } = await escenario();

    expect(filas.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);

    const entregadas = cubosDelDia(filas, D).get("entregada");
    expect(entregadas, "el cubo `entregada` no salio").toBeDefined();
    expect(entregadas?.n).toBe(2);
    // 2 dias + 4 dias = 6 dias exactos. Ni redondeo, ni promedio: la suma cruda.
    expect(entregadas?.segundosAcum).toBe(6 * UN_DIA_S);
  });

  it("el reloj arranca en `created_at`, no en la primera asignacion", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // La orden de 4 dias tiene su `en_reparto` doce horas despues de nacer. Con el reloj mal
    // anclado, la suma seria `6 dias - 12 h`.
    const entregadas = cubosDelDia(filas, D).get("entregada");
    expect(entregadas?.segundosAcum).toBe(6 * UN_DIA_S);
    expect(entregadas?.segundosAcum).not.toBe(6 * UN_DIA_S - 12 * 3600);
  });

  it("el cubo `viva` trae el numerador AUSENTE, y no cero", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    const viva = cubosDelDia(filas, D).get("viva");
    expect(viva, "el cubo `viva` no salio: el fixture no esta midiendo lo que dice").toBeDefined();
    expect(viva?.n).toBe(1);
    // `null` y NO `0`. Un `COALESCE(SUM(...), 0)` en la consulta pone rojo este caso.
    expect(viva?.segundosAcum).toBeNull();
    expect(viva?.segundosAcum).not.toBe(0);
  });

  it("el repositorio no devuelve promedios: solo numerador y denominador", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    for (const fila of filas) {
      expect(Object.keys(fila).sort()).toEqual(["desenlace", "fecha", "n", "segundosAcum"]);
    }
  });
});
