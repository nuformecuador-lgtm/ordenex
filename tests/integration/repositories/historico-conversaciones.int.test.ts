import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  serializarEscriturasReales,
} from "../db/_postgres-real";
import {
  HistoricoConversacionesRepository,
  construirConsultaListarHilos,
  construirConsultaMensajesDelHilo,
  type HistoricoPrismaClient,
} from "@/lib/repositories/HistoricoConversacionesRepository";
import type {
  FiltroHilosHistorico,
  HiloHistoricoDTO,
} from "@/lib/types/historico-conversaciones";
import type { ChatMensajeVista } from "@/lib/types/chat-whatsapp";
import { MENSAJES_LIMITE_DEFECTO } from "@/lib/types/historico-conversaciones";

// Feature 321 — bloque 3 del repositorio (T3.1 a T3.5) contra Postgres REAL.
//
// POR QUE CONTRA POSTGRES Y NO CON UN DOBLE. Todo lo que este bloque decide vive EN SQL: un
// `GROUP BY (orden_id, mensajero_id)` que fusiona dos filas de telefono, un `LATERAL` que calcula
// la ultima actividad, un cursor de tres componentes en el `HAVING`, un `EXISTS` con las cotas
// del dia calendario de Costa Rica y una comparacion de fila `(ocurrido_at, id) < (...)`. Un
// doble del cliente Prisma no probaria NADA de eso: probaria que un array de mentira tiene la
// forma que el test quiso.
//
// COMO NO ENSUCIA NADA. Todo ocurre dentro de `enTransaccionRevertida`, que SIEMPRE hace
// rollback. Lo unico que salta el archivo entero es la ausencia de `DATABASE_URL`.
//
// POR QUE NO PUEDE PASAR EN VERDE CON LA BASE VACIA (precedente pagado en este repo: 12 tests de
// paridad de busqueda que retornaban temprano y contaban como `passed`). El test SIEMBRA sus
// propios hilos y afirma sobre ELLOS: si la siembra fallara, `crearUsuario`/`crearOrden` LANZAN
// con el motivo escrito y el `beforeAll` revienta; y si la siembra ocurriera pero las consultas
// no vieran nada, cada `expect` de longitud (3, 1, 2, 5, 30...) se pone rojo. No hay ni un
// `if (vacio) return`.
//
// POR QUE CADA ESCENARIO TIENE SUS PROPIOS MENSAJEROS Y SE FILTRA POR ELLOS. La base de
// desarrollo ya tiene hilos (7 conversaciones el 2026-08-28) y otros archivos corren en paralelo.
// Afirmar `toHaveLength(3)` sobre el listado GLOBAL seria un test que depende del estado ajeno.
// Se acota con `filtro.mensajero_id`, que ademas es exactamente el filtro de R33; lo que se mide
// sigue siendo el listado real, no una consulta distinta.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Cada escenario deja aqui lo que sus `it(...)` necesitan mirar. */
interface Medicion {
  // --- T3.1 / T3.3: listado base -----------------------------------------------------------
  base: HiloHistoricoDTO[];
  baseEsperada: {
    m1: string;
    m2: string;
    m3: string;
    ordenM1: string;
    numGuiaM1: number;
    numRemisionM1: string;
    ultimaM1: string;
    ordenBorrada: string;
  };
  soloM1: HiloHistoricoDTO[];
  // --- T3.3: filtros ------------------------------------------------------------------------
  fechaDentro: HiloHistoricoDTO[];
  fechaEsperada: { ordenDentro: string; ordenFuera: string };
  fechaFusion: HiloHistoricoDTO[];
  fechaFusionEsperada: { orden: string; telefonoVigenteEsperado: string };
  ordenExacta: HiloHistoricoDTO[];
  ordenPrefijo: HiloHistoricoDTO[];
  guiaExacta: HiloHistoricoDTO[];
  qDestinatario: HiloHistoricoDTO[];
  qGuia: HiloHistoricoDTO[];
  qRemision: HiloHistoricoDTO[];
  qMensajero: HiloHistoricoDTO[];
  qSinCoincidencia: HiloHistoricoDTO[];
  qTelefono: HiloHistoricoDTO[];
  qTelefonoConFormato: HiloHistoricoDTO[];
  qTelefonoAjeno: HiloHistoricoDTO[];
  qTelefonoEsperado: { orden: string; telefono: string };
  // --- T3.1: paginacion ---------------------------------------------------------------------
  paginado: { paginas: HiloHistoricoDTO[][]; claves: string[] };
  empatados: { paginas: HiloHistoricoDTO[][]; claves: string[] };
  // --- T3.2: fusion -------------------------------------------------------------------------
  fusion: HiloHistoricoDTO[];
  fusionMensajes: ChatMensajeVista[];
  fusionEsperada: { ids: string[]; telefonoVigenteEsperado: string };
  dosMensajeros: HiloHistoricoDTO[];
  dosMensajerosEsperados: string[];
  reasignado: HiloHistoricoDTO[];
  reasignadoEsperado: { m9: string; m10: string };
  // --- T3.4: mensajes -----------------------------------------------------------------------
  paginaMasReciente: ChatMensajeVista[];
  paginaAnterior: ChatMensajeVista[];
  largoEsperado: { idMasReciente: string; idMasAntiguo: string; idAnterior: string };
  empateMensajes: string[];
  direcciones: string[];
  cabeceraFusion: HiloHistoricoDTO | null;
  cabeceraInexistente: HiloHistoricoDTO | null;
  // --- T3.5: reacciones ---------------------------------------------------------------------
  conReacciones: ChatMensajeVista[];
  reaccionEsperada: { idConReaccionMismaFila: string; idConReaccionOtraFila: string };
  // --- R17: el hilo completo ----------------------------------------------------------------
  hiloDeDosMeses: number;
}

describeSiHayBase("321 / bloque 3 — HistoricoConversacionesRepository contra Postgres real", () => {
  let prisma: PrismaClient;
  let m: Medicion;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    m = await enTransaccionRevertida(prisma, medir);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ==========================================================================================
  // Siembra
  // ==========================================================================================

  async function medir(tx: Tx): Promise<Medicion> {
    // PRIMERA sentencia: este archivo escribe usuarios y ordenes REALES en `public`, igual que
    // otros que corren en paralelo. Sin serializar, las transacciones toman los mismos locks de
    // FK en distinto orden y Postgres mata a una con `40P01`.
    await serializarEscriturasReales(tx);

    const repo = new HistoricoConversacionesRepository(tx as unknown as HistoricoPrismaClient);
    const tienda = await crearUsuario(tx, "Tienda", "321");

    // ---- Escenario BASE: tres mensajeros, tres hilos + un hilo de orden BORRADA -------------
    const m1 = await crearUsuario(tx, "Ana", "Zulúaga");
    const m2 = await crearUsuario(tx, "Bruno", "Pérez");
    const m3 = await crearUsuario(tx, "Carla", "Mora");

    const guiaM1 = guiaLibre();
    const ordenM1 = await crearOrden(tx, tienda, m1, {
      destinatario: "MARÍA GONZÁLEZ",
      numGuia: guiaM1,
    });
    const ordenM2 = await crearOrden(tx, tienda, m2, {});
    const ordenM3 = await crearOrden(tx, tienda, m3, {});
    const ordenBorrada = await crearOrden(tx, tienda, m1, { deletedAt: new Date() });

    const ultimaM1 = new Date("2026-08-20T15:00:00.000Z");
    await sembrarHilo(tx, ordenM1, m1, [
      { ocurridoAt: new Date("2026-08-20T14:00:00.000Z"), direccion: "entrante" },
      { ocurridoAt: ultimaM1, direccion: "saliente" },
    ]);
    await sembrarHilo(tx, ordenM2, m2, [
      { ocurridoAt: new Date("2026-08-19T15:00:00.000Z"), direccion: "entrante" },
    ]);
    await sembrarHilo(tx, ordenM3, m3, [
      { ocurridoAt: new Date("2026-08-18T15:00:00.000Z"), direccion: "entrante" },
    ]);
    await sembrarHilo(tx, ordenBorrada, m1, [
      { ocurridoAt: new Date("2026-08-21T15:00:00.000Z"), direccion: "entrante" },
    ]);

    const numRemisionM1 = await remisionDe(tx, ordenM1);
    const numRemisionM2 = await remisionDe(tx, ordenM2);

    // El SEÑUELO de R35: una orden cuya guia es la de M1 con un digito de mas (`1001` vs
    // `10011`) y cuya remision empieza igual. Vive en su propio mensajero para no alterar el
    // conteo del escenario base.
    const m4 = await crearUsuario(tx, "Dario", "Señuelo");
    const ordenSenuelo = await crearOrden(tx, tienda, m4, { numGuia: guiaM1 * 10 + 1 });
    await sembrarHilo(tx, ordenSenuelo, m4, [
      { ocurridoAt: new Date("2026-08-17T15:00:00.000Z"), direccion: "entrante" },
    ]);

    // ---- Escenario TELEFONO (pedido humano 2026-08-31) --------------------------------------
    // El numero del HILO, que puede no ser el que trae la orden: `orden.busqueda_texto` indexa
    // el telefono de la orden, asi que este mensajero se siembra con un numero de chat que NO
    // esta en ninguna otra columna. Si la busqueda por `q` no mirara `chat_conversacion`, este
    // hilo seria inencontrable.
    const m19 = await crearUsuario(tx, "Tomás", "Teléfono");
    const ordenTelefono = await crearOrden(tx, tienda, m19, {});
    const telHilo = `50677${digitos(6)}`;
    await sembrarHilo(
      tx,
      ordenTelefono,
      m19,
      [{ ocurridoAt: new Date("2026-08-14T15:00:00.000Z"), direccion: "entrante" }],
      telHilo,
    );

    const alcanceBase = [m1, m2, m3];
    const alcanceOrden = [m1, m2, m3, m4];

    // ---- Escenario FECHA (R34): el par que mata `startOfDayCR` -------------------------------
    const m5 = await crearUsuario(tx, "Elena", "Frontera");
    const ordenDentro = await crearOrden(tx, tienda, m5, {});
    const ordenFuera = await crearOrden(tx, tienda, m5, {});
    // 05:00Z = 23:00 del 15 en Costa Rica  -> DENTRO del dia 2026-08-15
    await sembrarHilo(tx, ordenDentro, m5, [
      { ocurridoAt: new Date("2026-08-16T05:00:00.000Z"), direccion: "entrante" },
    ]);
    // 06:00Z = 00:00 del 16 en Costa Rica  -> FUERA
    await sembrarHilo(tx, ordenFuera, m5, [
      { ocurridoAt: new Date("2026-08-16T06:00:00.000Z"), direccion: "entrante" },
    ]);

    // ---- Escenario FECHA x FUSION (R34 + R42/R43): el rango SELECCIONA EL HILO, no la fila ---
    // Un hilo fusionado de DOS numeros del que solo UNA fila tiene mensajes dentro del rango. El
    // `EXISTS` del filtro vive en el `WHERE`, o sea ANTES del `GROUP BY`: si se correlacionara
    // por fila (`m2.conversacion_id = c.id`, la forma que insinuaba el borrador del design) la
    // fila de `telFueraDeRango` moriria antes de agregarse y el hilo saldria con los agregados
    // calculados sobre MEDIO hilo. Aqui se fija lo contrario con numeros exactos.
    const m18 = await crearUsuario(tx, "Sofia", "FechaFusión");
    const ordenFechaFusion = await crearOrden(tx, tienda, m18, {});
    const telEnRango = `50699${digitos(6)}`;
    const telFueraDeRango = `50611${digitos(6)}`;
    const convEnRango = await crearConversacion(tx, ordenFechaFusion, m18, telEnRango);
    const convFueraDeRango = await crearConversacion(tx, ordenFechaFusion, m18, telFueraDeRango);
    // UN mensaje dentro del dia 2026-07-20 de Costa Rica (15:00Z = 09:00 CR).
    await crearMensaje(tx, convEnRango, {
      ocurridoAt: new Date("2026-07-20T15:00:00.000Z"),
      direccion: "entrante",
    });
    // TRES mensajes fuera del rango, y ademas POSTERIORES: son los que fijan el telefono vigente.
    for (const dia of [25, 26, 27]) {
      await crearMensaje(tx, convFueraDeRango, {
        ocurridoAt: new Date(`2026-07-${dia}T15:00:00.000Z`),
        direccion: "saliente",
      });
    }

    // ---- Escenario FUSION (R42/R43): una orden, un mensajero, DOS telefonos ------------------
    const m6 = await crearUsuario(tx, "Fabio", "Fusión");
    const ordenFusion = await crearOrden(tx, tienda, m6, {});
    const tel1 = `50688${digitos(6)}`;
    const tel2 = `50677${digitos(6)}`;
    const convTel1 = await crearConversacion(tx, ordenFusion, m6, tel1);
    const convTel2 = await crearConversacion(tx, ordenFusion, m6, tel2);
    const idAntiguoTel1 = await crearMensaje(tx, convTel1, {
      ocurridoAt: new Date("2026-08-10T10:00:00.000Z"),
      direccion: "entrante",
    });
    const idTel2 = await crearMensaje(tx, convTel2, {
      ocurridoAt: new Date("2026-08-10T11:00:00.000Z"),
      direccion: "saliente",
    });
    const idTel1 = await crearMensaje(tx, convTel1, {
      ocurridoAt: new Date("2026-08-10T12:00:00.000Z"),
      direccion: "entrante",
    });
    const idRecienteTel2 = await crearMensaje(tx, convTel2, {
      ocurridoAt: new Date("2026-08-10T13:00:00.000Z"),
      direccion: "saliente",
    });

    // ---- Escenario DOS MENSAJEROS (R44): la misma orden, dos personas ------------------------
    const m7 = await crearUsuario(tx, "Gina", "Uno");
    const m8 = await crearUsuario(tx, "Hugo", "Dos");
    const ordenCompartida = await crearOrden(tx, tienda, m7, {});
    await sembrarHilo(tx, ordenCompartida, m7, [
      { ocurridoAt: new Date("2026-08-11T10:00:00.000Z"), direccion: "entrante" },
    ]);
    await sembrarHilo(tx, ordenCompartida, m8, [
      { ocurridoAt: new Date("2026-08-11T11:00:00.000Z"), direccion: "entrante" },
    ]);

    // ---- Escenario REASIGNACION (R45, LIMITACION CONOCIDA) -----------------------------------
    // Se reproduce lo que hace `ChatConversacionRepository.upsertParaOrden` al reasignar:
    // REESCRIBE `mensajero_id` sobre la fila existente. Los mensajes anteriores se quedan donde
    // estaban porque `chat_mensaje` NO tiene columna de mensajero.
    const m9 = await crearUsuario(tx, "Ines", "Antes");
    const m10 = await crearUsuario(tx, "Julio", "Despues");
    const ordenReasignada = await crearOrden(tx, tienda, m10, {});
    const convReasignada = await crearConversacion(tx, ordenReasignada, m9, `50666${digitos(6)}`);
    await crearMensaje(tx, convReasignada, {
      ocurridoAt: new Date("2026-08-12T10:00:00.000Z"),
      direccion: "entrante",
    });
    await crearMensaje(tx, convReasignada, {
      ocurridoAt: new Date("2026-08-12T11:00:00.000Z"),
      direccion: "saliente",
    });
    await tx.chatConversacion.update({
      where: { id: convReasignada },
      data: { mensajeroId: m10 },
    });
    await crearMensaje(tx, convReasignada, {
      ocurridoAt: new Date("2026-08-12T12:00:00.000Z"),
      direccion: "entrante",
    });

    // ---- Escenario PAGINACION (R13): cinco hilos de un mismo mensajero ------------------------
    const m11 = await crearUsuario(tx, "Karla", "Paginada");
    for (let i = 0; i < 5; i += 1) {
      const orden = await crearOrden(tx, tienda, m11, {});
      await sembrarHilo(tx, orden, m11, [
        {
          ocurridoAt: new Date(Date.UTC(2026, 6, 1 + i, 12, 0, 0)),
          direccion: "entrante",
        },
      ]);
    }

    // ---- Escenario EMPATE (R15): tres hilos con la MISMA ultima actividad ---------------------
    const m12 = await crearUsuario(tx, "Luis", "Empate");
    const instanteEmpatado = new Date("2026-07-15T12:00:00.000Z");
    for (let i = 0; i < 3; i += 1) {
      const orden = await crearOrden(tx, tienda, m12, {});
      await sembrarHilo(tx, orden, m12, [
        { ocurridoAt: instanteEmpatado, direccion: "entrante" },
      ]);
    }

    // ---- Escenario HILO LARGO (R18/R19/R21) ---------------------------------------------------
    const m13 = await crearUsuario(tx, "Mario", "Largo");
    const ordenLarga = await crearOrden(tx, tienda, m13, {});
    const convLarga = await crearConversacion(tx, ordenLarga, m13, `50655${digitos(6)}`);
    const idsLargos: string[] = [];
    for (let i = 0; i < 100; i += 1) {
      idsLargos.push(
        await crearMensaje(tx, convLarga, {
          ocurridoAt: new Date(Date.UTC(2026, 5, 1, 0, i, 0)),
          direccion: i % 2 === 0 ? "entrante" : "saliente",
        }),
      );
    }

    // ---- Escenario EMPATE DE MENSAJES (R20): cinco con el MISMO `ocurrido_at` -----------------
    const m14 = await crearUsuario(tx, "Nadia", "Empatada");
    const ordenEmpate = await crearOrden(tx, tienda, m14, {});
    const convEmpate = await crearConversacion(tx, ordenEmpate, m14, `50644${digitos(6)}`);
    const mismoInstante = new Date("2026-06-10T08:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      await crearMensaje(tx, convEmpate, { ocurridoAt: mismoInstante, direccion: "entrante" });
    }

    // ---- Escenario DIRECCIONES (R16/R40) ------------------------------------------------------
    const m15 = await crearUsuario(tx, "Oscar", "Entrelazado");
    const ordenDirecciones = await crearOrden(tx, tienda, m15, {});
    await sembrarHilo(tx, ordenDirecciones, m15, [
      { ocurridoAt: new Date("2026-06-20T10:00:00.000Z"), direccion: "entrante" },
      { ocurridoAt: new Date("2026-06-20T10:01:00.000Z"), direccion: "saliente" },
      { ocurridoAt: new Date("2026-06-20T10:02:00.000Z"), direccion: "entrante" },
      { ocurridoAt: new Date("2026-06-20T10:03:00.000Z"), direccion: "saliente" },
    ]);

    // ---- Escenario REACCIONES (R28) -----------------------------------------------------------
    const m16 = await crearUsuario(tx, "Paula", "Reaccion");
    const ordenReacciones = await crearOrden(tx, tienda, m16, {});
    const convA = await crearConversacion(tx, ordenReacciones, m16, `50633${digitos(6)}`);
    const convB = await crearConversacion(tx, ordenReacciones, m16, `50622${digitos(6)}`);
    const waA = `wamid.${randomUUID()}`;
    const waB = `wamid.${randomUUID()}`;
    // Burbuja mas antigua: se queda FUERA de la pagina de tamaño 2.
    await crearMensaje(tx, convA, {
      ocurridoAt: new Date("2026-05-01T09:00:00.000Z"),
      direccion: "entrante",
    });
    const idConReaccionMismaFila = await crearMensaje(tx, convA, {
      ocurridoAt: new Date("2026-05-01T10:00:00.000Z"),
      direccion: "saliente",
      waMessageId: waA,
    });
    const idConReaccionOtraFila = await crearMensaje(tx, convA, {
      ocurridoAt: new Date("2026-05-01T11:00:00.000Z"),
      direccion: "saliente",
      waMessageId: waB,
    });
    // Reaccion a `waA` MUY anterior a la pagina: fuera de la ventana temporal.
    await crearMensaje(tx, convA, {
      ocurridoAt: new Date("2026-04-01T09:00:00.000Z"),
      direccion: "entrante",
      tipo: "reaccion",
      reaccionAWaMessageId: waA,
      reaccionEmoji: "👍",
    });
    // Reaccion a `waB` en OTRA fila del mismo grupo (el cliente cambio de numero).
    await crearMensaje(tx, convB, {
      ocurridoAt: new Date("2026-05-02T09:00:00.000Z"),
      direccion: "entrante",
      tipo: "reaccion",
      reaccionAWaMessageId: waB,
      reaccionEmoji: "❤️",
    });

    // ---- Escenario HILO DE DOS MESES (R17) ----------------------------------------------------
    const m17 = await crearUsuario(tx, "Rosa", "DosMeses");
    const ordenDosMeses = await crearOrden(tx, tienda, m17, {});
    await sembrarHilo(tx, ordenDosMeses, m17, [
      { ocurridoAt: new Date("2026-03-05T10:00:00.000Z"), direccion: "entrante" },
      { ocurridoAt: new Date("2026-03-06T10:00:00.000Z"), direccion: "saliente" },
      { ocurridoAt: new Date("2026-04-07T10:00:00.000Z"), direccion: "entrante" },
      { ocurridoAt: new Date("2026-04-08T10:00:00.000Z"), direccion: "saliente" },
    ]);

    // ==========================================================================================
    // Medicion
    // ==========================================================================================

    const listar = async (
      mensajeros: string[],
      extra: Partial<FiltroHilosHistorico> = {},
      limite = 25,
    ): Promise<HiloHistoricoDTO[]> =>
      (
        await repo.listarHilos({
          filtro: { mensajero_id: mensajeros, ...extra },
          cursor: null,
          limite,
        })
      ).items;

    const paginarHilos = async (
      mensajeros: string[],
      limite: number,
    ): Promise<{ paginas: HiloHistoricoDTO[][]; claves: string[] }> => {
      const paginas: HiloHistoricoDTO[][] = [];
      const claves: string[] = [];
      let cursor = null as Awaited<ReturnType<typeof repo.listarHilos>>["siguiente"];
      // Tope de seguridad: si el cursor no avanzara, el bucle no puede quedarse colgado.
      for (let vuelta = 0; vuelta < 20; vuelta += 1) {
        const pagina = await repo.listarHilos({
          filtro: { mensajero_id: mensajeros },
          cursor,
          limite,
        });
        paginas.push(pagina.items);
        for (const hilo of pagina.items) claves.push(`${hilo.ordenId}:${hilo.mensajeroId}`);
        if (pagina.siguiente === null) break;
        cursor = pagina.siguiente;
      }
      return { paginas, claves };
    };

    const base = await listar(alcanceBase);

    const paginaMasReciente = (
      await repo.listarMensajes({
        ordenId: ordenLarga,
        mensajeroId: m13,
        cursor: null,
        limite: MENSAJES_LIMITE_DEFECTO,
      })
    ).mensajes;
    const primeraPaginaLarga = await repo.listarMensajes({
      ordenId: ordenLarga,
      mensajeroId: m13,
      cursor: null,
      limite: MENSAJES_LIMITE_DEFECTO,
    });
    const paginaAnterior = (
      await repo.listarMensajes({
        ordenId: ordenLarga,
        mensajeroId: m13,
        cursor: primeraPaginaLarga.anterior,
        limite: MENSAJES_LIMITE_DEFECTO,
      })
    ).mensajes;

    // R20: recorrer el hilo empatado de 2 en 2 hasta el final.
    const empateMensajes: string[] = [];
    let cursorEmpate = null as Awaited<ReturnType<typeof repo.listarMensajes>>["anterior"];
    for (let vuelta = 0; vuelta < 10; vuelta += 1) {
      const pagina = await repo.listarMensajes({
        ordenId: ordenEmpate,
        mensajeroId: m14,
        cursor: cursorEmpate,
        limite: 2,
      });
      for (const mensaje of pagina.mensajes) empateMensajes.push(mensaje.id);
      if (pagina.anterior === null) break;
      cursorEmpate = pagina.anterior;
    }

    // R17: la paginacion COMPLETA del hilo de dos meses.
    let hiloDeDosMeses = 0;
    let cursorDosMeses = null as Awaited<ReturnType<typeof repo.listarMensajes>>["anterior"];
    for (let vuelta = 0; vuelta < 10; vuelta += 1) {
      const pagina = await repo.listarMensajes({
        ordenId: ordenDosMeses,
        mensajeroId: m17,
        cursor: cursorDosMeses,
        limite: 2,
      });
      hiloDeDosMeses += pagina.mensajes.length;
      if (pagina.anterior === null) break;
      cursorDosMeses = pagina.anterior;
    }

    return {
      base,
      baseEsperada: {
        m1,
        m2,
        m3,
        ordenM1,
        numGuiaM1: guiaM1,
        numRemisionM1,
        ultimaM1: ultimaM1.toISOString(),
        ordenBorrada,
      },
      soloM1: await listar([m1]),
      fechaDentro: await listar([m5], {
        fecha_desde: "2026-08-15",
        fecha_hasta: "2026-08-15",
      }),
      fechaEsperada: { ordenDentro, ordenFuera },
      fechaFusion: await listar([m18], {
        fecha_desde: "2026-07-20",
        fecha_hasta: "2026-07-20",
      }),
      fechaFusionEsperada: {
        orden: ordenFechaFusion,
        telefonoVigenteEsperado: telFueraDeRango,
      },
      ordenExacta: await listar(alcanceOrden, { orden: numRemisionM1 }),
      ordenPrefijo: await listar(alcanceOrden, { orden: numRemisionM1.slice(0, -1) }),
      guiaExacta: await listar(alcanceOrden, { orden: String(guiaM1) }),
      qDestinatario: await listar(alcanceBase, { q: "maría" }),
      qGuia: await listar(alcanceBase, { q: String(guiaM1) }),
      qRemision: await listar(alcanceBase, { q: numRemisionM2 }),
      qMensajero: await listar(alcanceBase, { q: "zuluaga" }),
      qSinCoincidencia: await listar(alcanceBase, { q: `zzq${randomUUID().slice(0, 8)}` }),
      // Tecleado TAL CUAL y tecleado CON FORMATO: los dos tienen que encontrar el mismo hilo.
      qTelefono: await listar([m19], { q: telHilo }),
      qTelefonoConFormato: await listar([m19], {
        q: `+${telHilo.slice(0, 3)} ${telHilo.slice(3, 7)}-${telHilo.slice(7)}`,
      }),
      qTelefonoAjeno: await listar([m19], { q: `50755${digitos(6)}` }),
      qTelefonoEsperado: { orden: ordenTelefono, telefono: telHilo },
      paginado: await paginarHilos([m11], 2),
      empatados: await paginarHilos([m12], 2),
      fusion: await listar([m6]),
      fusionMensajes: (
        await repo.listarMensajes({
          ordenId: ordenFusion,
          mensajeroId: m6,
          cursor: null,
          limite: 30,
        })
      ).mensajes,
      fusionEsperada: {
        ids: [idAntiguoTel1, idTel2, idTel1, idRecienteTel2],
        telefonoVigenteEsperado: tel2,
      },
      dosMensajeros: await listar([m7, m8]),
      dosMensajerosEsperados: [m7, m8].sort(),
      reasignado: await listar([m9, m10]),
      reasignadoEsperado: { m9, m10 },
      paginaMasReciente,
      paginaAnterior,
      largoEsperado: {
        idMasReciente: idsLargos[99]!,
        idMasAntiguo: idsLargos[0]!,
        idAnterior: idsLargos[69]!,
      },
      empateMensajes,
      direcciones: (
        await repo.listarMensajes({
          ordenId: ordenDirecciones,
          mensajeroId: m15,
          cursor: null,
          limite: 30,
        })
      ).mensajes.map((x) => x.direccion),
      cabeceraFusion: await repo.obtenerCabecera(ordenFusion, m6),
      cabeceraInexistente: await repo.obtenerCabecera(ordenFusion, m1),
      conReacciones: (
        await repo.listarMensajes({
          ordenId: ordenReacciones,
          mensajeroId: m16,
          cursor: null,
          limite: 2,
        })
      ).mensajes,
      reaccionEsperada: { idConReaccionMismaFila, idConReaccionOtraFila },
      hiloDeDosMeses,
    };
  }

  // ==========================================================================================
  // Utilidades de siembra
  // ==========================================================================================

  function digitos(n: number): string {
    return String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0");
  }

  /**
   * Una guia libre del rango alto: `num_guia` es UNICA GLOBALMENTE, asi que el señuelo de R35
   * (`guia * 10 + 1`) tiene que caber en `int` y no chocar con la base de desarrollo.
   */
  function guiaLibre(): number {
    return 70_000_000 + Math.floor(Math.random() * 9_000_000);
  }

  async function crearUsuario(tx: Tx, nombre: string, apellido: string): Promise<string> {
    const rol = await tx.rol.findFirst({ select: { id: true } });
    const tipo = await tx.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!rol || !tipo) {
      throw new Error(
        "La base de pruebas no tiene catalogos `rol`/`tipo_identificacion` sembrados: sin ellos " +
          "no se pueden crear los usuarios propios del test. Corre `pnpm db:seed`. Este test NO " +
          "se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 8);
    const { id } = await tx.usuario.create({
      data: {
        nombre,
        primerApellido: apellido,
        email: `t321-${sufijo}@example.test`,
        telefono: "00000000",
        passwordHash: "x",
        cedula: `t321${sufijo}`,
        tipoIdentificacionId: tipo.id,
        rolId: rol.id,
      },
      select: { id: true },
    });
    return id;
  }

  async function crearOrden(
    tx: Tx,
    tiendaId: string,
    mensajeroId: string,
    opciones: { destinatario?: string; numGuia?: number; deletedAt?: Date },
  ): Promise<string> {
    const canton = await tx.canton.findFirst({ select: { id: true, provinciaId: true } });
    const zona = await tx.zona.findFirst({ select: { id: true } });
    const estatus = await tx.orderStatus.findFirst({ select: { id: true } });
    if (!canton || !zona || !estatus) {
      throw new Error(
        "La base de pruebas no tiene catalogos de geografia/estatus sembrados: sin ellos no se " +
          "puede crear la orden propia del test (y sin orden no hay hilo que medir). Corre " +
          "`pnpm db:seed`. Este test NO se salta en ese caso a proposito.",
      );
    }
    const sufijo = randomUUID().slice(0, 12);
    const { id } = await tx.orden.create({
      data: {
        numRemision: `rem-321-${sufijo}`,
        numGuia: opciones.numGuia ?? null,
        estatusId: estatus.id,
        destinatario: opciones.destinatario ?? "Destinatario de prueba",
        telefonoDest: "00000000",
        tiendaId,
        zonaId: zona.id,
        provinciaId: canton.provinciaId,
        cantonId: canton.id,
        producto: "Producto",
        mensajeroAsignadoId: mensajeroId,
        deletedAt: opciones.deletedAt ?? null,
      },
      select: { id: true },
    });
    return id;
  }

  async function remisionDe(tx: Tx, ordenId: string): Promise<string> {
    const fila = await tx.orden.findUniqueOrThrow({
      where: { id: ordenId },
      select: { numRemision: true },
    });
    return fila.numRemision;
  }

  async function crearConversacion(
    tx: Tx,
    ordenId: string,
    mensajeroId: string,
    telefonoE164: string,
  ): Promise<string> {
    const { id } = await tx.chatConversacion.create({
      data: { ordenId, mensajeroId, telefonoE164 },
      select: { id: true },
    });
    return id;
  }

  interface MensajeSembrado {
    ocurridoAt: Date;
    direccion: "entrante" | "saliente";
    tipo?: "texto" | "reaccion" | "sistema";
    waMessageId?: string;
    reaccionAWaMessageId?: string;
    reaccionEmoji?: string;
  }

  async function crearMensaje(
    tx: Tx,
    conversacionId: string,
    mensaje: MensajeSembrado,
  ): Promise<string> {
    const { id } = await tx.chatMensaje.create({
      data: {
        conversacionId,
        direccion: mensaje.direccion,
        tipo: mensaje.tipo ?? "texto",
        cuerpo: mensaje.tipo === "reaccion" ? null : "hola",
        waMessageId: mensaje.waMessageId ?? null,
        reaccionAWaMessageId: mensaje.reaccionAWaMessageId ?? null,
        reaccionEmoji: mensaje.reaccionEmoji ?? null,
        ocurridoAt: mensaje.ocurridoAt,
      },
      select: { id: true },
    });
    return id;
  }

  async function sembrarHilo(
    tx: Tx,
    ordenId: string,
    mensajeroId: string,
    mensajes: MensajeSembrado[],
    telefonoE164?: string,
  ): Promise<string> {
    const conversacionId = await crearConversacion(
      tx,
      ordenId,
      mensajeroId,
      telefonoE164 ?? `506${digitos(8)}`,
    );
    for (const mensaje of mensajes) await crearMensaje(tx, conversacionId, mensaje);
    return conversacionId;
  }

  // ==========================================================================================
  // T3.1 — listarHilos
  // ==========================================================================================

  it("R10: lista los hilos de TODOS los mensajeros, sin scope de mensajero de sesion", () => {
    // Tres mensajeros sembrados, tres hilos: el repositorio NO recibe ningun `mensajeroId` de
    // sesion, y por eso puede devolver hilos que no son de quien pregunta. Es exactamente la
    // diferencia deliberada con `findByOrdenParaMensajero`, que si lleva el scope en el WHERE.
    expect(m.base).toHaveLength(3);
    expect([...new Set(m.base.map((h) => h.mensajeroId))].sort()).toEqual(
      [m.baseEsperada.m1, m.baseEsperada.m2, m.baseEsperada.m3].sort(),
    );
  });

  it("R11: cada fila identifica orden, destinatario, mensajero y ultima actividad", () => {
    expect(m.base[0]).toMatchObject({
      ordenId: m.baseEsperada.ordenM1,
      mensajeroId: m.baseEsperada.m1,
      numGuia: m.baseEsperada.numGuiaM1,
      numRemision: m.baseEsperada.numRemisionM1,
      destinatario: "MARÍA GONZÁLEZ",
      mensajeroNombre: "Ana Zulúaga",
      ultimaActividadAt: m.baseEsperada.ultimaM1,
    });
    // Pedido humano (2026-08-31): el telefono viaja COMPLETO. La contraprueba de que ya NO se
    // enmascara es la LONGITUD: el sembrado son 11 digitos (`506` + 8) y la forma vieja
    // devolvia exactamente 4. Se afirma el numero entero, no que "tenga cuatro".
    expect(m.base[0]!.telefonoVigente).toMatch(/^506\d{8}$/);
  });

  it("R12: el hilo de una orden borrada logicamente no aparece", () => {
    // El hilo borrado tiene la actividad MAS RECIENTE de todo el escenario (21 de agosto): si el
    // `JOIN ... AND o.deleted_at IS NULL` faltara, encabezaria el listado.
    expect(m.base.map((h) => h.ordenId)).not.toContain(m.baseEsperada.ordenBorrada);
  });

  it("R13: la consulta del listado NO usa OFFSET", () => {
    // Se mide el SQL que el repositorio construye de verdad (el mismo que ejecuta), no uno
    // reescrito a mano en el test.
    const sql = construirConsultaListarHilos({
      filtro: { mensajero_id: ["x"], q: "abc", orden: "1001", fecha_desde: "2026-08-01" },
      cursor: { ultimaActividadAt: "2026-08-01T00:00:00.000Z", ordenId: "o", mensajeroId: "m" },
      limite: 26,
    }).text;
    expect(sql).not.toMatch(/OFFSET/i);
  });

  it("R13: pagina de N hilos y recorrido completo sin repetir", () => {
    expect(m.paginado.paginas[0]).toHaveLength(2);
    expect(m.paginado.claves).toHaveLength(5);
    expect(new Set(m.paginado.claves).size).toBe(5);
  });

  it("R14: ordena por ultima actividad descendente, con (orden, mensajero) de desempate", () => {
    // Sembrados con 20, 19 y 18 de agosto: el orden esperado esta escrito, no derivado de lo
    // que devolvio la consulta.
    expect(m.base.map((h) => h.mensajeroId)).toEqual([
      m.baseEsperada.m1,
      m.baseEsperada.m2,
      m.baseEsperada.m3,
    ]);
    expect(m.base.map((h) => h.ultimaActividadAt)).toEqual([
      "2026-08-20T15:00:00.000Z",
      "2026-08-19T15:00:00.000Z",
      "2026-08-18T15:00:00.000Z",
    ]);
  });

  it("R15: tres hilos con la MISMA ultima actividad salen una sola vez cada uno", () => {
    // Sin las dos claves de desempate del cursor, dos de estos tres se pisarian entre paginas.
    expect(m.empatados.claves).toHaveLength(3);
    expect(new Set(m.empatados.claves).size).toBe(3);
  });

  // ==========================================================================================
  // T3.2 — fusion (orden, mensajero)
  // ==========================================================================================

  it("R42: dos filas de chat_conversacion del mismo (orden, mensajero) son UN hilo", () => {
    expect(m.fusion).toHaveLength(1);
    expect(m.fusion[0]!.totalMensajes).toBe(4);
  });

  it("R42: la fusion entrelaza ambas filas por (ocurrido_at, id), sin reordenar", () => {
    expect(m.fusionMensajes.map((x) => x.id)).toEqual(m.fusionEsperada.ids);
  });

  it("R43: la cabecera del hilo fusionado cuenta los numeros y muestra el VIGENTE", () => {
    expect(m.fusion[0]!.telefonosCount).toBe(2);
    expect(m.fusion[0]!.telefonoVigente).toBe(m.fusionEsperada.telefonoVigenteEsperado);
    // `obtenerCabecera` devuelve la MISMA proyeccion que la fila del listado: un solo dato, una
    // sola forma de decirlo.
    expect(m.cabeceraFusion).toEqual(m.fusion[0]);
    // Un par `(orden, mensajero)` que no existe no es una pagina vacia: no existe.
    expect(m.cabeceraInexistente).toBeNull();
  });

  it("R44: dos mensajeros de la misma orden son DOS filas, no un duplicado", () => {
    expect(m.dosMensajeros).toHaveLength(2);
    expect(m.dosMensajeros.map((h) => h.mensajeroId).sort()).toEqual(m.dosMensajerosEsperados);
  });

  it("R45 LIMITACIÓN CONOCIDA: tras una reasignacion el hilo entero queda atribuido al mensajero ACTUAL", () => {
    // ESTO NO ES UN BUG QUE ARREGLAR AQUI. `upsertParaOrden` REESCRIBE `chat_conversacion.
    // mensajero_id` al reasignar (`ChatConversacionRepository.ts`) y `chat_mensaje` NO tiene
    // columna de mensajero (`db/schema.prisma`), asi que el dato no sostiene una particion por
    // «mensajero del dia». Partirlo de verdad exige una COLUMNA NUEVA en `chat_mensaje` — una
    // migracion, que esta feature tiene PROHIBIDA por decision humana (R27/A10).
    //
    // Si vienes a «arreglar» esto: reabre R45 con el humano en su propia feature. Este test
    // existe para que el limite sea VIGILADO y no un accidente (mismo patron que la 311 con
    // `migrarTelefono`).
    expect(m.reasignado).toHaveLength(1);
    expect(m.reasignado[0]!.mensajeroId).toBe(m.reasignadoEsperado.m10);
    expect(m.reasignado[0]!.mensajeroId).not.toBe(m.reasignadoEsperado.m9);
    // Los TRES mensajes —los dos anteriores a la reasignacion incluidos— siguen en el hilo.
    expect(m.reasignado[0]!.totalMensajes).toBe(3);
  });

  // ==========================================================================================
  // T3.3 — filtros
  // ==========================================================================================

  it("R33: con mensajeros seleccionados solo salen sus hilos", () => {
    expect(m.soloM1).toHaveLength(1);
    expect(m.soloM1.every((h) => h.mensajeroId === m.baseEsperada.m1)).toBe(true);
    expect(m.soloM1.map((h) => h.mensajeroId)).not.toContain(m.baseEsperada.m2);
  });

  it("R34: el rango de fechas usa el dia calendario CR (mata el uso de startOfDayCR)", () => {
    // 2026-08-16T05:00Z son las 23:00 del 15 en Costa Rica -> DENTRO del dia 15.
    // 2026-08-16T06:00Z son las 00:00 del 16 -> FUERA. Con `startOfDayCR` (seis horas antes) el
    // par se invierte y este assert se pone rojo.
    expect(m.fechaDentro.map((h) => h.ordenId)).toEqual([m.fechaEsperada.ordenDentro]);
    expect(m.fechaDentro.map((h) => h.ordenId)).not.toContain(m.fechaEsperada.ordenFuera);
  });

  it("R34 x R42/R43: el rango de fechas selecciona el HILO ENTERO, no la fila que casa (mata el EXISTS por conversacion_id)", () => {
    // Hilo fusionado de DOS numeros; SOLO la fila de `telEnRango` tiene un mensaje dentro del
    // 2026-07-20. El `EXISTS` del filtro esta en el `WHERE`, antes del `GROUP BY`, asi que la
    // forma de la correlacion decide QUE FILAS LLEGAN A AGREGARSE:
    //
    //   correlacion por CLAVE DEL HILO (lo implementado)  -> llegan las dos filas
    //   correlacion por FILA (`m2.conversacion_id = c.id`) -> llega solo una
    //
    // Por eso los tres numeros de abajo son la prueba: con la correlacion por fila darian
    // `telefonosCount: 1`, `totalMensajes: 1` y el vigente seria el OTRO numero. No es un caso de
    // laboratorio: la medicion T0 (`progress/impl_321_T0.md`) encontro que el 40 % de los grupos
    // fusiona mas de un telefono.
    expect(m.fechaFusion).toHaveLength(1);
    expect(m.fechaFusion[0]!.ordenId).toBe(m.fechaFusionEsperada.orden);
    expect(m.fechaFusion[0]!.telefonosCount).toBe(2);
    // 1 mensaje dentro del rango + 3 fuera, en la otra fila del mismo hilo: el agregado es del
    // hilo ENTERO. Si saliera 1, el filtro habria amputado media fusion.
    expect(m.fechaFusion[0]!.totalMensajes).toBe(4);
    // El vigente es el numero de la fila que NO casa el rango (su actividad es posterior): otra
    // via por la que la correlacion por fila se pone roja.
    expect(m.fechaFusion[0]!.telefonoVigente).toBe(m.fechaFusionEsperada.telefonoVigenteEsperado);
    // Y la ultima actividad tambien es la del hilo entero, fuera del rango filtrado.
    expect(m.fechaFusion[0]!.ultimaActividadAt).toBe("2026-07-27T15:00:00.000Z");
  });

  it("R35: el filtro por orden es IGUALDAD exacta, nunca coincidencia parcial", () => {
    expect(m.ordenExacta.map((h) => h.ordenId)).toEqual([m.baseEsperada.ordenM1]);
    // Un PREFIJO de la remision no devuelve nada: la ausencia de `LIKE` es el assert.
    expect(m.ordenPrefijo).toEqual([]);
    // La guia `G` no casa la guia `G*10+1`, que existe y esta en el alcance consultado.
    expect(m.guiaExacta.map((h) => h.ordenId)).toEqual([m.baseEsperada.ordenM1]);
  });

  it("R36: la busqueda libre encuentra por destinatario, guia, remision y nombre del mensajero", () => {
    // Destinatario, con plegado de acentos y sin distinguir mayusculas: «maría» -> «MARÍA GONZÁLEZ».
    expect(m.qDestinatario.map((h) => h.ordenId)).toEqual([m.baseEsperada.ordenM1]);
    expect(m.qGuia.map((h) => h.ordenId)).toEqual([m.baseEsperada.ordenM1]);
    expect(m.qRemision).toHaveLength(1);
    expect(m.qRemision[0]!.mensajeroId).toBe(m.baseEsperada.m2);
    // El NOMBRE DEL MENSAJERO no esta en `orden.busqueda_texto`: lo resuelve la segunda mitad
    // del criterio, con `sqlNormalizarTextoBusqueda` sobre `usuario` («zuluaga» -> «Zulúaga»).
    expect(m.qMensajero.map((h) => h.mensajeroId)).toEqual([m.baseEsperada.m1]);
  });

  it("R36: un termino que no casa nada devuelve la lista vacia", () => {
    expect(m.qSinCoincidencia).toEqual([]);
  });

  it("la busqueda libre encuentra por el TELEFONO del hilo, tecleado con o sin formato", () => {
    // El numero sembrado vive SOLO en `chat_conversacion.telefono_e164`: no esta en
    // `orden.busqueda_texto` ni en el nombre del mensajero. Encontrarlo prueba la tercera
    // mitad del criterio, y no otra.
    expect(m.qTelefono.map((h) => h.ordenId)).toEqual([m.qTelefonoEsperado.orden]);
    // Tecleado como lo escribe una persona (`+506 7712-3456`): la comparacion es solo-digitos
    // en las DOS partes, asi que el formato no cambia el resultado.
    expect(m.qTelefonoConFormato.map((h) => h.ordenId)).toEqual([m.qTelefonoEsperado.orden]);
    // Contraprueba: otro numero no lo trae. Sin ella, un criterio que devolviera TODO tambien
    // pasaria las dos afirmaciones de arriba.
    expect(m.qTelefonoAjeno).toEqual([]);
  });

  // ==========================================================================================
  // T3.4 — listarMensajes
  // ==========================================================================================

  it("R18: el hilo no se carga de golpe: una pagina de tamaño fijo", () => {
    expect(m.paginaMasReciente).toHaveLength(MENSAJES_LIMITE_DEFECTO);
    expect(m.paginaMasReciente.length).toBeLessThan(100);
  });

  it("R19: la consulta del hilo NO usa OFFSET y corta por (ocurrido_at, id)", () => {
    const sql = construirConsultaMensajesDelHilo({
      ordenId: "o",
      mensajeroId: "m",
      cursor: { ocurridoAt: "2026-08-01T00:00:00.000Z", id: "x" },
      limite: 31,
    }).text;
    expect(sql).not.toMatch(/OFFSET/i);
    expect(sql).toMatch(/\(m\.ocurrido_at, m\.id\) </);
  });

  it("R20: cinco mensajes con el MISMO ocurrido_at se recorren una sola vez cada uno", () => {
    expect(m.empateMensajes).toHaveLength(5);
    expect(new Set(m.empateMensajes).size).toBe(5);
  });

  it("R21: se aterriza en lo mas reciente y la pagina siguiente es la inmediatamente anterior", () => {
    const ids = m.paginaMasReciente.map((x) => x.id);
    expect(ids).toContain(m.largoEsperado.idMasReciente);
    expect(ids).not.toContain(m.largoEsperado.idMasAntiguo);
    // 100 mensajes, paginas de 30: la segunda pagina termina en el mensaje nº 70 (indice 69).
    expect(m.paginaAnterior.map((x) => x.id)).toContain(m.largoEsperado.idAnterior);
    expect(m.paginaAnterior.map((x) => x.id)).not.toContain(m.largoEsperado.idMasReciente);
  });

  it("R16: la pagina trae las dos direcciones", () => {
    expect(m.paginaMasReciente.some((x) => x.direccion === "entrante")).toBe(true);
    expect(m.paginaMasReciente.some((x) => x.direccion === "saliente")).toBe(true);
  });

  it("R40: entrantes y salientes van entrelazados por tiempo, no agrupados por direccion", () => {
    expect(m.direcciones).toEqual(["entrante", "saliente", "entrante", "saliente"]);
  });

  it("R17: el hilo abierto se lee COMPLETO aunque abarque dos meses", () => {
    expect(m.hiloDeDosMeses).toBe(4);
  });

  // ==========================================================================================
  // T3.5 — reacciones
  // ==========================================================================================

  it("R28: las reacciones se anclan a su burbuja y NUNCA son burbuja propia", () => {
    // Ninguna fila `tipo = reaccion` ocupa sitio en la pagina...
    expect(m.conReacciones.some((x) => x.tipo === "reaccion")).toBe(false);
    // ...y sin embargo ambas reacciones aparecen ancladas: una llego FUERA de la ventana
    // temporal de la pagina, la otra desde OTRA `chat_conversacion` del mismo grupo.
    const mismaFila = m.conReacciones.find(
      (x) => x.id === m.reaccionEsperada.idConReaccionMismaFila,
    );
    const otraFila = m.conReacciones.find(
      (x) => x.id === m.reaccionEsperada.idConReaccionOtraFila,
    );
    expect(mismaFila).toBeDefined();
    expect(otraFila).toBeDefined();
    // NOTA: se busca por el id INTERNO y no por `waMessageId` porque `ChatMensajeVista` —el DTO
    // que esta feature REUTILIZA tal cual (design §2.3)— no expone el id de Meta a la UI (R21 de
    // la 311). Los dos ids identifican el mismo mensaje sembrado.
    expect(mismaFila!.reacciones).toHaveLength(1);
    expect(mismaFila!.reacciones[0]!.emoji).toBe("👍");
    expect(otraFila!.reacciones).toHaveLength(1);
    expect(otraFila!.reacciones[0]!.emoji).toBe("❤️");
  });
});
