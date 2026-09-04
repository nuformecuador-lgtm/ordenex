import { describe, it, expect, vi } from "vitest";
import { ApiKeyService } from "@/lib/services/ApiKeyService";
import type {
  CreateApiKeyConUsuarioData,
  IApiKeyRepository,
  TiendaDestinoCandidata,
} from "@/lib/interfaces/repositories/IApiKeyRepository";
import type { Actor } from "@/lib/interfaces/services/IApiKeyService";

// Feature 302 — ELEGIR LA TIENDA AL GENERAR LA KEY. Repositorio mockeado: sin DB.
//
// El bug que cierra esta ficha era MUDO: generar una key para una tienda ya registrada creaba una
// SEGUNDA cuenta con el mismo nombre y sin sus tarifas, sin un solo error. Por eso la mitad de este
// archivo son casos de RECHAZO: lo que se prueba no es solo que la eleccion valida se guarde, sino
// que ninguna eleccion dudosa se acepte en silencio y que ninguna de ellas llegue a escribir.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const UUID_NUFORM = "11111111-2222-4333-8444-555555555555";

const NUFORM: TiendaDestinoCandidata = {
  id: UUID_NUFORM,
  nombre: "Nuform",
  rol: "adminTienda",
  estado: "activo",
};

/**
 * Repositorio con `findTiendaDestino` programable y `createConUsuario` que CAPTURA lo recibido.
 * El resto de metodos lanza: `generar` no debe tocarlos.
 */
function makeRepo(candidata: TiendaDestinoCandidata | null = NUFORM) {
  const capturado: CreateApiKeyConUsuarioData[] = [];
  const findTiendaDestino = vi.fn(async () => candidata);
  const repo: IApiKeyRepository = {
    findTiendaDestino,
    createConUsuario: vi.fn(async (data: CreateApiKeyConUsuarioData) => {
      capturado.push(data);
      return {
        id: "key-1",
        identificador: data.identificador,
        keyPrefix: data.keyPrefix,
        estado: "activa" as const,
        usuarioId: "u-dedicada",
        tiendaDestinoId: data.tiendaDestinoId,
        ownerUsuarioId: data.tiendaDestinoId ?? "u-dedicada",
        createdAt: new Date("2026-08-28T12:00:00Z"),
      };
    }),
    list: vi.fn(async () => {
      throw new Error("list no debe invocarse desde generar");
    }),
    count: vi.fn(async () => {
      throw new Error("count no debe invocarse desde generar");
    }),
    findByKeyHash: vi.fn(async () => {
      throw new Error("findByKeyHash no debe invocarse desde generar");
    }),
    // Ficha 373: generar no mira la eliminabilidad ni borra nada.
    dependenciasDeCuentasDedicadas: vi.fn(async () => {
      throw new Error("dependenciasDeCuentasDedicadas no debe invocarse desde generar");
    }),
    eliminar: vi.fn(async () => {
      throw new Error("eliminar no debe invocarse desde generar");
    }),
    rotar: vi.fn(async () => {
      throw new Error("rotar no debe invocarse desde generar");
    }),
    setEstado: vi.fn(async () => {
      throw new Error("setEstado no debe invocarse desde generar");
    }),
  };
  return { repo, capturado, findTiendaDestino };
}

describe("302 — generar CON tienda destino valida", () => {
  it("persiste el `tiendaDestinoId` elegido y devuelve el owner ya resuelto", async () => {
    const { repo, capturado } = makeRepo();
    const r = await new ApiKeyService(repo).generar(
      { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    expect(capturado[0].tiendaDestinoId).toBe(UUID_NUFORM);
    if (r.status === "ok") {
      expect(r.apiKey.tiendaDestinoId).toBe(UUID_NUFORM);
      // El dueno de las ordenes es la tienda; la credencial sigue siendo su cuenta dedicada.
      expect(r.apiKey.ownerUsuarioId).toBe(UUID_NUFORM);
      expect(r.apiKey.usuarioId).toBe("u-dedicada");
    }
  });

  it("la cuenta dedicada se sigue creando: la key NO se cuelga de la cuenta de la tienda", async () => {
    // Es la alternativa que la ficha descarta. Los campos sinteticos siguen viajando al
    // repositorio, asi que la credencial sigue teniendo su propio usuario con rol restringido.
    const { repo, capturado } = makeRepo();
    await new ApiKeyService(repo).generar(
      { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
      MAESTRO,
    );
    expect(capturado[0].email).toBe("apikey+nuform-erp@apikey.invalid");
    expect(capturado[0].cedula).toBe("APIKEY-nuform-erp");
  });
});

describe("302 — generar SIN tienda destino (el camino existente, intacto)", () => {
  it("guarda `tiendaDestinoId: null` y NI SIQUIERA consulta la candidata", async () => {
    const { repo, capturado, findTiendaDestino } = makeRepo();
    const r = await new ApiKeyService(repo).generar({ identificador: "Tienda Uno" }, MAESTRO);

    expect(r.status).toBe("ok");
    expect(capturado[0].tiendaDestinoId).toBeNull();
    // Sin eleccion no hay nada que validar: una consulta aqui seria trabajo (y una lectura de
    // `usuario`) que el camino historico nunca hizo.
    expect(findTiendaDestino).not.toHaveBeenCalled();
    if (r.status === "ok") expect(r.apiKey.ownerUsuarioId).toBe("u-dedicada");
  });
});

describe("302 — elecciones que se RECHAZAN, y ninguna escribe", () => {
  it("una tienda que no existe -> validation_error en `tiendaDestinoId`, sin crear nada", async () => {
    const { repo } = makeRepo(null);
    const r = await new ApiKeyService(repo).generar(
      { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
      MAESTRO,
    );
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["tiendaDestinoId"]);
    }
    expect(repo.createConUsuario).not.toHaveBeenCalled();
  });

  it.each(["apiKey", "mensajero", "adminSatelite", "maestro", "admin"])(
    "una cuenta de rol %s no puede ser tienda destino, y no se crea la key",
    async (rol) => {
      const { repo } = makeRepo({ ...NUFORM, rol });
      const r = await new ApiKeyService(repo).generar(
        { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
        MAESTRO,
      );
      expect(r.status).toBe("validation_error");
      expect(repo.createConUsuario).not.toHaveBeenCalled();
    },
  );

  it.each(["pendiente", "inactivo", "bloqueado"] as const)(
    "una tienda en estado %s no puede ser tienda destino, y no se crea la key",
    async (estado) => {
      const { repo } = makeRepo({ ...NUFORM, estado });
      const r = await new ApiKeyService(repo).generar(
        { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
        MAESTRO,
      );
      expect(r.status).toBe("validation_error");
      expect(repo.createConUsuario).not.toHaveBeenCalled();
    },
  );

  it("el rechazo NO revela nada de la cuenta consultada (ni nombre, ni rol, ni estado)", async () => {
    const { repo } = makeRepo({ ...NUFORM, nombre: "Cliente Confidencial SA", rol: "mensajero" });
    const r = await new ApiKeyService(repo).generar(
      { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
      MAESTRO,
    );
    expect(JSON.stringify(r)).not.toContain("Cliente Confidencial SA");
    expect(JSON.stringify(r)).not.toContain("mensajero");
  });

  it("un actor que no es maestro no llega ni a consultar la tienda destino (R2 primero)", async () => {
    const { repo, findTiendaDestino } = makeRepo();
    const r = await new ApiKeyService(repo).generar(
      { identificador: "Nuform ERP", tiendaDestinoId: UUID_NUFORM },
      { usuarioId: "u1", rol: "adminTienda" },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(findTiendaDestino).not.toHaveBeenCalled();
    expect(repo.createConUsuario).not.toHaveBeenCalled();
  });
});
