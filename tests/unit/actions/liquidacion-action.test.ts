import { describe, it, expect, vi } from "vitest";
import * as accionesLiquidacion from "@/lib/actions/liquidacion";
import {
  anularPagoAction,
  listarPagosDeCierreAction,
  listarPagosDeTiendaAction,
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
const PAGO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // T F.4: el pago que se anula

/** T F.4 — el bloque de anulacion que acompaña a un pago anulado (R73/R74). */
const ANULACION = {
  motivo: "Monto mal tecleado",
  anuladoPorNombre: "Mario Maestro",
  anuladoAt: "2026-08-03T09:00:00.000Z",
};

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
    // T F.4: la anulacion. Por defecto sale bien y devuelve el comprobante YA marcado (R74) y
    // lo que vuelve a estar disponible (R71).
    anularPago: vi.fn(async () => ({
      status: "ok" as const,
      pago: { ...comprobante(), anulacion: ANULACION },
      restante: "50000.00",
    })),
    // T C.1: los dos listados de comprobantes. Por defecto devuelven UN pago vigente, para que
    // las aserciones de forma tengan algo que mirar.
    listarPagosDeCierre: vi.fn(async () => ({ status: "ok" as const, pagos: [comprobante()] })),
    listarPagosDeTienda: vi.fn(async () => ({ status: "ok" as const, pagos: [comprobante()] })),
    // Feature 205 (T4.2): los dos metodos del REPARTO. Ningun caso de ESTE archivo los ejercita
    // —tienen el suyo, `liquidacion-reparto-actions.test.ts`—, pero el doble los expone porque el
    // contrato del servicio los tiene, y asi las aserciones de aqui siguen midiendo lo mismo.
    previsualizarRepartoMensajero: vi.fn(async () => ({ status: "no_encontrado" as const })),
    registrarRepartoMensajero: vi.fn(async () => ({ status: "sin_saldo" as const })),
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

// ── T C.1 — las dos acciones de LISTAR comprobantes (R3, R49, R50) ──────────────────────────

describe("T C.1 — listar comprobantes: el borde resuelve sesion y forma; el resto, el servicio", () => {
  it("R3: sin sesion -> `unauthenticated`, sin tocar el servicio, en los DOS listados", async () => {
    const service = fakeService();

    expect(
      await listarPagosDeCierreAction({ cierreId: CIERRE }, { service, getActor: async () => null }),
    ).toEqual({ status: "unauthenticated" });
    expect(
      await listarPagosDeTiendaAction({ tiendaId: TIENDA }, { service, getActor: async () => null }),
    ).toEqual({ status: "unauthenticated" });

    expect(service.listarPagosDeCierre).not.toHaveBeenCalled();
    expect(service.listarPagosDeTienda).not.toHaveBeenCalled();
  });

  it("R3: sin sesion Y con la peticion rota, sigue ganando `unauthenticated`", async () => {
    const service = fakeService();

    const r = await listarPagosDeCierreAction(
      { basura: true },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
  });

  it("un id que no es uuid muere en el borde, en su campo", async () => {
    const service = fakeService();

    const r = await listarPagosDeCierreAction(
      { cierreId: "no-soy-un-uuid" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("cierreId");
    expect(service.listarPagosDeCierre).not.toHaveBeenCalled();
  });

  it("`.strict()`: una clave de mas no pasa (nadie escribe eso a proposito)", async () => {
    const service = fakeService();

    const r = await listarPagosDeTiendaAction(
      { tiendaId: TIENDA, incluirAnulados: false },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(service.listarPagosDeTienda).not.toHaveBeenCalled();
  });

  it("al servicio le llega el id parseado y el actor de la SESION, no el de la peticion", async () => {
    const service = fakeService();

    await listarPagosDeCierreAction({ cierreId: CIERRE }, { service, getActor: async () => ADMIN });

    const mock = service.listarPagosDeCierre as unknown as { mock: { calls: unknown[][] } };
    expect(mock.mock.calls[0]).toEqual([CIERRE, ADMIN]);
  });

  it("R1/R6: el `forbidden` del servicio se devuelve tal cual (el borde no duplica el guard)", async () => {
    const service = fakeService({
      listarPagosDeCierre: vi.fn(async () => ({ status: "forbidden" as const })),
    });

    const r = await listarPagosDeCierreAction(
      { cierreId: CIERRE },
      { service, getActor: async () => SIN_ACCESO },
    );

    expect(r).toEqual({ status: "forbidden" });
  });

  it("R49/R50: la lista llega entera y con montos STRING", async () => {
    const service = fakeService();

    const r = await listarPagosDeTiendaAction(
      { tiendaId: TIENDA },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pagos).toHaveLength(1);
    expect(typeof r.pagos[0]!.monto).toBe("string");
    expect(r.pagos[0]!.monto).toMatch(/^\d+\.\d{2}$/);
    // R56: ni el id de la tienda que se pidio viaja de vuelta en el comprobante.
    expect(JSON.stringify(r)).not.toContain(TIENDA);
  });
});

// ── T F.4 — la QUINTA accion: anular (R3, R72) ──────────────────────────────────────────────

describe("T F.4 — anular: el borde resuelve sesion y forma; el monto NO viene de aqui", () => {
  it("R3: sin sesion -> `unauthenticated`, sin tocar el servicio", async () => {
    const service = fakeService();

    const r = await anularPagoAction(
      { pagoId: PAGO, motivo: "Monto mal tecleado" },
      { service, getActor: async () => null },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.anularPago).not.toHaveBeenCalled();
  });

  it("R3: sin sesion Y con la peticion rota, sigue ganando `unauthenticated`", async () => {
    // Si zod corriera primero, un anonimo aprenderia que campos existen y como se validan.
    const service = fakeService();

    const r = await anularPagoAction({ basura: true }, { service, getActor: async () => null });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.anularPago).not.toHaveBeenCalled();
  });

  const motivosEnBlanco: [string, unknown][] = [
    ["ausente", undefined],
    ["vacio", ""],
    ["solo espacios", "   "],
    ["solo saltos de linea", "\n\n"],
  ];

  for (const [nombre, motivo] of motivosEnBlanco) {
    it(`R72: motivo ${nombre} -> \`validation_error\` en el campo \`motivo\``, async () => {
      const service = fakeService();

      const r = await anularPagoAction(
        { pagoId: PAGO, motivo },
        { service, getActor: async () => MAESTRO },
      );

      expect(r.status).toBe("validation_error");
      if (r.status !== "validation_error") return;
      expect(Object.keys(r.fieldErrors)).toContain("motivo");
      expect(service.anularPago).not.toHaveBeenCalled();
    });
  }

  it("R70: un `monto` colado en la peticion NO pasa el borde (`.strict()`)", async () => {
    // Primera de las dos barreras de R70. La segunda —la que manda— es que el servicio lee el
    // importe del pago; esta solo garantiza que el numero ni siquiera llega hasta alli.
    const service = fakeService();

    const r = await anularPagoAction(
      { pagoId: PAGO, motivo: "Monto mal tecleado", monto: "1.00" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(service.anularPago).not.toHaveBeenCalled();
  });

  it("un `pagoId` que no es uuid muere en el borde, en su campo", async () => {
    const service = fakeService();

    const r = await anularPagoAction(
      { pagoId: "no-soy-un-uuid", motivo: "Monto mal tecleado" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("pagoId");
    expect(service.anularPago).not.toHaveBeenCalled();
  });

  it("al servicio le llega el input parseado (motivo YA recortado) y el actor de la SESION", async () => {
    const service = fakeService();

    await anularPagoAction(
      { pagoId: PAGO, motivo: "  Monto mal tecleado  " },
      { service, getActor: async () => ADMIN },
    );

    const mock = service.anularPago as unknown as { mock: { calls: unknown[][] } };
    const [data, actor] = mock.mock.calls[0];
    // Exactamente dos campos: no hay por donde pedir una anulacion parcial (R76).
    expect(data).toEqual({ pagoId: PAGO, motivo: "Monto mal tecleado" });
    expect(actor).toEqual(ADMIN); // R81: el actor sale de la sesion, no de la peticion
  });

  const dominio: [string, Record<string, unknown>][] = [
    ["forbidden (R81: el rol lo decide el servicio)", { status: "forbidden" }],
    ["no_encontrado", { status: "no_encontrado" }],
  ];

  for (const [nombre, resultado] of dominio) {
    it(`el resultado de dominio se devuelve tal cual: ${nombre}`, async () => {
      const service = fakeService({ anularPago: vi.fn(async () => resultado as never) });

      const r = await anularPagoAction(
        { pagoId: PAGO, motivo: "Monto mal tecleado" },
        { service, getActor: async () => SIN_ACCESO },
      );

      expect(r).toEqual(resultado);
    });
  }

  it("R75: `ya_anulado` llega con su comprobante y SIN restante (no movio nada)", async () => {
    const service = fakeService({
      anularPago: vi.fn(async () => ({
        status: "ya_anulado" as const,
        pago: { ...comprobante(), anulacion: ANULACION },
      })),
    });

    const r = await anularPagoAction(
      { pagoId: PAGO, motivo: "Monto mal tecleado" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ya_anulado");
    if (r.status !== "ya_anulado") return;
    expect(r.pago.anulacion).toEqual(ANULACION);
    expect(r).not.toHaveProperty("restante");
  });

  it("R14/R74: la respuesta trae el comprobante marcado y montos STRING, sin ids internos", async () => {
    const service = fakeService();

    const r = await anularPagoAction(
      { pagoId: PAGO, motivo: "Monto mal tecleado" },
      { service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.pago.monto).toMatch(/^\d+\.\d{2}$/);
    expect(r.restante).toMatch(/^\d+\.\d{2}$/);
    // R74: el pago sigue entero (monto, metodo, referencia, fecha real, quien) Y marcado.
    expect(r.pago).toMatchObject({ metodo: "SINPE", referencia: "1234567" });
    expect(r.pago.anulacion).toEqual(ANULACION);
    // Ni un `number` suelto, ni el id de quien anulo (R14/R56).
    expect(JSON.stringify(r).match(/:\s*-?\d+(\.\d+)?\s*[,}]/g)).toBeNull();
    expect(JSON.stringify(r)).not.toContain("u-maestro");
  });
});

describe("R65/R82 — NO se exporta ninguna accion de EDITAR ni de DESANULAR un pago", () => {
  it("la superficie del modulo es EXACTAMENTE la de registrar, listar y anular", () => {
    // Lista cerrada a proposito: T C.1 (listados) la amplio a cuatro y T F.4 (anulacion) la deja
    // en CINCO, que son las del diseño §3.1 — y al hacerlo ha tenido que tocar este test, que es
    // justo el momento de mirar si lo que se anade tiene derecho a existir. Un `editarPagoAction`
    // no lo tiene; un `desanularPagoAction` tampoco (R82).
    //
    // Feature 205 (T4.3, R52): SIETE. Las dos nuevas son PREVISUALIZAR (solo lectura) y
    // REGISTRAR un reparto; no hay ninguna de editarlo ni de anularlo en bloque, y eso es una
    // decision escrita (design §10.5, Q3): deshacer un reparto es anular sus pagos uno a uno.
    expect(Object.keys(accionesLiquidacion).sort()).toEqual([
      "anularPagoAction",
      "listarPagosDeCierreAction",
      "listarPagosDeTiendaAction",
      "previsualizarRepartoMensajeroAction",
      "registrarPagoMensajeroAction",
      "registrarPagoTiendaAction",
      "registrarRepartoMensajeroAction",
    ]);
  });

  it("ninguna exportacion se llama editar/actualizar/modificar/corregir/desanular", () => {
    for (const nombre of Object.keys(accionesLiquidacion)) {
      expect(nombre, `exportacion sospechosa: ${nombre}`).not.toMatch(
        /editar|actualizar|modificar|corregir|update|patch|desanular|revertir|deshacer/i,
      );
    }
  });

  it("todas las exportaciones son funciones asincronas (contrato de Server Action)", () => {
    for (const valor of Object.values(accionesLiquidacion)) {
      expect(typeof valor).toBe("function");
    }
  });
});
