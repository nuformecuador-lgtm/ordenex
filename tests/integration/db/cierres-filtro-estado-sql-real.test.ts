import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreEstado } from "@/lib/types/cierre";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
} from "./_postgres-real";

/**
 * FICHA 386 (pedido humano del 2026-09-07) — EL FILTRO POR ESTADO DE LOS DOS LISTADOS DE CIERRES
 * DEL DIA, EJECUTADO CONTRA POSTGRES.
 *
 * QUE SE MIDE, en una frase: QUE FILAS devuelve cada lista con el filtro puesto. No la forma del
 * objeto `where` —eso es `tests/unit/repositories/cierres-filtros-where.test.ts`—, sino el
 * conjunto que Postgres realmente contesta.
 *
 * POR QUE CONTRA POSTGRES Y NO CON DOBLES, que es la pregunta que decide si este archivo vale
 * algo. La propiedad que sostiene la ficha es una CONJUNCION en el `WHERE`: el estado de la LISTA
 * (`estado IN (solicitado,vencido)` en pendientes, `NOT IN` en el historico) y el estado del
 * FILTRO tienen que exigirse A LA VEZ. Un doble no evalua SQL: devuelve lo que el propio test le
 * programe, asi que confirmaria la conjuncion que el test escribio. Y esta medido cuatro veces en
 * este repo que una mutacion del `WHERE` deja los tests de servicio en verde. Aqui la conjuncion
 * la resuelve el motor.
 *
 * EL CASO QUE DA NOMBRE A TODO ESTO es el (4): pedir `aprobado` DENTRO de pendientes. Escrito
 * mal —el recorte como clave hermana en vez de dentro del `AND`— la ultima clave `estado` del
 * objeto gana, el corte cola/historico desaparece y esa llamada devuelve LOS APROBADOS. Con
 * dobles, indistinguible; aqui son dos filas que aparecen donde no deben.
 *
 * LOS CUATRO CIERRES QUE SE SIEMBRAN, uno por estado, todos del MISMO mensajero recien creado:
 * es lo que permite afirmar conjuntos EXACTOS con `toEqual`. La base de desarrollo arrastra
 * cierres de otras corridas, asi que cada llamada lleva ademas `mensajeroIds: [el nuestro]`; ese
 * recorte no debilita nada —la propiedad medida es la del estado— y sin el, el conjunto esperado
 * dependeria de lo que otro agente dejo en la base.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde: un `if (!filas) return` dentro
 * del caso se leeria como `passed` sin haber comprobado nada, y este repo ya se comio ese verde.
 * CON base pero SIN catalogo, falla RUIDOSAMENTE en el `beforeAll`.
 *
 * CONTROL POSITIVO en todos los casos que esperan vacio: el mismo escenario se interroga antes
 * SIN filtro de estado y tiene que traer filas. Sin eso, un `WHERE` roto que no case nada dejaria
 * los `toHaveLength(0)` en verde y el archivo entero no diria nada.
 *
 * Todo se siembra dentro de una transaccion que SIEMPRE se revierte: no queda ni una fila.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Sufijo unico por corrida: `num_remision`, `email` y `cedula` son UNIQUE. */
const SUFIJO = `est${Date.now().toString(36)}`;

/** Alcance del maestro sobre la bodega central, que es donde se siembran los cierres. */
const ALCANCE: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/** Pagina generosa: los conjuntos de este archivo son de cuatro filas como mucho. */
const RANGO: RangoPagina = { skip: 0, take: 50 };

/** Los dos estados de la COLA de pendientes y los dos del HISTORICO (feature 38/R4 + 41/R20). */
const EN_PENDIENTES: CierreEstado[] = ["solicitado", "vencido"];
const EN_HISTORICO: CierreEstado[] = ["aprobado", "rechazado"];

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

describeSiHayBase("FICHA 386 — filtrar por estado DENTRO de cada lista de cierres (SQL real)", () => {
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
        nombre: `Mensajero estados ${clave}`,
        email: `mest-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa-en-este-test",
        cedula: `est${clave}`,
        tipoIdentificacionId: fksUsuario.tipoIdentificacionId,
        rolId: fksUsuario.rolId,
      },
      select: { id: true },
    });
    return u.id;
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
   * Siembra UN cierre por estado para un mensajero nuevo y ejecuta `interrogar` con el
   * repositorio ya atado a la transaccion. Los cuatro llevan fechas de solicitud distintas para
   * que el orden (`solicitadoAt desc`) sea determinista y el `toEqual` de conjuntos no dependa
   * de un empate.
   */
  async function conLosCuatroEstados<T>(
    interrogar: (
      repo: ReturnType<typeof repoDe>,
      mensajeroId: string,
      idPorEstado: Record<CierreEstado, string>,
    ) => Promise<T>,
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const mensajeroId = await crearMensajero(tx);

      const idPorEstado = {} as Record<CierreEstado, string>;
      const estados: CierreEstado[] = [...EN_PENDIENTES, ...EN_HISTORICO];
      for (const [i, estado] of estados.entries()) {
        const cierre = await tx.cierreDia.create({
          data: {
            mensajeroId,
            estado,
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
            solicitadoAt: new Date(`2026-03-0${i + 1}T15:00:00.000Z`),
            // `motivo_rechazo` es obligatorio SOLO al rechazar (feature 38/R11): se estampa para
            // que la fila sembrada sea la que produce el flujo real, no una a medias.
            motivoRechazo: estado === "rechazado" ? "rechazo sembrado por el test" : null,
          },
          select: { id: true },
        });
        idPorEstado[estado] = cierre.id;
      }

      return interrogar(repoDe(tx), mensajeroId, idPorEstado);
    });
  }

  /** Los estados de un conjunto de filas, ordenados: con lo que se compara todo aqui. */
  function estadosDe(filas: ReadonlyArray<{ estado: CierreEstado }>): CierreEstado[] {
    return filas.map((f) => f.estado).sort();
  }

  it("(1) sin filtro de estado, las dos listas siguen partiendo el conjunto EN GRUESO", async () => {
    // La linea base de la ficha y el control positivo de todo lo demas: los cuatro cierres
    // existen, dos caen en pendientes y dos en el historico. Si esto fallara, los `toHaveLength(0)`
    // de mas abajo serian verdes por vacio.
    const { cola, historico, totalCola, totalHistorico } = await conLosCuatroEstados(
      async (repo, mensajeroId) => {
        const c = await repo.findColaPaginada(ALCANCE, RANGO, { mensajeroIds: [mensajeroId] });
        const h = await repo.findHistoricoPaginado(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
        });
        return {
          cola: c.items,
          historico: h.items,
          totalCola: c.total,
          totalHistorico: h.total,
        };
      },
    );

    expect(estadosDe(cola)).toEqual([...EN_PENDIENTES].sort());
    expect(estadosDe(historico)).toEqual([...EN_HISTORICO].sort());
    // El total del CONJUNTO cuenta lo mismo que la pagina muestra.
    expect(totalCola).toBe(2);
    expect(totalHistorico).toBe(2);
  });

  it("(2) PENDIENTES filtrado por `vencido` separa el reenvio de lo que espera aprobacion", async () => {
    // El caso que el humano pidio: `solicitado` espera decision, `vencido` lo creo el corte
    // nocturno y necesita que alguien lo REENVIE. Hasta hoy salian mezclados en la misma cola.
    const { soloVencido, soloSolicitado } = await conLosCuatroEstados(
      async (repo, mensajeroId) => ({
        soloVencido: await repo.findColaPaginada(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["vencido"],
        }),
        soloSolicitado: await repo.findColaPaginada(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["solicitado"],
        }),
      }),
    );

    expect(estadosDe(soloVencido.items)).toEqual(["vencido"]);
    expect(soloVencido.total).toBe(1);
    expect(estadosDe(soloSolicitado.items)).toEqual(["solicitado"]);
    expect(soloSolicitado.total).toBe(1);
  });

  it("(3) HISTORICO filtrado separa `aprobado` de `rechazado`, que son desenlaces opuestos", async () => {
    const { soloAprobado, soloRechazado } = await conLosCuatroEstados(
      async (repo, mensajeroId) => ({
        soloAprobado: await repo.findHistoricoPaginado(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["aprobado"],
        }),
        soloRechazado: await repo.findHistoricoPaginado(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["rechazado"],
        }),
      }),
    );

    expect(estadosDe(soloAprobado.items)).toEqual(["aprobado"]);
    expect(soloAprobado.total).toBe(1);
    expect(estadosDe(soloRechazado.items)).toEqual(["rechazado"]);
    expect(soloRechazado.total).toBe(1);
  });

  it("(4) ⭑ el filtro INTERSECA con la lista: pedir un estado del historico dentro de PENDIENTES da vacio", async () => {
    // LA afirmacion de esta ficha. El filtro va DENTRO de cada lista, no en lugar de ella: si el
    // recorte sustituyera al corte cola/historico, estas dos llamadas devolverian los dos cierres
    // resueltos del mensajero — y la cola de pendientes mostraria cierres ya decididos.
    const { aprobadoEnCola, rechazadoEnCola, losDosEnCola, controlSinEstado } =
      await conLosCuatroEstados(async (repo, mensajeroId) => ({
        aprobadoEnCola: await repo.findColaPaginada(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["aprobado"],
        }),
        rechazadoEnCola: await repo.findColaPaginada(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["rechazado"],
        }),
        losDosEnCola: await repo.findColaPaginada(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: [...EN_HISTORICO],
        }),
        controlSinEstado: await repo.findColaPaginada(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
        }),
      }));

    // CONTROL POSITIVO primero: el escenario existe y la cola de este mensajero NO esta vacia.
    // Sin esta linea, los tres `toHaveLength(0)` de abajo pasarian con un `WHERE` que no casa nada.
    expect(controlSinEstado.items).toHaveLength(2);

    expect(aprobadoEnCola.items, "un cierre APROBADO se coló en la cola de pendientes").toHaveLength(
      0,
    );
    expect(aprobadoEnCola.total).toBe(0);
    expect(rechazadoEnCola.items).toHaveLength(0);
    expect(losDosEnCola.items).toHaveLength(0);
  });

  it("(5) y al reves: pedir un estado de la cola dentro del HISTORICO tampoco lo saca de su lista", async () => {
    const { solicitadoEnHistorico, vencidoEnHistorico, controlSinEstado } =
      await conLosCuatroEstados(async (repo, mensajeroId) => ({
        solicitadoEnHistorico: await repo.findHistoricoPaginado(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["solicitado"],
        }),
        vencidoEnHistorico: await repo.findHistoricoPaginado(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
          estados: ["vencido"],
        }),
        controlSinEstado: await repo.findHistoricoPaginado(ALCANCE, RANGO, {
          mensajeroIds: [mensajeroId],
        }),
      }));

    expect(controlSinEstado.items).toHaveLength(2); // control positivo
    expect(
      vencidoEnHistorico.items,
      "un cierre VENCIDO se coló en el histórico: dejaría de verse en la cola donde se resuelve",
    ).toHaveLength(0);
    expect(solicitadoEnHistorico.items).toHaveLength(0);
  });

  it("(6) los ARCHIVOS de las dos listas filtran EXACTAMENTE igual que sus paginas", async () => {
    // «Descargar» tiene que significar «esto que estoy viendo, entero». Los dos conjuntos salen de
    // `colaWhere`/`historicoWhere`, los mismos criterios que las paginas, y esto lo comprueba con
    // filas en vez de con una lectura del codigo.
    const { colaCompleta, historicoCompleto, aprobadoEnColaCompleta } =
      await conLosCuatroEstados(async (repo, mensajeroId) => ({
        colaCompleta: await repo.findColaCompleta(ALCANCE, {
          mensajeroIds: [mensajeroId],
          estados: ["vencido"],
        }),
        historicoCompleto: await repo.findHistoricoCompleto(ALCANCE, {
          mensajeroIds: [mensajeroId],
          estados: ["rechazado"],
        }),
        aprobadoEnColaCompleta: await repo.findColaCompleta(ALCANCE, {
          mensajeroIds: [mensajeroId],
          estados: ["aprobado"],
        }),
      }));

    expect(estadosDe(colaCompleta)).toEqual(["vencido"]);
    expect(estadosDe(historicoCompleto)).toEqual(["rechazado"]);
    // La misma interseccion del caso (4), por el camino del archivo.
    expect(aprobadoEnColaCompleta).toHaveLength(0);
  });

  it("(7) el estado se compone con los otros recortes, y con el ALCANCE, por CONJUNCION", async () => {
    // Dos hechos en un caso, y los dos son la misma propiedad:
    //  - con `desde` posterior a la fecha del cierre `vencido`, pedir `vencido` da vacio aunque el
    //    cierre exista: el estado no anula la fecha;
    //  - con el alcance de un `adminSatelite` de OTRA zona, pedir `vencido` da vacio: el filtro
    //    no reabre el alcance.
    const { conFechaQueLoDeja, conFechaQueLoQuita, enZonaAjena } = await conLosCuatroEstados(
      async (repo, mensajeroId) => ({
        // El `vencido` se sembro con `solicitadoAt` = 2026-03-02.
        conFechaQueLoDeja: await repo.findColaCompleta(ALCANCE, {
          mensajeroIds: [mensajeroId],
          estados: ["vencido"],
          desde: "2026-03-01",
        }),
        conFechaQueLoQuita: await repo.findColaCompleta(ALCANCE, {
          mensajeroIds: [mensajeroId],
          estados: ["vencido"],
          desde: "2026-03-03",
        }),
        enZonaAjena: await repo.findColaCompleta(
          { destinoTipo: "bodega_satelite", destinoZonaId: fks.zonaId },
          { mensajeroIds: [mensajeroId], estados: ["vencido"] },
        ),
      }),
    );

    expect(estadosDe(conFechaQueLoDeja)).toEqual(["vencido"]); // control positivo
    expect(conFechaQueLoQuita, "el filtro de estado se comió el recorte de fecha").toHaveLength(0);
    // Los cierres se sembraron como `bodega_central`; un alcance de satelite no los alcanza, y
    // pedir su estado no cambia eso.
    expect(enZonaAjena, "el filtro de estado reabrió el alcance").toHaveLength(0);
  });
});
