import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { RolValue } from "@prisma/client";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ITraspasoMensajeroService } from "@/lib/interfaces/services/ITraspasoMensajeroService";
import type {
  TraspasarMensajeroInput,
  TraspasoMensajeroServiceResult,
} from "@/lib/interfaces/services/ITraspasoMensajeroService";

// FICHA 427 (T19/T18) — EL BORDE de «traspasar a otro mensajero»: sesion + zod + delegacion, MAS el
// COMPOSITION ROOT de los dos avisos.
//
// Lo que se prueba aqui es EL BORDE y solo el borde. Las reglas de negocio (rol, estados, guardas
// del destino, avisos) viven en `tests/unit/services/traspaso-mensajero-service.test.ts`, y el
// `WHERE` en el de integracion contra Postgres.

// ⚠️ LOS MOCKS VAN ANTES DEL IMPORT DE LA ACCION. `vi.mock` se iza, pero la fabrica captura las
// referencias de abajo, asi que se declaran con `vi.hoisted`.
const espias = vi.hoisted(() => ({
  /** Los argumentos con los que el composition root construye el servicio REAL. */
  argsDelConstructor: [] as unknown[][],
  getPrismaClient: vi.fn(() => ({}) as never),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: espias.getPrismaClient,
  PRISMA_OMIT: {},
}));

vi.mock("@/lib/repositories/OrdenRepository", () => ({
  OrdenRepository: class {
    constructor(..._args: unknown[]) {}
  },
}));

vi.mock("@/lib/services/TraspasoMensajeroService", () => ({
  TraspasoMensajeroService: class {
    constructor(...args: unknown[]) {
      espias.argsDelConstructor.push(args);
    }
    async traspasar() {
      return { status: "forbidden" as const };
    }
  },
}));

const { traspasarMensajero } = await import("@/lib/actions/traspasar-mensajero");
const { notificarTraspasoCedidoReal, notificarTraspasoRecibidoReal } = await import(
  "@/lib/notificaciones/notificadores"
);

const ORDEN_ID = "11111111-1111-4111-8111-111111111111";
const OTRA_ORDEN = "22222222-2222-4222-8222-222222222222";
const DESTINO = "33333333-3333-4333-8333-333333333333";
const MOTIVO = "Andy se enfermo a media jornada y no puede seguir la ruta";
const MAESTRO: Actor = { usuarioId: "u-1", rol: "maestro" as RolValue };

function fakeService() {
  // TIPADO con sus parametros a proposito: sin ellos `mock.calls[0][0]` no existe para TypeScript y
  // los dos casos que afirman QUE llega al service no se podrian escribir.
  const traspasar = vi.fn(
    async (_input: TraspasarMensajeroInput, _actor: Actor): Promise<TraspasoMensajeroServiceResult> => ({
      status: "ok" as const,
      movidas: 1,
      conversaciones: 1,
      origen: { id: "u-andy", nombre: "Andy Cortés" },
      destino: { id: DESTINO, nombre: "Carlos Eduardo" },
    }),
  );
  return { service: { traspasar } as unknown as ITraspasoMensajeroService, traspasar };
}

function deps(overrides: { actor?: Actor | null } = {}) {
  const { service, traspasar } = fakeService();
  return {
    deps: {
      service,
      getActor: async () => ("actor" in overrides ? (overrides.actor ?? null) : MAESTRO),
    },
    traspasar,
  };
}

beforeEach(() => {
  espias.argsDelConstructor.length = 0;
});

describe("427/T19 — la sesion se resuelve ANTES de validar y de tocar nada", () => {
  it("⭑ sin sesion => `unauthenticated`, y el service NO se llama ni se construye", async () => {
    const { deps: d, traspasar } = deps({ actor: null });

    const r = await traspasarMensajero(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      d,
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(traspasar).not.toHaveBeenCalled();
    expect(espias.argsDelConstructor).toHaveLength(0);
  });

  it("sin sesion, ni siquiera un input INVALIDO cambia el desenlace", async () => {
    // El orden importa: primero la sesion, luego zod. Al reves, un anonimo aprenderia que campos
    // espera el endpoint.
    const { deps: d } = deps({ actor: null });
    const r = await traspasarMensajero({ basura: true }, d);
    expect(r).toEqual({ status: "unauthenticated" });
  });
});

describe("427/R28 — el motivo es OBLIGATORIO, 10-300, y se valida ANTES de escribir nada", () => {
  it("⭑ un motivo de 9 caracteres => `validation_error`, y el service NO se llama", async () => {
    const { deps: d, traspasar } = deps();

    const r = await traspasarMensajero(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: "123456789" },
      d,
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("unreachable");
    expect(Object.keys(r.fieldErrors)).toContain("motivo");
    expect(traspasar).not.toHaveBeenCalled();
  });

  it("⭑ solo espacios => `validation_error` (el `trim()` corre ANTES de las cotas)", async () => {
    const { deps: d, traspasar } = deps();
    const r = await traspasarMensajero(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: "               " },
      d,
    );
    expect(r.status).toBe("validation_error");
    expect(traspasar).not.toHaveBeenCalled();
  });

  it("motivo ausente o de mas de 300 => `validation_error`", async () => {
    const { deps: d, traspasar } = deps();
    for (const motivo of [undefined, null, 42, "x".repeat(301)]) {
      const r = await traspasarMensajero(
        { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo },
        d,
      );
      expect(r.status, `motivo=${String(motivo)}`).toBe("validation_error");
    }
    expect(traspasar).not.toHaveBeenCalled();
  });

  it("⭑ el caso feliz: el motivo llega al service RECORTADO", async () => {
    const { deps: d, traspasar } = deps();

    const r = await traspasarMensajero(
      {
        ordenIds: [ORDEN_ID],
        mensajeroDestinoId: DESTINO,
        motivo: `   ${MOTIVO}   `,
      },
      d,
    );

    expect(r.status).toBe("ok");
    expect(traspasar).toHaveBeenCalledWith(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      MAESTRO,
    );
  });
});

describe("427 — el lote y el destino: forma validada en el borde", () => {
  it("lote vacio o uuid invalido => `validation_error`, sin llamar al service", async () => {
    const { deps: d, traspasar } = deps();
    const casos: unknown[] = [
      { ordenIds: [], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      { ordenIds: ["no-es-uuid"], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: "no-es-uuid", motivo: MOTIVO },
      { ordenIds: [ORDEN_ID], motivo: MOTIVO },
      { mensajeroDestinoId: DESTINO, motivo: MOTIVO },
    ];
    for (const input of casos) {
      const r = await traspasarMensajero(input, d);
      expect(r.status, JSON.stringify(input)).toBe("validation_error");
    }
    expect(traspasar).not.toHaveBeenCalled();
  });

  it("un lote de varias ordenes llega ENTERO en UNA sola llamada", async () => {
    const { deps: d, traspasar } = deps();
    await traspasarMensajero(
      { ordenIds: [ORDEN_ID, OTRA_ORDEN], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      d,
    );
    expect(traspasar).toHaveBeenCalledTimes(1);
    expect(traspasar.mock.calls[0][0].ordenIds).toEqual([ORDEN_ID, OTRA_ORDEN]);
  });
});

describe("427/R8 — el input NO admite un mensajero de ORIGEN", () => {
  it("⭑⭑ un campo de origen enviado por el cliente NO llega al service", async () => {
    // R8 puesto en el schema: el origen se DERIVA de las ordenes. Aceptarlo permitiria pedir «mueve
    // estas ordenes COMO SI fueran de X» y la guarda del `WHERE` compararia contra un valor elegido
    // por quien llama. `zod` descarta las claves no declaradas, asi que el service NUNCA lo ve.
    const { deps: d, traspasar } = deps();

    await traspasarMensajero(
      {
        ordenIds: [ORDEN_ID],
        mensajeroDestinoId: DESTINO,
        motivo: MOTIVO,
        mensajeroOrigenId: "u-suplantado",
        origen: "u-suplantado",
      },
      d,
    );

    const enviado = traspasar.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual(["mensajeroDestinoId", "motivo", "ordenIds"]);
    expect(JSON.stringify(enviado)).not.toContain("u-suplantado");
  });
});

// =================================================================================================
// T18 — EL COMPOSITION ROOT: QUE ALGUIEN **PASE** LOS NOTIFICADORES REALES, NO QUE LOS IMPORTE
// =================================================================================================
//
// ⚠️ ESTE BLOQUE ES LA MUTACION 11 DEL PLAN. Este repo ya tuvo **2 de 7 notificadores muertos con
// la suite entera en verde** porque nadie comprobaba el cableado: el modulo los importaba y nadie
// los pasaba. Dejar el no-op en `buildService()` —quitar los dos argumentos— tiene que poner ESTO
// rojo; si no lo pone, el aviso no existe aunque el codigo este escrito.
describe("427/T18 — el composition root INYECTA los dos notificadores REALES", () => {
  it("⭑⭑ sin `deps.service`, el servicio se construye CON los dos notificadores reales", async () => {
    // Se llama SIN `deps.service`, asi que la accion tiene que ejecutar `buildService()`. El
    // constructor del servicio esta mockeado y captura sus argumentos: lo que se afirma es que
    // recibe LAS DOS REFERENCIAS REALES, por identidad.
    await traspasarMensajero(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      { getActor: async () => MAESTRO },
    );

    expect(espias.argsDelConstructor).toHaveLength(1);
    const args = espias.argsDelConstructor[0];
    // 0 = el repositorio; 1 = el aviso al DESTINO; 2 = el aviso al ORIGEN.
    expect(args).toHaveLength(3);
    expect(args[1]).toBe(notificarTraspasoRecibidoReal);
    expect(args[2]).toBe(notificarTraspasoCedidoReal);
  });

  it("⭑ y NO son el no-op ni el mismo notificador dos veces", async () => {
    // Las dos formas de «cablear a medias» que un `toBeDefined()` dejaria pasar.
    const { notificadorNoOp } = await import("@/lib/notificaciones/notificadores");
    await traspasarMensajero(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      { getActor: async () => MAESTRO },
    );
    const args = espias.argsDelConstructor[0];
    expect(args[1]).not.toBe(notificadorNoOp);
    expect(args[2]).not.toBe(notificadorNoOp);
    expect(args[1]).not.toBe(args[2]);
  });

  it("con `deps.service` inyectado, el composition root NO se ejecuta (los tests no emiten)", async () => {
    const { deps: d } = deps();
    await traspasarMensajero(
      { ordenIds: [ORDEN_ID], mensajeroDestinoId: DESTINO, motivo: MOTIVO },
      d,
    );
    expect(espias.argsDelConstructor).toHaveLength(0);
  });

  it("⭑ y el fuente los PASA, no solo los importa (la otra mitad de la mutacion 11)", async () => {
    // Cinturon sobre el runtime de arriba: si alguien reemplazara el mock por otra cosa, este caso
    // sigue leyendo el archivo REAL y exige que los dos nombres aparezcan FUERA de los imports.
    const raiz = path.resolve(__dirname, "../../..");
    const fuente = fs.readFileSync(
      path.join(raiz, "lib", "actions", "traspasar-mensajero.ts"),
      "utf8",
    );
    const sinImports = fuente
      .split("\n")
      .filter((l) => !/^\s*(import|\s*notificarTraspaso\w+Real,)\s/.test(l))
      .join("\n");
    // AUTOCOMPROBACION: el recorte tiene que haber dejado algo que leer.
    expect(sinImports.length).toBeGreaterThan(500);
    expect(sinImports).toContain("notificarTraspasoRecibidoReal");
    expect(sinImports).toContain("notificarTraspasoCedidoReal");
  });
});
