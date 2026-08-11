// Feature 179 (T2.1, design §3) — EL DECORADOR DE LECTURA DEL DOMINIO FINANCIERO.
//
// ┌ consultarMetricaFinanciera                  (127, sin cambios de firma — R20)
// │  └─ IAnaliticaFinancieraService
// │       ├─ CachedAnaliticaFinancieraService   (179)  ← ESTE es el punto de corte
// │       │     └─ AnaliticaFinancieraService   (127, sin cambios: ni una suma)
// │       │           └─ los CUATRO repositorios financieros (127/180/187, sin cambios)
// │       └─ (bandera apagada) el servicio DESNUDO (R22)
// └
//
// ─── POR QUE EL SERVICIO Y NO OTRA CAPA ─────────────────────────────────────────────────────
//
//  1. **Se cachea exactamente lo que cuesta.** Una metrica financiera son entre dos y tres
//     consultas de agregacion sobre los ledgers, algunas dentro de una lectura consistente
//     (feature 187). Es el trabajo caro entero, en una entrada.
//  2. **La entrada de la clave ya esta autorizada y recortada.** El decorador recibe la misma
//     `ConsultaAnalitica` que el servicio, con alcance resuelto y filtro recortado por la 122:
//     no puede cachear algo que el permiso no concedio, ni un 403 (cachear en la Server Action
//     si podria: alli conviven `validation_error` y `forbidden`).
//  3. **Decorar los CUATRO repositorios no se puede.** Tres de ellos exponen
//     `enLecturaConsistente<T>(fn)`, que recibe una FUNCION ARBITRARIA y abre una transaccion:
//     la clave tendria que derivarse del cuerpo del callback. Ademas la 187 dejaria de
//     significar lo que significa —dos consultas bajo un mismo snapshot— si una viniera de
//     cache y la otra de la base. Cortar en el servicio preserva ademas la invariante de la 180
//     (Σ filas == total), porque cachea las dos cifras JUNTAS o ninguna.
//  4. **NO hay «dia en curso» protegido por construccion, y hay que saberlo.** En la operativa
//     el intradia se sirve de otro repositorio que nadie decora (R3 de la 128). Aqui TODO es
//     vivo: no hay tabla de rollup, la financiera lee los ledgers directamente. Por eso la
//     correccion descansa ENTERA sobre la invalidacion, y por eso el censo de R17 es el corazon
//     de la feature y no un adorno.
//
// ─── NO HAY CODEC, Y ESO NO ES SUERTE: HAY QUE VIGILARLO (R3) ───────────────────────────────
// `ResultadoFinanciero` es JSON-safe de punta a punta: todo importe viaja como `string` escala 2
// y el unico `number` es el CONTEO de cierres. La 128 necesitaba codec porque
// `CuboRollup.segCicloAcum` es `bigint` y `JSON.stringify` **lanza**. Aqui pasa lo contrario y
// es peor: **nada lanza**. Un campo futuro `corteAt: Date` volveria del viaje por JSON como
// `string` y la pantalla seguiria pintando. El sitio del codec lo ocupan dos pruebas:
// `cache-financiera-json.test.ts` (round-trip real de las diez metricas) y
// `cache-financiera-json.guardia.test.ts` (lectura estatica del contrato).

import { claveFinanciera } from "@/lib/analytics/cache-clave-financiera";
import { esMetricaFinancieraCacheable } from "@/lib/analytics/cache-politica-financiera";
import { TAGS_FINANCIERA } from "@/lib/analytics/cache-tags";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { analiticaCacheHabilitada } from "@/lib/config/analitica-cache";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type {
  IAnaliticaFinancieraService,
  ResultadoConsultaFinanciera,
} from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import type { ResultadoFinanciero } from "@/lib/types/analitica-financiera";

/**
 * R4 — el vehiculo por el que un resultado que NO es `status: "ok"` sale del productor SIN
 * dejar entrada.
 *
 * POR QUE UNA EXCEPCION Y NO UN VALOR CENTINELA. El puerto `envolver` guarda **todo lo que el
 * productor devuelva**: un `null`, un `{ status: "dominio_invalido" }` o cualquier centinela se
 * escribirian en cache igual que una cifra buena. Lo unico que un productor puede hacer para
 * que no se escriba nada es LANZAR — y esa es exactamente la semantica de `unstable_cache`, que
 * no guarda promesas rechazadas (la cache falsa de los tests replica ese comportamiento).
 *
 * Lo que R4 compra: cachear un error lo vuelve PERMANENTE durante todo el TTL. Un fallo
 * transitorio de la base se serviria como respuesta buena durante una hora, y el segundo intento
 * del usuario devolveria el mismo error sin haber tocado nada.
 */
class ResultadoNoCacheable extends Error {
  constructor(readonly resultado: ResultadoConsultaFinanciera) {
    super("analitica financiera: resultado no cacheable (R4)");
    this.name = "ResultadoNoCacheable";
  }
}

export class CachedAnaliticaFinancieraService implements IAnaliticaFinancieraService {
  constructor(
    private readonly interno: IAnaliticaFinancieraService,
    private readonly cache: IAnaliticaCache,
  ) {}

  async consultar(consulta: ConsultaAnalitica): Promise<ResultadoConsultaFinanciera> {
    // (0) D3/R28 — LA POLITICA, ANTES DE TOCAR LA CACHE. Una metrica no declarada cacheable
    // —hoy solo `conciliacion_cierres`, por `alerta_por_consulta`— delega SIN LEER NI ESCRIBIR
    // una sola entrada. No es «no servir desde cache»: es no entrar.
    //
    // Por aqui pasan tambien las metricas de otros dominios, que no tienen politica escrita y
    // van a producir `dominio_invalido` mas abajo: delegar es lo correcto para las dos.
    if (!esMetricaFinancieraCacheable(consulta.metrica.id)) {
      return this.interno.consultar(consulta);
    }

    const clave = claveFinanciera(consulta);

    try {
      // R1 — el DTO se devuelve TAL CUAL, sin tocar un solo campo. Lo que vuelve de un HIT es el
      // round-trip por JSON, y R3 es quien garantiza que eso no cambia ningun tipo.
      const datos = await this.cache.envolver<ResultadoFinanciero>(
        clave,
        TAGS_FINANCIERA,
        async () => {
          const resultado = await this.interno.consultar(consulta);
          if (resultado.status !== "ok") throw new ResultadoNoCacheable(resultado);
          return resultado.datos;
        },
      );
      return { status: "ok", datos };
    } catch (error) {
      // Solo se desenvuelve el vehiculo de R4. Un fallo REAL de repositorio sube tal cual —el
      // borde lo traduce con contexto y sin PII (R32 de la 127)— y tampoco deja entrada.
      if (error instanceof ResultadoNoCacheable) return error.resultado;
      throw error;
    }
  }
}

/**
 * R22 (D5 de la 128) — el punto UNICO donde se decide si hay cache financiera.
 *
 * Con la bandera apagada devuelve el servicio DESNUDO: no se lee ni se escribe una sola entrada,
 * no solo «no se sirve desde cache». Es la diferencia entre un kill-switch y un placebo — y aqui
 * importa mas que en la operativa, porque el dominio es el dinero: si la cache sirviera algo
 * raro, apagarla no debe requerir un PR.
 *
 * Mismo default que la 128: ausencia de la variable = ENCENDIDA. Mismo patron que
 * `decorarRollupConCache`, incluido el `env` por parametro para que el test no mute
 * `process.env` global.
 */
export function decorarFinancieraConCache(
  interno: IAnaliticaFinancieraService,
  cache: IAnaliticaCache,
  env: Readonly<Record<string, string | undefined>> = process.env,
): IAnaliticaFinancieraService {
  if (!analiticaCacheHabilitada(env)) return interno;
  return new CachedAnaliticaFinancieraService(interno, cache);
}
