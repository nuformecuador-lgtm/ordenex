import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import type {
  CorreccionFechaAplicada,
  ICorreccionFechaReprogramacionRepository,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/ICorreccionFechaReprogramacionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DesenlaceLiberacion } from "@/lib/interfaces/services/ICorreccionFechaReprogramacionService";
import { CorreccionFechaReprogramacionService } from "@/lib/services/CorreccionFechaReprogramacionService";
import {
  desenlaceSinLiberar,
  liberarTrasCorregirFechaCon,
  liberarTrasCorregirFechaNoOp,
} from "@/lib/services/liberacion-tras-corregir-fecha";
import { fechaCalendarioCR, mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import {
  MSG_CARRERA,
  MSG_CATALOGO_INCOMPLETO,
  MSG_FECHA_INVALIDA,
  MSG_MOTIVO_REQUERIDO,
  MSG_ORDEN_BORRADA,
  MSG_ORDEN_NO_EXISTE,
  MSG_SIN_FECHA,
  MSG_SIN_GESTION,
  MSG_YA_ES_ESA_FECHA,
  msgEstadoNoReprogramada,
} from "@/lib/services/mensajes-correccion-fecha-reprogramacion";

// FICHA 371 — la logica de negocio de «corregir la fecha de una reprogramacion», con DOBLES.
//
// QUE SE PRUEBA AQUI Y QUE NO, dicho para que nadie lo confunda: aqui viven el ROL, el reloj
// inyectable, el pre-chequeo y la traduccion de los contadores de la liberacion al discriminante
// que la pantalla pinta. El `WHERE` de la escritura, el `FOR UPDATE`, el CHECK de la base y la
// atomicidad de los dos rastros NO se prueban aqui y NO PUEDEN: un doble no ejecuta SQL, y en este
// repo esta MEDIDO cuatro veces que una mutacion del `WHERE` deja los tests de servicio en verde.
// Eso vive en `tests/integration/db/correccion-fecha-reprogramacion.int.test.ts`, contra Postgres.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" as RolValue };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" as RolValue };
const MENSAJERO: Actor = { usuarioId: "u-mensajero", rol: "mensajero" as RolValue };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" as RolValue };
const SATELITE: Actor = { usuarioId: "u-satelite", rol: "adminSatelite" as RolValue };

const MOTIVO = "el mensajero eligio el dia equivocado al reprogramar";
const ORDEN_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * 22:30 CR del 2 de septiembre = 04:30Z del 3. Elegido a proposito: el dia UTC y el de Costa Rica
 * NO coinciden, asi que un «hoy» derivado con el helper equivocado saldria «3» y los limites de
 * fecha de abajo cambiarian de lado. Es la misma clase de hora que usa la suite de la 262.
 */
const NOW_2_CR = new Date("2026-09-03T04:30:00.000Z");
const HOY_CR = "2026-09-02";
const AYER_CR = "2026-09-01";
const MANANA_CR = "2026-09-03";

function ordenRow(overrides: Partial<OrdenParaCorreccionRow> = {}): OrdenParaCorreccionRow {
  return {
    ordenId: ORDEN_ID,
    estatusValue: "reprogramada",
    deletedAt: null,
    gestionVigenteId: "g-vigente",
    fechaReprogramacion: new Date("2026-09-04T00:00:00.000Z"), // el caso real: el 4
    ...overrides,
  };
}

function aplicada(overrides: Partial<CorreccionFechaAplicada> = {}): CorreccionFechaAplicada {
  return {
    gestionId: "g-vigente",
    cambioId: "c-1",
    fechaAnterior: new Date("2026-09-04T00:00:00.000Z"),
    fechaNueva: new Date(`${HOY_CR}T00:00:00.000Z`),
    ...overrides,
  };
}

interface Montaje {
  repo: ICorreccionFechaReprogramacionRepository;
  service: CorreccionFechaReprogramacionService;
  corregirFecha: ReturnType<typeof vi.fn>;
  findOrden: ReturnType<typeof vi.fn>;
  liberar: ReturnType<typeof vi.fn>;
}

function montar(
  opciones: {
    orden?: OrdenParaCorreccionRow | null;
    resultado?: CorreccionFechaAplicada | null;
    estatusId?: string | null;
    desenlace?: DesenlaceLiberacion;
  } = {},
): Montaje {
  const findOrden = vi.fn(async () =>
    opciones.orden === undefined ? ordenRow() : opciones.orden,
  );
  const corregirFecha = vi.fn(async () =>
    opciones.resultado === undefined ? aplicada() : opciones.resultado,
  );
  const liberar = vi.fn(async () => opciones.desenlace ?? "liberada");
  const repo = {
    findOrdenParaCorreccion: findOrden,
    corregirFecha,
  } as unknown as ICorreccionFechaReprogramacionRepository;
  const service = new CorreccionFechaReprogramacionService(
    repo,
    {
      // `=== undefined` y no `??`: `null` es el caso que se quiere poder pedir (catalogo sin seed),
      // y con `??` el doble lo convertiria en el id bueno y el test mediria otra cosa.
      findEstatusIdByValue: vi.fn(async () =>
        opciones.estatusId === undefined ? "os-reprogramada" : opciones.estatusId,
      ),
    },
    liberar as unknown as (ordenId: string) => Promise<DesenlaceLiberacion>,
  );
  return { repo, service, corregirFecha, findOrden, liberar };
}

function input(over: { fecha?: string; motivo?: string } = {}) {
  return { ordenId: ORDEN_ID, fecha: over.fecha ?? HOY_CR, motivo: over.motivo ?? MOTIVO };
}

// -------------------------------------------------------------------------------------------
// R-A · quien puede corregir
// -------------------------------------------------------------------------------------------

describe("371 — solo maestro y admin corrigen (el mensajero avisa, el coordinador corrige)", () => {
  it.each([
    ["maestro", MAESTRO],
    ["admin", ADMIN],
  ])("%s: la correccion procede", async (_nombre, actor) => {
    const { service } = montar();
    const r = await service.corregir(input(), actor, NOW_2_CR);
    expect(r.status).toBe("ok");
  });

  it.each([
    ["mensajero", MENSAJERO],
    ["adminTienda", TIENDA],
    ["adminSatelite", SATELITE],
  ])("%s: `forbidden` SIN TOCAR LA BASE", async (_nombre, actor) => {
    const { service, findOrden, corregirFecha, liberar } = montar();

    const r = await service.corregir(input(), actor, NOW_2_CR);

    expect(r).toEqual({ status: "forbidden" });
    // ⭑ Lo que de verdad importa: el rechazo se devuelve ANTES de leer nada, asi que un rol sin
    // permiso no puede ni averiguar el estado de una orden ajena.
    expect(findOrden).not.toHaveBeenCalled();
    expect(corregirFecha).not.toHaveBeenCalled();
    expect(liberar).not.toHaveBeenCalled();
  });

  it("⭑ el `adminSatelite` SI corrige el dia de reparto (262) y NO corrige esta fecha", async () => {
    // No es una omision: la 262 lo admite porque el dia de reparto es de SU zona y lo elige el.
    // Aqui la fecha la eligio un mensajero y quien corrige es el coordinador central. Si alguien
    // añade el rol, este caso se pone rojo y obliga a decidirlo por escrito.
    const { service } = montar();
    expect(await service.corregir(input(), SATELITE, NOW_2_CR)).toEqual({ status: "forbidden" });
  });
});

// -------------------------------------------------------------------------------------------
// R-B · la fecha: HOY en adelante, y el motivo obligatorio
// -------------------------------------------------------------------------------------------

describe("371 — las dos reglas del borde, revalidadas con el reloj inyectable", () => {
  it("⭑ HOY se acepta: es el caso REAL que origina la ficha (corregir del 4 al 3, estando a dia 3)", async () => {
    const { service, corregirFecha } = montar();
    const r = await service.corregir(input({ fecha: HOY_CR }), MAESTRO, NOW_2_CR);
    expect(r.status).toBe("ok");
    expect(corregirFecha).toHaveBeenCalledWith(expect.objectContaining({ fecha: HOY_CR }));
  });

  it("mañana tambien se acepta (no hay tope maximo)", async () => {
    const { service } = montar();
    expect((await service.corregir(input({ fecha: MANANA_CR }), MAESTRO, NOW_2_CR)).status).toBe(
      "ok",
    );
  });

  it("AYER se rechaza, y sin tocar la base", async () => {
    const { service, findOrden, corregirFecha } = montar();
    const r = await service.corregir(input({ fecha: AYER_CR }), MAESTRO, NOW_2_CR);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { fecha: [MSG_FECHA_INVALIDA] },
    });
    expect(findOrden).not.toHaveBeenCalled();
    expect(corregirFecha).not.toHaveBeenCalled();
  });

  it("un dia INEXISTENTE (2026-02-31) se rechaza: no rueda al 3 de marzo", async () => {
    const { service, corregirFecha } = montar();
    const r = await service.corregir(input({ fecha: "2026-02-31" }), MAESTRO, NOW_2_CR);
    expect(r.status).toBe("validation_error");
    expect(corregirFecha).not.toHaveBeenCalled();
  });

  it("⭑ el limite sale del RELOJ: la misma fecha vale hoy y no valdra pasado mañana", async () => {
    const { service } = montar();
    const dosDiasDespues = new Date("2026-09-05T04:30:00.000Z"); // 22:30 CR del 4
    expect((await service.corregir(input({ fecha: HOY_CR }), MAESTRO, NOW_2_CR)).status).toBe("ok");
    expect(
      (await service.corregir(input({ fecha: HOY_CR }), MAESTRO, dosDiasDespues)).status,
    ).toBe("validation_error");
  });

  it.each([
    ["vacio", ""],
    ["solo espacios", "   "],
  ])("⭑ motivo %s: rechazada y SIN escribir nada", async (_nombre, motivo) => {
    // Decision del humano: el motivo va, y con la MISMA regla que reprogramar (`motivoSchema`).
    const { service, findOrden, corregirFecha } = montar();
    const r = await service.corregir(input({ motivo }), MAESTRO, NOW_2_CR);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { motivo: [MSG_MOTIVO_REQUERIDO] },
    });
    expect(findOrden).not.toHaveBeenCalled();
    expect(corregirFecha).not.toHaveBeenCalled();
  });

  it("el motivo llega al repositorio ya RECORTADO", async () => {
    const { service, corregirFecha } = montar();
    await service.corregir(input({ motivo: `  ${MOTIVO}  ` }), MAESTRO, NOW_2_CR);
    expect(corregirFecha).toHaveBeenCalledWith(expect.objectContaining({ motivo: MOTIVO }));
  });

  it("un motivo de UNA letra vale: la regla es la de reprogramar, no el min(10) de la 262", async () => {
    const { service } = montar();
    expect((await service.corregir(input({ motivo: "x" }), MAESTRO, NOW_2_CR)).status).toBe("ok");
  });
});

// -------------------------------------------------------------------------------------------
// R-C · la ventana de estado, con su motivo NOMBRADO
// -------------------------------------------------------------------------------------------

describe("371 — solo se corrige mientras la orden sigue esperando", () => {
  it("la orden no existe", async () => {
    const { service, corregirFecha } = montar({ orden: null });
    expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
      status: "conflict",
      motivo: MSG_ORDEN_NO_EXISTE,
    });
    expect(corregirFecha).not.toHaveBeenCalled();
  });

  it("la orden esta borrada", async () => {
    const { service } = montar({ orden: ordenRow({ deletedAt: new Date() }) });
    expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
      status: "conflict",
      motivo: MSG_ORDEN_BORRADA,
    });
  });

  it.each(["en_reparto", "entregada", "en_bodega_central", "por_recoger"])(
    "⭑ estado `%s`: rechazada, y el motivo NOMBRA el estado",
    async (estatusValue) => {
      const { service, corregirFecha } = montar({ orden: ordenRow({ estatusValue }) });
      expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
        status: "conflict",
        motivo: msgEstadoNoReprogramada(estatusValue),
      });
      expect(corregirFecha).not.toHaveBeenCalled();
    },
  );

  it("sin gestion vigente que corregir", async () => {
    const { service } = montar({ orden: ordenRow({ gestionVigenteId: null }) });
    expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
      status: "conflict",
      motivo: MSG_SIN_GESTION,
    });
  });

  it("la gestion vigente no tiene fecha", async () => {
    const { service } = montar({ orden: ordenRow({ fechaReprogramacion: null }) });
    expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
      status: "conflict",
      motivo: MSG_SIN_FECHA,
    });
  });

  it("⭑ ya esta fijada para esa misma fecha: una correccion que no corrige nada", async () => {
    const { service, corregirFecha } = montar({
      orden: ordenRow({ fechaReprogramacion: new Date(`${HOY_CR}T00:00:00.000Z`) }),
    });
    expect(await service.corregir(input({ fecha: HOY_CR }), MAESTRO, NOW_2_CR)).toEqual({
      status: "conflict",
      motivo: MSG_YA_ES_ESA_FECHA,
    });
    expect(corregirFecha).not.toHaveBeenCalled();
  });

  it("⭑ el cierre APROBADO no bloquea: 18 de las 31 lo estan y quedarian sin arreglo", async () => {
    // Decision del humano. El servicio no pregunta por el cierre en NINGUN punto de la ventana: la
    // unica condicion es que la orden siga en `reprogramada`. Si alguien añadiera esa guarda, este
    // caso —que es el mayoritario en produccion— se pondria rojo.
    const { service } = montar();
    expect((await service.corregir(input(), MAESTRO, NOW_2_CR)).status).toBe("ok");
  });

  it("catalogo de estados incompleto: fallo CERRADO, sin escribir", async () => {
    const { service, corregirFecha } = montar({ estatusId: null });
    expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
      status: "validation_error",
      fieldErrors: { estatus: [MSG_CATALOGO_INCOMPLETO] },
    });
    expect(corregirFecha).not.toHaveBeenCalled();
  });

  it("carrera perdida en la escritura: `conflict` y NO se dispara la liberacion", async () => {
    const { service, liberar } = montar({ resultado: null });
    expect(await service.corregir(input(), MAESTRO, NOW_2_CR)).toEqual({
      status: "conflict",
      motivo: MSG_CARRERA,
    });
    expect(liberar).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------------------------
// R-D · el desenlace que la pantalla pinta
// -------------------------------------------------------------------------------------------

describe("371 — el resultado dice si la orden quedo liberada o sigue esperando", () => {
  it.each<DesenlaceLiberacion>(["liberada", "espera_cierre", "espera_fecha"])(
    "propaga el desenlace `%s` tal cual",
    async (desenlace) => {
      const { service, liberar } = montar({ desenlace });
      const r = await service.corregir(input(), MAESTRO, NOW_2_CR);
      expect(r).toMatchObject({ status: "ok", liberacion: desenlace });
      // ⭑ La FECHA viaja con la llamada: sin ella el camino de la liberacion no puede distinguir
      // «espera al calendario» de «no se pudo confirmar».
      expect(liberar).toHaveBeenCalledWith(ORDEN_ID, HOY_CR);
    },
  );

  it("devuelve las DOS fechas como fechas calendario, no como instantes", async () => {
    const { service } = montar({
      resultado: aplicada({ fechaAnterior: new Date("2026-09-04T00:00:00.000Z") }),
    });
    const r = await service.corregir(input({ fecha: HOY_CR }), MAESTRO, NOW_2_CR);
    expect(r).toMatchObject({
      status: "ok",
      ordenId: ORDEN_ID,
      gestionId: "g-vigente",
      fechaAnterior: "2026-09-04",
      fechaNueva: HOY_CR,
    });
  });

  it("⭑ la liberacion se dispara DESPUES de la escritura, nunca antes", async () => {
    // Si se disparara antes, decidiria leyendo la fecha VIEJA: una orden corregida a hoy se
    // quedaria esperando, y la pantalla diria «espera_fecha» sobre una fecha que ya es hoy.
    const orden: string[] = [];
    const repo = {
      findOrdenParaCorreccion: vi.fn(async () => ordenRow()),
      corregirFecha: vi.fn(async () => {
        orden.push("escritura");
        return aplicada();
      }),
    } as unknown as ICorreccionFechaReprogramacionRepository;
    const service = new CorreccionFechaReprogramacionService(
      repo,
      { findEstatusIdByValue: vi.fn(async () => "os-reprogramada") },
      async () => {
        orden.push("liberacion");
        return "liberada";
      },
    );

    await service.corregir(input(), MAESTRO, NOW_2_CR);

    expect(orden).toEqual(["escritura", "liberacion"]);
  });
});

// -------------------------------------------------------------------------------------------
// R-E · la traduccion de los contadores al desenlace (el adaptador)
// -------------------------------------------------------------------------------------------

describe("371 — `liberarTrasCorregirFechaCon` traduce los contadores de la liberacion", () => {
  const NOW = () => new Date("2026-09-02T18:00:00.000Z"); // 12:00 CR del 2

  function conResultado(resultado: {
    evaluadas: number;
    liberadas: number;
    omitidas: number;
    esperandoCierre?: number;
  }) {
    const liberarOrdenCorregida = vi.fn(async () => resultado);
    return { liberarOrdenCorregida, fn: liberarTrasCorregirFechaCon({ liberarOrdenCorregida }, NOW) };
  }

  it("liberadas: 1 -> `liberada`", async () => {
    const { fn } = conResultado({ evaluadas: 1, liberadas: 1, omitidas: 0, esperandoCierre: 0 });
    expect(await fn(ORDEN_ID, HOY_CR)).toBe("liberada");
  });

  it("⭑ esperandoCierre: 1 -> `espera_cierre` (la puerta de la 276, no un fallo)", async () => {
    const { fn } = conResultado({ evaluadas: 1, liberadas: 0, omitidas: 0, esperandoCierre: 1 });
    expect(await fn(ORDEN_ID, HOY_CR)).toBe("espera_cierre");
  });

  it("evaluadas: 0 con fecha FUTURA -> `espera_fecha` (espera al calendario, y es verdad)", async () => {
    const { fn } = conResultado({ evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 });
    expect(await fn(ORDEN_ID, MANANA_CR)).toBe("espera_fecha");
  });

  it("⭑ pasa `startOfDayCR(now)`, no `new Date()` a secas", async () => {
    const { liberarOrdenCorregida, fn } = conResultado({
      evaluadas: 1,
      liberadas: 1,
      omitidas: 0,
    });
    await fn(ORDEN_ID, HOY_CR);
    // 12:00 CR del 2 -> la medianoche UTC del 2 (convencion `@db.Date`). Con `new Date()` seria
    // 18:00Z y una orden con fecha de HOY quedaria fuera del `<=` durante toda la mañana.
    expect(liberarOrdenCorregida).toHaveBeenCalledWith(
      ORDEN_ID,
      new Date("2026-09-02T00:00:00.000Z"),
    );
  });

  it("si la liberacion revienta, NO propaga: la correccion ya esta escrita", async () => {
    const avisos: string[] = [];
    const fn = liberarTrasCorregirFechaCon(
      {
        liberarOrdenCorregida: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
      NOW,
      { warn: (m) => avisos.push(m) },
    );

    expect(await fn(ORDEN_ID, MANANA_CR)).toBe("espera_fecha");
    // No es un `catch` vacio: queda dicho, con su causa y SIN el id de la orden.
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("db down");
    expect(avisos[0]).not.toContain(ORDEN_ID);
  });
});

// -------------------------------------------------------------------------------------------
// R-F · EL TEXTO QUE MENTIA: «espera a ese dia» sobre un dia que YA es hoy
// -------------------------------------------------------------------------------------------

describe("371 — con la fecha ya vencida, NUNCA se afirma que la orden espera al calendario", () => {
  // ⚠️ POR QUE ESTE BLOQUE EXISTE. Hasta el 2026-09-03 todo el residuo caia en `espera_fecha`, y la
  // pantalla pintaba «La orden espera a ese dia: vuelve sola a la bodega cuando llegue» — sobre un
  // dia que ya era HOY. La correccion se guardaba bien y la corrida de las 00:00 lo arreglaba solo,
  // asi que el daño estaba acotado a un dia; pero el mensaje era FALSO mientras tanto, y en esta
  // ficha el mensaje es medio producto. No habia NI UN test que ejerciera este camino: por eso pudo
  // quedar mal sin que nada se pusiera rojo.

  const NOW = () => new Date("2026-09-02T18:00:00.000Z"); // 12:00 CR del 2

  it("⭑ la liberacion REVIENTA tras corregir a HOY -> `espera_cierre`, no `espera_fecha`", async () => {
    const { fn, avisos } = conFalloDeLiberacion();

    // «espera_cierre» dice lo unico cierto —la orden todavia no vuelve— sin inventar una fecha
    // futura. La corrida de medianoche sigue siendo la red, y queda dicho en el log.
    expect(await fn(ORDEN_ID, HOY_CR)).toBe("espera_cierre");
    expect(avisos[0]).toContain("00:00 CR");
  });

  it("⭑ la liberacion revienta tras corregir a AYER (fecha ya vencida) -> `espera_cierre`", async () => {
    // El servicio no admite corregir al pasado, pero el adaptador no puede suponerlo: lo que
    // decide es si la fecha YA LLEGO, y ayer llego mas todavia.
    const { fn } = conFalloDeLiberacion();
    expect(await fn(ORDEN_ID, AYER_CR)).toBe("espera_cierre");
  });

  it("⭑ residual SIN excepcion (una `omitida`) con fecha de HOY -> `espera_cierre`", async () => {
    // La orden se evaluo y no salio, pero no fue por la puerta del cierre: una carrera, un
    // catalogo incompleto o un fallo por orden. Tampoco aqui se puede decir «espera a ese dia».
    const { fn } = conResultado({ evaluadas: 1, liberadas: 0, omitidas: 1, esperandoCierre: 0 });
    expect(await fn(ORDEN_ID, HOY_CR)).toBe("espera_cierre");
  });

  it("residual con fecha FUTURA sigue siendo `espera_fecha`: ahi la frase SI es verdad", async () => {
    // El control positivo. Sin el, los tres de arriba pasarian igual con un adaptador que
    // devolviera siempre `espera_cierre`.
    const { fn } = conResultado({ evaluadas: 0, liberadas: 0, omitidas: 0, esperandoCierre: 0 });
    expect(await fn(ORDEN_ID, MANANA_CR)).toBe("espera_fecha");
  });

  it("⭑ el NO-OP del constructor aplica la MISMA regla, no una suya", async () => {
    // Un servicio construido sin cablear el liberador tampoco puede afirmar que una orden espera a
    // un dia que ya paso. `desenlaceSinLiberar` es el unico sitio donde vive esa decision.
    const hoy = fechaCalendarioCR();
    const manana = mananaCalendarioCR();
    expect(await liberarTrasCorregirFechaNoOp(ORDEN_ID, hoy)).toBe("espera_cierre");
    expect(await liberarTrasCorregirFechaNoOp(ORDEN_ID, manana)).toBe("espera_fecha");
  });

  it("`desenlaceSinLiberar` decide por el calendario de CR, no por el UTC", async () => {
    // 23:59 CR del 2 = 05:59Z del 3: para UTC ya es dia 3, para CR sigue siendo el 2. El dia 2
    // TIENE que contar como ya vencido y el 3 como futuro.
    const casiMedianocheCR = new Date("2026-09-03T05:59:00.000Z");
    expect(desenlaceSinLiberar(HOY_CR, casiMedianocheCR)).toBe("espera_cierre");
    expect(desenlaceSinLiberar(MANANA_CR, casiMedianocheCR)).toBe("espera_fecha");
  });

  /** Un liberador REAL cuyo servicio revienta, con su log capturado. */
  function conFalloDeLiberacion() {
    const avisos: string[] = [];
    const fn = liberarTrasCorregirFechaCon(
      {
        liberarOrdenCorregida: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
      NOW,
      { warn: (m) => avisos.push(m) },
    );
    return { fn, avisos };
  }

  function conResultado(resultado: {
    evaluadas: number;
    liberadas: number;
    omitidas: number;
    esperandoCierre?: number;
  }) {
    return {
      fn: liberarTrasCorregirFechaCon({ liberarOrdenCorregida: vi.fn(async () => resultado) }, NOW),
    };
  }
});
