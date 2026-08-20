import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// 💰 Feature 240 (T2.2, D1/D8) — EL RECHAZO MANUAL DE LA TIENDA en el repositorio:
// `devuelta -> rechazada` + gestion sintetica + fila de historial, en UNA transaccion.
// Molde: `gestion-orden-reprogramar.test.ts` (100), su hermana de forma.
//
// ⚠️ POR QUE EL DOBLE DEL `updateMany` HONRA EL `where` Y NO DEVUELVE `{count: 1}` A CIEGAS.
// Este repo tiene MEDIDO cuatro veces que un test de servicio no ve el SQL: con un `vi.fn()` mudo,
// borrar `estatusId: input.estatusDevueltaId` del `where` deja TODOS los casos en verde, porque
// nadie mira la guarda. Y esa guarda no es un detalle: es la barrera ENTERA de R3/R4/R5/R21 —lo
// unico que impide que un segundo envio, una re-corrida o una carrera con el cron de la 99 cobren
// el `cobroRechazado` dos veces sobre el mismo paquete—. Asi que aqui el doble mantiene una fila de
// orden con su `estatus_id` y decide `count` COMPARANDO el `where` contra ella, como haria
// Postgres. Es la mutacion T7.1 y este archivo es el UNICO que la mata.

// El jobRepo del constructor no se usa en `rechazarDesdeDevuelta` (la orden salio de la ruta hace
// tiempo: no se reoptimiza nada); se pasa un doble no-op para no encolar nada.
const noopJobRepo = {} as unknown as ConstructorParameters<typeof GestionOrdenRepository>[1];

const ORDEN_ID = "o1";
const MENSAJERO_DE_LA_DEVUELTA = "m-ultima-devuelta";

/**
 * Doble de Prisma con UNA fila de `orden` de verdad: `{ id, estatusId, deletedAt }`. El
 * `updateMany` evalua el `where` contra ella (id + estatusId + deletedAt) y solo entonces muta y
 * devuelve `count: 1`. Es lo que convierte la guarda en algo observable.
 */
function buildPrisma(
  fila: { id?: string; estatusId?: string; deletedAt?: Date | null } = {},
) {
  const orden = {
    id: fila.id ?? ORDEN_ID,
    estatusId: fila.estatusId ?? idEstado("devuelta"),
    deletedAt: fila.deletedAt ?? null,
  };

  const prisma = {
    orden: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; estatusId?: string; deletedAt?: Date | null };
          data: { estatusId?: string };
        }) => {
          // El `where` se evalua COMPLETO, clave a clave. Una clave que el repo deje de mandar
          // deja de filtrar, exactamente como en Postgres.
          const coincide =
            (where.id === undefined || where.id === orden.id) &&
            (where.estatusId === undefined || where.estatusId === orden.estatusId) &&
            (where.deletedAt === undefined || where.deletedAt === orden.deletedAt);
          if (!coincide) return { count: 0 };
          if (data.estatusId !== undefined) orden.estatusId = data.estatusId;
          return { count: 1 };
        },
      ),
    },
    gestionOrden: { findFirst: vi.fn(), create: vi.fn() },
    ordenHistorialEstado: { createMany: vi.fn() },
    $transaction: vi.fn(),
    /** Para poder afirmar que el estado NO se movio cuando la transaccion aborta (R10). */
    _orden: orden,
  };

  prisma.gestionOrden.findFirst.mockResolvedValue({ mensajeroId: MENSAJERO_DE_LA_DEVUELTA });
  prisma.gestionOrden.create.mockResolvedValue({ id: "g-rechazada" });
  // La transaccion es todo-o-nada: si el cuerpo lanza, se revierte lo escrito hasta ahi. El doble
  // lo emula deshaciendo la mutacion de la fila, que es lo unico que este metodo muta.
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const estadoPrevio = orden.estatusId;
    try {
      return await fn(prisma);
    } catch (e) {
      orden.estatusId = estadoPrevio; // ROLLBACK
      throw e;
    }
  });
  return prisma;
}

function repoWith(prisma: ReturnType<typeof buildPrisma>) {
  return new GestionOrdenRepository(prisma as unknown as PrismaClient, noopJobRepo);
}

const INPUT = {
  ordenId: ORDEN_ID,
  estatusDevueltaId: idEstado("devuelta"),
  estatusRechazadaId: idEstado("rechazada"),
  motivo: "el cliente ya compro en otro lado, no reintentar",
  actorUsuarioId: "tienda-1",
};

beforeEach(async () => {
  // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales),
  // asi que el par `devuelta -> rechazada` que este metodo registra tiene que ser uno REAL del
  // mapa `TRANSICIONES`. Si la arista #67 no estuviera declarada, estos casos se pondrian rojos.
  await sembrarCatalogoEstados();
});

/* -------------------------------------------------------------------------- */
/* 1. El camino feliz: lo que se escribe                                        */
/* -------------------------------------------------------------------------- */

describe("rechazarDesdeDevuelta — la transicion y su gestion sintetica (R8/R9/R11/R15)", () => {
  it("R4: el UPDATE va guardado por el estatus de ORIGEN, en la misma sentencia que lo cambia", async () => {
    const prisma = buildPrisma();
    const ok = await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(ok).toBe(true);
    const upd = prisma.orden.updateMany.mock.calls[0][0];
    // Las TRES claves del `where`, una a una: sin el `estatusId` no hay barrera (R3/R4); sin el
    // `deletedAt` se rechazarian ordenes borradas.
    expect(upd.where).toEqual({
      id: ORDEN_ID,
      estatusId: idEstado("devuelta"),
      deletedAt: null,
    });
  });

  it("💰 R14/R20: el `data` del UPDATE lleva EXACTAMENTE una clave, `estatusId`", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    const upd = prisma.orden.updateMany.mock.calls[0][0];
    // `toEqual` y no `toMatchObject`: la afirmacion ES que no hay nada mas. Ni
    // `mensajeroAsignadoId` (el bloque 139 de la aprobacion lo necesita para devolver el paquete),
    // ni `prioridad` (la orden no vuelve a reasignarse), ni un solo importe (R20).
    expect(upd.data).toEqual({ estatusId: idEstado("rechazada") });
    expect(Object.keys(upd.data)).toEqual(["estatusId"]);
  });

  it("💰 R9: la gestion se atribuye al MENSAJERO de la ultima `devuelta` vigente, no a la tienda", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    // La vigencia se lee con el mismo criterio que `findDevueltasSla` de la 99: no anulada y la
    // mas reciente. Si esta lectura cambiara, las dos vias dejarian de atribuir igual.
    const q = prisma.gestionOrden.findFirst.mock.calls[0][0];
    expect(q.where).toEqual({ ordenId: ORDEN_ID, resultado: "devuelta", anuladaAt: null });
    expect(q.orderBy).toEqual({ createdAt: "desc" });

    // 💰 Y ese id, y no el de la tienda, es el que va a la gestion. Es la mutacion T7.2: con
    // `actorUsuarioId` aqui, `crearCierre` —que vincula por `{ mensajeroId, cierreId: null }`— no
    // engancharia la fila a NINGUN cierre nunca, y el rechazo seria invisible y gratis.
    const gArg = prisma.gestionOrden.create.mock.calls[0][0];
    expect(gArg.data.mensajeroId).toBe(MENSAJERO_DE_LA_DEVUELTA);
    expect(gArg.data.mensajeroId).not.toBe(INPUT.actorUsuarioId);
  });

  it("💰 R8/R18: crea UNA gestion `rechazada` con `cierre_id` nulo y su motivo", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    const gArg = prisma.gestionOrden.create.mock.calls[0][0];
    expect(gArg.data).toMatchObject({
      ordenId: ORDEN_ID,
      mensajeroId: MENSAJERO_DE_LA_DEVUELTA,
      // D1 (firmada): el MISMO `resultado` que escribe el cron de plazo vencido. De el cuelgan
      // `ingresoBodegaPorResultado` (56) y `derivarIngresoOrden` (42/43), asi que las dos vias
      // facturan lo mismo SIN que esta ficha escriba una linea de aritmetica (R17/R22).
      resultado: "rechazada",
      motivo: INPUT.motivo, // R12
      // R18: ningun movimiento de dinero en el instante del rechazo. El NULL es lo que deja que la
      // recoja el SIGUIENTE cierre del mensajero, por el mismo mecanismo que las suyas.
      cierreId: null,
    });
  });

  it("💰 R16: la gestion nace SIN causa de devolucion, SIN ubicacion y SIN importes", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    const data = prisma.gestionOrden.create.mock.calls[0][0].data;
    // La causa describe una DEVOLUCION (73) y la tienda decide desde un escritorio, sin
    // coordenadas que aportar (193). Escribirlas seria inventarse un dato de campo.
    expect(data).not.toHaveProperty("causaDevolucion");
    expect(data).not.toHaveProperty("ubicacionLat");
    expect(data).not.toHaveProperty("ubicacionLng");
    expect(data).not.toHaveProperty("ubicacionAusencia");
    expect(data).not.toHaveProperty("evidenciaStoragePath"); // R13/D5: sin foto
    // R20: ni un importe pre-computado. Los deriva la aprobacion del cierre, a partir del
    // `resultado`, con aritmetica decimal que vive en otro sitio.
    expect(data).not.toHaveProperty("montoRecibido");
    expect(data).not.toHaveProperty("ingresoBodegaRechazo");
    expect(data).not.toHaveProperty("pagoMensajero");
    // Y no es una gestion reprogramada disfrazada: sin fecha.
    expect(data).not.toHaveProperty("fechaReprogramacion");
  });

  it("R11/R12: la fila de historial lleva a LA TIENDA como actor, la familia propia y el motivo", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    const hist = prisma.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(hist.data).toEqual([
      {
        ordenId: ORDEN_ID,
        estatusOrigenId: idEstado("devuelta"),
        estatusDestinoId: idEstado("rechazada"),
        // R11: la persona de la tienda. Es la UNICA evidencia de quien decidio un cobro, y el dato
        // que alguien pedira el dia de la primera disputa. El cron, en cambio, escribe `null`.
        actorUsuarioId: "tienda-1",
        // D8: familia propia. Con `escalado_devuelta_sla` esta orden apareceria en la pestaña
        // «Rechazadas por plazo vencido» (102) afirmando un plazo que aqui no vencio.
        origenTipo: "rechazo_tienda",
        motivo: INPUT.motivo, // R12: el MISMO texto que la gestion, no otro
        gestionOrdenId: "g-rechazada", // R11: enlaza la gestion sintetica
      },
    ]);
  });

  it("R15: las tres escrituras van dentro de UNA sola transaccion", async () => {
    const prisma = buildPrisma();
    await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Y las tres se hacen con el `tx` que la transaccion entrega, no con el cliente de fuera: el
    // doble pasa el propio `prisma` como `tx`, asi que basta con que ninguna se haya escapado.
    expect(prisma.orden.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Las ramas sin efectos: la guarda es la barrera                            */
/* -------------------------------------------------------------------------- */

describe("rechazarDesdeDevuelta — cuando NO se aplica, no deja NI UN efecto (R3/R5/R10/R21)", () => {
  it("💰 R3: una orden que YA SALIO de `devuelta` no deja ni un efecto", async () => {
    // ⭑ EL CASO QUE MATA LA MUTACION T7.1. La fila esta en `rechazada` (se le adelanto el cron de
    // la 99, o la bodega la recupero). Si alguien quita `estatusId` del `where`, este `updateMany`
    // pasa a coincidir por id y el resto del metodo se ejecuta: gestion + historial + un
    // `cobroRechazado` de mas sobre un paquete que ya se cobro.
    const prisma = buildPrisma({ estatusId: idEstado("rechazada") });
    const ok = await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(ok).toBe(false);
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
    // Ni siquiera se pregunta por el mensajero: el metodo sale en el paso 1.
    expect(prisma.gestionOrden.findFirst).not.toHaveBeenCalled();
    // Y el estado de la orden queda donde estaba.
    expect(prisma._orden.estatusId).toBe(idEstado("rechazada"));
  });

  it("R3: una orden BORRADA (soft-delete) tampoco se rechaza", async () => {
    const prisma = buildPrisma({ deletedAt: new Date("2026-08-01T00:00:00.000Z") });
    const ok = await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(ok).toBe(false);
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("💰 R5/R21: el SEGUNDO envio devuelve `false` y no duplica gestion ni historial", async () => {
    // La idempotencia NO tiene mecanismo propio: es la MISMA guarda. Un segundo mecanismo puede
    // divergir del primero, y aqui divergir significa cobrar dos veces.
    const prisma = buildPrisma();
    const repo = repoWith(prisma);

    expect(await repo.rechazarDesdeDevuelta(INPUT)).toBe(true);
    // La fila quedo en `rechazada` por el primer envio, asi que el segundo no encuentra nada.
    expect(await repo.rechazarDesdeDevuelta(INPUT)).toBe(false);

    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
  });

  it("R10: sin gestion `devuelta` vigente, ABORTA la tx y el estado NO queda cambiado", async () => {
    // Anomalia: una orden en `devuelta` sin gestion `devuelta` vigente no tiene a quien atribuir
    // la gestion sintetica (`mensajero_id` es NOT NULL). Abortar es preferible a inventar un
    // actor: un `mensajero_id` inventado mete la fila en el cierre de OTRA persona.
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue(null);

    await expect(repoWith(prisma).rechazarDesdeDevuelta(INPUT)).rejects.toThrow(
      /rechazarDesdeDevuelta/,
    );
    expect(prisma.gestionOrden.create).not.toHaveBeenCalled();
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
    // Y el UPDATE del paso 1 se revierte con la transaccion: la orden sigue en `devuelta` y la
    // tienda la vuelve a ver. Sin esto quedaria en `rechazada` sin gestion y sin historial.
    expect(prisma._orden.estatusId).toBe(idEstado("devuelta"));
  });

  it("R10: el mensaje del abort NO lleva datos personales ni el motivo (R46)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue(null);

    const error = await repoWith(prisma)
      .rechazarDesdeDevuelta(INPUT)
      .catch((e: Error) => e);

    const mensaje = (error as Error).message;
    expect(mensaje).not.toContain(INPUT.motivo); // el motivo es texto libre de la tienda
    expect(mensaje).not.toContain(INPUT.actorUsuarioId);
    expect(mensaje).not.toContain(ORDEN_ID);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. El doble honra el `where`: anti-vacuidad del propio arnes                  */
/* -------------------------------------------------------------------------- */

describe("el doble de este archivo SI mira el `where` (anti-vacuidad)", () => {
  it("con el `estatusId` del `where` puesto a otro estado, el propio doble devuelve count 0", () => {
    // Sin esta comprobacion, los dos casos de arriba podrian estar verdes porque el doble devuelve
    // siempre `{count: 0}`, o siempre `{count: 1}`, y nadie lo notaria. Se ejerce el doble
    // DIRECTAMENTE, en las dos direcciones, antes de creerse nada de lo que afirma sobre el repo.
    const prisma = buildPrisma();
    return (async () => {
      const acierta = await prisma.orden.updateMany({
        where: { id: ORDEN_ID, estatusId: idEstado("devuelta"), deletedAt: null },
        data: { estatusId: idEstado("rechazada") },
      });
      expect(acierta).toEqual({ count: 1 });

      const falla = await prisma.orden.updateMany({
        where: { id: ORDEN_ID, estatusId: idEstado("devuelta"), deletedAt: null },
        data: { estatusId: idEstado("rechazada") },
      });
      expect(falla).toEqual({ count: 0 }); // ya no esta en `devuelta`: la primera la movio
    })();
  });
});
