import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { GRUPOS_NOVEDAD } from "@/lib/types/novedad-grupo";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

/**
 * Feature 236 (T2.1/T2.5) — las TRES lecturas nuevas de `/novedades` se EJECUTAN contra un Postgres
 * de verdad. Molde: `satelite-conjunto-sql-real.test.ts` (feature 184, tanda A).
 *
 * QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO, que es lo que importa.
 *
 * **SÍ prueba** que el SQL que Prisma emite para el predicado partido y para la fecha de solicitud
 * es SQL válido contra el ESQUEMA REAL: que `estatus.value` sigue resolviendo por la relación, que
 * `orden_historial_estado` tiene `origen_tipo` y que `solicitud_ayuda_tienda` es un valor admisible
 * de ese enum en la base, no solo en el cliente generado. Ese es exactamente el fallo que ningún
 * test de arriba puede ver: los dobles de `orden-repository.novedades.test.ts` aceptan cualquier
 * objeto como `where`, así que un nombre de relación mal escrito o un valor de enum que la
 * migración nunca sembró pasan verdes ahí y revientan la primera vez que una tienda abre la
 * pestaña.
 *
 * **NO prueba el conjunto de filas.** Es una lectura de SOLO LECTURA con un `tiendaId` que no
 * existe, así que el resultado correcto es vacío. QUÉ filas admite cada predicado se prueba donde
 * puede probarse sin sembrar media base: en `orden-repository.novedades.test.ts`, con un evaluador
 * que APLICA el predicado a filas y que REVIENTA ante cualquier forma que no entienda —incluido el
 * `OR` de ayer—. Sembrar aquí una tienda, una zona, una provincia, un cantón, un distrito y dos
 * estatus para volver a comprobar lo mismo dejaría bloat en la base de quien corre la suite sin
 * añadir una sola afirmación nueva.
 *
 * Sin base alcanzable se SALTA (no falla): la suite tiene que seguir verde en una máquina sin
 * Postgres levantado. Cuando se salta, se salta ENTERO y con su nombre en el reporte — no hay
 * ningún `return` temprano que reporte «passed» sin haber comprobado nada.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** No existe ninguna tienda con este id: la lectura es real pero no puede devolver filas. */
const TIENDA_INEXISTENTE = "t-inexistente-236-predicado";

/** Ni ninguna orden con este: mismo criterio para la consulta agregada del historial. */
const ORDEN_INEXISTENTE = "o-inexistente-236-predicado";

describeSiHayBase("236 — el predicado partido de `/novedades`, contra el esquema real", () => {
  let prisma: PrismaClient;
  let repo: OrdenRepository;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
    repo = new OrdenRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("el conteo de CADA grupo es SQL válido (la igualdad de estado resuelve por la relación)", async () => {
    for (const grupo of GRUPOS_NOVEDAD) {
      await expect(
        repo.countNovedadesByTienda(TIENDA_INEXISTENTE, grupo),
        `el conteo del grupo ${grupo} no se pudo ejecutar contra el esquema real`,
      ).resolves.toBe(0);
    }
    // No-vacuidad del bucle: si `GRUPOS_NOVEDAD` quedara vacío, arriba no se habría ejecutado
    // ninguna consulta y este archivo estaría verde sin haber tocado la base.
    expect(GRUPOS_NOVEDAD.length).toBeGreaterThan(1);
  });

  it("la PÁGINA de cada grupo también, con su `select` de columnas y seis joins", async () => {
    // Aquí es donde un nombre de columna equivocado revienta: el `select` trae la orden completa
    // más los catálogos por nombre (estatus, tienda, zona, provincia, cantón, distrito) y —desde
    // la ficha 296— el MENSAJERO ASIGNADO (`mensajeroAsignado: { nombre }`).
    //
    // Ese sexto join es el único que apunta a `usuario` y no a un catálogo, así que es el que
    // podría estar mal nombrado sin que ningún doble se enterase: el de arriba, con Prisma
    // mockeado, acepta cualquier objeto como `select`. Aquí lo ejecuta Postgres.
    for (const grupo of GRUPOS_NOVEDAD) {
      await expect(
        repo.findNovedadesByTienda(TIENDA_INEXISTENTE, grupo, { skip: 0, take: 10 }),
        `la página del grupo ${grupo} no se pudo ejecutar contra el esquema real`,
      ).resolves.toEqual([]);
    }
  });

  it("236/R17: la fecha de la solicitud consulta el historial por su familia de origen REAL", async () => {
    // La comprobación con más valor del archivo: `solicitud_ayuda_tienda` es un valor del enum
    // `orden_historial_origen_tipo` que sembró la migración de la feature 235. Si esa migración no
    // estuviera aplicada en la base que se está usando, esta consulta falla aquí y no en la primera
    // apertura de la pestaña en producción.
    await expect(repo.findFechaSolicitudAyuda([ORDEN_INEXISTENTE])).resolves.toEqual(new Map());
  });

  it("con la lista de ids vacía NO se toca la base (el atajo no es una consulta encubierta)", async () => {
    // El atajo `if (ordenIds.length === 0) return new Map()` existe para no disparar un `IN ()`.
    // Se afirma su resultado; que no consulte se afirma sobre el doble, en el test de repositorio.
    await expect(repo.findFechaSolicitudAyuda([])).resolves.toEqual(new Map());
  });
});
