import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ResultadoFinanciero } from "@/lib/types/analitica-financiera";

// Feature 127 (T A.3) — contrato del UNICO servicio de la analitica financiera.
//
// UNA fachada para las ocho metricas, y no cuatro servicios pegados a los cuatro
// repositorios: la logica compartida —validar el dominio, leer las categorias del catalogo,
// derivar con las funciones money-safe, marcar `esAcumulado` y `sumableCon`— es la misma para
// las ocho, y partirla en cuatro la duplicaria cuatro veces. Asi es como se desincronizan las
// cifras del mismo dinero.
//
// R30 — este contrato NO menciona Prisma, ni `Request`/`Response`, ni `cookies`, ni
// `headers`. El servicio no sabe que existe HTTP y no sabe que existe una base: recibe el
// tipo opaco de la 122 y devuelve un DTO. Las dependencias entran por las cuatro interfaces
// de `lib/interfaces/repositories/` (R31), de modo que toda su suite unitaria corre sin
// `DATABASE_URL`.
//
// R7 — la entrada es `ConsultaAnalitica` y nada mas: ni filtro suelto, ni rango, ni rol, ni
// `usuarioId`. Olvidarse del recorte no da una cifra de mas: no compila.

/**
 * Lo que el servicio devuelve. `dominio_invalido` es un estado de PRIMERA CLASE, no una
 * excepcion ni un `null`:
 *
 * R5 — si el `metricaId` no pertenece al dominio `financiera`, el servicio devuelve este
 * error y **no consulta ninguna tabla**. Una rama por defecto que sirviera `entregas` con
 * ceros seria peor que un fallo: un cero es indistinguible de "no hubo movimiento".
 *
 * NO hay estado `no_producida` ⟨D8(b)⟩: la 127 produce las ocho financieras.
 *
 * Un fallo de la base NO viaja por aqui: se propaga con contexto (que metrica, que rango) y
 * sin ids ajenos ni PII (R32). Devolver "0.00" ante un fallo de consulta es la peor mentira
 * posible en dinero, y por eso no hay forma de expresarla en este tipo.
 */
export type ResultadoConsultaFinanciera =
  | { readonly status: "ok"; readonly datos: ResultadoFinanciero }
  | { readonly status: "dominio_invalido"; readonly metricaId: string };

export interface IAnaliticaFinancieraService {
  /**
   * Despacha por `consulta.metrica.id` —sin rama por defecto permisiva—, agrega por el
   * repositorio que corresponda y devuelve el DTO money-safe.
   */
  consultar(consulta: ConsultaAnalitica): Promise<ResultadoConsultaFinanciera>;
}
