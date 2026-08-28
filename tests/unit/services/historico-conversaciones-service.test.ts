import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";

import { HistoricoConversacionesService } from "@/lib/services/HistoricoConversacionesService";
import {
  HistoricoConversacionesRepository,
  type HistoricoPrismaClient,
} from "@/lib/repositories/HistoricoConversacionesRepository";
import type {
  IHistoricoConversacionesRepository,
  ListarHilosPagina,
  ListarMensajesPagina,
} from "@/lib/interfaces/repositories/IHistoricoConversacionesRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { HiloHistoricoDTO } from "@/lib/types/historico-conversaciones";
import { listarMensajesHistoricoSchema } from "@/lib/types/historico-conversaciones";
import { ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";

// Feature 318 / T3.6 — `HistoricoConversacionesService`: AUTORIZACION, NO-ESCRITURA y hilo
// completo.
//
// Los tres asuntos que este archivo fija, y por que cada uno se mide como se mide:
//
//  - AUTORIZACION (R7/R10). No basta con que el resultado sea `forbidden`: se afirma ademas que
//    el repositorio NO SE LLAMO. «Consultar y luego filtrar» y «no consultar» dan el mismo
//    `status` y son cosas distintas — la primera pagina trabajo y superficie de fuga por cada
//    negativa.
//  - NO-ESCRITURA (R25). El doble de Prisma LANZA ante `update`, `create`, `upsert`, `delete` y
//    `$executeRaw`. Se ejecutan las DOS operaciones del histórico con el repositorio REAL encima
//    de ese doble: si alguien mete una escritura en este camino —marcar leido, sellar, contar—,
//    el test revienta con el nombre del metodo. Es lo contrario de un comentario que promete que
//    no se escribe.
//  - HILO COMPLETO (R17). El esquema de la pagina de mensajes es `.strict()` y NO declara claves
//    de fecha: un `fecha_desde` colado ahi es `validation_error`, no una clave ignorada. La otra
//    mitad de R17 —que la paginacion completa devuelve los mensajes de los dos meses— se mide
//    contra Postgres en `tests/integration/repositories/historico-conversaciones.int.test.ts`.

const HILO: HiloHistoricoDTO = {
  ordenId: "orden-1",
  mensajeroId: "mensajero-1",
  numGuia: 1001,
  numRemision: "REM-1001",
  destinatario: "María González",
  mensajeroNombre: "Ana Zulúaga",
  telefonoVigenteMasked: "7777",
  telefonosCount: 1,
  ultimaActividadAt: "2026-08-20T15:00:00.000Z",
  totalMensajes: 4,
};

const PAGINA_HILOS: ListarHilosPagina = { items: [HILO], siguiente: null };
const PAGINA_MENSAJES: ListarMensajesPagina = { mensajes: [], anterior: null };

function crearRepoDoble(): IHistoricoConversacionesRepository & {
  listarHilos: ReturnType<typeof vi.fn>;
  listarMensajes: ReturnType<typeof vi.fn>;
  obtenerCabecera: ReturnType<typeof vi.fn>;
} {
  return {
    listarHilos: vi.fn(async () => PAGINA_HILOS),
    listarMensajes: vi.fn(async () => PAGINA_MENSAJES),
    obtenerCabecera: vi.fn(async () => HILO),
  } as unknown as IHistoricoConversacionesRepository & {
    listarHilos: ReturnType<typeof vi.fn>;
    listarMensajes: ReturnType<typeof vi.fn>;
    obtenerCabecera: ReturnType<typeof vi.fn>;
  };
}

const actorDe = (rol: RolValue): Actor => ({ usuarioId: `u-${rol}`, rol });

const TODOS_LOS_ROLES: RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];
const PERMITIDOS: readonly RolValue[] = ROLES_HISTORICO_CONVERSACIONES;
const DENEGADOS = TODOS_LOS_ROLES.filter((rol) => !PERMITIDOS.includes(rol));

describe("318 / T3.6 — HistoricoConversacionesService", () => {
  let repo: ReturnType<typeof crearRepoDoble>;
  let service: HistoricoConversacionesService;

  beforeEach(() => {
    repo = crearRepoDoble();
    service = new HistoricoConversacionesService(repo);
  });

  // ==========================================================================================
  // R7 / R10 — autorizacion por rol, en el SERVICE
  // ==========================================================================================

  it.each(DENEGADOS)(
    "R7/R10: el rol %s recibe forbidden y el repositorio NO se llama",
    async (rol) => {
      expect(await service.listarHilos({}, actorDe(rol))).toEqual({ status: "forbidden" });
      expect(repo.listarHilos).not.toHaveBeenCalled();

      expect(
        await service.listarMensajes(
          { ordenId: "orden-1", mensajeroId: "mensajero-1" },
          actorDe(rol),
        ),
      ).toEqual({ status: "forbidden" });
      expect(repo.listarMensajes).not.toHaveBeenCalled();
      expect(repo.obtenerCabecera).not.toHaveBeenCalled();
    },
  );

  it.each([...PERMITIDOS])("R10: el rol %s ve hilos de mensajeros que no son el", async (rol) => {
    const res = await service.listarHilos({}, actorDe(rol));
    expect(res.status).toBe("ok");
    // El repositorio recibe el filtro TAL CUAL, sin ningun `mensajeroId` de sesion añadido: esa
    // es la diferencia deliberada con el chat del mensajero (R26, que no se toca).
    expect(repo.listarHilos).toHaveBeenCalledWith({
      filtro: {},
      cursor: null,
      limite: 25,
    });
  });

  it("sin actor resuelto, las dos operaciones son unauthenticated y no consultan", async () => {
    expect(await service.listarHilos({}, null)).toEqual({ status: "unauthenticated" });
    expect(
      await service.listarMensajes({ ordenId: "o", mensajeroId: "m" }, null),
    ).toEqual({ status: "unauthenticated" });
    expect(repo.listarHilos).not.toHaveBeenCalled();
    expect(repo.listarMensajes).not.toHaveBeenCalled();
  });

  it("R38: una entrada invalida es validation_error y el repositorio NO se llama", async () => {
    const res = await service.listarHilos(
      { filtro: { mensajero_id: [] } } as never,
      actorDe("admin"),
    );
    expect(res.status).toBe("validation_error");
    expect(repo.listarHilos).not.toHaveBeenCalled();
  });

  // ==========================================================================================
  // R41 — el listado no trae mensajes, ni los pide
  // ==========================================================================================

  it("R41: el listado no devuelve mensajes ni provoca la consulta del hilo", async () => {
    const res = await service.listarHilos({}, actorDe("maestro"));
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(Object.keys(res.items[0]!)).not.toContain("mensajes");
    expect(repo.listarMensajes).not.toHaveBeenCalled();
  });

  // ==========================================================================================
  // R17 — el hilo abierto no se recorta por fecha
  // ==========================================================================================

  it("R17: la entrada del hilo NO admite claves de fecha (el .strict() las rechaza)", () => {
    expect(
      listarMensajesHistoricoSchema.safeParse({
        ordenId: "o",
        mensajeroId: "m",
        fecha_desde: "2026-08-15",
      }).success,
    ).toBe(false);
  });

  it("R17: un fecha_desde colado en la entrada del hilo es validation_error, no se ignora", async () => {
    const res = await service.listarMensajes(
      { ordenId: "o", mensajeroId: "m", fecha_desde: "2026-08-15" } as never,
      actorDe("admin"),
    );
    expect(res.status).toBe("validation_error");
    expect(repo.listarMensajes).not.toHaveBeenCalled();
  });

  it("un hilo inexistente es not_found, no una pagina vacia", async () => {
    repo.obtenerCabecera.mockResolvedValueOnce(null);
    const res = await service.listarMensajes(
      { ordenId: "o", mensajeroId: "m" },
      actorDe("admin"),
    );
    expect(res).toEqual({ status: "not_found" });
    expect(repo.listarMensajes).not.toHaveBeenCalled();
  });

  // ==========================================================================================
  // R25 — SOLO LECTURA, con el repositorio REAL encima de un Prisma que lanza al escribir
  // ==========================================================================================

  describe("R25 — ninguna escritura en el camino del histórico", () => {
    /** Cualquiera de estos metodos, invocado, es un fallo del test con el nombre escrito. */
    function metodoQueLanza(nombre: string) {
      return vi.fn(() => {
        throw new Error(
          `R25 violado: el histórico llamo a \`${nombre}\`. Esta pantalla es SOLO LECTURA y en ` +
            "particular NO debe tocar `chat_conversacion.mensajero_leido_at`.",
        );
      });
    }

    function crearPrismaDoble() {
      return {
        $queryRaw: vi.fn(async () => []),
        $executeRaw: metodoQueLanza("$executeRaw"),
        $executeRawUnsafe: metodoQueLanza("$executeRawUnsafe"),
        chatConversacion: {
          update: metodoQueLanza("chatConversacion.update"),
          updateMany: metodoQueLanza("chatConversacion.updateMany"),
          create: metodoQueLanza("chatConversacion.create"),
          upsert: metodoQueLanza("chatConversacion.upsert"),
          delete: metodoQueLanza("chatConversacion.delete"),
        },
        chatMensaje: {
          update: metodoQueLanza("chatMensaje.update"),
          create: metodoQueLanza("chatMensaje.create"),
          upsert: metodoQueLanza("chatMensaje.upsert"),
          delete: metodoQueLanza("chatMensaje.delete"),
        },
      };
    }

    it("ejecuta las DOS operaciones sin escribir en ninguna tabla", async () => {
      const prismaDoble = crearPrismaDoble();
      const real = new HistoricoConversacionesService(
        new HistoricoConversacionesRepository(
          prismaDoble as unknown as HistoricoPrismaClient,
        ),
      );

      // Con `$queryRaw` devolviendo `[]`, el listado sale vacio y el hilo sale `not_found`. Lo
      // que se mide aqui NO es el contenido: es que recorrer los dos caminos completos no toco
      // ni un metodo de escritura.
      await expect(real.listarHilos({}, actorDe("admin"))).resolves.toEqual({
        status: "ok",
        items: [],
        siguiente: null,
      });
      await expect(
        real.listarMensajes({ ordenId: "o", mensajeroId: "m" }, actorDe("admin")),
      ).resolves.toEqual({ status: "not_found" });

      // El contador de no leidos del mensajero es de EL: leer el histórico no lo consume.
      expect(prismaDoble.chatConversacion.update).not.toHaveBeenCalled();
      expect(prismaDoble.chatConversacion.updateMany).not.toHaveBeenCalled();
      expect(prismaDoble.chatMensaje.create).not.toHaveBeenCalled();
      expect(prismaDoble.$executeRaw).not.toHaveBeenCalled();
      // Y si hubo consultas, fueron TODAS de lectura.
      expect(prismaDoble.$queryRaw).toHaveBeenCalled();
    });

    it("el cliente Prisma que el repositorio admite NO expone metodos de escritura", () => {
      // Mitad ESTRUCTURAL de R25: `HistoricoPrismaClient` es `Pick<PrismaClient, "$queryRaw">`.
      // Este `@ts-expect-error` se pone rojo —en el typecheck— el dia que alguien ensanche ese
      // `Pick` con un metodo de escritura, que es justo cuando hay que enterarse.
      const soloLectura: HistoricoPrismaClient = { $queryRaw: (async () => []) as never };
      // @ts-expect-error `$executeRaw` no forma parte del cliente que este repositorio acepta.
      expect(soloLectura.$executeRaw).toBeUndefined();
    });
  });
});
