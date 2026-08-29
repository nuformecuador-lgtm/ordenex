import { describe, it, expect, vi } from "vitest";

import {
  corregirDatosCliente,
  obtenerUbicacionOrden,
} from "@/lib/actions/corregir-datos-cliente";
import type {
  CorregirDatosClienteInput,
  ICorregirDatosClienteService,
} from "@/lib/interfaces/services/ICorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 312 / D2, AMPLIADA POR LA 327 / D2 — el BORDE: sesion primero, zod despues, service al
// final. Ni una peticion sin sesion ni una entrada invalida llegan a construir el service ni a
// tocar ninguna fila. Vale para las DOS puertas: la que escribe y la que precarga.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

function deps(opts: { actor?: Actor | null } = {}) {
  const corregir = vi.fn(async (_input: CorregirDatosClienteInput, _actor: Actor) => ({
    status: "ok" as const,
    cambios: ["destinatario"] as const,
  }));
  const obtenerUbicacion = vi.fn(async (_ordenId: string, _actor: Actor) => ({
    status: "forbidden" as const,
  }));
  const service: ICorregirDatosClienteService = { corregir, obtenerUbicacion };
  return {
    corregir,
    obtenerUbicacion,
    d: {
      service,
      getActor: vi.fn(async () => (opts.actor === undefined ? MAESTRO : opts.actor)),
    },
  };
}

describe("312/D2 — R7: sin sesion", () => {
  it("responde unauthenticated sin invocar el service", async () => {
    const { d, corregir } = deps({ actor: null });

    const r = await corregirDatosCliente({ ordenId: ORDEN_ID, producto: "caja" }, d);

    expect(r).toEqual({ status: "unauthenticated" });
    expect(corregir).not.toHaveBeenCalled();
  });

  it("la sesion se comprueba ANTES que el schema", async () => {
    // Con entrada invalida Y sin sesion, gana `unauthenticated`: una respuesta de validacion a
    // quien no ha iniciado sesion ya le cuenta algo del sistema.
    const { d, corregir } = deps({ actor: null });

    const r = await corregirDatosCliente({}, d);

    expect(r).toEqual({ status: "unauthenticated" });
    expect(corregir).not.toHaveBeenCalled();
  });
});

describe("312/D2 — R2/R3: validacion del borde", () => {
  it.each([
    ["clave fuera del alcance: estatusId", { ordenId: ORDEN_ID, estatusId: "os-1" }],
    // ⚠️ 327: `direccion` SALIO de esta lista —es el alcance que la ficha abre (su D1)— y su caso
    // de aceptacion vive abajo. `zonaId` SE QUEDA: la deriva el servidor (R5).
    ["clave fuera del alcance: zonaId", { ordenId: ORDEN_ID, zonaId: "z-1" }],
    ["clave fuera del alcance: montoCobrar", { ordenId: ORDEN_ID, montoCobrar: 15000 }],
    ["clave fuera del alcance: mensajeroAsignadoId", { ordenId: ORDEN_ID, mensajeroAsignadoId: "m-1" }],
    ["geografia PARCIAL", { ordenId: ORDEN_ID, provinciaId: "p-1", cantonId: "c-1" }],
    ["distritoId nulo", { ordenId: ORDEN_ID, provinciaId: "p-1", cantonId: "c-1", distritoId: null }],
    ["peso cero", { ordenId: ORDEN_ID, peso: 0 }],
    ["sin ningun campo a corregir", { ordenId: ORDEN_ID }],
    ["ordenId que no es uuid", { ordenId: "pepe", producto: "caja" }],
    ["destinatario vacio", { ordenId: ORDEN_ID, destinatario: "" }],
    ["input nulo", null],
  ])("%s -> validation_error sin invocar el service", async (_n, input) => {
    const { d, corregir } = deps();

    const r = await corregirDatosCliente(input, d);

    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });
});

describe("312/D2 — R25: delega con el actor de la SESION", () => {
  it("pasa los cuatro campos y el actor, y devuelve el resultado del service tal cual", async () => {
    const { d, corregir } = deps();

    const r = await corregirDatosCliente(
      {
        ordenId: ORDEN_ID,
        destinatario: "Ana Perez",
        telefonoDest: "8888-7777",
        producto: "caja",
        notas: null,
      },
      d,
    );

    expect(corregir).toHaveBeenCalledWith(
      {
        ordenId: ORDEN_ID,
        destinatario: "Ana Perez",
        telefonoDest: "8888-7777",
        producto: "caja",
        notas: null,
        // Ficha 327: los cinco campos nuevos viajan como `undefined` («no los toques»), y la
        // confirmacion como `false` por su default.
        direccion: undefined,
        provinciaId: undefined,
        cantonId: undefined,
        distritoId: undefined,
        peso: undefined,
        confirmaCambioDeUbicacion: false,
      },
      MAESTRO,
    );
    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
  });

  it("el actor NUNCA sale del input: una entrada con `rol` ni siquiera pasa el schema", async () => {
    const { d, corregir } = deps();

    const r = await corregirDatosCliente(
      { ordenId: ORDEN_ID, producto: "caja", rol: "maestro" },
      d,
    );

    expect(r.status).toBe("validation_error");
    expect(corregir).not.toHaveBeenCalled();
  });

  it("los campos ausentes viajan como `undefined`, no como `null`", async () => {
    // `undefined` es «no lo toques» y `null` en `notas` es «vacialo»: confundirlos borraria las
    // notas de la orden cada vez que alguien corrige solo el telefono.
    const { d, corregir } = deps();

    await corregirDatosCliente({ ordenId: ORDEN_ID, telefonoDest: "8888-9999" }, d);

    expect(corregir).toHaveBeenCalledWith(
      {
        ordenId: ORDEN_ID,
        destinatario: undefined,
        telefonoDest: "8888-9999",
        producto: undefined,
        notas: undefined,
        direccion: undefined,
        provinciaId: undefined,
        cantonId: undefined,
        distritoId: undefined,
        peso: undefined,
        // La confirmacion NO es `undefined`: tiene default, y ese default es `false`. La ausencia
        // no confirma nada (327/design §4.1).
        confirmaCambioDeUbicacion: false,
      },
      MAESTRO,
    );
  });

  it("327/R1: los NUEVE campos y la confirmacion llegan al service tal cual", async () => {
    const { d, corregir } = deps();

    await corregirDatosCliente(
      {
        ordenId: ORDEN_ID,
        destinatario: "Ana Perez",
        telefonoDest: "8888-7777",
        producto: "caja",
        notas: null,
        direccion: "avenida siempre viva 742",
        provinciaId: "p-1",
        cantonId: "c-1",
        distritoId: "d-1",
        peso: 2.5,
        confirmaCambioDeUbicacion: true,
      },
      d,
    );

    expect(corregir).toHaveBeenCalledWith(
      {
        ordenId: ORDEN_ID,
        destinatario: "Ana Perez",
        telefonoDest: "8888-7777",
        producto: "caja",
        notas: null,
        direccion: "avenida siempre viva 742",
        provinciaId: "p-1",
        cantonId: "c-1",
        distritoId: "d-1",
        peso: 2.5,
        confirmaCambioDeUbicacion: true,
      },
      MAESTRO,
    );
  });
});

describe("312/D2 — los desenlaces del dominio se propagan sin reinterpretarse", () => {
  it.each([
    ["forbidden", { status: "forbidden" }],
    ["conflict", { status: "conflict" }],
    ["ok sin cambios", { status: "ok", cambios: [] }],
  ])("%s", async (_n, resultado) => {
    const { d, corregir } = deps();
    corregir.mockResolvedValueOnce(resultado as never);

    const r = await corregirDatosCliente({ ordenId: ORDEN_ID, producto: "caja"}, d);

    expect(r).toEqual(resultado);
  });
});

describe("327/D2 — `confirmacion_requerida` se propaga sin reinterpretarse", () => {
  it("el aviso del servidor llega a la pantalla entero", async () => {
    // El borde NO decide nada sobre el dinero: transporta. Si algun dia reinterpretara este
    // desenlace (por ejemplo, convirtiendolo en un `validation_error`), la pantalla perderia los
    // importes y el gate se quedaria sin su mitad visible.
    const { d } = deps();
    const aviso = {
      actual: {
        zonaId: "z-1",
        zonaNombre: "Zona Uno",
        distritoNombre: "Distrito Uno",
        esCentral: false,
        esZonaEspecial: false,
        tarifa: "resuelta",
        fleteConIva: "2260.00",
        comisionConIva: "767.25",
        fleteOrigen: "normal",
      },
      propuesta: {
        zonaId: "z-2",
        zonaNombre: "Zona Dos",
        distritoNombre: "Distrito Dos",
        esCentral: true,
        esZonaEspecial: false,
        tarifa: "sin_tarifa",
        fleteConIva: "0.00",
        comisionConIva: "0.00",
        fleteOrigen: "normal",
      },
      yaEnUnCierre: true,
    };
    d.service.corregir = vi.fn(async () => ({ status: "confirmacion_requerida", aviso }) as never);

    const r = await corregirDatosCliente(
      { ordenId: ORDEN_ID, provinciaId: "p-1", cantonId: "c-1", distritoId: "d-2" },
      d,
    );

    expect(r).toEqual({ status: "confirmacion_requerida", aviso });
  });
});

describe("327/D2 — R18/R31: la precarga `obtenerUbicacionOrden`", () => {
  it("sin sesion responde unauthenticated y NO construye el service", async () => {
    const { d, obtenerUbicacion } = deps({ actor: null });

    const r = await obtenerUbicacionOrden({ ordenId: ORDEN_ID }, d);

    expect(r).toEqual({ status: "unauthenticated" });
    expect(obtenerUbicacion).not.toHaveBeenCalled();
  });

  it("la sesion se comprueba ANTES que el schema, igual que en la escritura", async () => {
    const { d, obtenerUbicacion } = deps({ actor: null });

    const r = await obtenerUbicacionOrden({}, d);

    expect(r).toEqual({ status: "unauthenticated" });
    expect(obtenerUbicacion).not.toHaveBeenCalled();
  });

  it.each([
    ["sin ordenId", {}],
    ["ordenId que no es uuid", { ordenId: "pepe" }],
    ["input nulo", null],
    ["una clave de mas", { ordenId: ORDEN_ID, rol: "maestro" }],
  ])("%s -> validation_error sin invocar el service", async (_n, input) => {
    const { d, obtenerUbicacion } = deps();

    const r = await obtenerUbicacionOrden(input, d);

    expect(r.status).toBe("validation_error");
    expect(obtenerUbicacion).not.toHaveBeenCalled();
  });

  it("delega con el actor de la SESION, no con nada del input", async () => {
    const { d, obtenerUbicacion } = deps();

    await obtenerUbicacionOrden({ ordenId: ORDEN_ID }, d);

    expect(obtenerUbicacion).toHaveBeenCalledWith(ORDEN_ID, MAESTRO);
  });

  it("R30 — sobre una orden ajena devuelve el MISMO objeto opaco que por rol", async () => {
    // El service ya devuelve `forbidden` para las cuatro causas; lo que este caso fija es que el
    // BORDE no lo enriquece por el camino con nada que distinga una de otra.
    const { d } = deps();

    const r = await obtenerUbicacionOrden({ ordenId: ORDEN_ID }, d);

    expect(r).toEqual({ status: "forbidden" });
    expect(Object.keys(r)).toEqual(["status"]);
  });
});
