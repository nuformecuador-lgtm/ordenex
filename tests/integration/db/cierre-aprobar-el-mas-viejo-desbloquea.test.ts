import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
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
 * FEATURE 271 (T5.4, R36/R12) — **APROBAR EL MAS VIEJO DEVUELVE AL MENSAJERO A LIBRE**, MEDIDO
 * CONTRA POSTGRES.
 *
 * ES LA FILA QUE CIERRA LA TABLA DE VERDAD POR EL LADO DEL DESBLOQUEO. `cierre-bloqueo-nv-sql-real`
 * recorre las siete filas SEMBRANDO cada estado; lo que aqui se mide es distinto y es lo que el
 * mensajero vive: se parte del caso 4 (`N=2, V=0`, bloqueado), un administrador APRUEBA de verdad
 * —por el mismo `resolverCierre` que corre en produccion— el cierre que la propia app señala como
 * «el que toca resolver primero», y la consulta SIGUIENTE tiene que decir LIBRE.
 *
 * POR QUE NO BASTA CON QUE R1-R8 ESTEN PROBADOS. El veredicto se RECALCULA en cada consulta porque
 * no hay ninguna bandera persistida (R12), y esa propiedad solo es observable cruzando una
 * ESCRITURA real (la aprobacion) con una LECTURA posterior. Un test que siembre directamente el
 * estado `aprobado` demuestra que el conteo sabe contar; no demuestra que aprobar desbloquee.
 *
 * «SIN NINGUNA ESCRITURA ADICIONAL» NO SE AFIRMA DE PALABRA: la segunda consulta corre contra un
 * cliente ENVUELTO que revienta si alguien intenta escribir (`soloLectura`). Si algun dia alguien
 * «arregla» esto persistiendo una bandera de bloqueo al leer, este test se pone rojo — que es
 * exactamente lo que R12 pide.
 *
 * CONTRAPRUEBA APLICADA (2026-08-23): metiendo `aprobado` en el `estado: { in: … }` de
 * `OrdenRepository.contarCierresAbiertosPorMensajero`, este archivo se pone ROJO — el cierre
 * aprobado sigue contando, N se queda en 2 y el mensajero nunca se desbloquea.
 *
 * SIN BASE ALCANZABLE se SALTA (`describe.skip`), NO pasa en verde.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const ALCANCE_TOTAL: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };

/** Los dos instantes: el cierre de ayer y el de hoy. El MAS VIEJO es el primero. */
const AYER_18H = new Date("2026-08-21T18:00:00.000Z");
const HOY_18H = new Date("2026-08-22T18:00:00.000Z");

/**
 * Dobles NO-OP de los cuatro libros de dinero, igual que en `cierre-aprobacion-libera-solo-lo-suyo`:
 * aqui se mide un VEREDICTO, no la caja, y cada libro tiene sus propios tests de idempotencia.
 */
function dineroNoOp() {
  return [
    { crearMovimientos: vi.fn(async () => 0) },
    { construirMovimientosDeIngreso: vi.fn(async () => []) },
    { crearMovimientos: vi.fn(async () => 0) },
    { construirMovimientosPorTienda: vi.fn(async () => []) },
    { crearMovimientos: vi.fn(async () => 0) },
    { construirMovimientosDePago: vi.fn(async () => ({ libro: [], egresoCaja: [] })) },
    { construirEgresoIndemnizacion: vi.fn(async () => []) },
  ] as const;
}

/** Los metodos de Prisma que ESCRIBEN. Ninguno puede sonar durante la consulta del veredicto. */
const METODOS_QUE_ESCRIBEN = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "executeRaw",
]);

/**
 * Envuelve el cliente para que CUALQUIER escritura lance. Es la forma literal de afirmar «sin
 * ninguna escritura adicional» (R12): no se cuenta nada ni se compara un `updated_at`, se prohibe.
 */
function soloLectura(cliente: object): PrismaClient {
  const envolverDelegado = (delegado: object) =>
    new Proxy(delegado, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && METODOS_QUE_ESCRIBEN.has(prop)) {
          return () => {
            throw new Error(`R12 roto: la consulta del veredicto llamo a .${prop}()`);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  return new Proxy(cliente, {
    get(target, prop, receiver) {
      const valor = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && prop.startsWith("$execute")) {
        return () => {
          throw new Error(`R12 roto: la consulta del veredicto llamo a ${prop}`);
        };
      }
      if (typeof prop === "string" && !prop.startsWith("$") && typeof valor === "object" && valor !== null) {
        return envolverDelegado(valor as object);
      }
      return valor;
    },
  }) as unknown as PrismaClient;
}

describeSiHayBase("271/T5.4 · R36 — aprobar el mas viejo devuelve al mensajero a LIBRE", () => {
  let prisma: PrismaClient;
  let fks: NonNullable<Awaited<ReturnType<typeof fksDeOrden>>>;
  let mensajeroId: string;
  let adminId: string;

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
    const usuarios = await prisma.usuario.findMany({ select: { id: true }, take: 10 });
    if (usuarios.length < 2) throw new Error("hacen falta al menos DOS usuarios en la base.");
    // El mensajero del caso tiene que partir de CERO cierres abiertos: si arrastrara uno de la
    // base compartida, N valdria 3 y el caso medido no seria el 4 de la tabla de verdad. Se busca
    // uno limpio y, si no lo hay, se falla RUIDOSAMENTE (nunca un `return` silencioso).
    const abiertos = await prisma.cierreDia.groupBy({
      by: ["mensajeroId"],
      where: {
        mensajeroId: { in: usuarios.map((u) => u.id) },
        estado: { in: ["solicitado", "vencido", "rechazado"] },
      },
      _count: { _all: true },
    });
    const sucios = new Set(abiertos.map((a) => a.mensajeroId));
    const limpio = usuarios.find((u) => !sucios.has(u.id));
    if (limpio === undefined) {
      throw new Error(
        "todos los usuarios de la base arrastran cierres abiertos: este caso necesita uno con " +
          "N=0 para sembrar exactamente el caso 4 (N=2, V=0).",
      );
    }
    mensajeroId = limpio.id;
    adminId = (usuarios.find((u) => u.id !== mensajeroId) as { id: string }).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("R36/R12: con N=2 esta BLOQUEADO; aprobado el mas viejo, la consulta siguiente lo da LIBRE", async () => {
    const medido = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);

      const sembrarCierre = async (solicitadoAt: Date) =>
        tx.cierreDia.create({
          data: {
            mensajeroId,
            estado: "solicitado",
            destinoTipo: "bodega_central",
            destinoZonaId: fks.zonaId,
            solicitadoAt,
            createdAt: solicitadoAt,
          },
          select: { id: true },
        });

      // CASO 4 de la tabla de verdad: dos `solicitado`, ninguno re-solicitable. `N=2, V=0`.
      const viejo = await sembrarCierre(AYER_18H);
      const nuevo = await sembrarCierre(HOY_18H);

      const repoLectura = new OrdenRepository(tx as unknown as PrismaClient);
      const antesConteo = (await repoLectura.contarCierresAbiertosPorMensajero([mensajeroId])).get(
        mensajeroId,
      );
      const antesBloqueados = await repoLectura.findMensajerosBloqueadosPorCierres([mensajeroId]);
      const antesDetalle = await repoLectura.findBloqueoDetalle(mensajeroId);

      // LA APROBACION, por el camino REAL. `resolverCierre` abre su propia `$transaction` y un
      // cliente transaccional no la expone: el proxy la resuelve invocando el callback con LA
      // MISMA tx, asi que el SQL que corre es el de produccion y todo sigue dentro del rollback.
      const cliente = new Proxy(tx as object, {
        get(target, prop, receiver) {
          if (prop === "$transaction") {
            return async (fn: (t: unknown) => Promise<unknown>) => fn(target);
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as unknown as PrismaClient;
      const [wm, wf, wtm, wtf, pmm, wmf, wif] = dineroNoOp();
      const repoAdmin = new CierresAdminRepository(
        cliente,
        wm as never,
        wf as never,
        wtm as never,
        wtf as never,
        pmm as never,
        wmf as never,
        wif as never,
      );
      await repoAdmin.resolverCierre({
        // ⭑ SE APRUEBA EL QUE LA PROPIA APP SEÑALA COMO «el que toca resolver primero».
        cierreId: antesDetalle.aResolverPrimero?.cierreId ?? viejo.id,
        alcance: ALCANCE_TOTAL,
        nuevoEstado: "aprobado",
        resueltoPor: adminId,
        anclajeDevolucion: undefined,
        confirmacionFisica: [],
        indemnizaciones: [],
      } as never);

      // LA CONSULTA SIGUIENTE, contra un cliente que NO PUEDE escribir.
      const repoDespues = new OrdenRepository(soloLectura(tx as object));
      const despuesConteo = (
        await repoDespues.contarCierresAbiertosPorMensajero([mensajeroId])
      ).get(mensajeroId);
      const despuesBloqueados = await repoDespues.findMensajerosBloqueadosPorCierres([mensajeroId]);
      const despuesDetalle = await repoDespues.findBloqueoDetalle(mensajeroId);

      const estados = await tx.cierreDia.findMany({
        where: { id: { in: [viejo.id, nuevo.id] } },
        select: { id: true, estado: true },
      });

      return {
        viejo: viejo.id,
        nuevo: nuevo.id,
        antes: {
          conteo: antesConteo,
          bloqueado: antesBloqueados.has(mensajeroId),
          detalle: antesDetalle,
        },
        despues: {
          conteo: despuesConteo,
          bloqueado: despuesBloqueados.has(mensajeroId),
          detalle: despuesDetalle,
        },
        estados: Object.fromEntries(estados.map((c) => [c.id, c.estado])) as Record<string, string>,
      };
    });

    const { viejo, nuevo, antes, despues, estados } = medido;

    // ANTES — caso 4: dos abiertos, ninguno re-solicitable, BLOQUEADO, y el que toca resolver es
    // el MAS VIEJO (R11), que lo resuelve la administracion.
    expect(antes.conteo).toEqual({ n: 2, v: 0 });
    expect(antes.bloqueado).toBe(true);
    expect(antes.detalle.bloqueado).toBe(true);
    expect(antes.detalle.cierresAbiertos).toBe(2);
    expect(antes.detalle.cierresPorReenviar).toBe(0);
    expect(antes.detalle.aResolverPrimero?.cierreId).toBe(viejo);

    // La aprobacion ocurrio de verdad, y SOLO sobre el mas viejo.
    expect(estados[viejo]).toBe("aprobado");
    expect(estados[nuevo]).toBe("solicitado");

    // ⭑ DESPUES — LA FILA QUE FALTABA: queda UN cierre abierto (`N=1, V=0`) y el mensajero esta
    // LIBRE. Sin ninguna escritura de por medio: el cliente de esta consulta lanza si alguien
    // intenta escribir.
    expect(despues.conteo).toEqual({ n: 1, v: 0 });
    expect(despues.bloqueado).toBe(false);
    expect(despues.detalle.bloqueado).toBe(false);
    expect(despues.detalle.cierresAbiertos).toBe(1);
    expect(despues.detalle.cierresPorReenviar).toBe(0);
    // El que sigue abierto es el NUEVO: el aprobado ya no es «el que toca resolver».
    expect(despues.detalle.aResolverPrimero?.cierreId).toBe(nuevo);
  });
});
