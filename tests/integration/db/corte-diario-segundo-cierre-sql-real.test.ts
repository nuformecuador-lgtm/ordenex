import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CorteDiarioService, diaQueElCorteCierra } from "@/lib/services/CorteDiarioService";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import type { CierreVencidoContexto } from "@/lib/notificaciones/emitir";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FEATURE 271 (T10.3, R21-R24) — **LA CORRIDA DEL CORTE, SEMBRADA CONTRA POSTGRES**.
 *
 * POR QUE ESTE ARCHIVO EXISTE. El cambio central de la ficha 271 es **una linea que se fue**: la
 * exclusion `ESTADOS_CIERRE_ABIERTOS` de
 * `CorteDiarioRepository.findMensajerosConActividadSinCierre`, que restaba del corte a quien ya
 * tenia un cierre abierto. **Eso es un `WHERE`**, y hasta hoy solo lo cubrian tests UNITARIOS con
 * doble de Prisma: `corte-diario-repository.test.ts` afirma que `prisma.cierreDia.findMany` **no se
 * llama**, que es una afirmacion sobre la FORMA de la consulta, no sobre las filas que Postgres
 * devuelve.
 *
 * En este repo esta **medido cuatro veces** que una mutacion de un `WHERE` sobrevive en verde con
 * dobles. Aqui la unica forma de que un caso pase es que Postgres devuelva de verdad las filas que
 * se afirman: los repositorios son los **REALES** (`CorteDiarioRepository`, `CierreDiaRepository`,
 * `OrdenRepository`, `ZonaRepository`, `TarifaZonaMensajeroRepository`), sobre una transaccion
 * real, y quien decide es el motor.
 *
 * LAS DOS MUTACIONES QUE ESTE ARCHIVO TIENE QUE APROBAR (T11.2), aplicadas y anotadas en
 * `progress/impl_271.md`:
 *   (a) **reponer la exclusion por cierre abierto** en `CorteDiarioRepository` -> muere el caso 1
 *       («el caso `79cb2c0f`»): el mensajero con un `solicitado` vuelve a quedarse fuera del corte y
 *       su segundo cierre no se crea.
 *   (b) **romper la guarda «algo paso»** de `CierreDiaRepository.crearCierre` -> **SOBREVIVE, y se
 *       deja escrito tal cual**. No se maquilla ni se le fabrica un caso que la mate solo para tener
 *       el marcador a cero: por el camino del corte, «seleccionado y sin nada que cerrar» no es un
 *       estado alcanzable con datos estaticos. Lo que sostiene el caso 2 **no es esa guarda, es la
 *       SELECCION** (ver la nota de ⚠️ MECANISMO MEDIDO alli). La red de la guarda vive en
 *       `tests/unit/repositories/cierre-dia-repository.test.ts`, donde la mutacion mata **4 casos**.
 *
 * SIN BASE ALCANZABLE se **SALTA** (`describe.skip`), nunca pasa en verde: un `skip` se ve en la
 * salida; un `return` silencioso dentro del caso se leeria como `passed` sin haber comprobado nada,
 * y este repo ya se comio ese verde una vez. CON base pero SIN catalogo o sin FKs, **falla
 * RUIDOSAMENTE** en el `beforeAll`.
 *
 * ANTI-VACUIDAD, ADEMAS DEL `skip`: cada caso **cuenta su propio corpus antes de medir**
 * (`afirmarCorpusSembrado`) y exige que el corte haya **evaluado** a sus mensajeros. Un test que
 * midiera sobre cero filas no puede llegar a las aserciones del desenlace: muere en la primera.
 *
 * TODO corre dentro de una transaccion que **SIEMPRE se revierte**: si el caso pasa, si falla o si
 * el proceso muere, no queda ni una fila en la base compartida.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `271t103-${Date.now().toString(36)}`;

/**
 * El instante del cron: 00:03 CR del 22 de agosto. `diaQueElCorteCierra` lo convierte en el dia que
 * la corrida CIERRA — el **21** —, que es exactamente el desfase del caso medido en produccion
 * (`79cb2c0f` nacio el 22 y su jornada es el 21).
 */
const CRON_22_0003 = new Date("2026-08-22T06:03:15.000Z");
/** El cron de la noche SIGUIENTE: cierra el dia 22. Sirve para la idempotencia (R24). */
const CRON_23_0003 = new Date("2026-08-23T06:03:15.000Z");

/** Gestiones del dia 21 (CR = UTC-6 fijo). */
const CR_21_1656 = new Date("2026-08-21T22:56:00.000Z");
const CR_21_1710 = new Date("2026-08-21T23:10:00.000Z");
/** Gestiones del dia 20: las que ya viajan en el cierre `solicitado` de ayer. */
const CR_20_1400 = new Date("2026-08-20T20:00:00.000Z");

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

describeSiHayBase("271/T10.3 — el corte diario, sembrado contra Postgres", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let catalogo: { enReparto: string; ayuda: string; sinGestionar: string };
  let zonaCentralId: string;
  let rolMensajeroId: string;
  let tipoIdentificacionId: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const encontradas = await fksDeOrden(prisma);
    // Fallo RUIDOSO, no `return` silencioso: con base alcanzable y sin datos este archivo no puede
    // comprobar nada, y un `passed` en esas condiciones es peor que no tener el test.
    if (encontradas === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar el corpus. " +
          "Corre `pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    fks = encontradas;

    const estatus = await prisma.orderStatus.findMany({
      where: { value: { in: ["en_reparto", "ayuda_tienda", "sin_gestionar"] } },
      select: { id: true, value: true },
    });
    const porValue = new Map(estatus.map((e) => [e.value, e.id]));
    for (const v of ["en_reparto", "ayuda_tienda", "sin_gestionar"]) {
      if (!porValue.has(v)) {
        throw new Error(
          `falta el estatus «${v}» en el catalogo \`order_status\`. Corre \`pnpm run db:seed\`: ` +
            "sin el, el corte NO barre y este archivo NO debe pasar en verde.",
        );
      }
    }
    catalogo = {
      enReparto: porValue.get("en_reparto") as string,
      ayuda: porValue.get("ayuda_tienda") as string,
      sinGestionar: porValue.get("sin_gestionar") as string,
    };

    const central = await prisma.zona.findFirst({
      where: { esCentral: true },
      select: { id: true },
    });
    if (central === null) {
      throw new Error(
        "no hay ninguna zona con `es_central = true`: sin ella el corte no puede derivar la bodega " +
          "responsable y el corpus no seria el de produccion.",
      );
    }
    zonaCentralId = central.id;

    const rol = await prisma.rol.findFirst({
      where: { value: "mensajero" },
      select: { id: true },
    });
    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (rol === null || tipo === null) {
      throw new Error(
        "faltan el rol `mensajero` o el catalogo de tipos de identificacion: no se pueden sembrar " +
          "mensajeros propios. Corre `pnpm run db:seed`.",
      );
    }
    rolMensajeroId = rol.id;
    tipoIdentificacionId = tipo.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ===============================================================================================
  // Utilidades de siembra. Todas reciben la `tx` y escriben DENTRO de la transaccion revertida.
  // ===============================================================================================

  /**
   * Mensajeros **PROPIOS**, creados por el test.
   *
   * POR QUE NO SE REUSAN LOS USUARIOS DE LA BASE, como hacen los otros archivos de esta carpeta:
   * aqui lo que se ejercita es una corrida COMPLETA del corte, y el corte lee **toda** la base. Un
   * usuario prestado puede traer gestiones sueltas u ordenes en reparto que no sembro este test, y
   * entonces «el mensajero recibio su segundo cierre» dejaria de ser una consecuencia del corpus.
   * Con usuarios recien creados el estado de partida es CERO y esta escrito aqui.
   */
  async function sembrarMensajero(tx: Tx, marca: string): Promise<string> {
    const u = await tx.usuario.create({
      data: {
        nombre: `Mensajero ${marca}`,
        email: `m-${SUFIJO}-${marca}@test.local`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `${SUFIJO}-${marca}`,
        tipoIdentificacionId,
        rolId: rolMensajeroId,
        zonaId: zonaCentralId,
      },
      select: { id: true },
    });
    return u.id;
  }

  async function sembrarOrden(
    tx: Tx,
    marca: string,
    opts: {
      estatusId?: string;
      mensajeroAsignadoId?: string | null;
      fechaReparto?: Date | null;
    } = {},
  ): Promise<string> {
    const o = await tx.orden.create({
      data: {
        numRemision: `R-${SUFIJO}-${marca}`,
        destinatario: "Dest",
        telefonoDest: "88880000",
        producto: "Prod",
        estatusId: opts.estatusId ?? fks.estatusId,
        tiendaId: fks.tiendaId,
        zonaId: fks.zonaId,
        provinciaId: fks.provinciaId,
        cantonId: fks.cantonId,
        ...(opts.mensajeroAsignadoId !== undefined
          ? { mensajeroAsignadoId: opts.mensajeroAsignadoId }
          : {}),
        ...(opts.fechaReparto !== undefined ? { fechaReparto: opts.fechaReparto } : {}),
      },
      select: { id: true },
    });
    return o.id;
  }

  async function sembrarGestion(
    tx: Tx,
    marca: string,
    mensajeroId: string,
    opts: { cierreId?: string | null; anulada?: boolean; cuando?: Date } = {},
  ): Promise<string> {
    const g = await tx.gestionOrden.create({
      data: {
        ordenId: await sembrarOrden(tx, `g-${marca}`),
        mensajeroId,
        resultado: "entregada",
        cierreId: opts.cierreId ?? null,
        ...(opts.anulada ? { anuladaAt: new Date("2026-08-21T23:59:00.000Z") } : {}),
        ...(opts.cuando ? { createdAt: opts.cuando } : {}),
      },
      select: { id: true },
    });
    return g.id;
  }

  async function sembrarCierre(
    tx: Tx,
    mensajeroId: string,
    estado: "solicitado" | "vencido" | "rechazado" | "aprobado",
    createdAt?: Date,
  ): Promise<string> {
    const c = await tx.cierreDia.create({
      data: {
        mensajeroId,
        estado,
        destinoTipo: "bodega_central",
        destinoZonaId: zonaCentralId,
        ...(createdAt ? { createdAt } : {}),
      },
      select: { id: true },
    });
    return c.id;
  }

  /**
   * CUARENTENA — la base de desarrollo es **COMPARTIDA** y el corte barre **toda** la base.
   *
   * Sin esto, «el corte evaluo a N mensajeros» dependeria de lo que otro dejara sembrado, y una
   * corrida podria reventar dentro de `crearCierre` de un mensajero ajeno por datos que este test
   * no controla. Se apartan **dentro de la misma transaccion revertida** las dos fuentes que el
   * corte lee: las gestiones sueltas previas (se les pone el cierre de cuarentena) y las ordenes
   * previas en `en_reparto`/`ayuda_tienda` (se les quita el mensajero asignado).
   *
   * NO toca ni una fila sembrada por este test: se ejecuta ANTES de sembrar.
   */
  async function ponerLaBaseEnCero(tx: Tx, cierreCuarentena: string): Promise<void> {
    await tx.gestionOrden.updateMany({
      where: { cierreId: null, anuladaAt: null },
      data: { cierreId: cierreCuarentena },
    });
    await tx.orden.updateMany({
      where: {
        deletedAt: null,
        estatusId: { in: [catalogo.enReparto, catalogo.ayuda] },
        mensajeroAsignadoId: { not: null },
      },
      data: { mensajeroAsignadoId: null },
    });
  }

  /** El corte REAL sobre la transaccion, con un notificador ESPIA (nunca el real: escribe fuera). */
  function corteSobre(tx: Tx): {
    ejecutar: (now: Date) => ReturnType<CorteDiarioService["ejecutarCorte"]>;
    avisos: CierreVencidoContexto[];
    listaEvaluada: (now: Date) => Promise<string[]>;
  } {
    const cliente = tx as unknown as PrismaClient;
    const corteRepo = new CorteDiarioRepository(cliente);
    const avisos: CierreVencidoContexto[] = [];
    const servicio = new CorteDiarioService(
      corteRepo,
      new CierreDiaRepository(cliente, new TarifaVigentePorTiendaRepository(cliente)),
      new ZonaRepository(cliente),
      new OrdenRepository(cliente),
      new TarifaZonaMensajeroRepository(cliente),
      { warn: () => {} },
      async (ctx) => {
        avisos.push(ctx);
      },
    );
    return {
      ejecutar: (now) => servicio.ejecutarCorte(now),
      avisos,
      // La lista de SELECCION, leida del repositorio REAL con el MISMO ancla que usa la corrida.
      // Es el `WHERE` que esta ficha cambio, visto directamente.
      listaEvaluada: async (now) =>
        (await corteRepo.findMensajerosConActividadSinCierre(diaQueElCorteCierra(now))).map(
          (r) => r.mensajeroId,
        ),
    };
  }

  /**
   * ANTI-VACUIDAD. Cuenta el corpus **en la base** antes de medir nada y revienta si no esta.
   *
   * Este repo ya tuvo un test de integracion que reportaba `passed` sin ejecutar una sola asercion
   * porque empezaba con un `return` temprano por falta de datos. Aqui no hay `return`: si el corpus
   * no se sembro, el caso MUERE aqui, con el numero que encontro.
   */
  async function afirmarCorpusSembrado(
    tx: Tx,
    esperado: { gestionesSueltas: number; ordenesABarrer: number; cierresPrevios: number },
    mensajeros: string[],
  ): Promise<void> {
    const sueltas = await tx.gestionOrden.count({
      where: { mensajeroId: { in: mensajeros }, cierreId: null, anuladaAt: null },
    });
    const aBarrer = await tx.orden.count({
      where: {
        mensajeroAsignadoId: { in: mensajeros },
        deletedAt: null,
        estatusId: { in: [catalogo.enReparto, catalogo.ayuda] },
      },
    });
    const cierres = await tx.cierreDia.count({ where: { mensajeroId: { in: mensajeros } } });
    if (
      sueltas !== esperado.gestionesSueltas ||
      aBarrer !== esperado.ordenesABarrer ||
      cierres !== esperado.cierresPrevios
    ) {
      throw new Error(
        "el corpus NO quedo sembrado como dice el caso, asi que lo que se mida despues no vale. " +
          `Esperado ${JSON.stringify(esperado)}; encontrado ` +
          JSON.stringify({
            gestionesSueltas: sueltas,
            ordenesABarrer: aBarrer,
            cierresPrevios: cierres,
          }),
      );
    }
  }

  // ===============================================================================================
  // CASO 1 — EL CASO QUE ORIGINO LA FICHA: el cierre `79cb2c0f`.
  // ===============================================================================================

  it("R21/R23 · el caso `79cb2c0f`: con un `solicitado` de ayer, el corte SI le crea el segundo cierre", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const m = await sembrarMensajero(tx, "c1");
      const cuarentena = await sembrarCierre(tx, m, "aprobado");
      await ponerLaBaseEnCero(tx, cuarentena);

      // AYER: el mensajero cerro su dia y la administracion todavia no lo ha resuelto. Sus dos
      // gestiones del 20 ya viajan en ese cierre. **Es el estado que antes lo sacaba del corte.**
      const solicitado = await sembrarCierre(tx, m, "solicitado");
      const ayerUno = await sembrarGestion(tx, "ayer1", m, {
        cierreId: solicitado,
        cuando: CR_20_1400,
      });
      const ayerDos = await sembrarGestion(tx, "ayer2", m, {
        cierreId: solicitado,
        cuando: CR_20_1400,
      });

      // HOY (jornada del 21): trabajo dos guias y NO cerro. Dinero cobrado sin cierre al que ir.
      const hoyUno = await sembrarGestion(tx, "hoy1", m, { cuando: CR_21_1656 });
      const hoyDos = await sembrarGestion(tx, "hoy2", m, { cuando: CR_21_1710 });
      // Y se quedo una guia en la mano: el corte tiene que barrerla a `sin_gestionar`.
      const enLaMano = await sembrarOrden(tx, "mano", {
        estatusId: catalogo.enReparto,
        mensajeroAsignadoId: m,
        fechaReparto: null,
      });

      await afirmarCorpusSembrado(
        tx,
        { gestionesSueltas: 2, ordenesABarrer: 1, cierresPrevios: 2 },
        [m],
      );

      const corte = corteSobre(tx);
      const evaluados = await corte.listaEvaluada(CRON_22_0003);
      const resultado = await corte.ejecutar(CRON_22_0003);

      const cierres = await tx.cierreDia.findMany({
        where: { mensajeroId: m },
        select: { id: true, estado: true, destinoTipo: true },
        orderBy: { createdAt: "asc" },
      });
      const nuevo = cierres.find((c) => c.id !== solicitado && c.id !== cuarentena) ?? null;
      const gestiones = await tx.gestionOrden.findMany({
        where: { id: { in: [ayerUno, ayerDos, hoyUno, hoyDos] } },
        select: { id: true, cierreId: true },
      });
      const orden = await tx.orden.findUnique({
        where: { id: enLaMano },
        select: { estatusId: true, mensajeroAsignadoId: true },
      });
      const barridas = await tx.cierreSinGestion.findMany({
        where: { cierreId: nuevo?.id ?? "sin-cierre" },
        select: { ordenId: true, estatusOrigenId: true },
      });
      const solicitadoAhora = await tx.cierreDia.findUnique({
        where: { id: solicitado },
        select: { estado: true },
      });

      return {
        m,
        evaluados,
        resultado,
        cuarentena,
        solicitado,
        solicitadoAhora,
        nuevo,
        totalCierres: cierres.length,
        estados: cierres.map((c) => c.estado).sort(),
        porGestion: Object.fromEntries(gestiones.map((g) => [g.id, g.cierreId])),
        ids: { ayerUno, ayerDos, hoyUno, hoyDos, enLaMano },
        orden,
        barridas,
        avisos: corte.avisos.map((a) => ({ cierreId: a.cierreId, jornadaCR: a.jornadaCR })),
      };
    });

    // ⭑ EL `WHERE` QUE ESTA FICHA CAMBIO, VISTO EN LA LISTA REAL. Antes de la 271 el mensajero con
    // un cierre ABIERTO se restaba aqui y no llegaba nunca al bucle.
    expect(medido.evaluados).toContain(medido.m);
    // Anti-vacuidad de la corrida: si el corte no evaluo a nadie, lo de abajo no significa nada.
    expect(medido.resultado.mensajerosEvaluados).toBeGreaterThanOrEqual(1);

    // ⭑ EL DESENLACE: existe un SEGUNDO cierre, y es `vencido`.
    expect(medido.nuevo).not.toBeNull();
    expect(medido.nuevo?.estado).toBe("vencido");
    expect(medido.nuevo?.destinoTipo).toBe("bodega_central");
    expect(medido.resultado.vencidosCreados).toBe(1);
    // Tres cierres: el de cuarentena (aprobado), el `solicitado` de ayer y el `vencido` de hoy.
    expect(medido.totalCierres).toBe(3);
    expect(medido.estados).toEqual(["aprobado", "solicitado", "vencido"]);

    // ⭑ SE LLEVA EXACTAMENTE LAS DOS DE HOY, y ni una de las de ayer (R14: el reparto es por
    // AUSENCIA de vinculo, no por fecha).
    expect(medido.porGestion[medido.ids.hoyUno]).toBe(medido.nuevo?.id);
    expect(medido.porGestion[medido.ids.hoyDos]).toBe(medido.nuevo?.id);
    expect(medido.porGestion[medido.ids.ayerUno]).toBe(medido.solicitado);
    expect(medido.porGestion[medido.ids.ayerDos]).toBe(medido.solicitado);

    // ⭑ EL CIERRE DE AYER NO SE TOCA: sigue esperando a la administracion.
    expect(medido.solicitadoAhora?.estado).toBe("solicitado");

    // ⭑ EL BARRIDO SIGUE SIENDO EL DE SIEMPRE: la guia en la mano pasa a `sin_gestionar`,
    // conservando el mensajero asignado, y queda REGISTRADA en el cierre nuevo con su origen real.
    expect(medido.orden?.estatusId).toBe(catalogo.sinGestionar);
    expect(medido.orden?.mensajeroAsignadoId).toBe(medido.m);
    expect(medido.barridas.map((b) => b.ordenId)).toEqual([medido.ids.enLaMano]);
    expect(medido.barridas[0].estatusOrigenId).toBe(catalogo.enReparto);

    // El aviso sale UNA vez, por el cierre creado, y con la jornada del 21 — no la del 22, que es
    // cuando el cron corre (R38/R57).
    expect(medido.avisos).toEqual([{ cierreId: medido.nuevo?.id, jornadaCR: "2026-08-21" }]);
  });

  // ===============================================================================================
  // CASO 2 — EL INVARIANTE R17: un mensajero YA bloqueado no acumula un segundo `vencido`.
  // ===============================================================================================

  it("R22/R17 · el mensajero YA bloqueado con un `vencido` y nada que cerrar NO recibe un segundo", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const bloqueado = await sembrarMensajero(tx, "c2");
      const testigo = await sembrarMensajero(tx, "c2t");
      const cuarentena = await sembrarCierre(tx, bloqueado, "aprobado");
      await ponerLaBaseEnCero(tx, cuarentena);

      // EL ESTADO EN QUE LO DEJO EL CORTE DE ANOCHE, tal cual: su `vencido`, sus gestiones YA
      // vinculadas a el y su guia YA barrida a `sin_gestionar` conservando el mensajero asignado
      // (esa es la asociacion orden<->cierre por mensajero de la 109). No le queda NADA suelto.
      const vencido = await sembrarCierre(tx, bloqueado, "vencido");
      await sembrarGestion(tx, "bl1", bloqueado, { cierreId: vencido, cuando: CR_20_1400 });
      const yaBarrida = await sembrarOrden(tx, "bl-barrida", {
        estatusId: catalogo.sinGestionar,
        mensajeroAsignadoId: bloqueado,
      });
      await tx.cierreSinGestion.create({
        data: {
          cierreId: vencido,
          ordenId: yaBarrida,
          numRemision: `R-${SUFIJO}-g-bl-barrida-registro`,
          destinatario: "Dest",
          producto: "Prod",
          tiendaNombre: "T",
          zonaNombre: "Z",
          estatusOrigenId: catalogo.enReparto,
        },
      });

      // EL TESTIGO. Sin el, «no se creo ningun cierre» tambien seria cierto si la corrida no
      // hubiera hecho nada en absoluto (por ejemplo si el ancla o el catalogo estuvieran rotos).
      // Este mensajero SI tiene una gestion suelta: la corrida tiene que crearle SU cierre.
      const gestionTestigo = await sembrarGestion(tx, "c2t1", testigo, { cuando: CR_21_1656 });

      await afirmarCorpusSembrado(
        tx,
        { gestionesSueltas: 1, ordenesABarrer: 0, cierresPrevios: 2 },
        [bloqueado, testigo],
      );

      const corte = corteSobre(tx);
      const evaluados = await corte.listaEvaluada(CRON_22_0003);
      const resultado = await corte.ejecutar(CRON_22_0003);

      const cierresBloqueado = await tx.cierreDia.findMany({
        where: { mensajeroId: bloqueado },
        select: { id: true, estado: true },
      });
      const cierresTestigo = await tx.cierreDia.findMany({
        where: { mensajeroId: testigo },
        select: { id: true, estado: true },
      });
      const registros = await tx.cierreSinGestion.count({ where: { cierreId: vencido } });
      const gestionTestigoAhora = await tx.gestionOrden.findUnique({
        where: { id: gestionTestigo },
        select: { cierreId: true },
      });

      return {
        bloqueado,
        testigo,
        evaluados,
        resultado,
        cuarentena,
        vencido,
        cierresBloqueado,
        cierresTestigo,
        registros,
        gestionTestigoAhora,
        avisos: corte.avisos.map((a) => a.cierreId),
      };
    });

    // ⭑ EL TESTIGO PRIMERO: la corrida hizo su trabajo. Sin esto, lo de abajo seria vacio.
    expect(medido.cierresTestigo).toHaveLength(1);
    expect(medido.cierresTestigo[0].estado).toBe("vencido");
    expect(medido.gestionTestigoAhora?.cierreId).toBe(medido.cierresTestigo[0].id);
    expect(medido.evaluados).toContain(medido.testigo);

    // ⭑ EL INVARIANTE R17, MEDIDO: el bloqueado sigue con sus DOS cierres de partida —el de
    // cuarentena y su `vencido`— y ni uno mas. **DOS `vencido` a la vez no ocurre.**
    expect(medido.cierresBloqueado.map((c) => c.id).sort()).toEqual(
      [medido.cuarentena, medido.vencido].sort(),
    );
    expect(medido.cierresBloqueado.filter((c) => c.estado === "vencido")).toHaveLength(1);
    expect(medido.resultado.vencidosCreados).toBe(1); // solo el del testigo
    expect(medido.avisos).toEqual([medido.cierresTestigo[0].id]);

    // Y no se le vuelve a registrar la orden que su cierre ya barrio (R24).
    expect(medido.registros).toBe(1);

    // ⚠️⚠️ **MECANISMO MEDIDO.** Hasta el 2026-08-23, `design.md`, `tasks.md` (T3.3) y el comentario
    // de cabecera de `CorteDiarioRepository` decian que el bloqueado «entra en el bucle pero NO
    // TIENE NADA QUE CERRAR», y que quien lo descarta es la guarda «algo paso» de `crearCierre`.
    // **Postgres dice otra cosa:** no llega a entrar en el bucle, porque las DOS ramas de la
    // seleccion (gestiones con `cierre_id IS NULL` y ordenes en `en_reparto`/`ayuda_tienda`) ya
    // vienen vacias para el. La garantia es la misma y es MAS fuerte. **Los tres sitios se
    // corrigieron ese dia**; esta linea es la que lo afirma, y por eso la mutacion «romper la guarda
    // algo paso» NO mata este caso — la guarda es la SEGUNDA red, y su prueba esta en
    // `tests/unit/repositories/cierre-dia-repository.test.ts` (4 casos).
    expect(medido.evaluados).not.toContain(medido.bloqueado);
  });

  // ===============================================================================================
  // CASO 3 — EL BARRIDO Y LA VINCULACION SIGUEN SIENDO LOS DE SIEMPRE (R23, R24).
  // ===============================================================================================

  it("R23/R24 · el barrido a `sin_gestionar`, la vinculacion y la idempotencia de la 2.ª corrida", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const uno = await sembrarMensajero(tx, "c3a");
      const dos = await sembrarMensajero(tx, "c3b");
      const cuarentena = await sembrarCierre(tx, uno, "aprobado");
      await ponerLaBaseEnCero(tx, cuarentena);

      // MENSAJERO UNO: una guia en reparto, otra en ayuda_tienda, una gestion suelta, una gestion
      // ANULADA (no es trabajo que cobrar) y una orden RESERVADA para mañana (246: protegida).
      const enReparto = await sembrarOrden(tx, "c3a-rep", {
        estatusId: catalogo.enReparto,
        mensajeroAsignadoId: uno,
        fechaReparto: null,
      });
      const enAyuda = await sembrarOrden(tx, "c3a-ayu", {
        estatusId: catalogo.ayuda,
        mensajeroAsignadoId: uno,
        fechaReparto: null,
      });
      const reservada = await sembrarOrden(tx, "c3a-res", {
        estatusId: catalogo.enReparto,
        mensajeroAsignadoId: uno,
        fechaReparto: new Date("2026-08-22T00:00:00.000Z"), // el dia SIGUIENTE al que se cierra
      });
      const suelta = await sembrarGestion(tx, "c3a-s", uno, { cuando: CR_21_1656 });
      const anulada = await sembrarGestion(tx, "c3a-anul", uno, {
        anulada: true,
        cuando: CR_21_1656,
      });

      // MENSAJERO DOS: solo una gestion suelta. Sirve para R23 —un cierre por mensajero y corrida—
      // y para que «se creo un cierre» no pueda confundirse con «se creo uno para todos».
      const sueltaDos = await sembrarGestion(tx, "c3b-s", dos, { cuando: CR_21_1710 });

      await afirmarCorpusSembrado(
        tx,
        { gestionesSueltas: 2, ordenesABarrer: 3, cierresPrevios: 1 },
        [uno, dos],
      );

      const corte = corteSobre(tx);
      const primera = await corte.ejecutar(CRON_22_0003);

      const cierreUno =
        (
          await tx.cierreDia.findFirst({
            where: { mensajeroId: uno, estado: "vencido" },
            select: { id: true },
          })
        )?.id ?? null;
      const cierreDos =
        (
          await tx.cierreDia.findFirst({
            where: { mensajeroId: dos, estado: "vencido" },
            select: { id: true },
          })
        )?.id ?? null;

      const traerOrdenes = async () =>
        Object.fromEntries(
          (
            await tx.orden.findMany({
              where: { id: { in: [enReparto, enAyuda, reservada] } },
              select: { id: true, estatusId: true },
            })
          ).map((o) => [o.id, o.estatusId]),
        );
      const traerRegistros = async () =>
        (
          await tx.cierreSinGestion.findMany({
            where: { cierreId: cierreUno ?? "sin-cierre" },
            select: { ordenId: true, estatusOrigenId: true },
          })
        )
          .map((r) => `${r.ordenId}|${r.estatusOrigenId}`)
          .sort();
      const traerVinculos = async () =>
        Object.fromEntries(
          (
            await tx.gestionOrden.findMany({
              where: { id: { in: [suelta, anulada, sueltaDos] } },
              select: { id: true, cierreId: true },
            })
          ).map((g) => [g.id, g.cierreId]),
        );

      const ordenesTras1 = await traerOrdenes();
      const registrosTras1 = await traerRegistros();
      const vinculosTras1 = await traerVinculos();

      // LA SEGUNDA CORRIDA **DE LA MISMA NOCHE** — el reintento del cron, que es real: Vercel
      // reintenta. Mismo ancla, mismos datos ya cerrados. Es donde se ve la idempotencia (R24) sin
      // mezclarla con el paso del dia.
      const segunda = await corte.ejecutar(CRON_22_0003);

      const cierresUnoTras2 = await tx.cierreDia.findMany({
        where: { mensajeroId: uno },
        select: { id: true, estado: true },
      });

      return {
        uno,
        dos,
        cuarentena,
        cierreUno,
        cierreDos,
        primera,
        segunda,
        ids: { enReparto, enAyuda, reservada, suelta, anulada, sueltaDos },
        ordenesTras1,
        registrosTras1,
        vinculosTras1,
        ordenesTras2: await traerOrdenes(),
        registrosTras2: await traerRegistros(),
        vinculosTras2: await traerVinculos(),
        cierresUnoTras2,
        avisos: corte.avisos.map((a) => a.cierreId),
      };
    });

    // Anti-vacuidad: la primera corrida evaluo a los dos y les creo un cierre a cada uno (R23).
    expect(medido.primera.mensajerosEvaluados).toBe(2);
    expect(medido.primera.vencidosCreados).toBe(2);
    expect(medido.cierreUno).not.toBeNull();
    expect(medido.cierreDos).not.toBeNull();
    expect(medido.cierreUno).not.toBe(medido.cierreDos);

    // ⭑ EL BARRIDO: `en_reparto` y `ayuda_tienda` van a `sin_gestionar`; la RESERVADA para mañana
    // se queda donde esta (246/R11, y sigue vigente tras la 271).
    expect(medido.ordenesTras1[medido.ids.enReparto]).toBe(catalogo.sinGestionar);
    expect(medido.ordenesTras1[medido.ids.enAyuda]).toBe(catalogo.sinGestionar);
    expect(medido.ordenesTras1[medido.ids.reservada]).toBe(catalogo.enReparto);

    // ⭑ EL REGISTRO en `cierre_sin_gestion` lleva el origen REAL de cada una, no uno supuesto.
    expect(medido.registrosTras1).toEqual(
      [
        `${medido.ids.enReparto}|${catalogo.enReparto}`,
        `${medido.ids.enAyuda}|${catalogo.ayuda}`,
      ].sort(),
    );

    // ⭑ LA VINCULACION: la suelta entra, la ANULADA no (67/R16: vincularla la cobraria al aprobar),
    // y la del otro mensajero va a SU cierre.
    expect(medido.vinculosTras1[medido.ids.suelta]).toBe(medido.cierreUno);
    expect(medido.vinculosTras1[medido.ids.anulada]).toBeNull();
    expect(medido.vinculosTras1[medido.ids.sueltaDos]).toBe(medido.cierreDos);

    // ⭑ LA SEGUNDA CORRIDA NO RE-VINCULA NI RE-REGISTRA (R24): lo ya cerrado se queda como estaba,
    // y NO se crea ningun cierre nuevo — ni uno vacio. Ya no queda nada suelto que la arrastre.
    expect(medido.segunda.mensajerosEvaluados).toBe(0);
    expect(medido.segunda.vencidosCreados).toBe(0);
    expect(medido.vinculosTras2).toEqual(medido.vinculosTras1);
    expect(medido.registrosTras2).toEqual(medido.registrosTras1);
    expect(medido.ordenesTras2[medido.ids.enReparto]).toBe(catalogo.sinGestionar);
    expect(medido.ordenesTras2[medido.ids.enAyuda]).toBe(catalogo.sinGestionar);
    expect(medido.cierresUnoTras2).toHaveLength(2); // el de cuarentena + su unico `vencido`

    // Un aviso por cierre CREADO, nunca por un `null`.
    expect(medido.avisos.slice(0, 2).sort()).toEqual(
      [medido.cierreUno, medido.cierreDos].sort() as string[],
    );
  });

  // ===============================================================================================
  // CASO 4 — R17: **DOS `vencido` A LA VEZ ES UN ESTADO ALCANZABLE**, y este caso es su unica prueba.
  // ===============================================================================================

  /**
   * ⚠️⚠️ **ESTE CASO DOCUMENTA UN ESTADO ALCANZABLE, NO UN CONTRAEJEMPLO TEORICO. NO SE BORRA.**
   *
   * Hasta el 2026-08-23 el spec de la 271 afirmaba en mayusculas que **dos `vencido` a la vez es
   * IMPOSIBLE** (**R17**), y de esa frase colgaban tres decisiones: quitar la exclusion del corte
   * «sin ninguna condicion nueva» (S3), no escribir codigo defensivo (T2.5) y no escribir test del
   * caso (T2.4). Estaba razonado en tres pasos, «verificado contra el codigo», copiado a cinco
   * sitios y aceptado por una revision. **Lo unico que faltaba era ejecutarlo.** Este caso lo
   * ejecuto, y el spec se corrigio el mismo dia (`requirements.md` -> R17; `design.md` §5 y §6;
   * `progress/impl_271.md`). **El comportamiento NO se toco: es el correcto.**
   *
   * **DONDE SE ROMPIA EL ARGUMENTO: LA FEATURE 246.** El paso 2 decia «el corte que creo el
   * `vencido` ya barrio sus ordenes en la MISMA transaccion». Eso tiene una **excepcion** desde la
   * 246: una orden reservada para un dia posterior **NO se barre** (246/R11), se queda en
   * `en_reparto` en la mano de un mensajero que acaba de quedar bloqueado, y **su proteccion caduca
   * sola** (246/R13). La noche siguiente vence, el mensajero vuelve a entrar por la rama (b) de la
   * seleccion, `crearCierre` la barre —`sinGestionarTransicionadas` vale 1—, la guarda «algo paso»
   * **pasa**, y nace el **segundo `vencido`**.
   *
   * **Y ES ALCANZABLE EN PRODUCCION**, no un estado fabricado: `CorreccionDiaRepartoService`
   * (feature 262) permite cambiar el dia de reparto de una orden que YA esta en `en_reparto` o
   * `ayuda_tienda` —su constante `ESTADOS_CON_DIA_DE_REPARTO_VIVO` lo dice, y su comentario llama a
   * esa poblacion «la que la 261 dejo atrapada: el paquete ya esta en la mano del mensajero»—. Es
   * decir: bodega pasa a mañana una guia que el mensajero ya lleva encima, y esa guia atraviesa el
   * corte que lo bloquea.
   *
   * **ANTES DE LA 271 ESTO NO PODIA PASAR**, y por eso lo introduce esta ficha: la exclusion por
   * cierre abierto sacaba al mensajero de la corrida siguiente.
   *
   * **POR QUE NO SE PROGRAMO NADA, decidido por el humano el 2026-08-23:** porque el estado **ya
   * esta cubierto**, que es una razon distinta de «no existe». Es la **fila 7** de la tabla de
   * verdad (`N=2, V=2`) con dos `vencido` en vez de dos `rechazado`; la regla general cuenta N y V
   * sin mirar el estado; el `id` en el `WHERE` de `transicionarASolicitado` —el arreglo de M2,
   * puesto «por si acaso» para el gemelo del `vencido`— mueve UNO, el mas viejo (R18), sin
   * escribir-y-reportar-fallo; y la rama `v === n` del aviso ya dice lo correcto para los dos. El
   * desenlace medido es ademas el razonable: la orden necesitaba barrido y un cierre al que ir.
   *
   * **SI ALGUIEN CAMBIA EL COMPORTAMIENTO, ESTE CASO SE PONDRA ROJO Y LEERA ESTO.** Es su unica
   * razon de ser, y es suficiente.
   */
  it("R17 · dos `vencido` a la vez es ALCANZABLE: la orden reservada (246) sobrevive al corte que bloquea y la noche siguiente trae el SEGUNDO", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const m = await sembrarMensajero(tx, "c4");
      const cuarentena = await sembrarCierre(tx, m, "aprobado");
      await ponerLaBaseEnCero(tx, cuarentena);

      // Trabajo el 21 y no cerro -> el corte del 22 le va a crear su `vencido`.
      await sembrarGestion(tx, "c4-s", m, { cuando: CR_21_1656 });
      // Y lleva encima una guia que bodega paso al 22 (262: se puede corregir el dia de una orden
      // que YA esta `en_reparto`). El corte del 22 NO la barre: esta reservada para el 22.
      const reservada = await sembrarOrden(tx, "c4-res", {
        estatusId: catalogo.enReparto,
        mensajeroAsignadoId: m,
        fechaReparto: new Date("2026-08-22T00:00:00.000Z"),
      });

      await afirmarCorpusSembrado(
        tx,
        { gestionesSueltas: 1, ordenesABarrer: 1, cierresPrevios: 1 },
        [m],
      );

      const corte = corteSobre(tx);
      const noche22 = await corte.ejecutar(CRON_22_0003); // cierra el 21
      const trasLa22 = await tx.cierreDia.findMany({
        where: { mensajeroId: m, estado: "vencido" },
        select: { id: true },
      });
      const reservadaTrasLa22 = await tx.orden.findUnique({
        where: { id: reservada },
        select: { estatusId: true },
      });

      const evaluadosLa23 = await corte.listaEvaluada(CRON_23_0003);
      const noche23 = await corte.ejecutar(CRON_23_0003); // cierra el 22
      const trasLa23 = await tx.cierreDia.findMany({
        where: { mensajeroId: m, estado: "vencido" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });

      return {
        m,
        reservada,
        noche22,
        noche23,
        trasLa22,
        trasLa23,
        reservadaTrasLa22,
        evaluadosLa23,
        reservadaTrasLa23: await tx.orden.findUnique({
          where: { id: reservada },
          select: { estatusId: true },
        }),
      };
    });

    // La noche del 22: un `vencido`, y la guia reservada SIGUE en la mano (246/R11 vigente).
    expect(medido.noche22.vencidosCreados).toBe(1);
    expect(medido.trasLa22).toHaveLength(1);
    expect(medido.reservadaTrasLa22?.estatusId).toBe(catalogo.enReparto);

    // ⭑ LA NOCHE DEL 23: el mensajero, YA BLOQUEADO con su `vencido`, vuelve a entrar en la
    // seleccion —por la orden cuya reserva acaba de caducar— y recibe un SEGUNDO `vencido`.
    expect(medido.evaluadosLa23).toContain(medido.m);
    expect(medido.noche23.vencidosCreados).toBe(1);
    // ⚠️ DOS `vencido` VIVOS A LA VEZ. Esta linea es la que desmintio la version original de R17.
    expect(medido.trasLa23).toHaveLength(2);
    expect(medido.trasLa23[0].id).toBe(medido.trasLa22[0].id); // el primero sigue ahi, intacto
    expect(medido.trasLa23[1].id).not.toBe(medido.trasLa22[0].id);

    // Y la guia si acaba barrida: el desenlace de la orden es el correcto. Lo que falla es la
    // afirmacion de que este estado no puede existir, no el trato que se le da.
    expect(medido.reservadaTrasLa23?.estatusId).toBe(catalogo.sinGestionar);
  });
});
