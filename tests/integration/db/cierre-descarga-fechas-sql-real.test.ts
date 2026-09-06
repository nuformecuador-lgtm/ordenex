import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * PEDIDO HUMANO DEL 2026-09-05 — LAS DOS FECHAS DE LA DESCARGA DETALLADA DE CIERRES, EJECUTADAS
 * CONTRA POSTGRES.
 *
 * QUE SE MIDE. Que la columna «Fecha de gestion» de la hoja fundida sale de
 * `gestion_orden.created_at` —el reloj INMUTABLE de la gestion— y no de `cierre_dia.solicitado_at`,
 * y que «Dia de reparto» sale de `orden.fecha_reparto` incluso cuando esa columna esta en NULL.
 *
 * POR QUE CONTRA POSTGRES Y NO CON DOBLES, que es la pregunta que decide si este archivo vale
 * algo. Lo que puede salir mal aqui NO es una rama de codigo: es un `select` que no pide la
 * columna, una relacion que Prisma no resuelve, y sobre todo un tipo de dato. Los dos campos son
 * de tipos DISTINTOS —`created_at` es `timestamp` y `fecha_reparto` es `@db.Date`— y por eso se
 * serializan de dos formas distintas; un doble devuelve el `Date` que el test le ponga, asi que
 * confirmaria la conversion que el propio test eligio. Aqui el `Date` lo construye el DRIVER a
 * partir de lo que Postgres guardo, que es lo que corre en produccion.
 *
 * LOS TRES HECHOS QUE SE SIEMBRAN, y cada uno mata una forma concreta de equivocarse:
 *
 *  1. **El cierre y la gestion son de DIAS DISTINTOS** (cierre el 10 de marzo, gestion el 11).
 *     Es el 29 % de los casos medidos en produccion (312 de 1.063). Con las dos fechas iguales,
 *     una proyeccion que emitiera `solicitado_at` en la celda de la gestion pasaria en VERDE.
 *  2. **La gestion se registra a las 20:00 de COSTA RICA** (`2026-03-12T02:00:00Z`). En UTC eso
 *     ya es dia 12; en CR sigue siendo el 11. Es el off-by-one del `toISOString().slice(0, 10)`
 *     sobre un `timestamp`, y aqui se exige el dia CR.
 *  3. **Una segunda orden con `fecha_reparto` en NULL.** La columna se anula al deshacer una
 *     asignacion, al liberar a bodega satelite y al aprobar el cierre de una orden sin gestionar,
 *     asi que la celda vacia es un desenlace legitimo — y lo que hay que impedir es que alguien
 *     la «arregle» rellenandola con la fecha del cierre.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `if (!x) return` dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE en el `beforeAll`.
 *
 * Todo se siembra dentro de una transaccion que SIEMPRE se revierte: no queda ni una fila.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `fech${Date.now().toString(36)}`;

/** El cierre se solicita el 10 de marzo (09:00 CR). */
const SOLICITADO_AT = new Date("2026-03-10T15:00:00.000Z");
/** La gestion se registra a las 20:00 CR del 11 — que en UTC ya es el 12. */
const GESTION_CREATED_AT = new Date("2026-03-12T02:00:00.000Z");
/** El dia de reparto de la orden que lo conserva: `@db.Date`, medianoche UTC. */
const FECHA_REPARTO = new Date("2026-03-08T00:00:00.000Z");

/** Alcance del maestro sobre la bodega central, que es donde se siembran los cierres. */
const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

describeSiHayBase("descarga detallada — las fechas de gestion y de reparto (2026-09-05)", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let fksUsuario: { tipoIdentificacionId: string; rolId: string };
  let n = 0;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    fks = encontradas;
    const usuario = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (usuario === null) {
      throw new Error(
        "hace falta al menos UN usuario en la base: de el se toman prestadas las FKs de catalogo " +
          "(tipo de identificacion y rol) para crear el mensajero limpio de estos casos.",
      );
    }
    fksUsuario = usuario;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Un mensajero SIN historia: es lo que permite afirmar conjuntos EXACTOS. */
  async function crearMensajero(tx: Tx): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `Mensajero fechas ${clave}`,
        email: `mfecha-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `fch${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
      },
      select: { id: true },
    });
    return u.id;
  }

  /**
   * Una orden + su gestion YA VINCULADA al cierre + la fila CONGELADA de `cierre_detail`.
   *
   * Las tres van juntas porque la descarga las necesita las tres: la lectura empareja
   * `gestion_orden` con `cierre_detail` por `(cierre_id, orden_id)` y revienta duro si falta la
   * congelada — asi que sembrar solo la gestion daria un rojo que no dice nada de las fechas.
   */
  async function sembrarFila(
    tx: Tx,
    cierreId: string,
    mensajeroId: string,
    marca: string,
    fechaReparto: Date | null,
  ): Promise<{ ordenId: string; numRemision: string }> {
    const clave = `${SUFIJO}-${marca}`;
    const numRemision = `R-${clave}`;
    const orden = await tx.orden.create({
      data: {
        numRemision,
        destinatario: "Dest",
        telefonoDest: "88880000",
        producto: "Prod",
        estatusId: fks.estatusId,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
        fechaReparto,
      },
      select: { id: true },
    });
    await tx.gestionOrden.create({
      data: {
        ordenId: orden.id,
        mensajeroId,
        resultado: "entregada",
        cierreId,
        // El dato que esta ficha lleva a la hoja. Se estampa a mano porque el default es
        // `now()`, y con `now()` los tres dias del escenario serian el mismo.
        createdAt: GESTION_CREATED_AT,
      },
      select: { id: true },
    });
    await tx.cierreDetail.create({
      data: {
        cierreId,
        ordenId: orden.id,
        montoCobrar: null,
        cobraComision: false,
        zonaId: fks.zonaId,
        tiendaId: fks.tiendaId,
        esCentral: true,
        numGuia: null,
        numRemision,
        destinatario: "Dest",
        direccion: null,
        producto: "Prod",
        tiendaNombre: "Tienda congelada",
        zonaNombre: "Zona congelada",
        provinciaNombre: "Provincia congelada",
        cantonNombre: "Canton congelado",
        distritoNombre: null,
      },
      select: { id: true },
    });
    return { ordenId: orden.id, numRemision };
  }

  function repoDe(tx: Tx) {
    return new CierresAdminRepository(
      tx as unknown as PrismaClient,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  /**
   * Siembra el escenario entero y devuelve las filas que la descarga emite para ESE mensajero.
   * El filtro por `mensajeroIds` acota a lo recien sembrado: la base de desarrollo arrastra
   * cierres de otras corridas y sin acotar el `toEqual` de un conjunto no diria nada.
   */
  async function filasDeLaDescarga() {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const cierre = await tx.cierreDia.create({
        data: {
          mensajeroId,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: fks.zonaId,
          solicitadoAt: SOLICITADO_AT,
        },
        select: { id: true },
      });
      const conReparto = await sembrarFila(tx, cierre.id, mensajeroId, "con", FECHA_REPARTO);
      const sinReparto = await sembrarFila(tx, cierre.id, mensajeroId, "sin", null);

      const filas = await repoDe(tx).findGestionesPorAlcanceCompleto(ALCANCE, {
        mensajeroIds: [mensajeroId],
      });
      return { filas, conReparto, sinReparto };
    });
  }

  it("emite la fecha de la GESTION, no la del cierre, y en calendario de Costa Rica", async () => {
    const { filas } = await filasDeLaDescarga();

    // No-vacuidad primero: si el WHERE dejara de casar, todo lo de abajo pasaria por vacio.
    expect(filas).toHaveLength(2);

    for (const fila of filas) {
      // ⭑ EL HECHO: la gestion se registro a las 20:00 CR del 11 de marzo.
      expect(fila.fechaGestion, fila.numRemision).toBe("2026-03-11");
      // …y NO es el dia UTC de ese mismo instante, que es el 12. Este es el off-by-one que
      // `toISOString().slice(0, 10)` habria producido sobre un `timestamp`.
      expect(fila.fechaGestion, fila.numRemision).not.toBe("2026-03-12");
      // …ni el dia del CIERRE, que es el 10. Es la confusion que motivo la ficha.
      expect(fila.fechaGestion, fila.numRemision).not.toBe("2026-03-10");
      expect(fila.cierreSolicitadoAt.slice(0, 10)).toBe("2026-03-10");
    }
  });

  it("emite el dia de reparto de la orden, y lo deja VACIO cuando la columna esta en NULL", async () => {
    const { filas, conReparto, sinReparto } = await filasDeLaDescarga();

    const porRemision = new Map(filas.map((f) => [f.numRemision, f]));
    expect([...porRemision.keys()].sort()).toEqual(
      [conReparto.numRemision, sinReparto.numRemision].sort(),
    );

    // La orden que conserva su dia de reparto lo emite tal cual: `@db.Date`, sin hora.
    expect(porRemision.get(conReparto.numRemision)!.diaReparto).toBe("2026-03-08");

    // ⭑ Y la que lo perdio deja la celda VACIA. Ni la fecha del cierre («2026-03-10»), ni la de
    // la gestion («2026-03-11»), ni una cadena vacia: `null`, que es lo que de verdad hay.
    const sin = porRemision.get(sinReparto.numRemision)!;
    expect(sin.diaReparto).toBeNull();
    expect(sin.diaReparto).not.toBe("2026-03-10");
    expect(sin.diaReparto).not.toBe("2026-03-11");
    // Y perder el dia de reparto no se lleva por delante la otra fecha de la misma fila.
    expect(sin.fechaGestion).toBe("2026-03-11");
  });

  it("las tres fechas de una fila son TRES dias distintos y ninguna se contamina", async () => {
    // El caso que resume la ficha: cierre el 10, reparto el 8, gestion el 11. Si la proyeccion
    // cruzara dos de ellas, aqui dos celdas saldrian iguales.
    const { filas, conReparto } = await filasDeLaDescarga();
    const fila = filas.find((f) => f.numRemision === conReparto.numRemision)!;

    const tres = [fila.cierreSolicitadoAt.slice(0, 10), fila.fechaGestion, fila.diaReparto];
    expect(tres).toEqual(["2026-03-10", "2026-03-11", "2026-03-08"]);
    expect(new Set(tres).size).toBe(3);
  });
});
