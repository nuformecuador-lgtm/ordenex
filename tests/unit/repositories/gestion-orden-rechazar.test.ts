import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { SinGestionDevueltaError } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
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

/** La fila de anclaje de la devolucion (239) que YA existe cuando la tienda rechaza. */
interface FilaHistorial {
  ordenId: string;
  origenTipo: string;
  gestionOrdenId: string | null;
}

/**
 * Doble de Prisma con UNA fila de `orden` de verdad: `{ id, estatusId, deletedAt }`. El
 * `updateMany` evalua el `where` contra ella (id + estatusId + deletedAt) y solo entonces muta y
 * devuelve `count: 1`. Es lo que convierte la guarda en algo observable.
 *
 * ⚠️ Y con una TABLA `orden_historial_estado` de verdad, sembrada con EL ANCLA de la devolucion
 * (`anclaje_devolucion`, feature 239). Hasta 2026-08-20 este doble exponia SOLO `createMany`, y eso
 * tenia una consecuencia que no se veia: una mutacion que borrase el ancla moria con un
 * `TypeError` —«prisma.ordenHistorialEstado.deleteMany is not a function»— y no por ninguna
 * asercion. Un requisito que se sostiene sobre una excepcion accidental NO esta cubierto: el dia
 * que el doble crezca, el rojo desaparece y nadie se entera. Por eso ahora estan los CINCO metodos
 * de escritura de esa tabla, los cuatro que el repo NO debe usar espiados, y el ancla se comprueba
 * fila a fila (R24).
 */
function buildPrisma(
  fila: { id?: string; estatusId?: string; deletedAt?: Date | null } = {},
) {
  const orden = {
    id: fila.id ?? ORDEN_ID,
    estatusId: fila.estatusId ?? idEstado("devuelta"),
    deletedAt: fila.deletedAt ?? null,
  };

  // R24: el ancla de la 239 ya esta escrita cuando la tienda decide rechazar. Es historia
  // INMUTABLE y es lo que R24 protege: ni se re-ancla, ni se borra, ni se modifica.
  const ancla: FilaHistorial = {
    ordenId: ORDEN_ID,
    origenTipo: "anclaje_devolucion",
    gestionOrdenId: "g-ancla",
  };
  const historial: FilaHistorial[] = [ancla];

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
    // Los CINCO metodos de escritura de `orden_historial_estado`. `createMany` es el UNICO que el
    // choke point (`appendCambioEstado`) usa; los otros cuatro estan aqui para que su uso sea
    // OBSERVABLE en vez de reventar con un `TypeError`. Todos mutan la tabla de verdad, asi que el
    // efecto sobre el ancla se puede comprobar sobre los datos y no solo sobre el espia.
    ordenHistorialEstado: {
      createMany: vi.fn(async ({ data }: { data: FilaHistorial[] }) => {
        historial.push(...data);
        return { count: data.length };
      }),
      create: vi.fn(async ({ data }: { data: FilaHistorial }) => {
        historial.push(data);
        return data;
      }),
      update: vi.fn(async ({ data }: { data: Partial<FilaHistorial> }) => {
        Object.assign(historial[0], data);
        return historial[0];
      }),
      updateMany: vi.fn(async ({ data }: { data: Partial<FilaHistorial> }) => {
        for (const f of historial) Object.assign(f, data);
        return { count: historial.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where?: { origenTipo?: string } } = {}) => {
        const antes = historial.length;
        const quedan = historial.filter(
          (f) => where?.origenTipo !== undefined && f.origenTipo !== where.origenTipo,
        );
        historial.length = 0;
        historial.push(...quedan);
        return { count: antes - historial.length };
      }),
    },
    $transaction: vi.fn(),
    /** Para poder afirmar que el estado NO se movio cuando la transaccion aborta (R10). */
    _orden: orden,
    /** La tabla de historial, para comprobar el ancla fila a fila (R24). */
    _historial: historial,
    /** La fila de anclaje tal cual se sembro, para compararla contra si misma despues (R24). */
    _anclaEsperada: { ...ancla },
  };

  prisma.gestionOrden.findFirst.mockResolvedValue({ mensajeroId: MENSAJERO_DE_LA_DEVUELTA });
  prisma.gestionOrden.create.mockResolvedValue({ id: "g-rechazada" });
  // La transaccion es todo-o-nada: si el cuerpo lanza, se revierte lo escrito hasta ahi. El doble
  // lo emula deshaciendo lo que este metodo puede mutar: el estatus de la orden Y las filas de
  // historial. Lo segundo se anadio con la tabla de historial de verdad (2026-08-20): si el doble
  // revirtiera solo la orden, una escritura de historial dentro de una tx abortada quedaria visible
  // y el caso R10 pasaria a mentir sobre lo que la base tiene.
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    const estadoPrevio = orden.estatusId;
    const historialPrevio = historial.map((f) => ({ ...f }));
    try {
      return await fn(prisma);
    } catch (e) {
      orden.estatusId = estadoPrevio; // ROLLBACK
      historial.length = 0;
      historial.push(...historialPrevio);
      throw e;
    }
  });
  return prisma;
}

/** Un doble nuevo sin gestion `devuelta` vigente: cada `expect(...).rejects` consume el suyo. */
function buildPrismaSinAncla() {
  const prisma = buildPrisma();
  prisma.gestionOrden.findFirst.mockResolvedValue(null);
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

    // 2026-08-20: se afirma la CLASE, no solo el texto. El service la distingue con `instanceof`
    // para convertirla en un desenlace con mensaje; si aqui volviera a lanzarse un `Error` pelado,
    // ese `instanceof` fallaria en silencio y la tienda volveria a pulsar un boton mudo.
    await expect(repoWith(prisma).rechazarDesdeDevuelta(INPUT)).rejects.toThrow(
      SinGestionDevueltaError,
    );
    await expect(repoWith(buildPrismaSinAncla()).rechazarDesdeDevuelta(INPUT)).rejects.toThrow(
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
/* 2-bis. El ancla de la 239 no se toca (R24)                                    */
/* -------------------------------------------------------------------------- */

// FEATURE 240 (R24, D9) — EL ANCLA DE LA DEVOLUCION SOBREVIVE AL RECHAZO, INTACTA.
//
// Que dice R24: «El sistema NO DEBE re-anclar, borrar ni modificar el registro de anclaje de la
// devolucion de esa orden». Son TRES prohibiciones distintas y aqui se afirman las tres por
// separado, porque cada una se rompe de una forma distinta.
//
// POR QUE IMPORTA, y no es simetria burocratica: el ancla (`orden_historial_estado` con familia
// `anclaje_devolucion`, feature 239) es de donde el cron del plazo saca CUANDO empezo a correr el
// reloj — `orderBy createdAt desc` + `take 1`—. Es historia inmutable y es la unica prueba de
// cuando la bodega confirmo esa devolucion. Si el rechazo manual la borrase, una orden que algun
// dia volviera a `devuelta` arrancaria su reloj desde el ancla EQUIVOCADA (la vieja, o ninguna), y
// el escalado —con su `cobroRechazado`— caeria en la fecha que no es.
//
// ⏳ 2026-08-20 — ESTE BLOQUE NACE DE UN RECHAZO DE REVISION, y conviene que quede escrito por que.
// R24 estaba declarado como «no cubierto aqui, es del recorrido T8.3», y T8.3 nunca se corrio. La
// revision midio que la mutacion «el rechazo borra el ancla» SI moria... pero con un `TypeError`,
// porque el doble solo exponia `createMany`. Morir por una excepcion accidental no es estar
// cubierto: el dia que alguien anada `deleteMany` al doble por otro motivo, el rojo se apaga solo y
// nadie se entera. Ahora el doble expone los cinco metodos y el rojo viene de la ASERCION.
describe("rechazarDesdeDevuelta — el ancla de la devolucion queda INTACTA (R24)", () => {
  it("R24: la fila de anclaje sigue ahi, sin un solo campo cambiado", () => {
    const prisma = buildPrisma();
    return repoWith(prisma)
      .rechazarDesdeDevuelta(INPUT)
      .then((ok) => {
        expect(ok).toBe(true);
        // Se compara contra la FOTO tomada al sembrar, no contra la fila viva: comparar una fila
        // consigo misma estaria verde aunque alguien la hubiera reescrito entera.
        const anclas = prisma._historial.filter((f) => f.origenTipo === "anclaje_devolucion");
        expect(anclas).toHaveLength(1);
        expect(anclas[0]).toEqual(prisma._anclaEsperada);
      });
  });

  it("💰 R24: NO se borra — ninguno de los cuatro metodos que podrian tocarla se usa", () => {
    // El choke point appendea con `createMany` y NADA MAS. Cualquier otro metodo de escritura sobre
    // esta tabla, en este camino, solo puede servir para tocar filas que ya existen: es decir, el
    // ancla. Por eso los cuatro se espian y se afirma que nadie los llamo.
    const prisma = buildPrisma();
    return repoWith(prisma)
      .rechazarDesdeDevuelta(INPUT)
      .then(() => {
        expect(prisma.ordenHistorialEstado.deleteMany).not.toHaveBeenCalled();
        expect(prisma.ordenHistorialEstado.update).not.toHaveBeenCalled();
        expect(prisma.ordenHistorialEstado.updateMany).not.toHaveBeenCalled();
        expect(prisma.ordenHistorialEstado.create).not.toHaveBeenCalled();
        // Y el unico que SI se usa, exactamente una vez: el append del choke point.
        expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
      });
  });

  it("R24: NO se RE-ANCLA — la unica fila nueva es la del rechazo, no otro anclaje", () => {
    // La tercera prohibicion, y la mas facil de romper sin querer: bastaria con que alguien
    // «refrescara» el anclaje al rechazar, creyendo que asi la fecha queda al dia. El resultado
    // seria que el `take 1` descendente devolviera un ancla nacida DESPUES del rechazo.
    const prisma = buildPrisma();
    return repoWith(prisma)
      .rechazarDesdeDevuelta(INPUT)
      .then(() => {
        expect(prisma._historial).toHaveLength(2); // el ancla que ya estaba + la del rechazo
        const nuevas = prisma._historial.filter((f) => f.origenTipo !== "anclaje_devolucion");
        expect(nuevas.map((f) => f.origenTipo)).toEqual(["rechazo_tienda"]);
      });
  });

  it("R24: tampoco se toca cuando la orden YA SALIO de `devuelta` (carrera perdida)", () => {
    // La rama sin efectos tiene que serlo tambien para el ancla: si el borrado viviera ANTES de la
    // guarda del `updateMany`, esta orden perderia su anclaje sin que nada mas ocurriera — el peor
    // de los casos, porque no dejaria ni rastro de que paso.
    const prisma = buildPrisma({ estatusId: idEstado("rechazada") });
    return repoWith(prisma)
      .rechazarDesdeDevuelta(INPUT)
      .then((ok) => {
        expect(ok).toBe(false);
        expect(prisma._historial).toEqual([prisma._anclaEsperada]);
        expect(prisma.ordenHistorialEstado.deleteMany).not.toHaveBeenCalled();
      });
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

/* -------------------------------------------------------------------------- */
/* 4. FICHA 337 — el EFECTO EXTRA viaja DENTRO de la transaccion               */
/* -------------------------------------------------------------------------- */

describe("💰 337 — `trasCrearGestion`: el cobro entra en la MISMA transaccion", () => {
  it("⭑ se invoca con el `tx` y con el id de la gestion RECIEN creada", async () => {
    // ⭑ LA MUTACION QUE ESTE CASO MATA: borrar `trasCrearGestion: input.trasCrearGestion` del
    // cuerpo de `rechazarDesdeDevuelta`, o el `if (input.trasCrearGestion)` del helper. Es la
    // familia del «composition root que no inyecta»: el hook seguiria existiendo en el contrato,
    // el servicio seguiria construyendolo, la suite de servicio seguiria verde... y NINGUN
    // rechazo se cobraria nunca. Un fallo mudo sobre dinero.
    const prisma = buildPrisma();
    const visto: Array<{ mismaTx: boolean; gestionId: string }> = [];

    const ok = await repoWith(prisma).rechazarDesdeDevuelta({
      ...INPUT,
      trasCrearGestion: async (tx, gestionId) => {
        // El `tx` que llega ES el de la transaccion (el doble se pasa a si mismo como cliente).
        visto.push({ mismaTx: tx === (prisma as unknown), gestionId });
      },
    });

    expect(ok).toBe(true);
    expect(visto).toHaveLength(1);
    expect(visto[0].mismaTx).toBe(true);
    // Y el id es el de LA gestion que acaba de crearse (el que el doble de `create` devuelve),
    // no uno inventado ni el de la orden.
    expect(visto[0].gestionId).toBe("g-rechazada");
  });

  it("⭑ NO se invoca cuando la orden ya salio de `devuelta` (carrera perdida)", async () => {
    // Un cobro sin rechazo seria dinero contra una tienda por algo que no paso. El hook cuelga del
    // paso 3, que solo corre si el `updateMany` guardado afecto una fila.
    const prisma = buildPrisma({ estatusId: idEstado("rechazada") });
    const hook = vi.fn(async () => {});

    const ok = await repoWith(prisma).rechazarDesdeDevuelta({ ...INPUT, trasCrearGestion: hook });

    expect(ok).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it("⭑ va ANTES del append del historial", async () => {
    // No cambia el resultado final (la transaccion es todo-o-nada), pero deja el fallo mas cerca
    // de su causa cuando se lee un log: si el cobro revienta, no se ha escrito todavia la fila de
    // auditoria de una transicion que va a revertirse.
    const prisma = buildPrisma();
    const orden: string[] = [];
    prisma.ordenHistorialEstado.createMany.mockImplementation(async () => {
      orden.push("historial");
      return { count: 1 };
    });

    await repoWith(prisma).rechazarDesdeDevuelta({
      ...INPUT,
      trasCrearGestion: async () => {
        orden.push("cobro");
      },
    });

    expect(orden).toEqual(["cobro", "historial"]);
  });

  it("sin `trasCrearGestion` el metodo se comporta EXACTAMENTE como antes de la 337", async () => {
    // El hook es OPCIONAL, y esta es la prueba de que serlo no cuesta nada: la via del cron y
    // cualquier llamador que no lo traiga siguen igual.
    const prisma = buildPrisma();
    const ok = await repoWith(prisma).rechazarDesdeDevuelta(INPUT);

    expect(ok).toBe(true);
    expect(prisma.gestionOrden.create).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
  });
});
