import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TraspasoMensajeroConflictoError } from "@/lib/interfaces/repositories/IOrdenRepository";

import {
  HAY_BASE_DE_DATOS,
  crearPrismaDeTest,
  enTransaccionRevertida,
  fksDeOrden,
  serializarEscriturasReales,
  type TxDeTest,
} from "./_postgres-real";

/**
 * ⭑⭑ FICHA 427 (T9) — EL TEST QUE SOSTIENE LA FICHA ENTERA: el caso real de las 31 ordenes, medido
 * contra Postgres de verdad.
 *
 * POR QUE ESTE ARCHIVO EXISTE Y NO BASTAN LOS DOBLES, y esto esta MEDIDO CUATRO VECES EN ESTE REPO:
 * un test de servicio con dobles NO VE EL SQL. Una mutacion del `WHERE` —quitar la guarda de
 * pertenencia al mensajero de origen, o la de estado— deja los 46 tests de servicio en verde y el
 * defecto suelto. El `WHERE` se prueba DONDE VIVE. Y lo mismo con la atomicidad: una transaccion
 * solo existe dentro de una transaccion de verdad.
 *
 * ⚠️ NADA DE `if (!fks) return;`. Con base y sin catalogo, esto REVIENTA con un mensaje que lo dice:
 * un `return` temprano reporta `passed` sin haber comprobado nada — ya paso en este repo. Sin base,
 * el `describe.skip` se ve en la salida con su nombre.
 *
 * TODO corre dentro de una transaccion que SIEMPRE se revierte: ni una fila queda en la base, ni
 * siquiera los dos usuarios que se siembran.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const SUFIJO = `427-${Date.now().toString(36)}`;
const GUIA_BASE = 940_000_000 + (Date.now() % 40_000_000);

/** Un instante VIEJO y distinguible: si el `SET` NO tocara `asignado_at`, se notaria (R17). */
const ASIGNADO_AT_VIEJO = new Date("2026-09-10T15:00:00.000Z");
/** El dia de reparto sembrado. Tiene que sobrevivir IDENTICO al traspaso (R16). */
const DIA_REPARTO = new Date("2026-09-14T00:00:00.000Z");
/** Un entrante viejo: la ventana de 24 h del hilo NO se toca (design §6.3). */
const ULTIMO_ENTRANTE = new Date("2026-09-14T09:00:00.000Z");
/** «Hasta donde leyo» el ORIGEN. Tiene que quedar en NULL para el destino (R19). */
const LEIDO_POR_ORIGEN = new Date("2026-09-14T09:30:00.000Z");
const MOTIVO = "Andy se enfermo a media jornada y Carlos Eduardo termina su ruta";
/** Reloj fijo: el `runAfter` del debounce tiene que ser determinista. */
const AHORA = new Date("2026-09-14T18:00:00.000Z");

describeSiHayBase("427/T9 — el traspaso entre mensajeros, contra Postgres real", () => {
  let prisma: PrismaClient;
  let ESTATUS: Record<string, string>;
  let FKS: {
    estatusId: string;
    tiendaId: string;
    zonaId: string;
    provinciaId: string;
    cantonId: string;
  };
  let ROL_MENSAJERO: string;
  let ROL_MAESTRO: string;
  let TIPO_IDENT: string;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();

    const fks = await fksDeOrden(prisma);
    if (fks === null) {
      throw new Error(
        "hay DATABASE_URL pero la tabla `orden` esta vacia: sin FKs no se puede sembrar. Corre " +
          "`pnpm run db:seed` (y las semillas de zonas) antes de esta suite.",
      );
    }
    FKS = fks;

    const valores = ["en_reparto", "ayuda_tienda", "entregado", "mensajero_recogiendo_en_bodega"];
    const estados = await prisma.orderStatus.findMany({
      where: { value: { in: valores } },
      select: { id: true, value: true },
    });
    ESTATUS = Object.fromEntries(estados.map((e) => [e.value, e.id]));
    const faltan = valores.filter((v) => !ESTATUS[v]);
    if (faltan.length > 0) {
      throw new Error(
        `el catalogo \`order_status\` no tiene ${faltan.join(", ")}: sin ellos no hay guarda de ` +
          `estado que medir. Corre el seed del catalogo.`,
      );
    }

    const roles = await prisma.rol.findMany({
      where: { value: { in: ["mensajero", "maestro"] } },
      select: { id: true, value: true },
    });
    ROL_MENSAJERO = roles.find((r) => r.value === "mensajero")?.id ?? "";
    ROL_MAESTRO = roles.find((r) => r.value === "maestro")?.id ?? "";
    if (!ROL_MENSAJERO || !ROL_MAESTRO) {
      throw new Error("faltan los roles `mensajero`/`maestro` en el catalogo: corre el seed.");
    }

    const tipo = await prisma.tipoIdentificacion.findFirst({ select: { id: true } });
    if (!tipo) throw new Error("no hay `tipo_identificacion` en la base: corre el seed.");
    TIPO_IDENT = tipo.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------
  // Siembra
  // ---------------------------------------------------------------------------------------------

  interface SemillaOrden {
    /** Por defecto `en_reparto`. */
    estatusValue?: string;
    /** Por defecto el mensajero de ORIGEN. `"otro"` la asigna a un tercero. */
    duenio?: "origen" | "destino" | "tercero" | null;
    borrada?: boolean;
    /** Cuantos hilos de chat colgar de esta orden. Por defecto 1. */
    hilos?: number;
    prioridad?: boolean;
  }

  interface Contexto {
    repo: OrdenRepository;
    tx: PrismaClient;
    /** El `tx` crudo del test, para consultar sin pasar por el savepoint del repo. */
    crudo: TxDeTest;
    origenId: string;
    destinoId: string;
    terceroId: string;
    actorId: string;
    ids: string[];
  }

  async function crearUsuario(
    tx: TxDeTest,
    rolId: string,
    etiqueta: string,
  ): Promise<string> {
    const sufijo = `${SUFIJO}-${etiqueta}-${randomUUID().slice(0, 8)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `Corpus427 ${etiqueta}`,
        email: `corpus427.${sufijo}@example.test`,
        telefono: "88880000",
        passwordHash: "x",
        cedula: `C427${sufijo}`.slice(0, 40),
        tipoIdentificacionId: TIPO_IDENT,
        rolId,
        zonaId: FKS.zonaId,
      },
      select: { id: true },
    });
    return u.id;
  }

  /**
   * Siembra dos mensajeros, un actor y las ordenes descritas, y ejecuta `fn`. Todo se revierte al
   * terminar, pase lo que pase.
   *
   * `romperRastro` sustituye `ordenTraspasoMensajero.createMany` por una funcion que LANZA, en el
   * cliente que se le diga (ver `clienteDelRepo`): es la unica forma de medir «si el rastro no se
   * puede escribir, la orden NO queda movida» (R31) y «el rastro se escribe con el `tx`, no con el
   * cliente del repositorio» (mutacion 7) sin tocar codigo de produccion.
   */
  async function conEscenario<T>(
    semillas: SemillaOrden[],
    fn: (ctx: Contexto) => Promise<T>,
    opts: { romperRastro?: "tx" | "fuera" } = {},
  ): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const origenId = await crearUsuario(tx, ROL_MENSAJERO, "origen");
      const destinoId = await crearUsuario(tx, ROL_MENSAJERO, "destino");
      const terceroId = await crearUsuario(tx, ROL_MENSAJERO, "tercero");
      const actorId = await crearUsuario(tx, ROL_MAESTRO, "actor");

      const porEtiqueta: Record<string, string> = {
        origen: origenId,
        destino: destinoId,
        tercero: terceroId,
      };

      const ids: string[] = [];
      let n = 0;
      for (const s of semillas) {
        n += 1;
        const duenio = s.duenio === undefined ? "origen" : s.duenio;
        const orden = await tx.orden.create({
          data: {
            numGuia: GUIA_BASE + Math.floor(Math.random() * 1_000_000) + n,
            numRemision: `R-${SUFIJO}-${Math.random().toString(36).slice(2, 8)}-${n}`,
            destinatario: "Corpus 427",
            telefonoDest: "88880000",
            producto: "caja",
            estatusId: ESTATUS[s.estatusValue ?? "en_reparto"],
            tiendaId: FKS.tiendaId,
            zonaId: FKS.zonaId,
            provinciaId: FKS.provinciaId,
            cantonId: FKS.cantonId,
            mensajeroAsignadoId: duenio === null ? null : porEtiqueta[duenio],
            asignadoAt: duenio === null ? null : ASIGNADO_AT_VIEJO,
            fechaReparto: duenio === null ? null : DIA_REPARTO,
            prioridad: s.prioridad ?? false,
            deletedAt: s.borrada ? new Date() : null,
          },
          select: { id: true },
        });
        ids.push(orden.id);

        const hilos = s.hilos ?? 1;
        for (let h = 0; h < hilos; h += 1) {
          await tx.chatConversacion.create({
            data: {
              telefonoE164: `5068888${String(n).padStart(2, "0")}${h}`,
              ordenId: orden.id,
              mensajeroId: duenio === null ? origenId : porEtiqueta[duenio],
              ultimoEntranteAt: ULTIMO_ENTRANTE,
              mensajeroLeidoAt: LEIDO_POR_ORIGEN,
            },
          });
        }
      }

      const cliente = clienteDelRepo(tx, opts.romperRastro ?? null);
      // Reloj FIJO: el `runAfter` del debounce (y por tanto la clave de dedupe) tiene que ser
      // determinista entre corridas.
      const repo = new OrdenRepository(cliente, undefined, () => AHORA);
      return fn({
        repo,
        tx: cliente,
        crudo: tx,
        origenId,
        destinoId,
        terceroId,
        actorId,
        ids,
      });
    });
  }

  /**
   * El cliente que recibe el repositorio: el `tx` del test MAS un `$transaction` que abre un
   * SAVEPOINT REAL (no un paso a traves), para que un `throw` dentro del repositorio REVIERTA de
   * verdad lo que el repositorio ya habia escrito. Sin savepoint, el caso del todo-o-nada pasaria
   * en verde por accidente.
   *
   * ⚠️ DEVUELVE **DOS** OBJETOS DISTINGUIBLES, Y ESO ES LO QUE HACE MEDIBLE LA MUTACION 7. El
   * cliente EXTERNO es el que el repositorio guarda como `this.prisma`; el que su `$transaction`
   * entrega al callback es OTRO (`interno`). Con un solo objeto —que es lo que hacia la primera
   * version de este arnes, y lo que dejo la mutacion 7 VIVA— `tx` y `this.prisma` son literalmente
   * el mismo valor y ninguna asercion puede distinguirlos: escribir el rastro con uno o con otro da
   * exactamente el mismo resultado.
   *
   * `romper` dice CUAL de los dos revienta:
   *   · `"tx"`    — revienta el INTERNO al tocar la tabla del rastro: modela «el rastro no se puede
   *                 escribir» (R31).
   *   · `"fuera"` — deja limpio el interno y vuelve ESTRICTO al externo: MIENTRAS DURA SU
   *                 `$transaction`, cualquier escritura por el cliente del repositorio LANZA
   *                 `EscrituraFueraDeLaTransaccion` —SQL crudo o delegado de modelo, a cualquier
   *                 tabla—, y la tabla del rastro lanza siempre.
   *
   * ⚠️ POR QUE «CUALQUIER ESCRITURA» Y NO SOLO EL RASTRO (M1 del reviewer, 2026-09-14). Con solo el
   * rastro vigilado, `traspasarConversaciones(this.prisma, …)` y
   * `encolarOptimizacionDebounce(this.jobRepo, undefined, …)` SOBREVIVIAN 23/23: en este arnes el
   * `ROLLBACK TO SAVEPOINT` revierte tambien lo escrito por el externo —es la misma conexion—, asi
   * que nada distinguia «dentro» de «fuera». En PRODUCCION no es asi: `this.prisma` es OTRA
   * conexion del pool, y si despues fallara el rastro los HILOS o los JOBS quedarian escritos sin
   * traspaso que los respalde (R23). Y el compilador no lo impide: `Pick<PrismaClient,"$queryRaw">`
   * acepta el cliente entero.
   *
   * El SQL crudo por el externo se trata ENTERO como escritura, lecturas incluidas, y es deliberado:
   * el codigo correcto no usa `this.prisma` para NADA dentro del acto. Clasificar un `$queryRaw` en
   * lectura/escritura exigiria parsear el SQL, y un detector que en la duda deja pasar es justo el que
   * falla.
   */
  function clienteDelRepo(tx: TxDeTest, romper: "tx" | "fuera" | null): PrismaClient {
    const lanzador = {
      createMany: () => {
        throw new RastroCaido();
      },
    };
    /** `true` solo mientras corre el callback del `$transaction` del EXTERNO. */
    let dentroDelActo = false;
    const esEstricto = romper === "fuera";

    const hacerProxy = (rompe: boolean, conTransaccion: boolean): PrismaClient =>
      new Proxy(tx as object, {
        get(objetivo, prop) {
          if (rompe && prop === "ordenTraspasoMensajero") return lanzador;
          if (conTransaccion && prop === "$transaction") {
            return async (fn: (t: unknown) => unknown) => {
              const punto = `sp427_${randomUUID().replace(/-/g, "")}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${punto}`);
              dentroDelActo = true;
              try {
                const salida = await fn(interno);
                dentroDelActo = false;
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${punto}`);
                return salida;
              } catch (error) {
                dentroDelActo = false;
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${punto}`);
                throw error;
              }
            };
          }
          const valor = Reflect.get(objetivo, prop) as unknown;
          // M1: el EXTERNO, dentro del acto, no escribe. Ni SQL crudo ni delegados de modelo.
          if (conTransaccion && esEstricto && dentroDelActo && typeof prop === "string") {
            if (SQL_CRUDO.has(prop)) {
              return () => {
                throw new EscrituraFueraDeLaTransaccion(prop);
              };
            }
            if (esDelegadoDeModelo(valor)) {
              return new Proxy(valor as object, {
                get(delegado, metodo) {
                  if (typeof metodo === "string" && METODOS_DE_ESCRITURA.has(metodo)) {
                    return () => {
                      throw new EscrituraFueraDeLaTransaccion(`${prop}.${metodo}`);
                    };
                  }
                  const v = Reflect.get(delegado, metodo) as unknown;
                  return typeof v === "function" ? v.bind(delegado) : v;
                },
              });
            }
          }
          return typeof valor === "function" ? valor.bind(objetivo) : valor;
        },
      }) as unknown as PrismaClient;

    const interno = hacerProxy(romper === "tx", false);
    return hacerProxy(romper === "fuera", true);
  }

  /** Superficie de SQL crudo del cliente Prisma: dentro del acto, por el externo, todo lanza. */
  const SQL_CRUDO = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);

  /** Metodos de un delegado de modelo que escriben. */
  const METODOS_DE_ESCRITURA = new Set([
    "create",
    "createMany",
    "createManyAndReturn",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "upsert",
    "delete",
    "deleteMany",
  ]);

  function esDelegadoDeModelo(valor: unknown): boolean {
    return (
      typeof valor === "object" &&
      valor !== null &&
      typeof (valor as { findMany?: unknown }).findMany === "function"
    );
  }

  class EscrituraFueraDeLaTransaccion extends Error {
    constructor(que: string) {
      super(
        `escritura por el cliente del REPOSITORIO (this.prisma.${que}) DENTRO del acto: tenia que ` +
          `ir por el tx de la transaccion`,
      );
      this.name = "EscrituraFueraDeLaTransaccion";
    }
  }

  class RastroCaido extends Error {
    constructor() {
      super("fallo PROVOCADO del rastro de traspasos");
      this.name = "RastroCaido";
    }
  }

  /** El input del repositorio para un lote de ordenes `en_reparto` del origen. */
  function loteDe(ctx: Contexto, ids: string[], estatusValue = "en_reparto") {
    return {
      loteId: randomUUID(),
      mensajeroOrigenId: ctx.origenId,
      mensajeroDestinoId: ctx.destinoId,
      ordenes: ids.map((ordenId) => ({
        ordenId,
        estatusIdEsperado: ESTATUS[estatusValue],
      })),
      actor: { usuarioId: ctx.actorId, rol: "maestro" as const },
      motivo: MOTIVO,
    };
  }

  const COLUMNAS = {
    estatusId: true,
    mensajeroAsignadoId: true,
    asignadoAt: true,
    fechaReparto: true,
    numGuia: true,
    numRemision: true,
    prioridad: true,
    zonaId: true,
    deletedAt: true,
  } as const;

  /* ---------------------------------------------------------------------------------------- */
  /* 1 y 2 — las ordenes cambian de dueno, y NADA MAS cambia                                    */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑ T9.1/T9.2 (R15/R16/R17): cambia el mensajero y `asignado_at`; lo demas IDENTICO", async () => {
    const r = await conEscenario([{ prioridad: true }, {}], async (ctx) => {
      const antes = await ctx.crudo.orden.findMany({
        where: { id: { in: ctx.ids } },
        select: { id: true, ...COLUMNAS },
        orderBy: { id: "asc" },
      });
      const aplicado = await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const despues = await ctx.crudo.orden.findMany({
        where: { id: { in: ctx.ids } },
        select: { id: true, ...COLUMNAS },
        orderBy: { id: "asc" },
      });
      return { antes, despues, aplicado, ctx: { origenId: ctx.origenId, destinoId: ctx.destinoId } };
    });

    expect(r.aplicado.movidas).toBe(2);

    for (let i = 0; i < r.antes.length; i += 1) {
      const antes = r.antes[i];
      const despues = r.despues[i];

      // R15: la orden queda con el DESTINO.
      expect(antes.mensajeroAsignadoId).toBe(r.ctx.origenId);
      expect(despues.mensajeroAsignadoId).toBe(r.ctx.destinoId);

      // R17: `asignado_at` es POSTERIOR al de antes. Un traspaso ES una re-asignacion.
      expect(antes.asignadoAt).toEqual(ASIGNADO_AT_VIEJO);
      expect(despues.asignadoAt!.getTime()).toBeGreaterThan(ASIGNADO_AT_VIEJO.getTime());

      // ⭑ R16: TODO LO DEMAS, IDENTICO. Se compara la fila ENTERA menos las dos columnas que SI
      // cambian, no campo a campo elegido a dedo: asi una columna que alguien anada al `SET` en el
      // futuro rompe este test.
      expect({ ...despues, mensajeroAsignadoId: null, asignadoAt: null }).toEqual({
        ...antes,
        mensajeroAsignadoId: null,
        asignadoAt: null,
      });
      // Y las cuatro que el requisito nombra, dichas una por una para que el rojo sea legible:
      expect(despues.estatusId).toBe(antes.estatusId);
      expect(despues.fechaReparto).toEqual(DIA_REPARTO);
      expect(despues.numGuia).toBe(antes.numGuia);
      expect(despues.prioridad).toBe(antes.prioridad);
    }
    // ⭑ La `prioridad` de la primera era `true` y SIGUE siendolo: un traspaso en calle no cierra
    // ningun ciclo de reasignacion prioritaria, al contrario que `asignarBodegaLote` (101/R5).
    expect(r.despues.some((o) => o.prioridad)).toBe(true);
  });

  it("⭑ R16: una orden con `fecha_reparto` NULL se reescribe NULL, no «hoy»", async () => {
    // El estado legado de las ordenes anteriores a la 246. Si el `SET` pusiera `NOW()::date`, aqui
    // saldria una fecha — y seria un SEGUNDO ESCRITOR SILENCIOSO del dia, saltandose el rastro de
    // `orden_dia_reparto_cambio` (262).
    const dia = await conEscenario([{}], async (ctx) => {
      await ctx.crudo.orden.update({
        where: { id: ctx.ids[0] },
        data: { fechaReparto: null },
      });
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const fila = await ctx.crudo.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { fechaReparto: true, mensajeroAsignadoId: true },
      });
      return { fila, destinoId: ctx.destinoId };
    });
    expect(dia.fila.fechaReparto).toBeNull();
    expect(dia.fila.mensajeroAsignadoId).toBe(dia.destinoId);
  });

  it("R4: `ayuda_tienda` se traspasa igual que `en_reparto` (D4)", async () => {
    const r = await conEscenario([{ estatusValue: "ayuda_tienda" }], async (ctx) => {
      const aplicado = await ctx.repo.traspasarMensajeroLote(
        loteDe(ctx, ctx.ids, "ayuda_tienda"),
      );
      const fila = await ctx.crudo.orden.findUniqueOrThrow({
        where: { id: ctx.ids[0] },
        select: { mensajeroAsignadoId: true, estatusId: true },
      });
      return { aplicado, fila, destinoId: ctx.destinoId };
    });
    expect(r.aplicado.movidas).toBe(1);
    expect(r.fila.mensajeroAsignadoId).toBe(r.destinoId);
    expect(r.fila.estatusId).toBe(ESTATUS.ayuda_tienda);
  });

  /* ---------------------------------------------------------------------------------------- */
  /* 3 — el chat                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑⭑ T9.3 (R18/R19): TODAS las conversaciones pasan al destino, sin leer y con su ventana", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LAS MUTACIONES 1 y 2 (quitar el UPDATE del chat, o quitar
    // `mensajero_leido_at = NULL`). Sin el, el destino se queda con hilo vacio, ventana cerrada y
    // solo plantilla — el defecto medido que el arreglo manual del 2026-09-14 pago.
    const r = await conEscenario([{ hilos: 2 }, { hilos: 1 }], async (ctx) => {
      const aplicado = await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const hilos = await ctx.crudo.chatConversacion.findMany({
        where: { ordenId: { in: ctx.ids } },
        select: {
          mensajeroId: true,
          mensajeroLeidoAt: true,
          ultimoEntranteAt: true,
          telefonoE164: true,
        },
      });
      return { aplicado, hilos, destinoId: ctx.destinoId, origenId: ctx.origenId };
    });

    // Tres hilos para dos ordenes: el unico es `(orden_id, telefono_e164)`, asi que una orden puede
    // tener mas de uno. La cifra viaja al resultado para que R36 pueda decirla.
    expect(r.hilos).toHaveLength(3);
    expect(r.aplicado.conversaciones).toBe(3);

    for (const hilo of r.hilos) {
      // R18: el hilo es del DESTINO, y el origen deja de verlo en su panel.
      expect(hilo.mensajeroId).toBe(r.destinoId);
      expect(hilo.mensajeroId).not.toBe(r.origenId);
      // R19: SIN LEER para el destino. Conservar la marca del origen le diria «0 sin leer» sobre
      // mensajes que el no ha visto nunca.
      expect(hilo.mensajeroLeidoAt).toBeNull();
      // ⭑ Y la VENTANA DE 24 H INTACTA: `ultimo_entrante_at` es del hilo y del cliente, no del
      // mensajero. Sin ella el destino solo podria mandar plantilla.
      expect(hilo.ultimoEntranteAt).toEqual(ULTIMO_ENTRANTE);
    }
  });

  it("R18: los hilos de OTRAS ordenes no se tocan", async () => {
    // El `WHERE` va por `orden_id IN`, no por mensajero: un hilo de una orden ajena al lote —aunque
    // sea del mismo mensajero— se queda donde estaba.
    const r = await conEscenario([{}, {}], async (ctx) => {
      const [movida, quieta] = ctx.ids;
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, [movida]));
      const hilos = await ctx.crudo.chatConversacion.findMany({
        where: { ordenId: { in: [movida, quieta] } },
        select: { ordenId: true, mensajeroId: true, mensajeroLeidoAt: true },
      });
      return { hilos, movida, quieta, origenId: ctx.origenId, destinoId: ctx.destinoId };
    });
    const dela = (id: string) => r.hilos.find((h) => h.ordenId === id)!;
    expect(dela(r.movida).mensajeroId).toBe(r.destinoId);
    expect(dela(r.quieta).mensajeroId).toBe(r.origenId);
    expect(dela(r.quieta).mensajeroLeidoAt).toEqual(LEIDO_POR_ORIGEN);
  });

  /* ---------------------------------------------------------------------------------------- */
  /* 4, 5, 6 — lo que NO se toca                                                                */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑⭑ T9.4 (R20): las gestiones ya registradas NO cambian de dueno ni de importes", async () => {
    // El caso real: 37 entregadas que NO se tocaron. `gestion_orden.mensajero_id` es EL ACTOR que
    // registro la gestion, no el asignado. Reescribirlo haria que las entregas del origen contaran
    // como del destino, moveria el pago al mensajero, el cierre del dia y el ranking, y dejaria al
    // origen sin cierre que aprobar (design §A6).
    //
    // ⚠️ B2 del reviewer (2026-09-14): la PRIMERA version de este caso sembraba la gestion SOLO en
    // la orden `entregada`, que NO entra en el lote. Por eso la mutacion 10 —`UPDATE gestion_orden
    // SET mensajero_id = destino WHERE orden_id IN (lote)` dentro de la tx— sobrevivio 23/23: el
    // caso no tenia ninguna gestion en la poblacion que esa sentencia toca.
    //
    // Y el caso es REAL, no de laboratorio: `gestion_orden` NO es unica por orden, una orden
    // `reprogramada` vuelve a reparto ARRASTRANDO su gestion con `cierre_id` y `pago_mensajero`, y
    // R14 admite en el lote ordenes que ya agotaron intentos —o sea, que ya tienen gestiones—.
    // Reescribir el autor de ESA gestion moveria el pago y el cierre del origen al destino sin que
    // nada se pusiera rojo. Por eso se siembran las DOS: la de la orden del lote (con cierre e
    // importes) y la de la entregada fuera del lote.
    const r = await conEscenario([{}, { estatusValue: "entregado" }], async (ctx) => {
      const [enReparto, entregada] = ctx.ids;

      // El cierre del dia anterior del ORIGEN, ya aprobado, que contiene la gestion previa.
      const cierre = await ctx.crudo.cierreDia.create({
        data: {
          mensajeroId: ctx.origenId,
          estado: "aprobado",
          destinoTipo: "bodega_central",
          destinoZonaId: FKS.zonaId,
          totalPagoMensajero: "800.00",
        },
        select: { id: true },
      });
      // ⭑ LA GESTION PREVIA DEL ORIGEN SOBRE UNA ORDEN **DEL LOTE**: la reprogramo ayer, su cierre
      // se aprobo y se le pago; hoy la orden volvio a `en_reparto` y es la que se traspasa.
      const gestionDelLote = await ctx.crudo.gestionOrden.create({
        data: {
          ordenId: enReparto,
          mensajeroId: ctx.origenId,
          resultado: "reprogramado",
          motivo: "el cliente pidio recibirla otro dia",
          cierreId: cierre.id,
          pagoMensajero: "800.00",
        },
        select: { id: true },
      });
      // La de la orden `entregada`, que NO entra en el lote (las 37 entregadas del caso real).
      const gestionFuera = await ctx.crudo.gestionOrden.create({
        data: {
          ordenId: entregada,
          mensajeroId: ctx.origenId,
          resultado: "entregado",
          montoRecibido: "15000.00",
          pagoMensajero: "1200.00",
        },
        select: { id: true },
      });

      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, [enReparto]));

      const columnas = {
        mensajeroId: true,
        cierreId: true,
        montoRecibido: true,
        pagoMensajero: true,
        ingresoBodegaRechazo: true,
        resultado: true,
        ordenId: true,
      } as const;
      const despuesDelLote = await ctx.crudo.gestionOrden.findUniqueOrThrow({
        where: { id: gestionDelLote.id },
        select: columnas,
      });
      const despuesFuera = await ctx.crudo.gestionOrden.findUniqueOrThrow({
        where: { id: gestionFuera.id },
        select: columnas,
      });
      const cierreDespues = await ctx.crudo.cierreDia.findUniqueOrThrow({
        where: { id: cierre.id },
        select: { mensajeroId: true, totalPagoMensajero: true, estado: true },
      });
      // La orden del lote SI cambio de dueno: sin esto, el caso pasaria aunque no se traspasara nada.
      const ordenDelLote = await ctx.crudo.orden.findUniqueOrThrow({
        where: { id: enReparto },
        select: { mensajeroAsignadoId: true },
      });
      // Y la orden `entregada`, que NO estaba en el lote, sigue siendo del origen.
      const ordenEntregada = await ctx.crudo.orden.findUniqueOrThrow({
        where: { id: entregada },
        select: { mensajeroAsignadoId: true },
      });
      return {
        cierreId: cierre.id,
        despuesDelLote,
        despuesFuera,
        cierreDespues,
        ordenDelLote,
        ordenEntregada,
        origenId: ctx.origenId,
        destinoId: ctx.destinoId,
        enReparto,
      };
    });

    // Anti-vacuidad: la orden de esa gestion SI se traspaso.
    expect(r.ordenDelLote.mensajeroAsignadoId).toBe(r.destinoId);

    // ⭑⭑ R20 SOBRE UNA ORDEN DEL LOTE: la gestion previa conserva AUTOR, CIERRE e IMPORTES.
    expect(r.despuesDelLote.ordenId).toBe(r.enReparto);
    expect(r.despuesDelLote.mensajeroId).toBe(r.origenId);
    expect(r.despuesDelLote.cierreId).toBe(r.cierreId);
    expect(r.despuesDelLote.pagoMensajero?.toString()).toBe("800");
    expect(r.despuesDelLote.montoRecibido).toBeNull();
    expect(r.despuesDelLote.ingresoBodegaRechazo).toBeNull();
    expect(r.despuesDelLote.resultado).toBe("reprogramado");
    // Y el cierre que la contiene sigue siendo del origen, con el mismo total.
    expect(r.cierreDespues.mensajeroId).toBe(r.origenId);
    expect(r.cierreDespues.totalPagoMensajero.toString()).toBe("800");
    expect(r.cierreDespues.estado).toBe("aprobado");

    // Y la de la orden FUERA del lote, igual que antes.
    expect(r.despuesFuera.mensajeroId).toBe(r.origenId);
    expect(r.despuesFuera.cierreId).toBeNull();
    expect(r.despuesFuera.montoRecibido?.toString()).toBe("15000");
    expect(r.despuesFuera.pagoMensajero?.toString()).toBe("1200");
    expect(r.ordenEntregada.mensajeroAsignadoId).toBe(r.origenId);
  });

  it("⭑ T9.5 (R21): CERO filas nuevas en `orden_historial_estado` para esas ordenes", async () => {
    // Un traspaso NO cambia el estado. Escribirlo como `en_reparto -> en_reparto` ni siquiera seria
    // posible: el choke point valida contra el inventario de la 140 y reventaria. Y ademas
    // mentiria a los integradores por el webhook de estado (99/R10).
    const n = await conEscenario([{}, {}], async (ctx) => {
      const antes = await ctx.crudo.ordenHistorialEstado.count({
        where: { ordenId: { in: ctx.ids } },
      });
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const despues = await ctx.crudo.ordenHistorialEstado.count({
        where: { ordenId: { in: ctx.ids } },
      });
      return { antes, despues };
    });
    expect(n.despues).toBe(n.antes);
  });

  it("⭑ T9.6 (R22): las marcas privadas del ORIGEN sobre esas ordenes quedan intactas", async () => {
    // «Gestionar mas tarde» es del mensajero que la puso. Borrarlas o moverlas seria decidir por el.
    const r = await conEscenario([{}], async (ctx) => {
      await ctx.crudo.ordenMensajeroMeta.create({
        data: { usuarioId: ctx.origenId, ordenId: ctx.ids[0], marcarLuego: true },
      });
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const metas = await ctx.crudo.ordenMensajeroMeta.findMany({
        where: { ordenId: ctx.ids[0] },
        select: { usuarioId: true, marcarLuego: true },
      });
      return { metas, origenId: ctx.origenId };
    });
    expect(r.metas).toHaveLength(1);
    expect(r.metas[0].usuarioId).toBe(r.origenId);
    expect(r.metas[0].marcarLuego).toBe(true);
  });

  /* ---------------------------------------------------------------------------------------- */
  /* 7 y 8 — el rastro                                                                          */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑⭑ T9.7 (R25/R27): UNA fila por orden, con los cinco datos y UN SOLO `lote_id`", async () => {
    const r = await conEscenario([{}, {}, {}], async (ctx) => {
      const input = loteDe(ctx, ctx.ids);
      const antes = new Date();
      const aplicado = await ctx.repo.traspasarMensajeroLote(input);
      const filas = await ctx.crudo.ordenTraspasoMensajero.findMany({
        where: { ordenId: { in: ctx.ids } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return { filas, aplicado, input, antes, ctx: { ...ctx, repo: undefined, tx: undefined } };
    });

    // Una por orden movida, ni una mas.
    expect(r.filas).toHaveLength(3);
    for (const fila of r.filas) {
      expect(fila.mensajeroAnteriorId).toBe(r.ctx.origenId); // desde quien
      expect(fila.mensajeroNuevoId).toBe(r.ctx.destinoId); // hacia quien
      expect(fila.actorUsuarioId).toBe(r.ctx.actorId); // quien la traspaso
      expect(fila.actorRol).toBe("maestro"); // con que rol (CONGELADO)
      expect(fila.motivo).toBe(MOTIVO); // con que motivo
      expect(fila.createdAt.getTime()).toBeGreaterThan(0); // y en que instante
    }
    // ⭑ R27: UN SOLO `lote_id`, y es el que el llamante paso. Es lo que distingue «se traspasaron
    // 3 ordenes de una vez» de «hubo 3 traspasos».
    expect(new Set(r.filas.map((f) => f.loteId)).size).toBe(1);
    expect(r.filas[0].loteId).toBe(r.input.loteId);
    expect(r.aplicado.loteId).toBe(r.input.loteId);
  });

  it("⭑⭑ T9.8 (R26): el rol del actor queda CONGELADO, aunque despues cambie el rol vivo", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 6 (escribir el rol VIVO en vez del congelado). Si la
    // fila resolviera el rol por join al leer, aqui saldria `mensajero` — y la historia quedaria
    // RE-ETIQUETADA. Precedente: `orden_nota.rol_autor`, `historial_accion.actor_rol`.
    const r = await conEscenario([{}], async (ctx) => {
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      // El actor CAMBIA DE ROL despues del traspaso (la 362 registra ese mismo evento).
      await ctx.crudo.usuario.update({
        where: { id: ctx.actorId },
        data: { rolId: ROL_MENSAJERO },
      });
      const fila = await ctx.crudo.ordenTraspasoMensajero.findFirstOrThrow({
        where: { ordenId: ctx.ids[0] },
        select: { actorRol: true, actor: { select: { rol: { select: { value: true } } } } },
      });
      return fila;
    });

    // La fila sigue diciendo el rol DE ENTONCES...
    expect(r.actorRol).toBe("maestro");
    // ...mientras el rol VIVO de esa persona ya es otro. Las dos cosas a la vez son la prueba.
    expect(r.actor.rol.value).toBe("mensajero");
  });

  it("⭑⭑ T9.8 (R26, segunda mitad): la fila guarda EL ROL DEL ACTO, no el que la base dice ahora", async () => {
    // ⚠️ LA OTRA MITAD DE LA MUTACION 6. El caso de arriba mata a un LECTOR que resuelva el rol por
    // join; este mata a un ESCRITOR que lo busque en la base en vez de persistir el que el acto
    // trae. Se le pasa al repositorio un rol DISTINTO del que la fila de `usuario` tiene en ese
    // instante: la fila de rastro tiene que decir EL QUE SE LE PASO.
    const r = await conEscenario([{}], async (ctx) => {
      // El actor es `maestro` en la base...
      const vivoAntes = await ctx.crudo.usuario.findUniqueOrThrow({
        where: { id: ctx.actorId },
        select: { rol: { select: { value: true } } },
      });
      // ...y el acto se ejecuta declarando `admin` (el rol CONGELADO que viaja desde la sesion).
      await ctx.repo.traspasarMensajeroLote({
        ...loteDe(ctx, ctx.ids),
        actor: { usuarioId: ctx.actorId, rol: "admin" as const },
      });
      const fila = await ctx.crudo.ordenTraspasoMensajero.findFirstOrThrow({
        where: { ordenId: ctx.ids[0] },
        select: { actorRol: true },
      });
      return { vivoAntes: vivoAntes.rol.value, fila };
    });

    expect(r.vivoAntes).toBe("maestro");
    // Con un escritor que buscara el rol en la base, aqui saldria `maestro` y esto se pondria rojo.
    expect(r.fila.actorRol).toBe("admin");
  });

  it("R30: un SEGUNDO traspaso ANADE una fila y no altera la primera (append-only)", async () => {
    const r = await conEscenario([{}], async (ctx) => {
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const primera = await ctx.crudo.ordenTraspasoMensajero.findFirstOrThrow({
        where: { ordenId: ctx.ids[0] },
      });
      // Segundo acto: del destino al tercero.
      await ctx.repo.traspasarMensajeroLote({
        loteId: randomUUID(),
        mensajeroOrigenId: ctx.destinoId,
        mensajeroDestinoId: ctx.terceroId,
        ordenes: [{ ordenId: ctx.ids[0], estatusIdEsperado: ESTATUS.en_reparto }],
        actor: { usuarioId: ctx.actorId, rol: "maestro" as const },
        motivo: "el segundo traspaso del dia, con otro motivo distinto",
      });
      const todas = await ctx.crudo.ordenTraspasoMensajero.findMany({
        where: { ordenId: ctx.ids[0] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      return { primera, todas, ctx: { ...ctx, repo: undefined, tx: undefined } };
    });

    expect(r.todas).toHaveLength(2);
    // La primera fila sigue EXACTAMENTE igual: nada se edita.
    expect(r.todas.find((f) => f.id === r.primera.id)).toEqual(r.primera);
    // Y la segunda cuenta el otro tramo, con su propio lote.
    const segunda = r.todas.find((f) => f.id !== r.primera.id)!;
    expect(segunda.mensajeroAnteriorId).toBe(r.ctx.destinoId);
    expect(segunda.mensajeroNuevoId).toBe(r.ctx.terceroId);
    expect(segunda.loteId).not.toBe(r.primera.loteId);
  });

  /* ---------------------------------------------------------------------------------------- */
  /* 9 — la ruta de los DOS                                                                     */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑⭑ T9.9 (R32): DOS jobs `optimizacion_ruta`, uno por mensajero", async () => {
    // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 8 (encolar solo el destino). Al ORIGEN le acaban de
    // QUITAR paradas: su ruta optimizada se queda con huecos hasta que su job corra. Encolar solo
    // uno es un fallo mudo — la ruta del otro sigue pintando un recorrido que ya no existe.
    const r = await conEscenario([{}, {}], async (ctx) => {
      const antes = await ctx.crudo.job.count({ where: { tipo: "optimizacion_ruta" } });
      await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const jobs = await ctx.crudo.job.findMany({
        where: { tipo: "optimizacion_ruta" },
        select: { payload: true, dedupeKey: true, runAfter: true },
      });
      return { antes, jobs, origenId: ctx.origenId, destinoId: ctx.destinoId };
    });

    const nuevos = r.jobs.filter((j) =>
      [r.origenId, r.destinoId].includes((j.payload as { mensajeroId?: string }).mensajeroId ?? ""),
    );
    // DOS, uno por mensajero. Las claves de debounce son POR MENSAJERO, asi que no colisionan.
    expect(nuevos).toHaveLength(2);
    const mensajeros = nuevos.map((j) => (j.payload as { mensajeroId: string }).mensajeroId).sort();
    expect(mensajeros).toEqual([r.origenId, r.destinoId].sort());
    expect(new Set(nuevos.map((j) => j.dedupeKey)).size).toBe(2);
    for (const job of nuevos) {
      expect(job.dedupeKey).toMatch(/^optimizacion_ruta:.+:debounce:\d+$/);
      // Patron OUTBOX + debounce de la 92: el job corre DESPUES, no ahora.
      expect(job.runAfter.getTime()).toBeGreaterThan(AHORA.getTime());
    }
    // Y el payload lleva SOLO el mensajero: ni coordenadas ni direcciones (regla de PII de la 91).
    for (const job of nuevos) {
      expect(Object.keys(job.payload as object)).toEqual(["mensajeroId"]);
    }
  });

  /* ---------------------------------------------------------------------------------------- */
  /* 10 — todo-o-nada                                                                           */
  /* ---------------------------------------------------------------------------------------- */

  describe("⭑⭑ T9.10 (R5/R23/R24/R31) — TODO-O-NADA: si una falla, no se mueve NINGUNA", () => {
    async function esperarConflicto(
      semillas: SemillaOrden[],
      conIds: (ctx: Contexto) => string[],
      estatusEsperado?: string,
    ) {
      return conEscenario(semillas, async (ctx) => {
        const ids = conIds(ctx);
        const antesOrdenes = await ctx.crudo.orden.findMany({
          where: { id: { in: ctx.ids } },
          select: { id: true, mensajeroAsignadoId: true, asignadoAt: true },
          orderBy: { id: "asc" },
        });
        const jobsAntes = await ctx.crudo.job.count({ where: { tipo: "optimizacion_ruta" } });

        let error: unknown = null;
        try {
          await ctx.repo.traspasarMensajeroLote({
            ...loteDe(ctx, ids, estatusEsperado ?? "en_reparto"),
          });
        } catch (e) {
          error = e;
        }

        const despuesOrdenes = await ctx.crudo.orden.findMany({
          where: { id: { in: ctx.ids } },
          select: { id: true, mensajeroAsignadoId: true, asignadoAt: true },
          orderBy: { id: "asc" },
        });
        const hilos = await ctx.crudo.chatConversacion.findMany({
          where: { ordenId: { in: ctx.ids } },
          select: { mensajeroId: true, mensajeroLeidoAt: true },
        });
        const rastro = await ctx.crudo.ordenTraspasoMensajero.count({
          where: { ordenId: { in: ctx.ids } },
        });
        const jobsDespues = await ctx.crudo.job.count({ where: { tipo: "optimizacion_ruta" } });

        return {
          error,
          antesOrdenes,
          despuesOrdenes,
          hilos,
          rastro,
          jobsAntes,
          jobsDespues,
          origenId: ctx.origenId,
        };
      });
    }

    it("⭑ una orden ENTREGADA en el lote: ni ella ni las buenas se mueven", async () => {
      const r = await esperarConflicto(
        [{}, { estatusValue: "entregado" }],
        (ctx) => ctx.ids,
      );
      expect(r.error).toBeInstanceOf(TraspasoMensajeroConflictoError);
      expect(r.despuesOrdenes).toEqual(r.antesOrdenes);
      expect(r.rastro).toBe(0);
      expect(r.jobsDespues).toBe(r.jobsAntes);
      for (const hilo of r.hilos) {
        expect(hilo.mensajeroId).toBe(r.origenId);
        expect(hilo.mensajeroLeidoAt).toEqual(LEIDO_POR_ORIGEN);
      }
    });

    it("⭑⭑ una orden DE OTRO MENSAJERO en el lote: no se mueve ninguna", async () => {
      // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 3 (quitar
      // `AND "mensajero_asignado_id" = ${origenId}` del `WHERE`). La orden del tercero esta
      // `en_reparto` y su `estatus_id` coincide con el esperado, asi que la PRE-LECTURA la da por
      // buena: lo unico que la para es esa clausula del `UPDATE`. Sin ella, el traspaso le robaria
      // la orden a un tercero que no tiene nada que ver.
      const r = await esperarConflicto([{}, { duenio: "tercero" }], (ctx) => ctx.ids);
      expect(r.error).toBeInstanceOf(TraspasoMensajeroConflictoError);
      expect(r.despuesOrdenes).toEqual(r.antesOrdenes);
      expect(r.rastro).toBe(0);
      expect(r.jobsDespues).toBe(r.jobsAntes);
    });

    it("⭑ una orden BORRADA en el lote: no se mueve ninguna", async () => {
      const r = await esperarConflicto([{}, { borrada: true }], (ctx) => ctx.ids);
      expect(r.error).toBeInstanceOf(TraspasoMensajeroConflictoError);
      expect(r.despuesOrdenes).toEqual(r.antesOrdenes);
      expect(r.rastro).toBe(0);
    });

    it("⭑ un id que NO EXISTE en el lote: no se mueve ninguna", async () => {
      const r = await conEscenario([{}], async (ctx) => {
        const inventado = randomUUID();
        let error: unknown = null;
        try {
          await ctx.repo.traspasarMensajeroLote(loteDe(ctx, [...ctx.ids, inventado]));
        } catch (e) {
          error = e;
        }
        const fila = await ctx.crudo.orden.findUniqueOrThrow({
          where: { id: ctx.ids[0] },
          select: { mensajeroAsignadoId: true },
        });
        const rastro = await ctx.crudo.ordenTraspasoMensajero.count({
          where: { ordenId: { in: ctx.ids } },
        });
        return { error, fila, rastro, origenId: ctx.origenId };
      });
      expect(r.error).toBeInstanceOf(TraspasoMensajeroConflictoError);
      expect(r.fila.mensajeroAsignadoId).toBe(r.origenId);
      expect(r.rastro).toBe(0);
    });

    it("⭑⭑ R31: si el RASTRO no se puede escribir, NINGUNA orden queda movida", async () => {
      // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 7 (sacar `registrarTraspasoMensajero` de la
      // transaccion). Con el rastro DENTRO, su fallo revierte el movimiento y el chat; fuera, las
      // ordenes se quedarian movidas SIN rastro — y ese es exactamente el estado del que la ficha
      // viene a sacar al sistema.
      const r = await conEscenario(
        [{}, {}],
        async (ctx) => {
          let error: unknown = null;
          try {
            await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
          } catch (e) {
            error = e;
          }
          const ordenes = await ctx.crudo.orden.findMany({
            where: { id: { in: ctx.ids } },
            select: { mensajeroAsignadoId: true, asignadoAt: true },
          });
          const hilos = await ctx.crudo.chatConversacion.findMany({
            where: { ordenId: { in: ctx.ids } },
            select: { mensajeroId: true, mensajeroLeidoAt: true },
          });
          const jobs = await ctx.crudo.job.count({ where: { tipo: "optimizacion_ruta" } });
          return { error, ordenes, hilos, jobs, origenId: ctx.origenId };
        },
        { romperRastro: "tx" },
      );

      expect((r.error as Error).name).toBe("RastroCaido");
      for (const orden of r.ordenes) {
        expect(orden.mensajeroAsignadoId).toBe(r.origenId);
        expect(orden.asignadoAt).toEqual(ASIGNADO_AT_VIEJO);
      }
      // ⭑ Y EL CHAT TAMBIEN REVIERTE: va en la misma transaccion.
      for (const hilo of r.hilos) {
        expect(hilo.mensajeroId).toBe(r.origenId);
        expect(hilo.mensajeroLeidoAt).toEqual(LEIDO_POR_ORIGEN);
      }
    });

    it("⭑⭑ R23/R31 (mutaciones 7 y 9): el rastro, el chat y los jobs van por el `tx`, NO por el cliente del repositorio", async () => {
      // ⚠️ ESTE ES EL CASO QUE MATA LA MUTACION 7, y esta escrito asi porque la primera version del
      // arnes NO la mataba: el `$transaction` del doble entregaba EL MISMO objeto que
      // `this.prisma`, asi que `registrarTraspasoMensajero(tx, ...)` y
      // `registrarTraspasoMensajero(this.prisma, ...)` eran indistinguibles y la mutacion salio
      // VIVA con 22 tests en verde. Medido el 2026-09-14.
      //
      // Aqui los dos clientes son OBJETOS DISTINTOS y el EXTERNO revienta al tocar la tabla del
      // rastro. Si el repositorio escribiera con `this.prisma`, saltaria `RastroCaido`.
      //
      // Por que importa fuera del test: un rastro escrito FUERA de la transaccion del movimiento
      // rompe R31 en las dos direcciones —una orden movida sin rastro, o un rastro de algo que se
      // revirtio— y es el estado exacto del que esta ficha viene a sacar al sistema.
      //
      // ⚠️ M1 (2026-09-14): la PRIMERA version de este caso solo vigilaba el RASTRO, y la mutacion 9
      // del reviewer —`traspasarConversaciones(this.prisma, …)`— sobrevivio 23/23. Ahora el externo
      // lanza ante CUALQUIER escritura mientras dura el acto (ver `clienteDelRepo`), asi que las tres
      // escrituras que R23 ata al movimiento —rastro, chat y jobs— quedan medidas a la vez. Y se
      // afirma el EFECTO de las tres, para que el caso no pase por no haber escrito nada.
      const r = await conEscenario(
        [{}, {}],
        async (ctx) => {
          const aplicado = await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
          const rastro = await ctx.crudo.ordenTraspasoMensajero.count({
            where: { ordenId: { in: ctx.ids } },
          });
          const ordenes = await ctx.crudo.orden.count({
            where: { id: { in: ctx.ids }, mensajeroAsignadoId: ctx.destinoId },
          });
          const hilos = await ctx.crudo.chatConversacion.count({
            where: { ordenId: { in: ctx.ids }, mensajeroId: ctx.destinoId },
          });
          const jobs = await ctx.crudo.job.findMany({
            where: { tipo: "optimizacion_ruta" },
            select: { payload: true },
          });
          const jobsDelActo = jobs.filter((j) =>
            [ctx.origenId, ctx.destinoId].includes(
              (j.payload as { mensajeroId?: string }).mensajeroId ?? "",
            ),
          ).length;
          return { aplicado, rastro, ordenes, hilos, jobsDelActo };
        },
        { romperRastro: "fuera" },
      );

      expect(r.aplicado.movidas).toBe(2);
      expect(r.ordenes).toBe(2);
      expect(r.rastro).toBe(2); // mutacion 7
      expect(r.hilos).toBe(2); // mutacion 9
      expect(r.aplicado.conversaciones).toBe(2);
      expect(r.jobsDelActo).toBe(2); // y el encolado, que tenia el mismo hueco
    });

    it("CONTROL de M1: el cliente estricto SI lanza si alguien escribe por el externo dentro del acto", async () => {
      // Anti-vacuidad del caso de arriba. Sin esto, un `clienteDelRepo` que no vigilara nada lo
      // dejaria en verde. Se abre el `$transaction` del EXTERNO y, desde dentro, se escribe POR EL
      // EXTERNO: tiene que saltar `EscrituraFueraDeLaTransaccion`, y por las dos vias (SQL crudo y
      // delegado de modelo). Y FUERA del acto el mismo cliente sigue escribiendo con normalidad.
      const r = await enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const externo = clienteDelRepo(tx, "fuera");
        const errores: string[] = [];
        await externo.$transaction(async () => {
          try {
            await externo.$executeRawUnsafe(`SELECT 1`);
          } catch (e) {
            errores.push((e as Error).name);
          }
          try {
            await externo.chatConversacion.updateMany({ where: { id: "nada" }, data: {} });
          } catch (e) {
            errores.push((e as Error).name);
          }
        });
        const fueraDelActo = await externo.chatConversacion.updateMany({
          where: { id: "nada" },
          data: {},
        });
        return { errores, fueraDelActo: fueraDelActo.count };
      });
      expect(r.errores).toEqual(["EscrituraFueraDeLaTransaccion", "EscrituraFueraDeLaTransaccion"]);
      expect(r.fueraDelActo).toBe(0);
    });

    it("CONTROL: el mismo escenario SIN romper el rastro SI mueve (anti-vacuidad)", async () => {
      // Sin este control, el caso anterior pasaria aunque el repositorio no moviera nunca nada.
      const r = await conEscenario([{}, {}], async (ctx) => {
        await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
        const ordenes = await ctx.crudo.orden.findMany({
          where: { id: { in: ctx.ids } },
          select: { mensajeroAsignadoId: true },
        });
        const rastro = await ctx.crudo.ordenTraspasoMensajero.count({
          where: { ordenId: { in: ctx.ids } },
        });
        return { ordenes, rastro, destinoId: ctx.destinoId };
      });
      expect(r.ordenes.every((o) => o.mensajeroAsignadoId === r.destinoId)).toBe(true);
      expect(r.rastro).toBe(2);
    });
  });

  /* ---------------------------------------------------------------------------------------- */
  /* 11 — la carrera                                                                            */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑⭑ T9.11 (R24): si el estatus cambio tras la validacion, el lote revierte ENTERO", async () => {
    // LA CARRERA, ejercitada: el servicio leyo `en_reparto` y valido; antes de que la transaccion
    // tome el bloqueo, el mensajero entrego la orden. El repositorio compara la fila bloqueada
    // contra el `estatusIdEsperado` que el servicio le paso y aborta el lote COMPLETO.
    //
    // Sin ese campo, el repositorio guardaria contra lo que acaba de leer —una guarda que siempre se
    // cumple— y moveria una orden ENTREGADA.
    const r = await conEscenario([{}, {}], async (ctx) => {
      // La segunda se entrega DESPUES de la validacion del servicio (aqui, antes de llamar al repo).
      await ctx.crudo.orden.update({
        where: { id: ctx.ids[1] },
        data: { estatusId: ESTATUS.entregado },
      });

      let error: unknown = null;
      try {
        // El lote sigue diciendo «esperaba `en_reparto`», que es lo que el servicio valido.
        await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      } catch (e) {
        error = e;
      }

      const ordenes = await ctx.crudo.orden.findMany({
        where: { id: { in: ctx.ids } },
        select: { id: true, mensajeroAsignadoId: true },
        orderBy: { id: "asc" },
      });
      const rastro = await ctx.crudo.ordenTraspasoMensajero.count({
        where: { ordenId: { in: ctx.ids } },
      });
      return { error, ordenes, rastro, origenId: ctx.origenId, perdedora: ctx.ids[1] };
    });

    expect(r.error).toBeInstanceOf(TraspasoMensajeroConflictoError);
    // Y el error NOMBRA a la perdedora, para que el servicio pueda componer el detalle por orden.
    expect((r.error as TraspasoMensajeroConflictoError).ordenIdsNoMovidas).toEqual([r.perdedora]);
    // NINGUNA se movio: ni la que seguia valida.
    for (const orden of r.ordenes) expect(orden.mensajeroAsignadoId).toBe(r.origenId);
    expect(r.rastro).toBe(0);
  });

  /* ---------------------------------------------------------------------------------------- */
  /* El caso real, con su numero                                                                */
  /* ---------------------------------------------------------------------------------------- */

  it("⭑⭑ EL CASO REAL: 31 ordenes y 31 conversaciones, en una sola operacion", async () => {
    // Los numeros del 2026-09-14, medidos en produccion. Con 31 ordenes cabe en UNA pagina del
    // listado (50), que es el limite aceptado por el humano (D5).
    const semillas: SemillaOrden[] = Array.from({ length: 31 }, () => ({}));
    const r = await conEscenario(semillas, async (ctx) => {
      const aplicado = await ctx.repo.traspasarMensajeroLote(loteDe(ctx, ctx.ids));
      const movidas = await ctx.crudo.orden.count({
        where: { id: { in: ctx.ids }, mensajeroAsignadoId: ctx.destinoId },
      });
      const hilos = await ctx.crudo.chatConversacion.count({
        where: { ordenId: { in: ctx.ids }, mensajeroId: ctx.destinoId, mensajeroLeidoAt: null },
      });
      const rastro = await ctx.crudo.ordenTraspasoMensajero.findMany({
        where: { ordenId: { in: ctx.ids } },
        select: { loteId: true },
      });
      return { aplicado, movidas, hilos, rastro };
    });

    expect(r.aplicado.movidas).toBe(31);
    expect(r.aplicado.conversaciones).toBe(31);
    expect(r.movidas).toBe(31);
    expect(r.hilos).toBe(31);
    // 31 filas de rastro y UN SOLO acto.
    expect(r.rastro).toHaveLength(31);
    expect(new Set(r.rastro.map((f) => f.loteId)).size).toBe(1);
  });

  it("R7 en la base: el CHECK rechaza un traspaso a la MISMA persona", async () => {
    // Defensa en profundidad: el servicio ya lo rechaza. Aqui se mide que la BASE tampoco lo admite,
    // ni siquiera llamando al repositorio directamente.
    const error = await conEscenario([{}], async (ctx) => {
      try {
        await ctx.repo.traspasarMensajeroLote({
          ...loteDe(ctx, ctx.ids),
          mensajeroDestinoId: ctx.origenId,
        });
        return null;
      } catch (e) {
        return e;
      }
    });
    expect(error).toBeInstanceOf(TraspasoMensajeroConflictoError);
  });
});
