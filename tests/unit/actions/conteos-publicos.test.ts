import { describe, it, expect, vi } from "vitest";

import { obtenerConteosPublicos } from "@/lib/actions/conteos-publicos";
import { ConteosPublicosRepository } from "@/lib/repositories/ConteosPublicosRepository";
import { ConteosPublicosCacheNula } from "@/lib/cache/conteos-publicos-cache-nula";
import { CONTEOS_PUBLICOS_CACHE_KEY } from "@/lib/config/conteos-publicos-cache";
import type { IConteosPublicosRepository } from "@/lib/interfaces/repositories/IConteosPublicosRepository";

// Feature 198 — los tres conteos publicos.
//
// El caso mas importante de este archivo NO es que los numeros salgan: es que la accion NO
// ACEPTE ENTRADA DE DOMINIO. Es publica —sin sesion ni rol— y Prisma va con service role, asi
// que un filtro la convertiria en un oraculo por inquilino. Esa guardia esta al final.

const CONTEOS = {
  cantonesConCobertura: 12,
  ordenesGestionadas: 340,
  ordenesSinGestionar: 57,
};

function repoDoble(): IConteosPublicosRepository {
  return { contar: vi.fn().mockResolvedValue(CONTEOS) };
}

describe("obtenerConteosPublicos", () => {
  it("devuelve los tres conteos", async () => {
    const r = await obtenerConteosPublicos({
      repo: repoDoble(),
      cache: new ConteosPublicosCacheNula(),
    });

    expect(r).toEqual(CONTEOS);
  });

  it("solo devuelve NUMEROS: ni ids, ni nombres, ni listas", async () => {
    // Un conteo no identifica a nadie; una lista, si. Al ser publica, la forma del DTO es
    // parte de la defensa, no una preferencia de estilo.
    const r = await obtenerConteosPublicos({
      repo: repoDoble(),
      cache: new ConteosPublicosCacheNula(),
    });

    expect(Object.keys(r).sort()).toEqual([
      "cantonesConCobertura",
      "ordenesGestionadas",
      "ordenesSinGestionar",
    ]);
    for (const valor of Object.values(r)) {
      expect(typeof valor).toBe("number");
    }
  });

  it("pasa por la cache, con la clave constante y sin discriminantes", async () => {
    // La clave no lleva rol, usuario ni filtro porque el resultado es global e igual para
    // todos. Si algun dia dejara de serlo, esta afirmacion tendria que caer primero.
    const envolver = vi.fn(async (_clave: string, producir: () => Promise<unknown>) =>
      producir(),
    );

    await obtenerConteosPublicos({ repo: repoDoble(), cache: { envolver } });

    expect(envolver).toHaveBeenCalledTimes(1);
    expect(envolver.mock.calls[0][0]).toBe(CONTEOS_PUBLICOS_CACHE_KEY);
  });

  it("no vuelve a consultar si la cache responde", async () => {
    const repo = repoDoble();
    const cache = { envolver: vi.fn().mockResolvedValue(CONTEOS) };

    const r = await obtenerConteosPublicos({ repo, cache });

    expect(r).toEqual(CONTEOS);
    expect(repo.contar).not.toHaveBeenCalled();
  });

  // GUARDIA. Si esto se pone rojo, alguien le añadio un parametro de dominio a una accion
  // publica: eso NO es una mejora, es una fuga de datos por inquilino esperando a ocurrir.
  it("GUARDIA: la accion no acepta entrada de dominio (solo la inyeccion de dobles)", () => {
    // `length` cuenta los parametros ANTES del primero con valor por defecto. `deps` lo
    // tiene, asi que una accion sin entrada de dominio declara longitud 0.
    expect(obtenerConteosPublicos).toHaveLength(0);
  });
});

describe("ConteosPublicosRepository", () => {
  it("cuenta ORDENES distintas, no gestiones, y las dos cuentas son complementarias", async () => {
    // `gestion_orden` no tiene @@unique(ordenId): contar filas de gestion daria un numero
    // mayor que el total de ordenes (trampa que la feature 192 dejo documentada). Se afirma
    // sobre el WHERE, que es donde vive esa decision.
    const canton = { count: vi.fn().mockResolvedValue(12) };
    const orden = { count: vi.fn().mockResolvedValue(0) };
    const prisma = {
      canton,
      orden,
      $transaction: vi.fn(async (ops: Promise<number>[]) => Promise.all(ops)),
    };

    await new ConteosPublicosRepository(
      prisma as unknown as ConstructorParameters<typeof ConteosPublicosRepository>[0],
    ).contar();

    const [gestionadas, sinGestionar] = orden.count.mock.calls.map((c) => c[0]);
    // Mismo universo en las dos: sin el `deletedAt: null` de ambas, la suma no cuadra.
    expect(gestionadas.where.deletedAt).toBeNull();
    expect(sinGestionar.where.deletedAt).toBeNull();
    // Complementarias por construccion: `some` vigente frente a `none` vigente.
    expect(gestionadas.where.gestiones).toEqual({ some: { anuladaAt: null } });
    expect(sinGestionar.where.gestiones).toEqual({ none: { anuladaAt: null } });
  });

  it("cobertura: llega a la zona por la tabla puente, no por una columna escalar", async () => {
    // `Canton` no tiene `zonaId` y `Distrito` tampoco —la escalar se elimino en la migracion
    // de la feature 24—. Si alguien "simplifica" esto a un `zonaId`, no compilara; si lo
    // cambia por otra ruta, este caso lo dira.
    const canton = { count: vi.fn().mockResolvedValue(12) };
    const orden = { count: vi.fn().mockResolvedValue(0) };
    const prisma = {
      canton,
      orden,
      $transaction: vi.fn(async (ops: Promise<number>[]) => Promise.all(ops)),
    };

    await new ConteosPublicosRepository(
      prisma as unknown as ConstructorParameters<typeof ConteosPublicosRepository>[0],
    ).contar();

    expect(canton.count.mock.calls[0][0]).toEqual({
      where: { distritos: { some: { zonas: { some: {} } } } },
    });
  });

  it("las tres cuentas van bajo el MISMO snapshot", async () => {
    // Leidas en instantes distintos, una orden gestionada entre medias podria contarse en
    // las dos cuentas —o en ninguna— y la suma dejaria de cuadrar.
    const prisma = {
      canton: { count: vi.fn().mockResolvedValue(1) },
      orden: { count: vi.fn().mockResolvedValue(1) },
      $transaction: vi.fn(async (ops: Promise<number>[]) => Promise.all(ops)),
    };

    await new ConteosPublicosRepository(
      prisma as unknown as ConstructorParameters<typeof ConteosPublicosRepository>[0],
    ).contar();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(3);
  });
});
