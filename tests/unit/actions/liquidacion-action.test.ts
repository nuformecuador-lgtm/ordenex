import { describe, it, expect, vi } from "vitest";
import * as accionesLiquidacion from "@/lib/actions/liquidacion";
import {
  registrarPagoMensajeroAction,
  registrarPagoTiendaAction,
} from "@/lib/actions/liquidacion";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ILiquidacionService } from "@/lib/interfaces/services/ILiquidacionService";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 172 / T B.7 — Server Actions de REGISTRO. Cubre R3 (sin sesion -> `unauthenticated`
// ANTES de tocar el servicio), R14 (ningun monto viaja como `number`) y R65 (no se exporta
// ninguna accion de EDITAR un pago).
//
// Reparto de responsabilidades que estos tests fijan: la SESION y la FORMA se resuelven en el
// borde; el ROL, el tope y la idempotencia los decide el servicio y la accion los devuelve tal
// cual. Un `forbidden` que naciera aqui seria un guard duplicado que podria divergir del real.
//
// La fecha del pago se calcula con `fechaCalendarioCR(new Date())` y no se escribe a mano: el
// schema rechaza fechas futuras (R10), asi que una constante quedaria en el futuro —o en el
// pasado imposible— segun el dia en que se corra la suite.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const SIN_ACCESO: Actor = { usuarioId: "u-sat", rol: "adminSatelite" };

const HOY_CR = fechaCalendarioCR(new Date());
const MANANA_CR = fechaCalendarioCR(new Date(Date.now() + 24 * 60 * 60 * 1000));

const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CIERRE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TIENDA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function comprobante(): PagoRegistradoDTO {
  return {
    id: "pago-1",
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    nota: null,
    fechaPago: HOY_CR,
    registradoPorNombre: "Ana Admin",
    registradoAt: "2026-08-02T15:04:05.000Z",
    anulacion: null,
  };
}

function fakeService(overrides: Partial<ILiquidacionService> = {}): ILiquidacionService {
  return {
    registrarPagoMensajero: vi.fn(async () => ({
      status: "ok" as const,
      pago: comprobante(),
      restante: "35000.00",
    })),
    registrarPagoTienda: vi.fn(async () => ({
      status: "ok" as const,
      pago: comprobante(),
      restante: "85000.00",
    })),
    ...overrides,
  };
}

/** Peticion valida de pago a un MENSAJERO (contra un cierre aprobado). */
function inputMensajero(over: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE,
    cierreId: CIERRE,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    fechaPago: HOY_CR,
    ...over,
  };
}

/** Peticion valida de pago a una TIENDA (contra su saldo acumulado). */
function inputTienda(over: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE,
    tiendaId: TIENDA,
    monto: "15000.00",
    metodo: "efectivo",
    fechaPago: HOY_CR,
    ...over,
  };
}

describe("R3 — sin sesion se rechaza ANTES de evaluar ningun otro dato", () => {
  it("pago a mensajero sin sesion -> `unauthenticated`, sin tocar el servicio", async () => {
    const service = fakeService();

    const r = await registrarPagoMensajeroAction(inputMensajero(), {
      service,
      getActor: async () => null,
    });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.registrarPagoMensajero).not.toHaveBeenCalled();
  });

  it("pago a tienda sin sesion -> `unauthenticated`, sin tocar el servicio", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(inputTienda(), {
      service,
      getActor: async () => null,
    });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.registrarPagoTienda).not.toHaveBeenCalled();
  });

  it("sin sesion Y con la peticion rota, gana `unauthenticated` (el orden importa)", async () => {
    // R3 dice «antes de evaluar ningun otro dato». Si zod corriera primero, una peticion basura
    // de un anonimo revelaria que campos existen y como se validan.
    const service = fakeService();

    const r = await registrarPagoTiendaAction(
      { basura: true },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.registrarPagoTienda).not.toHaveBeenCalled();
  });
});

describe("el borde valida la FORMA; el servicio decide el resto", () => {
  it("ZodError -> `validation_error` POR CAMPO, sin tocar el servicio", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(inputTienda({ monto: "0" }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("monto");
    expect(service.registrarPagoTienda).not.toHaveBeenCalled();
  });

  it("R10: una fecha de manana (hora de Costa Rica) no pasa el borde", async () => {
    const service = fakeService();

    const r = await registrarPagoMensajeroAction(inputMensajero({ fechaPago: MANANA_CR }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("fechaPago");
    expect(service.registrarPagoMensajero).not.toHaveBeenCalled();
  });

  it("R12: SINPE sin referencia muere en el borde, en el campo `referencia`", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(
      inputTienda({ metodo: "SINPE", referencia: undefined }),
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("referencia");
  });

  it("R15 [P7]: un comprobante adjunto no entra (`.strict()`)", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(inputTienda({ comprobante: "data:image/png;…" }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    expect(service.registrarPagoTienda).not.toHaveBeenCalled();
  });

  it("R29: un `cierreId` colado en el pago a una TIENDA se rechaza", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(inputTienda({ cierreId: CIERRE }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    expect(service.registrarPagoTienda).not.toHaveBeenCalled();
  });

  it("R21: un pago a mensajero SIN cierre se rechaza en el borde", async () => {
    const service = fakeService();

    const r = await registrarPagoMensajeroAction(inputMensajero({ cierreId: undefined }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("cierreId");
    expect(service.registrarPagoMensajero).not.toHaveBeenCalled();
  });

  it("al servicio le llega el input PARSEADO, con el actor de la sesion", async () => {
    const service = fakeService();

    await registrarPagoMensajeroAction(inputMensajero(), {
      service,
      getActor: async () => ADMIN,
    });

    const mock = service.registrarPagoMensajero as unknown as { mock: { calls: unknown[][] } };
    const [data, actor] = mock.mock.calls[0];
    expect(data).toEqual({
      claveIdempotencia: CLAVE,
      cierreId: CIERRE,
      monto: "15000.00",
      metodo: "SINPE",
      referencia: "1234567",
      fechaPago: HOY_CR,
    });
    // El actor NO sale de la peticion: sale de la sesion (R5).
    expect(actor).toEqual(ADMIN);
  });
});

describe("R14 — ningun monto viaja como `number` por la Server Action", () => {
  it("un monto numerico se RECHAZA en el borde (sin coercion silenciosa)", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(inputTienda({ monto: 15000 }), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("monto");
    expect(service.registrarPagoTienda).not.toHaveBeenCalled();
  });

  it("el monto que llega al servicio sigue siendo el MISMO string", async () => {
    const service = fakeService();

    await registrarPagoTiendaAction(inputTienda({ monto: "15000.5" }), {
      service,
      getActor: async () => MAESTRO,
    });

    const mock = service.registrarPagoTienda as unknown as { mock: { calls: unknown[][] } };
    const data = mock.mock.calls[0][0] as { monto: unknown };
    expect(data.monto).toBe("15000.5"); // el borde no redondea ni convierte: eso es del servicio
    expect(typeof data.monto).toBe("string");
  });

  it("todo monto de la respuesta es STRING de escala 2", async () => {
    const service = fakeService();

    const r = await registrarPagoMensajeroAction(inputMensajero(), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(typeof r.pago.monto).toBe("string");
    expect(typeof r.restante).toBe("string");
    expect(r.pago.monto).toMatch(/^\d+\.\d{2}$/);
    expect(r.restante).toMatch(/^\d+\.\d{2}$/);
    // Y ni un `number` en toda la respuesta serializada (R14 de punta a punta).
    const numerosSueltos = JSON.stringify(r).match(/:\s*-?\d+(\.\d+)?\s*[,}]/g);
    expect(numerosSueltos).toBeNull();
  });
});

describe("los resultados de DOMINIO se devuelven tal cual (el borde no los reinventa)", () => {
  const casos: [string, Record<string, unknown>][] = [
    ["forbidden (R1/R6: el rol lo decide el servicio)", { status: "forbidden" }],
    ["cierre_no_aprobado (R20)", { status: "cierre_no_aprobado" }],
    ["excede con el disponible [P1] (R25)", { status: "excede", disponible: "20000.00" }],
    ["sin_saldo (R32)", { status: "sin_saldo" }],
    ["no_encontrado", { status: "no_encontrado" }],
  ];

  for (const [nombre, resultado] of casos) {
    it(`pago a mensajero: ${nombre}`, async () => {
      const service = fakeService({
        registrarPagoMensajero: vi.fn(async () => resultado as never),
      });

      const r = await registrarPagoMensajeroAction(inputMensajero(), {
        service,
        getActor: async () => SIN_ACCESO,
      });

      expect(r).toEqual(resultado);
    });
  }

  it("R43/R47: `ya_registrado` llega con su comprobante y su restante", async () => {
    const service = fakeService({
      registrarPagoTienda: vi.fn(async () => ({
        status: "ya_registrado" as const,
        pago: comprobante(),
        restante: "85000.00",
      })),
    });

    const r = await registrarPagoTiendaAction(inputTienda(), {
      service,
      getActor: async () => MAESTRO,
    });

    expect(r).toMatchObject({ status: "ya_registrado", restante: "85000.00" });
  });

  it("R56: el comprobante que cruza no lleva ids internos ni la clave de idempotencia", async () => {
    const service = fakeService();

    const r = await registrarPagoTiendaAction(inputTienda(), {
      service,
      getActor: async () => MAESTRO,
    });

    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain(CLAVE);
    expect(serializado).not.toContain(TIENDA);
    expect(serializado).not.toContain("u-maestro");
  });
});

describe("R65 — NO se exporta ninguna accion de EDITAR un pago", () => {
  it("la superficie del modulo es EXACTAMENTE la de registrar", () => {
    // Lista cerrada a proposito: T C.1 (listados) y T F.4 (anulacion) la amplian, y al hacerlo
    // tendran que tocar este test — que es justo el momento de mirar si lo que se anade tiene
    // derecho a existir. Un `editarPagoAction` no lo tiene.
    expect(Object.keys(accionesLiquidacion).sort()).toEqual([
      "registrarPagoMensajeroAction",
      "registrarPagoTiendaAction",
    ]);
  });

  it("ninguna exportacion se llama editar/actualizar/modificar/corregir", () => {
    for (const nombre of Object.keys(accionesLiquidacion)) {
      expect(nombre, `exportacion sospechosa: ${nombre}`).not.toMatch(
        /editar|actualizar|modificar|corregir|update|patch/i,
      );
    }
  });

  it("las dos exportaciones son funciones asincronas (contrato de Server Action)", () => {
    for (const valor of Object.values(accionesLiquidacion)) {
      expect(typeof valor).toBe("function");
    }
  });
});
