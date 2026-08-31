import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * 💰 FICHA 337 (2026-08-31) — LAS GESTIONES DE ESCRITORIO NO ENTRAN AL CIERRE DE NADIE,
 * EJECUTADO CONTRA POSTGRES.
 *
 * EL DEFECTO QUE MIDE, con numeros de produccion de ese dia: 41 gestiones nacidas en el
 * escritorio de la tienda (22 `rechazo_tienda` + 19 `reprogramacion_tienda`) dentro de los 6
 * cierres aun no aprobados, y un cierre ENTERO de un mensajero —Andy Cortes— con 5 filas y NI UNA
 * suya. La tienda rechaza o reprograma desde novedades una orden que ya volvio a bodega; la
 * gestion sintetica nace con el `mensajero_id` del reparto y `cierre_id NULL`, y el siguiente
 * cierre de esa persona se la lleva. A los mensajeros no se les paga de mas (`pago_mensajero` =
 * 0,00 en las 41): el daño es de ATRIBUCION y de CONTEO —firman un documento de trabajo que no
 * hicieron—.
 *
 * POR QUE CONTRA POSTGRES Y NO CON DOBLES. Es un `where`, y ademas uno con una SUBCONSULTA
 * correlacionada (`historialEstados: { none: … }` -> `NOT EXISTS`). Un test de servicio con un
 * doble afirma que se llamo a `crearCierre`, no que `crearCierre` seleccione las filas correctas;
 * este repo tiene MEDIDO cuatro veces que una mutacion de un `where` sobrevive en verde por
 * arriba. Y en concreto: que Prisma acepte un filtro de RELACION dentro de un `updateMany` —el
 * punto donde de verdad se escribe el `cierre_id`— es un hecho del motor, no del codigo.
 *
 * LOS DOS PUNTOS QUE SE EJERCEN, que son los dos que hay:
 *   1. `findGestionesPendientes` — la LECTURA: lo que el mensajero ve y de donde salen los totales.
 *   2. `crearCierre` — la ESCRITURA: el `updateMany` que pone el `cierre_id`. Si solo se hubiera
 *      arreglado (1), la pantalla habria dejado de mostrarlas y el documento habria seguido
 *      llevandoselas: el bug entero, ahora invisible.
 *
 * CADA CASO USA UN MENSAJERO RECIEN CREADO, y no uno del catalogo: la base de desarrollo arrastra
 * gestiones sueltas de otras corridas, y con ellas por medio un `toEqual` del conjunto no diria
 * nada (o el `null` del tercer caso pasaria por la razon equivocada).
 *
 * CONTRAPRUEBA APLICADA (2026-08-31, salida pegada en `progress/impl_337.md`): quitando la
 * condicion `historialEstados: { none: … }` de `gestionesDelCierreWhere`
 * (`lib/repositories/CierreDiaRepository.ts`), este archivo se pone ROJO en los tres casos del
 * nucleo: el cierre se lleva las 4 gestiones en vez de las 2 que le tocan.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `return` silencioso dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `f337${Date.now().toString(36)}`;

/** Las cuatro familias que este archivo enfrenta, con lo que cada una significa. */
const CALLE: OrdenHistorialOrigenTipo = "gestion"; // el mensajero, en la puerta
const AYUDA: OrdenHistorialOrigenTipo = "gestion_tienda_ayuda"; // su visita, cerrada por la tienda
const RECHAZO_ESCRITORIO: OrdenHistorialOrigenTipo = "rechazo_tienda"; // decision de escritorio
const REPRO_ESCRITORIO: OrdenHistorialOrigenTipo = "reprogramacion_tienda"; // idem

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

describeSiHayBase("💰 337 — el cierre NO recoge las gestiones de escritorio de la tienda", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  /** FKs obligatorias de `usuario`, prestadas de una fila existente (no se inventa catalogo). */
  let fksUsuario: { tipoIdentificacionId: string; rolId: string };
  /** Contador de sembrados: cada mensajero/orden necesita su clave unica dentro de la corrida. */
  let n = 0;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    const encontradas = await fksDeOrden(prisma);
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. " +
          "Corre `pnpm run db:seed` antes de esta suite.",
      );
    }
    fks = encontradas;
    const usuario = await prisma.usuario.findFirst({
      select: { tipoIdentificacionId: true, rolId: true },
    });
    if (usuario === null) {
      throw new Error(
        "hace falta al menos UN usuario en la base: de el se toman prestadas las FKs de catalogo " +
          "(tipo de identificacion y rol) para crear los mensajeros limpios de estos casos.",
      );
    }
    fksUsuario = usuario;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Un mensajero SIN historia: es lo que permite afirmar conjuntos exactos y un `null` honesto. */
  async function crearMensajero(tx: Tx): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `Mensajero 337 ${clave}`,
        email: `m337-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `337${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
      },
      select: { id: true },
    });
    return u.id;
  }

  /**
   * Una gestion SUELTA (`cierre_id NULL`) con su fila de historial enlazada — que es la unica
   * evidencia de quien la registro y, desde la 337, lo que decide si entra al cierre.
   *
   * La fila de historial se escribe DIRECTA (no por `appendCambioEstado`) a proposito: lo que este
   * archivo mide es el `where` de la LECTURA y el de la ESCRITURA del cierre, y para eso la fila
   * solo tiene que existir con su `origen_tipo` y su `gestion_orden_id`. Meter el choke point por
   * medio añadiria un sujeto mas al experimento sin acercarse a lo que se quiere probar.
   */
  async function sembrarGestion(
    tx: Tx,
    mensajeroId: string,
    origenTipo: OrdenHistorialOrigenTipo,
    resultado: "entregada" | "rechazada" | "reprogramada",
  ): Promise<string> {
    const clave = `${SUFIJO}${(n += 1)}`;
    const orden = await tx.orden.create({
      data: {
        numRemision: `R-${clave}`,
        destinatario: "Dest",
        telefonoDest: "88880000",
        producto: "Prod",
        estatusId: fks.estatusId,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
      },
      select: { id: true },
    });
    const gestion = await tx.gestionOrden.create({
      data: { ordenId: orden.id, mensajeroId, resultado, cierreId: null },
      select: { id: true },
    });
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId: orden.id,
        estatusOrigenId: null,
        estatusDestinoId: fks.estatusId,
        actorUsuarioId: null,
        origenTipo,
        gestionOrdenId: gestion.id,
      },
    });
    return gestion.id;
  }

  /** Las CUATRO del escenario: dos que son suyas y las dos de escritorio que no. */
  async function sembrarEscenario(tx: Tx, mensajeroId: string) {
    return {
      calle: await sembrarGestion(tx, mensajeroId, CALLE, "entregada"),
      ayuda: await sembrarGestion(tx, mensajeroId, AYUDA, "rechazada"),
      rechazoTienda: await sembrarGestion(tx, mensajeroId, RECHAZO_ESCRITORIO, "rechazada"),
      reproTienda: await sembrarGestion(tx, mensajeroId, REPRO_ESCRITORIO, "reprogramada"),
    };
  }

  function repoDe(tx: Tx) {
    return new CierreDiaRepository(
      tx as unknown as PrismaClient,
      new TarifaVigenteRepository(tx as unknown as PrismaClient),
    );
  }

  const INPUT_CIERRE_VACIO = {
    destinoTipo: "bodega_central" as const,
    totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
    pagoByGestionId: {},
    totalPagoMensajero: "0.00",
    ingresoByGestionId: {},
    totalIngresoBodegaRechazos: "0.00",
  };

  // ==========================================================================================
  // CAMINO 1 — LA LECTURA: lo que el mensajero ve y de donde salen los totales.
  // ==========================================================================================

  it("`findGestionesPendientes` devuelve la de CALLE y la de AYUDA, y NINGUNA de escritorio", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const ids = await sembrarEscenario(tx, mensajeroId);
      const filas = await repoDe(tx).findGestionesPendientes(mensajeroId);
      return { ids, vistas: filas.map((f) => f.gestionId).sort() };
    });

    // ⭑ EL CONJUNTO EXACTO. No «no contiene el rechazo»: las DOS que entran y las DOS que no, en
    // la misma lectura. Una bandera que siempre excluye pasaria igual de verde que una correcta.
    expect(medido.vistas).toEqual([medido.ids.calle, medido.ids.ayuda].sort());

    // Y dicho fila por fila, que es donde se ve QUE se rompio si esto cae:
    expect(medido.vistas).not.toContain(medido.ids.rechazoTienda); // 22 de las 41 medidas
    expect(medido.vistas).not.toContain(medido.ids.reproTienda); // 19 de las 41 medidas
    expect(medido.vistas).toContain(medido.ids.ayuda); // ⭑ REGRESION 237: la ayuda NO se toca
    expect(medido.vistas).toContain(medido.ids.calle);
  });

  // ==========================================================================================
  // CAMINO 2 — LA ESCRITURA: el `updateMany` que pone el `cierre_id`. Es el que manda.
  // ==========================================================================================

  it("`crearCierre` VINCULA solo la de calle y la de ayuda; las de escritorio siguen sueltas", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const ids = await sembrarEscenario(tx, mensajeroId);

      const cierreId = await repoDe(tx).crearCierre({
        ...INPUT_CIERRE_VACIO,
        mensajeroId,
        destinoZonaId: fks.zonaId,
      });

      const filas = await tx.gestionOrden.findMany({
        where: { id: { in: Object.values(ids) } },
        select: { id: true, cierreId: true },
      });
      const enElCierre = await tx.gestionOrden.findMany({
        where: { cierreId: cierreId ?? "sin-cierre" },
        select: { id: true },
      });
      return {
        ids,
        cierreId,
        enElCierre: enElCierre.map((g) => g.id).sort(),
        porGestion: Object.fromEntries(filas.map((f) => [f.id, f.cierreId])) as Record<
          string,
          string | null
        >,
      };
    });

    const { ids, cierreId, porGestion, enElCierre } = medido;
    expect(cierreId).not.toBeNull();

    // ⭑ EL CONJUNTO EXACTO DE LO QUE EL DOCUMENTO SE LLEVO: dos filas, ni una mas.
    expect(enElCierre).toEqual([ids.calle, ids.ayuda].sort());

    // ⭑ LAS DOS QUE SI: reciben el `cierre_id` del cierre recien creado.
    expect(porGestion[ids.calle]).toBe(cierreId);
    expect(porGestion[ids.ayuda]).toBe(cierreId); // ⭑ REGRESION 237

    // ⭑ LAS DOS DE ESCRITORIO: siguen con `cierre_id NULL`. Este es EL requisito de la ficha, y es
    // el que la mutacion del `where` tumba.
    expect(porGestion[ids.rechazoTienda]).toBeNull();
    expect(porGestion[ids.reproTienda]).toBeNull();
  });

  // ==========================================================================================
  // EL CASO ANDY CORTES — un cierre ENTERO sin una sola gestion de su mensajero.
  // ==========================================================================================

  it("un mensajero cuyas UNICAS gestiones sueltas son de escritorio NO recibe cierre (`null`)", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const rechazo = await sembrarGestion(tx, mensajeroId, RECHAZO_ESCRITORIO, "rechazada");
      const repro = await sembrarGestion(tx, mensajeroId, REPRO_ESCRITORIO, "reprogramada");

      const cierreId = await repoDe(tx).crearCierre({
        ...INPUT_CIERRE_VACIO,
        mensajeroId,
        destinoZonaId: fks.zonaId,
      });
      const cierres = await tx.cierreDia.count({ where: { mensajeroId } });
      const sueltas = await tx.gestionOrden.findMany({
        where: { id: { in: [rechazo, repro] } },
        select: { cierreId: true },
      });
      return { cierreId, cierres, cierresDeLasGestiones: sueltas.map((g) => g.cierreId) };
    });

    // La guarda «algo paso» de `crearCierre` (41/C1) hace el resto: 0 vinculadas -> rollback.
    expect(medido.cierreId).toBeNull();
    // Y no queda el cierre vacio a su nombre — el caso exacto que el humano reporto.
    expect(medido.cierres).toBe(0);
    // Las gestiones no se pierden ni se marcan: siguen sueltas, enteras, esperando su via de cobro.
    expect(medido.cierresDeLasGestiones).toEqual([null, null]);
  });

  // ==========================================================================================
  // LA NO-REGRESION DEL DINERO — un cierre SOLO DE CALLE se comporta exactamente igual que ayer.
  // ==========================================================================================

  it("un cierre SOLO de calle vincula lo mismo y con los MISMOS totales que antes de la 337", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);
      const uno = await sembrarGestion(tx, mensajeroId, CALLE, "entregada");
      const dos = await sembrarGestion(tx, mensajeroId, CALLE, "entregada");

      const vistas = (await repoDe(tx).findGestionesPendientes(mensajeroId)).map(
        (f) => f.gestionId,
      );

      const cierreId = await repoDe(tx).crearCierre({
        mensajeroId,
        destinoTipo: "bodega_central",
        destinoZonaId: fks.zonaId,
        // Los MISMOS totales snapshot de siempre: el filtro nuevo no toca esta aritmetica.
        totales: {
          efectivo: "12500.00",
          simpe: "0.00",
          transferencia: "0.00",
          general: "12500.00",
        },
        pagoByGestionId: { [uno]: "1500.00", [dos]: "1500.00" },
        totalPagoMensajero: "3000.00",
        ingresoByGestionId: {},
        totalIngresoBodegaRechazos: "0.00",
      });

      const cabecera = await tx.cierreDia.findUnique({
        where: { id: cierreId ?? "sin-cierre" },
        select: {
          totalEfectivo: true,
          totalGeneral: true,
          totalPagoMensajero: true,
          totalIngresoBodegaRechazos: true,
        },
      });
      const vinculadas = await tx.gestionOrden.findMany({
        where: { cierreId: cierreId ?? "sin-cierre" },
        select: { id: true, pagoMensajero: true },
      });
      return {
        ids: [uno, dos].sort(),
        vistas: vistas.sort(),
        vinculadas: vinculadas.map((g) => g.id).sort(),
        // Money-safe: Decimal -> STRING escala 2 aqui, para que la asercion sea literal.
        totales: {
          efectivo: cabecera?.totalEfectivo.toFixed(2) ?? null,
          general: cabecera?.totalGeneral.toFixed(2) ?? null,
          pagoMensajero: cabecera?.totalPagoMensajero.toFixed(2) ?? null,
          ingresoBodega: cabecera?.totalIngresoBodegaRechazos.toFixed(2) ?? null,
        },
        pagos: vinculadas
          .map((g) => (g.pagoMensajero === null ? null : g.pagoMensajero.toFixed(2)))
          .sort(),
      };
    });

    // La lista y el vinculo: las DOS, sin perder ni una. El `NOT EXISTS` no come gestiones de
    // calle — que es la forma en que este arreglo podria haber roto lo que venia a proteger.
    expect(medido.vistas).toEqual(medido.ids);
    expect(medido.vinculadas).toEqual(medido.ids);

    // ⭑ LOS TOTALES, INTACTOS. Money-safe: STRING de punta a punta.
    expect(medido.totales).toEqual({
      efectivo: "12500.00",
      general: "12500.00",
      pagoMensajero: "3000.00",
      ingresoBodega: "0.00",
    });
    expect(medido.pagos).toEqual(["1500.00", "1500.00"]);
  });
});
