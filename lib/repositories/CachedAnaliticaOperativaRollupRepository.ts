// Feature 128 (T3.1, design §4) — EL DECORADOR: donde se cachea.
//
// ┌ consultarAnaliticaOperativa            (126, sin cambios de firma)
// │  └─ AnaliticaOperativaService          (126, sin cambios)
// │       ├─ IAnaliticaOperativaRollupRepository ← ESTE decorador
// │       │       └─ AnaliticaOperativaRollupRepository (126) → GROUP BY analytics_daily
// │       └─ IAnaliticaOperativaVivaRepository   ← SIN DECORAR → dia en curso
// └
//
// CUATRO razones por las que el punto de corte es el REPOSITORIO y no la Server Action:
//
//  1. **El dia en curso queda fuera POR CONSTRUCCION (R3), no por politica.** El intradia se
//     sirve desde `IAnaliticaOperativaVivaRepository`, que nadie decora. No hay una regla que
//     alguien pueda olvidar: no hay camino.
//  2. **La seudonimizacion queda fuera de la cache.** Ocurre en el servicio, ENCIMA del
//     repositorio (`AnaliticaOperativaService.seudonimizarPuntos`). Cachear en la accion
//     obligaria a meter `politicaIdentidad` en la clave y una omision filtraria ids reales de
//     mensajero. Aqui lo cacheado son cubos con ids crudos y la etiqueta ordinal se recalcula.
//  3. **Se cachea exactamente lo que cuesta**: el `GROUP BY` con `_sum` de diez medidas.
//  4. **Sigue habiendo UN SOLO LECTOR de `analytics_daily` (R22).** Este archivo no conoce
//     Prisma ni nombra la tabla: delega en el repositorio de la 126, asi que el guardia R42 de
//     la 124 (`tests/integration/db/analytics-daily-guards.test.ts`) sigue verde sin tocarlo.
//
// R4 — `etiquetasDeEstatus` se DELEGA SIEMPRE. Su valor es un `ReadonlyMap`, que no sobrevive
// a `JSON.stringify`/`JSON.parse`: volveria como `{}` y la dimension quedaria etiquetada con
// ids crudos en vez de con el `value` del estatus.

import { claveDeConsulta, codificarCubos, decodificarCubos } from "@/lib/analytics/cache-clave";
import { TAGS_OPERATIVA } from "@/lib/analytics/cache-tags";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { analiticaCacheHabilitada } from "@/lib/config/analitica-cache";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type {
  CuboRollup,
  EtiquetaEstatus,
  IAnaliticaOperativaRollupRepository,
} from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";
import type { DimensionAnalitica } from "@/lib/analytics/types";

export class CachedAnaliticaOperativaRollupRepository
  implements IAnaliticaOperativaRollupRepository
{
  constructor(
    private readonly interno: IAnaliticaOperativaRollupRepository,
    private readonly cache: IAnaliticaCache,
  ) {}

  /**
   * R2 — una segunda consulta equivalente no vuelve a agregar sobre `analytics_daily`.
   *
   * R9 — el CODEC va DENTRO y FUERA del puerto, y no es una precaucion: `segCicloAcum` es
   * `bigint` y `JSON.stringify` sobre un `BigInt` **lanza `TypeError`**. Sin codec, guardar el
   * cubo rompe la CONSULTA entera, no la cache. Al leer se rehidrata: sin eso `tiempo_ciclo`
   * concatenaria cadenas en vez de sumar.
   */
  async agregarCubos(
    consulta: ConsultaAnalitica,
    granos: readonly DimensionAnalitica[],
  ): Promise<readonly CuboRollup[]> {
    const clave = claveDeConsulta(consulta, granos);
    const codificados = await this.cache.envolver(clave, TAGS_OPERATIVA, async () =>
      codificarCubos(await this.interno.agregarCubos(consulta, granos)),
    );
    return decodificarCubos(codificados);
  }

  /** R4 — sin cache: un `ReadonlyMap` no sobrevive al viaje por JSON. */
  async etiquetasDeEstatus(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, EtiquetaEstatus>> {
    return this.interno.etiquetasDeEstatus(ids);
  }
}

/**
 * R16 (D5) — el punto UNICO donde se decide si hay cache.
 *
 * Con la bandera apagada devuelve el repositorio DESNUDO: no se lee ni se escribe una sola
 * entrada, no solo «no se sirve desde cache». Es la diferencia entre un kill-switch y un
 * placebo.
 *
 * Ausencia de la variable = ENCENDIDA (`analiticaCacheHabilitada`).
 */
export function decorarRollupConCache(
  interno: IAnaliticaOperativaRollupRepository,
  cache: IAnaliticaCache,
  env: Readonly<Record<string, string | undefined>> = process.env,
): IAnaliticaOperativaRollupRepository {
  if (!analiticaCacheHabilitada(env)) return interno;
  return new CachedAnaliticaOperativaRollupRepository(interno, cache);
}
