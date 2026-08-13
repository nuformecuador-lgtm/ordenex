import { describe, it, expect, vi } from "vitest";
import * as accionesLiquidacion from "@/lib/actions/liquidacion";
import {
  previsualizarRepartoMensajeroAction,
  registrarRepartoMensajeroAction,
} from "@/lib/actions/liquidacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ILiquidacionService } from "@/lib/interfaces/services/ILiquidacionService";
import type { PrevisualizacionRepartoDTO, RepartoAplicadoDTO } from "@/lib/types/liquidacion-reparto";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 205 / T4.3 — el BORDE del reparto: las dos Server Actions. Cubre R2 (sin sesion ->
// `unauthenticated` ANTES de nada), R9 (`cierreId` colado muere en el borde), R46/R47 (forma y
// montos STRING) y R52 (la superficie del modulo, ampliada a siete y ni una mas).
//
// Reparto de responsabilidades que estos casos fijan, igual que en la suite de la 172: la SESION
// y la FORMA se resuelven aqui; el ROL, el tope, el reparto y la idempotencia los decide el
// servicio y la accion los devuelve tal cual. Un `forbidden` nacido aqui seria un guard duplicado
// que podria divergir del real.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const SIN_ACCESO: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };

const HOY_CR = fechaCalendarioCR(new Date());
const MANANA_CR = fechaCalendarioCR(new Date(Date.now() + 24 * 60 * 60 * 1000));

const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MENSAJERO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CIERRE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function previsualizacion(): PrevisualizacionRepartoDTO {
  return {
    mensajeroNombre: "Marco Mensajero",
    imputable: "25000.00",
    imputableTotal: "25000.00",
    cuentaPorPagar: "25000.00",
    deudaNoImputable: { hay: false, monto: "0.00" },
    recorte: { aplicado: false, tope: 50, enVentana: 3, fuera: 0, montoFuera: "0.00" },
    imputaciones: [
      {
        cierreId: CIERRE,
        solicitadoAt: "2026-07-01T10:00:00.000Z",
        pendienteActual: "5000.00",
        monto: "5000.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
    ],
    sobrante: "0.00",
    excede: false,
    excluidos: [],
  };
}

function repartoAplicado(): RepartoAplicadoDTO {
  return {
    totalImputado: "15000.00",
    restanteImputable: "10000.00",
    imputaciones: [{ cierreId: CIERRE, monto: "15000.00", pendienteDespues: "0.00" }],
  };
}

function fakeService(overrides: Partial<ILiquidacionService> = {}): ILiquidacionService {
  return {
    registrarPagoMensajero: vi.fn(),
    registrarPagoTienda: vi.fn(),
    anularPago: vi.fn(),
    listarPagosDeCierre: vi.fn(),
    listarPagosDeTienda: vi.fn(),
    previsualizarRepartoMensajero: vi.fn(async () => ({
      status: "ok" as const,
      previsualizacion: previsualizacion(),
    })),
    registrarRepartoMensajero: vi.fn(async () => ({
      status: "ok" as const,
      reparto: repartoAplicado(),
    })),
    ...overrides,
  } as unknown as ILiquidacionService;
}

/** Peticion valida de REGISTRO del reparto (sin `cierreId`: no existe en el contrato, R9). */
function inputRegistro(over: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE,
    mensajeroId: MENSAJERO,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    fechaPago: HOY_CR,
    ...over,
  };
}

describe("R2 — sin sesion se rechaza ANTES de evaluar ningun otro dato", () => {
  it("previsualizar sin sesion -> `unauthenticated`, sin tocar el servicio", async () => {
    const service = fakeService();

    const r = await previsualizarRepartoMensajeroAction(
      { mensajeroId: MENSAJERO },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.previsualizarRepartoMensajero).not.toHaveBeenCalled();
  });

  it("registrar sin sesion -> `unauthenticated`, sin tocar el servicio", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro(), {
      service,
      getActor: async () => null,
    });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.registrarRepartoMensajero).not.toHaveBeenCalled();
  });

  it("R2 (el ORDEN): sin sesion Y con una peticion invalida, gana `unauthenticated`", async () => {
    // Es la unica forma de medir que la sesion se resuelve ANTES de la forma: si el `parse`
    // corriera primero, la respuesta seria `validation_error` y el borde estaria diciendo algo
    // sobre la peticion de alguien que ni siquiera esta identificado.
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(
      { mensajeroId: "no-es-uuid", monto: 15000 },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("con sesion, la accion SI llama al servicio (si no, lo de arriba no diria nada)", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro(), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("ok");
    expect(service.registrarRepartoMensajero).toHaveBeenCalledTimes(1);
    // El actor llega TAL CUAL al servicio: el rol lo decide el, no este borde.
    expect(service.registrarRepartoMensajero).toHaveBeenCalledWith(expect.anything(), MAESTRO);
  });

  it("el `forbidden` del rol lo emite el SERVICIO y la accion lo devuelve sin reinterpretarlo", async () => {
    const service = fakeService({
      registrarRepartoMensajero: vi.fn(async () => ({ status: "forbidden" as const })),
      previsualizarRepartoMensajero: vi.fn(async () => ({ status: "forbidden" as const })),
    });

    const registro = await registrarRepartoMensajeroAction(inputRegistro(), {
      service,
      getActor: async () => SIN_ACCESO,
    });
    const previa = await previsualizarRepartoMensajeroAction(
      { mensajeroId: MENSAJERO },
      { service, getActor: async () => SIN_ACCESO },
    );

    expect(registro).toEqual({ status: "forbidden" });
    expect(previa).toEqual({ status: "forbidden" });
  });
});

describe("R9/R47 — la peticion NO puede elegir contra que cierre se imputa", () => {
  // Nota medida, no supuesta: una clave DESCONOCIDA es un `unrecognized_keys` de zod, cuyo
  // `path` esta VACIO, asi que `z.flattenError(...).fieldErrors` —lo que este borde emite desde
  // la 172— no la lleva. La clave se nombra donde de verdad existe: en el schema, y hay un caso
  // que lo afirma en `tests/unit/types/liquidacion-reparto-schema.test.ts`. Aqui se mide lo que
  // este archivo puede medir: que se rechaza y que el servicio NO se entera.
  it("R9: un `cierreId` colado en el REGISTRO muere en el borde", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro({ cierreId: CIERRE }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    // Y el servicio no llega a enterarse: el rechazo ocurre ANTES de tocar datos (R47).
    expect(service.registrarRepartoMensajero).not.toHaveBeenCalled();
  });

  it("R9: un `cierreId` colado en la PREVISUALIZACION muere igual", async () => {
    const service = fakeService();

    const r = await previsualizarRepartoMensajeroAction(
      { mensajeroId: MENSAJERO, cierreId: CIERRE },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(service.previsualizarRepartoMensajero).not.toHaveBeenCalled();
  });

  it("R47: cualquier otra clave desconocida tambien muere (`.strict()`, no una lista de nombres)", async () => {
    const service = fakeService();

    for (const extra of [{ tiendaId: CIERRE }, { archivo: "x.png" }, { repartoId: "rep-1" }]) {
      const r = await registrarRepartoMensajeroAction(inputRegistro(extra), {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r.status, JSON.stringify(extra)).toBe("validation_error");
    }
    expect(service.registrarRepartoMensajero).not.toHaveBeenCalled();
  });
});

describe("R46/R47 — la forma del dinero y de la fecha, validada en el borde", () => {
  it("R46: un `monto` NUMERICO no se coerciona: muere con `validation_error`", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro({ monto: 15000 }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("monto");
    expect(service.registrarRepartoMensajero).not.toHaveBeenCalled();
  });

  it("R46: tampoco en la previsualizacion, que es el mismo validador del pago", async () => {
    const service = fakeService();

    const r = await previsualizarRepartoMensajeroAction(
      { mensajeroId: MENSAJERO, monto: 15000 },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
  });

  it("un monto de cero o negativo no pasa (es el `montoPositivoSchema` reusado)", async () => {
    const service = fakeService();

    for (const monto of ["0.00", "-1.00", "abc", "1.005"]) {
      const r = await registrarRepartoMensajeroAction(inputRegistro({ monto }), {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r.status, monto).toBe("validation_error");
    }
  });

  it("[P6]/R12: la referencia es OBLIGATORIA en SINPE y en transferencia, y opcional en efectivo", async () => {
    const service = fakeService();

    for (const metodo of ["SINPE", "transferencia"]) {
      const r = await registrarRepartoMensajeroAction(
        inputRegistro({ metodo, referencia: undefined }),
        { service, getActor: async () => MAESTRO },
      );
      expect(r.status, metodo).toBe("validation_error");
      if (r.status !== "validation_error") return;
      expect(Object.keys(r.fieldErrors), metodo).toContain("referencia");
    }

    const efectivo = await registrarRepartoMensajeroAction(
      inputRegistro({ metodo: "efectivo", referencia: undefined }),
      { service, getActor: async () => MAESTRO },
    );
    expect(efectivo.status).toBe("ok");
  });

  it("R10 de la 172: la fecha del pago no puede ser posterior a hoy (hora de Costa Rica)", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro({ fechaPago: MANANA_CR }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("fechaPago");
  });

  it("la clave de idempotencia tiene que ser un uuid: la acuña el CLIENTE al abrir (R27)", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro({ claveIdempotencia: "1" }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("claveIdempotencia");
  });

  it("la clave del cliente llega INTACTA al servicio: el borde no la regenera", async () => {
    // Si el borde acuñara la clave, cada reintento traeria una distinta y la idempotencia no
    // protegeria de nada (R31).
    const service = fakeService();

    await registrarRepartoMensajeroAction(inputRegistro(), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(service.registrarRepartoMensajero).toHaveBeenCalledWith(
      expect.objectContaining({ claveIdempotencia: CLAVE }),
      MAESTRO,
    );
  });
});

describe("los resultados del servicio cruzan tal cual, con montos STRING", () => {
  it("`ok` devuelve el reparto aplicado, con todos los importes como texto", async () => {
    const service = fakeService();

    const r = await registrarRepartoMensajeroAction(inputRegistro(), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.reparto.totalImputado).toMatch(/^\d+\.\d{2}$/);
    expect(r.reparto.restanteImputable).toMatch(/^\d+\.\d{2}$/);
    for (const imputacion of r.reparto.imputaciones) {
      expect(imputacion.monto).toMatch(/^\d+\.\d{2}$/);
      expect(imputacion.pendienteDespues).toMatch(/^\d+\.\d{2}$/);
    }
    // R46: ni un `number` suelto en toda la respuesta.
    expect(JSON.stringify(r).match(/:\s*-?\d+(\.\d+)?\s*[,}]/g)).toBeNull();
  });

  it("`excede`, `sin_saldo` y `ya_registrado` llegan sin reinterpretar", async () => {
    for (const respuesta of [
      { status: "excede" as const, disponible: "13000.00" },
      { status: "sin_saldo" as const },
      { status: "ya_registrado" as const, reparto: repartoAplicado() },
    ]) {
      const service = fakeService({ registrarRepartoMensajero: vi.fn(async () => respuesta) });
      const r = await registrarRepartoMensajeroAction(inputRegistro(), {
        service,
        getActor: async () => MAESTRO,
      });
      expect(r).toEqual(respuesta);
    }
  });

  it("la previsualizacion cruza sus dos avisos y sus cifras sin tocarlas", async () => {
    const service = fakeService();

    const r = await previsualizarRepartoMensajeroAction(
      { mensajeroId: MENSAJERO, monto: "15000.00" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.previsualizacion).toEqual(previsualizacion());
    // R48: el NOMBRE del mensajero, nunca su id.
    expect(JSON.stringify(r)).not.toContain(MENSAJERO);
  });

  it("el `monto` es opcional en la previsualizacion: sin el, tambien se pide al servicio", async () => {
    const service = fakeService();

    const r = await previsualizarRepartoMensajeroAction(
      { mensajeroId: MENSAJERO },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    expect(service.previsualizarRepartoMensajero).toHaveBeenCalledWith(
      { mensajeroId: MENSAJERO },
      MAESTRO,
    );
  });
});

describe("R52 — la superficie del modulo tras la 205", () => {
  it("las dos acciones del reparto existen, son asincronas y no hay ninguna de corregirlo", () => {
    // La lista EXACTA de las siete vive en `liquidacion-action.test.ts` (donde la 172 la dejo).
    // Aqui se afirma lo propio de la 205: que lo que se anadio es previsualizar y registrar, y
    // que no se colo nada que edite, anule en bloque o deshaga un reparto (design §10.5, Q3).
    const delReparto = Object.keys(accionesLiquidacion).filter((n) => /reparto/i.test(n));
    expect(delReparto.sort()).toEqual([
      "anularRepartoAction",
      "previsualizarRepartoMensajeroAction",
      "registrarRepartoMensajeroAction",
    ]);
    for (const nombre of delReparto) {
      expect(typeof (accionesLiquidacion as Record<string, unknown>)[nombre]).toBe("function");
      expect(nombre).not.toMatch(/editar|actualizar|modificar|corregir|desanular|deshacer/i);
    }
  });
});
