import { describe, it, expect, vi } from "vitest";

import { obtenerConteosPublicos } from "@/lib/actions/conteos-publicos";
import { ConteosPublicosRepository } from "@/lib/repositories/ConteosPublicosRepository";
import { ConteosPublicosCacheNula } from "@/lib/cache/conteos-publicos-cache-nula";
import type { IConteosPublicosCache } from "@/lib/interfaces/external/IConteosPublicosCache";
import { CONTEOS_PUBLICOS_CACHE_KEY } from "@/lib/config/conteos-publicos-cache";
import type { IConteosPublicosRepository } from "@/lib/interfaces/repositories/IConteosPublicosRepository";

// Feature 198 — los tres conteos publicos.
//
// El caso mas importante de este archivo NO es que los numeros salgan: es que la accion NO
// ACEPTE ENTRADA DE DOMINIO. Es publica —sin sesion ni rol— y Prisma va con service role, asi
// que un filtro la convertiria en un oraculo por inquilino. Esa guardia esta al final.

const CONTEOS = {
  distritosConCobertura: 12,
  ordenesGestionadas: 340,
  ordenesSinGestionar: 57,
};

function repoDoble(): IConteosPublicosRepository {
  return { contar: vi.fn().mockResolvedValue(CONTEOS) };
}

/**
 * Doble de cache. `envolver` es GENERICO en la interfaz y un `vi.fn()` suelto NO lo satisface
 * —se instancia como `unknown` y `tsc` lo rechaza—, asi que el spy va dentro de una
 * implementacion tipada en vez de sustituirla. Las claves quedan fuera para poder afirmarlas.
 *
 * `respuesta` simula un ACIERTO de cache: se devuelve sin llamar a `producir`.
 */
function cacheDoble(respuesta?: typeof CONTEOS) {
  const claves: string[] = [];
  const cache: IConteosPublicosCache = {
    async envolver<T>(clave: string, producir: () => Promise<T>): Promise<T> {
      claves.push(clave);
      if (respuesta !== undefined) return respuesta as T;
      return producir();
    },
  };
  return { cache, claves };
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
      "distritosConCobertura",
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
    const { cache, claves } = cacheDoble();

    await obtenerConteosPublicos({ repo: repoDoble(), cache });

    expect(claves).toEqual([CONTEOS_PUBLICOS_CACHE_KEY]);
  });

  it("no vuelve a consultar si la cache responde", async () => {
    const repo = repoDoble();
    const { cache } = cacheDoble(CONTEOS);

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
    const distrito = { count: vi.fn().mockResolvedValue(12) };
    const orden = { count: vi.fn().mockResolvedValue(0) };
    const prisma = {
      distrito,
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

  it("cobertura: cuenta DISTRITOS distintos por la tabla puente, no filas ni columna escalar", async () => {
    // Dos afirmaciones en una: que la cuenta sea sobre `Distrito` —contar filas de
    // `zona_distrito` contaria dos veces un distrito servido por dos zonas— y que llegue a la
    // zona por la relacion `zonas` del puente. `Distrito` no tiene `zonaId`: la escalar se
    // elimino en la migracion de la feature 24, asi que "simplificarlo" a un `zonaId` no
    // compilaria; cambiarlo por otra ruta lo dice este caso.
    const distrito = { count: vi.fn().mockResolvedValue(12) };
    const orden = { count: vi.fn().mockResolvedValue(0) };
    const prisma = {
      distrito,
      orden,
      $transaction: vi.fn(async (ops: Promise<number>[]) => Promise.all(ops)),
    };

    const r = await new ConteosPublicosRepository(
      prisma as unknown as ConstructorParameters<typeof ConteosPublicosRepository>[0],
    ).contar();

    expect(distrito.count.mock.calls[0][0]).toEqual({
      where: { zonas: { some: {} } },
    });
    // Y que ese numero sea el que sale por `distritosConCobertura`, no otro campo.
    expect(r.distritosConCobertura).toBe(12);
  });

  it("las tres cuentas van bajo el MISMO snapshot", async () => {
    // Leidas en instantes distintos, una orden gestionada entre medias podria contarse en
    // las dos cuentas —o en ninguna— y la suma dejaria de cuadrar.
    const prisma = {
      distrito: { count: vi.fn().mockResolvedValue(1) },
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
