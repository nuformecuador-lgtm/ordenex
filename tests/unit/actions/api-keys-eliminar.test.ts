import { describe, it, expect, vi } from "vitest";

import { eliminarApiKey } from "@/lib/actions/api-keys";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import { eliminarApiKeySchema, type EliminarApiKeyResult } from "@/lib/types/api-key";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / E1 (R19/R20) — EL BORDE DEL BORRADO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// `deps` inyectados: esta action no toca cookies reales ni Prisma. Lo que se mide aqui es lo que
// pasa ANTES de que exista un service —sesion y zod— y que el resto se DELEGA sin reinterpretarse.
//
// La diferencia deliberada con sus tres hermanas del ciclo de vida: el schema es
// `eliminarApiKeySchema` (`.strict()`). En un BORRADO, una clave desconocida en la entrada no puede
// ignorarse en silencio (R20).

const UUID = "11111111-1111-4111-8111-111111111111";
const maestro = async (): Promise<Actor> => ({ usuarioId: "u-maestro", rol: "maestro" });

/** Service cuyo `eliminar` es programable; el resto lanza para delatar una invocacion. */
function makeService(resultado?: EliminarApiKeyResult) {
  const eliminar = vi.fn(
    async (): Promise<EliminarApiKeyResult> =>
      resultado ?? { status: "ok", identificador: "integracion-erp" },
  );
  const lanza = (nombre: string) =>
    vi.fn(async (): Promise<never> => {
      throw new Error(`${nombre} no debe invocarse desde eliminarApiKey`);
    });
  const service = {
    eliminar,
    generar: lanza("generar"),
    listar: lanza("listar"),
    listarCompleto: lanza("listarCompleto"),
    rotar: lanza("rotar"),
    activar: lanza("activar"),
    desactivar: lanza("desactivar"),
  } as unknown as IApiKeyService;
  return { service, eliminar };
}

/** Un `getActor` que delata si se llego a instanciar el service pese a no haber sesion. */
function sinSesion(): () => Promise<Actor | null> {
  return async () => null;
}

describe("373/R19 — sin sesion no se llega al service", () => {
  it("⭑ devuelve unauthenticated y NO instancia ni invoca el service", async () => {
    const { service, eliminar } = makeService();
    const r = await eliminarApiKey({ id: UUID }, { getActor: sinSesion(), apiKeyService: service });

    expect(r).toEqual({ status: "unauthenticated" });
    expect(eliminar).not.toHaveBeenCalled();
  });

  it("la sesion se comprueba ANTES que el schema: una entrada basura sigue siendo unauthenticated", async () => {
    // El orden importa: decir «el id no es valido» a quien no ha iniciado sesion filtra que la
    // action existe y como se llama su campo.
    const { service, eliminar } = makeService();
    const r = await eliminarApiKey(
      { id: "no-uuid", loQueSea: 1 },
      { getActor: sinSesion(), apiKeyService: service },
    );

    expect(r).toEqual({ status: "unauthenticated" });
    expect(eliminar).not.toHaveBeenCalled();
  });
});

describe("373/R20 — validacion en el borde, sin consultar la base", () => {
  it("⭑ un id que no es uuid -> validation_error, sin tocar el service", async () => {
    const { service, eliminar } = makeService();
    const r = await eliminarApiKey({ id: "no-uuid" }, { getActor: maestro, apiKeyService: service });

    expect(r.status).toBe("validation_error");
    expect(eliminar).not.toHaveBeenCalled();
  });

  it("⭑ una clave DESCONOCIDA -> validation_error, sin tocar el service", async () => {
    // Es lo que `.strict()` compra, y por lo que esta action no reusa `apiKeyIdSchema`: un
    // `{ id, confirmar: false }` que se ignorara en silencio es la forma de borrar algo creyendo
    // que se estaba pidiendo otra cosa.
    const { service, eliminar } = makeService();
    const r = await eliminarApiKey(
      { id: UUID, confirmar: false },
      { getActor: maestro, apiKeyService: service },
    );

    expect(r.status).toBe("validation_error");
    expect(eliminar).not.toHaveBeenCalled();
  });

  it("sin `id` -> validation_error", async () => {
    const { service, eliminar } = makeService();
    const r = await eliminarApiKey({}, { getActor: maestro, apiKeyService: service });
    expect(r.status).toBe("validation_error");
    expect(eliminar).not.toHaveBeenCalled();
  });

  it("el schema de esta ficha es ESTRICTO y el compartido NO se toco", async () => {
    // Contraprueba directa sobre los dos schemas: si alguien le pusiera `.strict()` a
    // `apiKeyIdSchema`, cambiaria el borde de rotar/activar/desactivar sin que nadie lo pidiera.
    const { apiKeyIdSchema } = await import("@/lib/types/api-key");
    expect(apiKeyIdSchema.safeParse({ id: UUID, extra: 1 }).success).toBe(true);
    expect(eliminarApiKeySchema.safeParse({ id: UUID, extra: 1 }).success).toBe(false);
    expect(eliminarApiKeySchema.safeParse({ id: UUID }).success).toBe(true);
  });
});

describe("373 — delegacion: el borde no reinterpreta nada", () => {
  it("⭑ el caso feliz llama al service con el id parseado y el actor de la sesion", async () => {
    const { service, eliminar } = makeService();
    const r = await eliminarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: service });

    expect(eliminar).toHaveBeenCalledWith({ id: UUID }, { usuarioId: "u-maestro", rol: "maestro" });
    expect(r).toEqual({ status: "ok", identificador: "integracion-erp" });
  });

  it.each([
    ["not_found", { status: "not_found" } as const],
    ["forbidden", { status: "forbidden" } as const],
    ["bloqueada · ordenes", { status: "bloqueada", motivo: "ordenes" } as const],
    ["bloqueada · activa", { status: "bloqueada", motivo: "activa" } as const],
    ["bloqueada · otros_datos", { status: "bloqueada", motivo: "otros_datos" } as const],
  ])("propaga %s tal cual", async (_nombre, resultado) => {
    // `bloqueada` NO pasa por ningun mapeador de error: es un RETORNO del service. Si alguien la
    // metiera por `toApiKeyLifecycleActionError`, el motivo se perderia por el camino.
    const { service } = makeService(resultado);
    expect(await eliminarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: service })).toEqual(
      resultado,
    );
  });

  it("R36: nada de lo que la action devuelve contiene prefijo ni hash", async () => {
    const { service } = makeService();
    const r = await eliminarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: service });
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain("ordx_");
    expect(serializado).not.toContain("keyHash");
  });
});
