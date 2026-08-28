import { describe, it, expect, vi } from "vitest";

import { corregirDatosCliente } from "@/lib/actions/corregir-datos-cliente";
import type {
  CorregirDatosClienteInput,
  ICorregirDatosClienteService,
} from "@/lib/interfaces/services/ICorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// FICHA 312 / D2 — el BORDE: sesion primero, zod despues, service al final. Ni una peticion sin
// sesion ni una entrada invalida llegan a construir el service ni a tocar ninguna fila.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

function deps(opts: { actor?: Actor | null } = {}) {
  const corregir = vi.fn(async (_input: CorregirDatosClienteInput, _actor: Actor) => ({
    status: "ok" as const,
    cambios: ["destinatario"] as const,
  }));
  const service: ICorregirDatosClienteService = { corregir };
  return {
    corregir,
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
    ["clave fuera del alcance: direccion", { ordenId: ORDEN_ID, direccion: "calle 1" }],
    ["clave fuera del alcance: zonaId", { ordenId: ORDEN_ID, zonaId: "z-1" }],
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
