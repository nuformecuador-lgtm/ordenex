import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  CorreccionDiaConflictoError,
  type CorreccionDiaAplicada,
  type OrdenTransicionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  CorreccionDiaRepartoService,
  type CorreccionDiaRepartoRepo,
} from "@/lib/services/CorreccionDiaRepartoService";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_DIA,
  MSG_SIN_MENSAJERO,
  MSG_YA_ES_ESE_DIA,
  msgEstadoSinDiaVivo,
} from "@/lib/services/mensajes-correccion-dia-reparto";

// FEATURE 262 (B11) — la logica de negocio de «corregir el dia de reparto», con DOBLES.
//
// QUE SE PRUEBA AQUI Y QUE NO, dicho para que nadie lo confunda: aqui vive el ROL, la ZONA, los
// ESTADOS, el pre-chequeo por orden y el reloj inyectable. El `WHERE` de la escritura NO se prueba
// aqui y no puede: un doble no ejecuta SQL, y en este repo esta MEDIDO cuatro veces seguidas que
// una mutacion del `WHERE` deja once tests de servicio en verde. Eso vive en
// `tests/integration/db/correccion-dia-reparto.int.test.ts`, contra Postgres real.

const ZONA_SATELITE = "z-limon";
const ZONA_AJENA = "z-guanacaste";
const MOTIVO = "la bodega marco el lote para el dia siguiente por error";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" as RolValue };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" as RolValue };
const SATELITE: Actor = { usuarioId: "u-satelite", rol: "adminSatelite" as RolValue };
const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero" as RolValue };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" as RolValue };

/**
 * 22:30 CR del 21 de agosto = 04:30Z del 22. Elegido a proposito: el dia UTC y el dia de Costa Rica
 * NO coinciden, asi que un «hoy» derivado con el helper equivocado saldria «22» y los tests que
 * comparan la fecha resuelta se pondrian rojos. Es la misma hora que uso la 261.
 */
const NOW_21_CR = new Date("2026-08-22T04:30:00.000Z");
const DIA_21 = new Date("2026-08-21T00:00:00.000Z");
const DIA_22 = new Date("2026-08-22T00:00:00.000Z");
/** Un dia despues: sirve para demostrar que la fecha sale del RELOJ y no de una constante. */
const NOW_22_CR = new Date("2026-08-23T04:30:00.000Z");
const DIA_23 = new Date("2026-08-23T00:00:00.000Z");

function ordenRow(overrides: Partial<OrdenTransicionRow> = {}): OrdenTransicionRow {
  return {
    id: "o1",
    estatusValue: "por_recoger",
    numGuia: 17496963,
    deletedAt: null,
    zonaId: ZONA_SATELITE,
    zonaEsGam: false,
    tiendaId: "store-1",
    mensajeroAsignadoId: "m-1",
    fechaReparto: DIA_22, // marcada para MAÑANA respecto de `NOW_21_CR`
    ...overrides,
  };
}

function aplicada(overrides: Partial<CorreccionDiaAplicada> = {}): CorreccionDiaAplicada {
  return {
    ordenId: "o1",
    cambioId: "c-1",
    mensajeroAsignadoId: "m-1",
    numGuia: 17496963,
    numRemision: "R-1",
    fechaAnterior: DIA_22,
    fechaNueva: DIA_21,
    ...overrides,
  };
}

interface EscenarioOpts {
  ordenes?: OrdenTransicionRow[];
  /** Segunda lectura (la de `detalleCarrera`), si el escenario la necesita. */
  ordenesTrasCarrera?: OrdenTransicionRow[];
  zonaActor?: string | null;
  catalogo?: (value: string) => string | null;
  corregir?: CorreccionDiaRepartoRepo["corregirDiaRepartoLote"];
}

function fakeRepo(opts: EscenarioOpts = {}) {
  const ordenes = opts.ordenes ?? [ordenRow()];
  let lecturas = 0;
  // `zonaActor: null` significa «el actor NO tiene zona», no «usa el default»: con `??` el caso de
  // `sin_zona` seria irrepresentable y su test pasaria por otra razon.
  const zonaActor = "zonaActor" in opts ? (opts.zonaActor as string | null) : ZONA_SATELITE;
  const repo = {
    findUsuarioZonaId: vi.fn(async () => zonaActor),
    findByIdsForTransicion: vi.fn(async () => {
      lecturas += 1;
      return lecturas === 1 ? ordenes : (opts.ordenesTrasCarrera ?? ordenes);
    }),
    findEstatusIdByValue: vi.fn(async (value: string) =>
      opts.catalogo ? opts.catalogo(value) : `os-${value}`,
    ),
    corregirDiaRepartoLote: vi.fn(
      opts.corregir ?? (async () => [aplicada()] as CorreccionDiaAplicada[]),
    ),
  };
  return repo as unknown as CorreccionDiaRepartoRepo & typeof repo;
}

/**
 * Los argumentos con los que el service llamo al writer.
 *
 * Se lee la llamada REAL en vez de usar `expect.anything()` por una razon concreta: `anything()` NO
 * casa con `null`, y `null` es exactamente el valor que el cuarto argumento tiene para los roles de
 * acceso total («sin restriccion de zona»). Una asercion que no puede expresar el caso principal no
 * es una asercion floja: es una que no mira ahi.
 */
function llamadaAlWriter(repo: { corregirDiaRepartoLote: unknown }): {
  ordenIds: string[];
  fecha: Date;
  estatusIds: string[];
  zonaId: string | null;
  ctx: { actorUsuarioId: string; motivo: string };
} {
  const calls = (repo.corregirDiaRepartoLote as { mock: { calls: unknown[][] } }).mock.calls;
  expect(calls, "el service no llamo al writer ni una vez").toHaveLength(1);
  const [ordenIds, fecha, estatusIds, zonaId, ctx] = calls[0];
  return {
    ordenIds: ordenIds as string[],
    fecha: fecha as Date,
    estatusIds: estatusIds as string[],
    zonaId: zonaId as string | null,
    ctx: ctx as { actorUsuarioId: string; motivo: string },
  };
}

// =================================================================================================
// R11 / R15 — QUIEN PUEDE
// =================================================================================================

describe("262/R11 — corrige exactamente quien puede ELEGIR el dia al asignar", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s (acceso total) corrige sin restriccion de zona", async (_nombre, actor) => {
    const repo = fakeRepo();
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, actor, NOW_21_CR);

    expect(r.status).toBe("ok");
    // Acceso total => `zonaId` del writer es `null`: alcanza CUALQUIER zona, mismo reparto que
    // «Deshacer asignacion» (149/R3).
    const llamada = llamadaAlWriter(repo);
    expect(llamada.ordenIds).toEqual(["o1"]);
    expect(llamada.fecha).toEqual(DIA_21);
    expect(llamada.zonaId).toBeNull();
    expect(llamada.ctx).toEqual({ actorUsuarioId: actor.usuarioId, motivo: MOTIVO });
    // Y NO consulta la zona: no la necesita.
    expect(repo.findUsuarioZonaId).not.toHaveBeenCalled();
  });

  it("el `adminSatelite` corrige, acotado a SU zona resuelta en el servidor (R12)", async () => {
    const repo = fakeRepo();
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, SATELITE, NOW_21_CR);

    expect(r.status).toBe("ok");
    expect(repo.findUsuarioZonaId).toHaveBeenCalledWith(SATELITE.usuarioId);
    // La zona viaja al writer para repetirse en el `WHERE` (defensa en profundidad anti-TOCTOU).
    expect(llamadaAlWriter(repo).zonaId).toBe(ZONA_SATELITE);
  });
});

describe("262/R15 — al mensajero y a la tienda NO se les ofrece, y su rechazo no revela nada", () => {
  it.each([
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
  ])("%s recibe `forbidden` SIN efectos y sin leer una sola orden", async (_nombre, actor) => {
    const repo = fakeRepo();
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, actor, NOW_21_CR);

    expect(r.status).toBe("forbidden");
    // R11: «sin revelar el estado de ninguna orden». Si leyera antes de autorizar, un rechazo
    // podria distinguirse de otro por el tiempo o por un error distinto.
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("el mensajero es la parte BLOQUEADA: quien sufre el bloqueo no puede levantarlo", async () => {
    // La razon, escrita: si el mensajero pudiera corregir su propio dia, la 261 no habria
    // bloqueado nada. No es «los admin pueden mas»: es que el bloqueo dejaria de existir.
    const repo = fakeRepo();
    const service = new CorreccionDiaRepartoService(repo);
    const r = await service.corregir(
      { ordenIds: ["o1"], dia: "manana", motivo: MOTIVO },
      MENSAJERO,
      NOW_21_CR,
    );
    expect(r.status).toBe("forbidden");
  });
});

describe("262/R12 — la zona del satelite se resuelve en el servidor y acota de verdad", () => {
  it("sin zona asignada => `sin_zona`, sin leer ni escribir nada", async () => {
    const repo = fakeRepo({ zonaActor: null });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, SATELITE, NOW_21_CR);

    expect(r.status).toBe("sin_zona");
    expect(repo.findByIdsForTransicion).not.toHaveBeenCalled();
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("una orden de OTRA zona => `forbidden` del lote completo, no `conflict`", async () => {
    // `forbidden` y no `conflict` a proposito (149/R4): es un problema de PERMISO, no de estado, y
    // se decide ANTES del pre-chequeo para no filtrar el estado de una orden que el actor no
    // deberia poder mirar.
    const repo = fakeRepo({
      ordenes: [ordenRow({ id: "o1" }), ordenRow({ id: "o2", zonaId: ZONA_AJENA })],
    });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir(
      { ordenIds: ["o1", "o2"], dia: "hoy", motivo: MOTIVO },
      SATELITE,
      NOW_21_CR,
    );

    expect(r.status).toBe("forbidden");
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("acceso total SI alcanza esa misma orden de otra zona", async () => {
    // El peldaño de arriba de la escalera (limite declarado 5): lo que el satelite no alcanza, lo
    // alcanza maestro/admin desde `/ordenes`, que llega a CUALQUIER zona.
    const repo = fakeRepo({ ordenes: [ordenRow({ id: "o2", zonaId: ZONA_AJENA })] });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o2"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r.status).toBe("ok");
  });
});

// =================================================================================================
// R5 / R6 / R7 — EL PRE-CHEQUEO POR ORDEN, CADA MOTIVO POR SEPARADO
// =================================================================================================

describe("262/R6 — solo los estados donde el dia TODAVIA decide algo, y el rechazo NOMBRA el estado", () => {
  it.each(["por_recoger", "en_reparto", "ayuda_tienda"])(
    "`%s` se admite",
    async (estatusValue) => {
      const repo = fakeRepo({ ordenes: [ordenRow({ estatusValue })] });
      const service = new CorreccionDiaRepartoService(repo);
      const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);
      expect(r.status).toBe("ok");
    },
  );

  it.each(["entregada", "devuelta", "en_bodega_central", "sin_gestionar", "rechazada"])(
    "`%s` se rechaza NOMBRANDO el estado, y sin efectos",
    async (estatusValue) => {
      const repo = fakeRepo({ ordenes: [ordenRow({ estatusValue })] });
      const service = new CorreccionDiaRepartoService(repo);

      const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

      expect(r.status).toBe("conflict");
      if (r.status !== "conflict") throw new Error("unreachable");
      expect(r.detalle).toEqual([{ ordenId: "o1", motivo: msgEstadoSinDiaVivo(estatusValue) }]);
      // El motivo NOMBRA el estado: no es un `conflict` mudo.
      expect(r.detalle[0].motivo).toContain(estatusValue);
      expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
    },
  );
});

describe("262/R5 — sin mensajero o sin dia se rechaza, y cada motivo es el SUYO", () => {
  it("sin mensajero asignado", async () => {
    const repo = fakeRepo({ ordenes: [ordenRow({ mensajeroAsignadoId: null })] });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r).toEqual({ status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_SIN_MENSAJERO }] });
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("sin dia de reparto (R4: esta operacion NO pone dia donde no lo habia)", async () => {
    const repo = fakeRepo({ ordenes: [ordenRow({ fechaReparto: null })] });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r).toEqual({ status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_SIN_DIA }] });
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("y los dos motivos son DISTINTOS entre si (no un `conflict` generico)", () => {
    expect(MSG_SIN_MENSAJERO).not.toBe(MSG_SIN_DIA);
  });

  it("orden inexistente y orden borrada tambien tienen su motivo propio", async () => {
    const repo = fakeRepo({ ordenes: [ordenRow({ id: "o2", deletedAt: new Date() })] });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir(
      { ordenIds: ["o1", "o2"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );

    expect(r).toEqual({
      status: "conflict",
      detalle: [
        { ordenId: "o1", motivo: MSG_ORDEN_NO_EXISTE },
        { ordenId: "o2", motivo: MSG_ORDEN_BORRADA },
      ],
    });
  });
});

describe("262/R7 — una orden que YA esta en el dia elegido se rechaza, no se «corrige»", () => {
  it("marcada para el 22 y se pide «mañana» (que es el 22) => rechazo con su motivo", async () => {
    const repo = fakeRepo({ ordenes: [ordenRow({ fechaReparto: DIA_22 })] });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir(
      { ordenIds: ["o1"], dia: "manana", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );

    expect(r).toEqual({ status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_YA_ES_ESE_DIA }] });
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("la comparacion es por FECHA CALENDARIO, no por instante", async () => {
    // `fecha_reparto` es `@db.Date` y Prisma lo devuelve como la medianoche UTC de esa fecha. Si la
    // comparacion se hiciera con `getTime()` sobre valores construidos de otra forma, una fila con
    // la misma fecha pero otro instante pasaria la guarda y escribiria una correccion vacia.
    const repo = fakeRepo({
      ordenes: [ordenRow({ fechaReparto: new Date("2026-08-21T00:00:00.000Z") })],
    });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r.status).toBe("conflict");
  });
});

// =================================================================================================
// R8 — TODO O NADA
// =================================================================================================

describe("262/R8 — una sola rechazada aborta el LOTE COMPLETO, sin efectos", () => {
  it("dos validas y una invalida => CERO llamadas al writer", async () => {
    const repo = fakeRepo({
      ordenes: [
        ordenRow({ id: "o1" }),
        ordenRow({ id: "o2" }),
        ordenRow({ id: "o3", estatusValue: "entregada" }),
      ],
    });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir(
      { ordenIds: ["o1", "o2", "o3"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") throw new Error("unreachable");
    // El detalle nombra SOLO la que falla, pero el efecto es sobre el lote entero: nada se escribe.
    expect(r.detalle).toEqual([{ ordenId: "o3", motivo: msgEstadoSinDiaVivo("entregada") }]);
    expect(repo.corregirDiaRepartoLote).toHaveBeenCalledTimes(0);
  });

  it("R9: si el writer LANZA por carrera, el resultado es `conflict` con motivo por orden", async () => {
    const repo = fakeRepo({
      corregir: vi.fn(async () => {
        throw new CorreccionDiaConflictoError(["o2"]);
      }),
      ordenes: [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })],
      // Al re-leer, «o2» ya se entrego: alguien la movio entre la validacion y la escritura.
      ordenesTrasCarrera: [ordenRow({ id: "o2", estatusValue: "entregada" })],
    });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir(
      { ordenIds: ["o1", "o2"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );

    expect(r).toEqual({
      status: "conflict",
      detalle: [{ ordenId: "o2", motivo: msgEstadoSinDiaVivo("entregada") }],
    });
  });

  it("R9: si al re-leer la orden sigue pareciendo valida, el motivo es LA CARRERA", async () => {
    // El caso que no se puede explicar por el estado: la orden esta perfecta ahora, pero perdio la
    // guarda. Decir «estado no admitido» aqui seria mentir; decir «actualiza y reintenta» tambien.
    const repo = fakeRepo({
      corregir: vi.fn(async () => {
        throw new CorreccionDiaConflictoError(["o1"]);
      }),
    });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r).toEqual({ status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_CARRERA }] });
  });
});

// =================================================================================================
// R2 / R3 — LA FECHA LA RESUELVE EL SERVIDOR, CON UN RELOJ INYECTABLE
// =================================================================================================

describe("262/R2 — la fecha sale del TOKEN y del RELOJ, en el servidor", () => {
  it("dos `now` distintos producen dos fechas distintas para el MISMO token", async () => {
    // Mata M-o (resolver la fecha dentro del repositorio con `new Date()`): si el repo la calculara,
    // las dos llamadas recibirian lo mismo y este test seguiria verde con un doble... por eso lo que
    // se afirma es el ARGUMENTO que el service pasa, no el efecto.
    // La orden se siembra con un dia LEJANO a proposito: con el default (el 22) la segunda llamada
    // caeria en R7 —«ya es de ese dia»— y el writer no se llamaria. El test se puso rojo por eso
    // antes de escribir esta linea, y por eso queda dicho.
    const lejos = { fechaReparto: new Date("2026-01-05T00:00:00.000Z") };
    const repo1 = fakeRepo({ ordenes: [ordenRow(lejos)] });
    await new CorreccionDiaRepartoService(repo1).corregir(
      { ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );
    const repo2 = fakeRepo({ ordenes: [ordenRow(lejos)] });
    await new CorreccionDiaRepartoService(repo2).corregir(
      { ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_22_CR,
    );

    expect(llamadaAlWriter(repo1).fecha).toEqual(DIA_21);
    expect(llamadaAlWriter(repo2).fecha).toEqual(DIA_22);
  });

  it("«mañana» es el dia SIGUIENTE al de Costa Rica, no al de UTC", async () => {
    // A las 04:30Z del 22 el dia de Costa Rica es el 21 (UTC-6). Si el service usara el dia UTC,
    // «mañana» saldria el 23 y este test se pondria rojo.
    const repo = fakeRepo({ ordenes: [ordenRow({ fechaReparto: DIA_21 })] });
    await new CorreccionDiaRepartoService(repo).corregir(
      { ordenIds: ["o1"], dia: "manana", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );
    expect(llamadaAlWriter(repo).fecha).toEqual(DIA_22);
  });

  it("R3: el pasado NO es expresable — el unico grado de libertad es el token", async () => {
    // No hay ningun `if (fecha < hoy)` que probar, y esa es la propiedad: las UNICAS dos fechas que
    // este servicio puede producir son el dia en curso y el siguiente. Se afirma sobre el conjunto
    // de salidas posibles, que es lo que la decision D3 compra.
    const salidas: Date[] = [];
    for (const dia of ["hoy", "manana"] as const) {
      const repo = fakeRepo({ ordenes: [ordenRow({ fechaReparto: new Date("2026-01-01T00:00:00.000Z") })] });
      await new CorreccionDiaRepartoService(repo).corregir(
        { ordenIds: ["o1"], dia, motivo: MOTIVO },
        MAESTRO,
        NOW_21_CR,
      );
      salidas.push(llamadaAlWriter(repo).fecha);
    }
    expect(salidas).toEqual([DIA_21, DIA_22]);
    for (const f of salidas) expect(f.getTime()).toBeGreaterThanOrEqual(DIA_21.getTime());
  });

  it("con el reloj un dia mas tarde, «mañana» es el 23 (la fecha no esta congelada)", async () => {
    const repo = fakeRepo({ ordenes: [ordenRow({ fechaReparto: DIA_21 })] });
    await new CorreccionDiaRepartoService(repo).corregir(
      { ordenIds: ["o1"], dia: "manana", motivo: MOTIVO },
      MAESTRO,
      NOW_22_CR,
    );
    expect(llamadaAlWriter(repo).fecha).toEqual(DIA_23);
  });
});

// =================================================================================================
// R14 — UN CIERRE PENDIENTE NO BLOQUEA
// =================================================================================================

describe("262/R14 — un cierre de dia sin resolver NO bloquea la correccion", () => {
  it("el `Pick` del repo NO expone el predicado de bloqueo: es imposible consultarlo", () => {
    // La forma FUERTE de esta regla y la razon de que este escrita como test de TIPO y no de
    // comportamiento: un test que solo comprobara «procede con cierre pendiente» seguiria verde el
    // dia que alguien anadiera la consulta y la usara mal. Si el metodo no esta en el tipo del repo
    // que el service recibe, no hay descuido posible (patron `DeshacerAsignacionRepo`, 149/R19).
    const claves: (keyof CorreccionDiaRepartoRepo)[] = [
      "findUsuarioZonaId",
      "findByIdsForTransicion",
      "findEstatusIdByValue",
      "corregirDiaRepartoLote",
    ];
    expect(claves).toHaveLength(4);
    // @ts-expect-error `findMensajerosBloqueadosPorCierres` NO pertenece a este `Pick` (R14). Si
    // alguien lo anadiera, este `@ts-expect-error` se quedaria sin error que suprimir y
    // `pnpm typecheck` se pondria ROJO.
    const prohibido: keyof CorreccionDiaRepartoRepo = "findMensajerosBloqueadosPorCierres";
    expect(prohibido).toBe("findMensajerosBloqueadosPorCierres");
  });

  it("y en comportamiento: con un repo que NI SIQUIERA tiene ese metodo, la correccion procede", async () => {
    const repo = fakeRepo();
    expect((repo as unknown as Record<string, unknown>).findMensajerosBloqueadosPorCierres).toBeUndefined();
    const r = await new CorreccionDiaRepartoService(repo).corregir(
      { ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );
    expect(r.status).toBe("ok");
  });
});

// =================================================================================================
// GUARDIA DE CONFIGURACION + R10
// =================================================================================================

describe("262 — guardias de configuracion y forma del resultado", () => {
  it("catalogo incompleto => `validation_error`, sin escribir nada (fallo CERRADO)", async () => {
    const repo = fakeRepo({ catalogo: (v) => (v === "ayuda_tienda" ? null : `os-${v}`) });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] },
    });
    expect(repo.corregirDiaRepartoLote).not.toHaveBeenCalled();
  });

  it("R10: el `ok` dice CUANTAS quedaron y PARA QUE DIA (el token que la pantalla pone en palabras)", async () => {
    const repo = fakeRepo({
      ordenes: [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })],
      corregir: vi.fn(async () => [aplicada({ ordenId: "o1" }), aplicada({ ordenId: "o2", cambioId: "c-2" })]),
    });
    const service = new CorreccionDiaRepartoService(repo);

    const r = await service.corregir(
      { ordenIds: ["o1", "o2"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );

    expect(r).toEqual({ status: "ok", corregidas: 2, dia: "hoy" });
  });

  it("los ids repetidos se deduplican antes de escribir", async () => {
    const repo = fakeRepo();
    await new CorreccionDiaRepartoService(repo).corregir(
      { ordenIds: ["o1", "o1"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );
    expect(llamadaAlWriter(repo).ordenIds).toEqual(["o1"]);
  });

  it("el motivo del lote llega INTACTO al writer (es lo que queda en el rastro, R21)", async () => {
    const repo = fakeRepo();
    await new CorreccionDiaRepartoService(repo).corregir(
      { ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );
    expect(llamadaAlWriter(repo).ctx).toEqual({
      actorUsuarioId: MAESTRO.usuarioId,
      motivo: MOTIVO,
    });
  });
});

// =================================================================================================
// R46 / R49 / R50 / R51 / R55 — EL AVISO, DESDE EL SERVICIO
// =================================================================================================

describe("262/R46 — el aviso se emite FUERA de la transaccion y solo si esta confirmo", () => {
  it("una correccion => un aviso al MENSAJERO ASIGNADO, con la fecha nueva y el anexo", async () => {
    const avisos: unknown[] = [];
    const repo = fakeRepo({
      corregir: vi.fn(async () => [
        aplicada({ mensajeroAsignadoId: "m-9", numGuia: 17496963, fechaNueva: DIA_21 }),
      ]),
    });
    const service = new CorreccionDiaRepartoService(repo, async (ctx) => {
      avisos.push(ctx);
    });

    await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(avisos).toEqual([
      {
        cambioId: "c-1",
        mensajeroUsuarioId: "m-9",
        fechaNuevaISO: "2026-08-21",
        anexo: "17496963",
      },
    ]);
  });

  it("sin guia, el anexo es el numero de remision", async () => {
    const avisos: { anexo: string }[] = [];
    const repo = fakeRepo({
      corregir: vi.fn(async () => [aplicada({ numGuia: null, numRemision: "REM-77" })]),
    });
    await new CorreccionDiaRepartoService(repo, async (ctx) => {
      avisos.push(ctx as { anexo: string });
    }).corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(avisos[0].anexo).toBe("REM-77");
  });

  it("R48/A24: el contexto del aviso NO lleva el motivo escrito por quien corrigio", async () => {
    const avisos: Record<string, unknown>[] = [];
    const repo = fakeRepo();
    await new CorreccionDiaRepartoService(repo, async (ctx) => {
      avisos.push(ctx as unknown as Record<string, unknown>);
    }).corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(Object.keys(avisos[0]).sort()).toEqual([
      "anexo",
      "cambioId",
      "fechaNuevaISO",
      "mensajeroUsuarioId",
    ]);
    expect(JSON.stringify(avisos[0])).not.toContain(MOTIVO);
  });

  it("R50: DOS correcciones del lote => DOS avisos, uno por correccion", async () => {
    const avisos: { cambioId: string }[] = [];
    const repo = fakeRepo({
      ordenes: [ordenRow({ id: "o1" }), ordenRow({ id: "o2" })],
      corregir: vi.fn(async () => [
        aplicada({ ordenId: "o1", cambioId: "c-1" }),
        aplicada({ ordenId: "o2", cambioId: "c-2" }),
      ]),
    });
    await new CorreccionDiaRepartoService(repo, async (ctx) => {
      avisos.push(ctx as { cambioId: string });
    }).corregir({ ordenIds: ["o1", "o2"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(avisos.map((a) => a.cambioId)).toEqual(["c-1", "c-2"]);
  });

  it("R55: los DOS sentidos avisan igual (mañana->hoy y hoy->mañana)", async () => {
    // El caso que la puerta humana nombro es «mañana -> hoy» sobre una orden que el mensajero YA
    // lleva encima; pero el aviso no distingue sentido, y eso es deliberado (§15.6).
    for (const [dia, anterior, esperada] of [
      ["hoy", DIA_22, "2026-08-21"],
      ["manana", DIA_21, "2026-08-22"],
    ] as const) {
      const avisos: { fechaNuevaISO: string }[] = [];
      const repo = fakeRepo({
        ordenes: [ordenRow({ estatusValue: "en_reparto", fechaReparto: anterior })],
        corregir: vi.fn(async () => [
          aplicada({ fechaAnterior: anterior, fechaNueva: dia === "hoy" ? DIA_21 : DIA_22 }),
        ]),
      });
      await new CorreccionDiaRepartoService(repo, async (ctx) => {
        avisos.push(ctx as { fechaNuevaISO: string });
      }).corregir({ ordenIds: ["o1"], dia, motivo: MOTIVO }, MAESTRO, NOW_21_CR);

      expect(avisos).toHaveLength(1);
      expect(avisos[0].fechaNuevaISO).toBe(esperada);
    }
  });

  it("R49: un notificador que LANZA no tumba la correccion — sigue devolviendo `ok`", async () => {
    // Mata M-af (mover el aviso DENTRO de la `$transaction`): ahi un aviso caido abortaria la
    // transaccion entera y devolveria la orden al estado inalcanzable del que esta ficha existe
    // para sacarla. La direccion segura del error es la contraria.
    const repo = fakeRepo();
    const service = new CorreccionDiaRepartoService(repo, async () => {
      throw new Error("la campana esta caida");
    });

    const r = await service.corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r).toEqual({ status: "ok", corregidas: 1, dia: "hoy" });
    // Y la correccion SI se intento escribir: el `ok` no viene de haberse saltado el writer.
    expect(repo.corregirDiaRepartoLote).toHaveBeenCalledTimes(1);
  });

  it("con la escritura revertida NO se emite ni un aviso", async () => {
    const avisos: unknown[] = [];
    const repo = fakeRepo({
      corregir: vi.fn(async () => {
        throw new CorreccionDiaConflictoError(["o1"]);
      }),
    });
    const r = await new CorreccionDiaRepartoService(repo, async (ctx) => {
      avisos.push(ctx);
    }).corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(r.status).toBe("conflict");
    expect(avisos).toEqual([]);
  });

  it("y un lote rechazado en el pre-chequeo tampoco emite nada", async () => {
    const avisos: unknown[] = [];
    const repo = fakeRepo({ ordenes: [ordenRow({ estatusValue: "entregada" })] });
    await new CorreccionDiaRepartoService(repo, async (ctx) => {
      avisos.push(ctx);
    }).corregir({ ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO }, MAESTRO, NOW_21_CR);

    expect(avisos).toEqual([]);
  });

  it("el DEFAULT del notificador es el no-op: un service sin cablear no emite nada", async () => {
    // Patron `notificadores.ts:11-19`. Una suite que construya el service sin inyectar obtiene el
    // no-op POR CONSTRUCCION y no puede escribir en la base — que en este repo es compartida.
    const repo = fakeRepo();
    const r = await new CorreccionDiaRepartoService(repo).corregir(
      { ordenIds: ["o1"], dia: "hoy", motivo: MOTIVO },
      MAESTRO,
      NOW_21_CR,
    );
    expect(r.status).toBe("ok");
  });
});
