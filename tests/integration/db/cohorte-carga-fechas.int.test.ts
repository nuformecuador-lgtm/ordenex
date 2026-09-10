import { it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "./_postgres-real";
import { crearOrden, instanteCR, sembrarBase } from "./_semilla-rollup";
import {
  cargadasDe,
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
 * ⭑⭑ FICHA 411 / T4.1 — LA TRAMPA HORARIA, CONTRA POSTGRES DE VERDAD (R1, R2, R3).
 *
 * ─── POR QUE NO BASTA UN DOBLE ──────────────────────────────────────────────────────────
 *
 * Todo lo que este archivo mide vive en el SQL: la EXPRESION que calcula el dia calendario de
 * Costa Rica (`DIA_CR`, un desfase que viaja como parametro) y las COTAS de la ventana. Un test
 * con dobles no ve ninguna de las dos: devuelve lo que se le diga y sale verde con las dos
 * puestas al reves.
 *
 * ─── LAS DOS TRAMPAS, Y NINGUNA SE VE A OJO ─────────────────────────────────────────────
 *
 * 1. **El bucket.** `orden.created_at` es un `timestamp` que guarda el reloj UTC. Agrupar por
 *    `created_at::date` daria el dia UTC: una orden cargada a las 23:50 hora de PARED de Costa
 *    Rica caeria en el dia SIGUIENTE. El pais entero carga de tarde, asi que el error se
 *    reparte por toda la tabla sin que ninguna cifra parezca rara.
 *
 * 2. **Las cotas.** `startOfDayCR(f)` devuelve la MEDIANOCHE UTC de la fecha CR — correcta
 *    contra columnas `@db.Date` y SEIS HORAS por debajo del inicio real del dia contra un
 *    `timestamp`. Con ella, la ventana real seria 18:00-18:00 hora CR: entrarian ordenes de la
 *    tarde del dia ANTERIOR al pedido y se caerian las de la noche del ULTIMO dia. Las cotas
 *    correctas son `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, y todo borde cae en
 *    `...T06:00:00.000Z`.
 *
 * ─── EL ESCENARIO ESTA DISENADO PARA DISCRIMINAR LAS DOS ────────────────────────────────
 *
 * | orden | hora de PARED CR          | instante UTC             | donde debe caer           |
 * | ----- | ------------------------- | ------------------------ | ------------------------- |
 * | A     | D    23:50                | D+1 05:50Z               | cohorte D                 |
 * | B     | D+1  00:10                | D+1 06:10Z               | cohorte D+1               |
 * | C     | D-1  18:10                | D    00:10Z              | FUERA (antes del `desde`) |
 * | E     | D+1  23:50                | D+2 05:50Z               | cohorte D+1               |
 * | F     | D    00:00 (borde `desde`)| D    06:00Z              | cohorte D  (la cota es >=)|
 * | G     | D+2  00:00 (borde `hasta`)| D+2 06:00Z               | FUERA      (la cota es <) |
 *
 * A y B matan la trampa (1): si el bucket fuera el dia UTC, A caeria con B. C y E matan la
 * trampa (2): con `startOfDayCR` como cota, C entraria (y estrenaria una cohorte D-1 que nadie
 * pidio) y E se caeria. F y G matan el off-by-one de la SEMIABIERTA: un `>` dejaria a F fuera y
 * un `<=` metaria a G, que es de un dia que nadie pidio.
 *
 * ⚠️ NADA DE `if (!fks) return;`. Sin catalogo esto REVIENTA con un mensaje que lo dice: un
 * `return` temprano reporta `passed` sin haber comprobado nada. Y cada caso asevera PRIMERO que
 * su fixture produjo filas — con cohortes es facilisimo que la ventana quede vacia por accidente.
 */

describeSiHayBase("411/T4.1 — la cohorte agrupa por el dia CR de la CARGA", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Siembra las seis ordenes y devuelve las cohortes del rango `[D, D+1]`. */
  async function escenario() {
    return enTransaccionRevertida(prisma, async (tx) => {
      // PRIMERA sentencia de la transaccion: si se tomara despues de tocar una tabla, la
      // transaccion ya habria adquirido locks antes de serializarse y el deadlock vuelve.
      await serializarEscriturasReales(tx);
      const base = await sembrarBase(tx);

      await crearOrden(tx, base, {
        clave: "A-2350-del-dia-D",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "23:50"),
      });
      await crearOrden(tx, base, {
        clave: "B-0010-del-dia-D1",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D_MAS_1, "00:10"),
      });
      await crearOrden(tx, base, {
        clave: "C-1810-del-dia-anterior",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D_MENOS_1, "18:10"),
      });
      await crearOrden(tx, base, {
        clave: "E-2350-del-ultimo-dia",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D_MAS_1, "23:50"),
      });

      // Las dos ordenes del BORDE EXACTO, que es donde vive el off-by-one clasico:
      //  - F cae EXACTAMENTE en el `desde` (00:00 CR del dia D): entra, porque la cota es `>=`;
      //  - G cae EXACTAMENTE en el `hasta` (00:00 CR de D+2, el dia siguiente al ultimo pedido):
      //    NO entra, porque la cota es `<`. Con un `<=` estaria dentro y la tabla estrenaria una
      //    cohorte D+2 con una orden que no es de este rango.
      await crearOrden(tx, base, {
        clave: "F-borde-exacto-del-desde",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D, "00:00"),
      });
      await crearOrden(tx, base, {
        clave: "G-borde-exacto-del-hasta",
        zonaId: base.zonaA,
        tiendaId: base.tienda1,
        createdAt: instanteCR(D_MAS_2, "00:00"),
      });

      const consulta = consultaDe(rangoDe(D, D_MAS_1), {
        usuarioId: base.tienda1,
        rol: "adminTienda",
      });
      return { filas: await leerCohortes(tx, consulta), instantes: instantesDe(consulta) };
    });
  }

  /** Los dos instantes que la consulta preparada lleva dentro, para afirmarlos tal cual. */
  function instantesDe(consulta: { rango: { desde: Date; hasta: Date } | null }): {
    desde: string;
    hasta: string;
  } {
    if (consulta.rango === null) throw new Error("la consulta de prueba se quedo sin rango");
    return {
      desde: consulta.rango.desde.toISOString(),
      hasta: consulta.rango.hasta.toISOString(),
    };
  }

  it("agrupa cada orden por el dia calendario CR de su `created_at`", async () => {
    const { filas } = await escenario();

    // ANTI-VACIO, y va primero: una ventana vacia reporta `passed` sin comprobar nada.
    expect(filas.length, "el fixture no produjo ni una cohorte").toBeGreaterThan(0);

    const dias = [...new Set(filas.map((f) => f.fecha))];
    expect(dias).toEqual([D_MAS_1, D]); // descendente, y solo los dias CON ordenes
    expect(cargadasDe(filas, D)).toBe(2); // A (23:50) y F (borde exacto del `desde`)
    expect(cargadasDe(filas, D_MAS_1)).toBe(2); // B (00:10) y E (23:50)
  });

  it("una orden de las 23:50 CR del dia D cae en la cohorte D, y una de las 00:10 CR del D+1 en la D+1", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // LA TRAMPA DEL BUCKET. Las dos ordenes distan VEINTE MINUTOS y estan en el MISMO dia UTC
    // (`2001-06-16`): si el dia se calculara sobre el reloj UTC, las dos caerian juntas en la
    // cohorte D+1 y la cohorte D no existiria.
    expect(cargadasDe(filas, D)).toBe(2);
    expect(cargadasDe(filas, D_MAS_1)).toBe(2);
    expect(instanteCR(D, "23:50").toISOString()).toBe("2001-06-16T05:50:00.000Z");
    expect(instanteCR(D_MAS_1, "00:10").toISOString()).toBe("2001-06-16T06:10:00.000Z");
  });

  it("los bordes de la ventana son las 06:00Z: la tarde del dia anterior queda FUERA y la noche del ultimo dia DENTRO", async () => {
    const { filas, instantes } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // Las cotas, tal y como viajan a la base. Con `startOfDayCR` serian `T00:00:00.000Z`.
    expect(instantes.desde).toBe("2001-06-15T06:00:00.000Z");
    expect(instantes.hasta).toBe("2001-06-17T06:00:00.000Z");

    // C (18:10 CR del dia ANTERIOR = D 00:10Z) esta DENTRO de la ventana desplazada seis horas
    // y FUERA de la correcta: si apareciera, la tabla estrenaria una cohorte D-1 que nadie pidio.
    expect(filas.some((f) => f.fecha === D_MENOS_1)).toBe(false);
    expect(cargadasDe(filas, D_MENOS_1)).toBe(0);

    // E (23:50 CR del ULTIMO dia del rango = D+2 05:50Z) esta DENTRO de la correcta y FUERA de
    // la desplazada: si se cayera, la cohorte D+1 tendria 1 en vez de 2.
    expect(cargadasDe(filas, D_MAS_1)).toBe(2);
    expect(instanteCR(D_MAS_1, "23:50").toISOString()).toBe("2001-06-17T05:50:00.000Z");
  });

  it("la ventana es SEMIABIERTA: el `desde` entra y el `hasta` no", async () => {
    const { filas } = await escenario();

    expect(filas.length).toBeGreaterThan(0);

    // F cae EXACTAMENTE en el `desde`: con `>` en vez de `>=` la cohorte D bajaria a 1.
    expect(instanteCR(D, "00:00").toISOString()).toBe("2001-06-15T06:00:00.000Z");
    expect(cargadasDe(filas, D)).toBe(2);

    // G cae EXACTAMENTE en el `hasta`: con `<=` en vez de `<` apareceria una cohorte D+2 entera
    // que nadie pidio. Es el off-by-one que menos se ve, porque el numero de la cohorte pedida
    // no cambia: lo que cambia es que sobra una fila abajo.
    expect(instanteCR(D_MAS_2, "00:00").toISOString()).toBe("2001-06-17T06:00:00.000Z");
    expect(filas.some((f) => f.fecha === D_MAS_2)).toBe(false);
    expect(cargadasDe(filas, D_MAS_2)).toBe(0);
  });
});
