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
  D_MAS_1,
  describeSiHayBase,
  leerCohortes,
  rangoDe,
} from "./_cohorte-carga";

/**
 * ⭑⭑ FICHA 411 / T4.4 — LA INVERSION: LA VENTANA CAE SOBRE LA CARGA (R12).
 *
 * ESTE ES EL ERROR QUE LA FICHA EXISTE PARA NO COMETER, y el archivo que lo caza.
 *
 * En este repo ya vive una consulta casi identica —`CicloVidaRepository`— que tambien mide de
 * `orden.created_at` a la ultima transicion terminal. Copiarla es lo natural y su ventana esta
 * en el sitio CONTRARIO: alli acota la TRANSICION (`condicionDeVentanaTerminal`, sobre
 * `h."created_at"`), porque contesta «de lo que CERRO esta semana, cuanto tardo». Una cohorte es
 * exactamente lo contrario: sigue el LOTE hasta su desenlace, caiga donde caiga en el tiempo.
 *
 * ⚠ POR QUE ES PELIGROSO Y NO SOLO INCORRECTO: poner la ventana sobre el cierre **no rompe nada
 * visible**. No hay excepcion, no hay fila de mas, no hay tipo que no compile. La tabla sale con
 * dias plausibles, cohortes plausibles y porcentajes plausibles — y equivocados: estaria
 * contestando «que cerro esta semana» con el rotulo «que se cargo esta semana», y solo cuadraria
 * en los lotes que cierran el mismo dia. Nadie lo ve mirando la pantalla.
 *
 * ─── LAS DOS DIRECCIONES, Y HACEN FALTA LAS DOS ─────────────────────────────────────────
 *
 * | orden | cargada        | cerrada           | que debe pasar                             |
 * | ----- | -------------- | ----------------- | ------------------------------------------ |
 * | X     | DENTRO (D)     | DESPUES del hasta | cuenta, y en su cubo TERMINAL (no en `viva`)|
 * | Y     | FUERA (D-10)   | DENTRO (D)        | NO aparece en ninguna cohorte               |
 *
 * X mata la mutacion «anado `condicionDeVentanaTerminal` al CTE `cierre`»: su cierre se caeria y
 * la orden pasaria a `viva`. Y mata la inversa —mover la ventana a la transicion y quitarla de
 * la carga—: entraria una orden de un lote que no es de este rango.
 */

/** Cargada DIEZ dias antes del rango. Su cierre SI cae dentro. */
const D_MENOS_10 = "2001-06-05";
/** Cierre muy posterior al `hasta` del rango: nueve dias despues del ultimo dia pedido. */
const D_MAS_10 = "2001-06-25";

describeSiHayBase("411/T4.4 — la ventana cae sobre la CARGA, nunca sobre el cierre", () => {
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

      // X — cargada DENTRO del rango, cerrada NUEVE DIAS DESPUES del `hasta`.
      const x = await crearOrden(tx, base, {
        clave: "X-cargada-dentro-cerrada-despues",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "10:00"),
      });
      await agregarTransicion(tx, base, x, {
        at: instanteCR(D_MAS_10, "10:00"),
        destino: "entregada",
      });

      // Y — cargada DIEZ DIAS ANTES del rango, cerrada DENTRO de la ventana.
      const y = await crearOrden(tx, base, {
        clave: "Y-cargada-fuera-cerrada-dentro",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D_MENOS_10, "10:00"),
      });
      await agregarTransicion(tx, base, y, {
        at: instanteCR(D, "12:00"),
        destino: "entregada",
      });

      const consulta = consultaDe(rangoDe(D, D_MAS_1), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      return { filas: await leerCohortes(tx, consulta) };
    });
  }

  it("una orden cargada DENTRO y cerrada DESPUES del `hasta` cuenta igual, y en su cubo terminal", async () => {
    const { filas } = await escenario();

    // ANTI-VACIO, primero: si el fixture no produjera cohortes, todo lo de abajo seria un
    // `passed` que no comprueba nada.
    expect(filas.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);

    const cubos = cubosDelDia(filas, D);
    expect(
      [...cubos.keys()],
      "la orden cargada el dia D no aparecio en su cohorte",
    ).toContain("entregada");
    expect(cubos.get("entregada")?.n).toBe(1);

    // Y NO en `viva`: es la mitad que muere si alguien acota el CTE `cierre` por la ventana.
    expect(cubos.get("viva")).toBeUndefined();

    // El reloj tampoco se recorta: son nueve dias y pico, muy fuera de la ventana pedida.
    const segundos = cubos.get("entregada")?.segundosAcum;
    expect(segundos).toBe(
      (instanteCR(D_MAS_10, "10:00").getTime() - instanteCR(D, "10:00").getTime()) / 1000,
    );
  });

  it("una orden cargada FUERA del rango y cerrada DENTRO no aparece en ninguna cohorte", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // La direccion inversa: si la ventana se hubiera movido a la transicion terminal, esta orden
    // —de un lote de hace diez dias— entraria y la cohorte diria que se cargo el dia D.
    expect(filas.some((f) => f.fecha === D_MENOS_10)).toBe(false);
    expect(cargadasDe(filas, D)).toBe(1);
    expect(filas.reduce((suma, f) => suma + f.n, 0)).toBe(1);
  });
});
