import type { WalletMovimientoCategoria, WalletMovimientoTipo } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { CuboTemporal } from "@/lib/analytics/cubo-temporal";

// Feature 127 (T A.2) — contrato del repositorio de la CAJA PRINCIPAL: las cuatro metricas
// que salen de `wallet_movimiento` (`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` y
// `egresos`). Nombre por el hecho de negocio, no por la tabla (docs/conventions.md).
//
// LA CONSULTA ENTRA ENTERA (R7). El parametro es `ConsultaAnalitica` —el tipo opaco de la
// 122— y no un filtro, ni un rango suelto, ni un rol, ni un `usuarioId`. De ese objeto este
// repositorio usa DOS cosas y ninguna mas:
//   - `consulta.metrica.definicion.categorias` — las categorias las manda EL CATALOGO (R17).
//     Ningun array literal de categorias vive en la implementacion: si alguien añade un valor
//     al enum y lo declara en el catalogo, la consulta cambia sola.
//   - `consulta.rango.desde` / `.hasta` — la ventana `[desde, hasta)` por `fecha_movimiento`,
//     tal cual la produjo `resolverRango` (R26). Ninguna ventana temporal propia: construir
//     un `new Date(fecha)` aqui reintroduciria el off-by-one de seis horas del repo.
//
// NO usa `consulta.alcance`, y eso es correcto, no un olvido (R9): con el catalogo vigente el
// alcance de una financiera concedida es siempre `{ tipo: "global" }`. Un `where` de recorte
// aqui seria codigo muerto que anuncia un recorte que nadie diseño (R8/R25 de la 122).
//
// SOLO CONSULTAS (R30). Este repositorio no resta, no decide signos y no deriva saldos:
// devuelve el material agregado y la derivacion money-safe la hace el servicio con
// `derivarBalance`. Tampoco silencia errores (R32): un fallo de consulta se propaga.

/**
 * Una fila del `groupBy(categoria, tipo)` con su `_sum(monto)`.
 *
 * Viene desglosada POR TIPO ademas de por categoria porque de ahi sale el `neto` con signo
 * (ingreso − egreso) que ⟨D1⟩/R37 obliga a servir DONDE SIGNIFICA ALGO. El signo lo aplica el
 * servicio con `derivarBalance`, no esta consulta.
 *
 * ACOTADO por ⟨D12⟩ (humano, 2026-08-04, `progress/decision_183.md`, feature 183): de las
 * CUATRO metricas de caja, el desglose por `tipo` solo lo consume ya `egresos` —la unica cuya
 * lista de categorias mezcla prefijos y, por tanto, la unica cuyo neto informa de algo—. Las
 * tres `ingreso_*` publican solo el `bruto`. El campo `tipo` SIGUE HACIENDO FALTA y no se
 * retira: `egresos` lo necesita, y las dos metricas de tesoreria de la 173 tambien
 * (`derivarCaja` particiona por naturaleza Y por tipo).
 *
 * `suma` es STRING escala 2 (S1/R27): `monto` es `Decimal(12,2)` y sale de aqui ya
 * formateado, sin pasar nunca por `number`.
 */
export interface AgregadoCategoriaCaja {
  readonly categoria: WalletMovimientoCategoria;
  readonly tipo: WalletMovimientoTipo;
  readonly suma: string;
}

/**
 * Feature 180 (T2.1) — la MISMA fila que `AgregadoCategoriaCaja`, con una coordenada mas: el
 * **indice del cubo temporal** al que pertenece la suma.
 *
 * `indiceCubo` es un indice 0-based dentro del array `cubos` que el metodo recibe. **No es una
 * fecha**, y esa ausencia es el diseño ⟨D4⟩, no una simplificacion:
 *
 * - la clave publicable (`YYYY-MM-DD` del primer dia del cubo, R10) la pone el SERVICIO a partir
 *   de `trocear(consulta.rango)`, que a su vez la deriva de `inicioDelDiaCREnUtc` /
 *   `fechaCalendarioCR`. Asi **el SQL nunca emite una fecha**;
 * - si el repositorio devolviera una fecha, esa fecha tendria que calcularla la base, y calcularla
 *   exige decirle a Postgres que es "un dia de Costa Rica". Eso seria una SEGUNDA definicion del
 *   dia operativo, invisible para los tests de `lib/utils/fecha-cr.ts` y para el guardia de modulo
 *   puro: exactamente el off-by-one de seis horas del que avisa `lib/analytics/ranges.ts`.
 *
 * `suma` es STRING escala 2 (R16), formateada desde `Prisma.Decimal`. Nunca `number`.
 */
export interface AgregadoCuboCategoriaCaja {
  /** Indice 0-based dentro del array `cubos` recibido. Nunca una fecha, nunca una entidad. */
  readonly indiceCubo: number;
  readonly categoria: WalletMovimientoCategoria;
  readonly tipo: WalletMovimientoTipo;
  readonly suma: string;
}

export interface IIngresosAnaliticaRepository {
  /**
   * Σ `monto` de `wallet_movimiento` agrupada por `(categoria, tipo)`, restringida a las
   * categorias que la metrica declara y a `fecha_movimiento ∈ [rango.desde, rango.hasta)`.
   *
   * Orden ESTABLE por `(categoria, tipo)` (R28): sin `orderBy` explicito, dos ejecuciones con
   * los mismos datos pueden devolver las filas en distinto orden y el determinismo del DTO
   * dependeria del plan de la base.
   */
  sumarPorCategoria(consulta: ConsultaAnalitica): Promise<readonly AgregadoCategoriaCaja[]>;

  /**
   * Feature 180 ⟨D4⟩ — la MISMA Σ que `sumarPorCategoria`, particionada por cubo temporal.
   *
   * **R22 — la consulta entra ENTERA.** El primer parametro es la `ConsultaAnalitica` preparada
   * por `prepararConsultaAnalitica`, no un rango suelto, ni un `desde`/`hasta`, ni una tienda, ni
   * una zona, ni un mensajero. De ella salen las categorias (del CATALOGO, nunca de un array
   * escrito a mano) y la ventana `[rango.desde, rango.hasta)`.
   *
   * **`cubos` NO es un canal alternativo para colar una ventana propia.** El servicio los deriva
   * de `trocear(consulta.rango)` y de ningun otro sitio; el repositorio los usa solo como
   * LIMITES de particion, y la ventana del `WHERE` la sigue mandando `consulta.rango`. Que las
   * fronteras usadas coincidan con `trocear(consulta.rango)` lo comprueba un test del servicio:
   * si alguien pasara aqui cubos de otro rango, la particion no ampliaria ni recortaria lo que se
   * lee — el `WHERE` no cambia — pero produciria indices fuera de sitio, y eso es lo que ese test
   * caza.
   *
   * **R24 — ningun id de persona entra ni sale.** La coordenada de salida es un indice de cubo.
   * No hay `tiendaId`, ni `mensajeroId`, ni `zonaId`, ni en la firma ni en la fila.
   *
   * **R25 — sin `try`/`catch` y sin ceros por defecto.** Un fallo de la base se propaga tal cual.
   * Un cero devuelto por una base caida es la peor mentira posible en dinero: el tablero diria que
   * hoy no hubo ingresos y nadie veria un error.
   *
   * **Ausencias que significan algo:** un cubo sin movimiento NO aparece en el resultado. El
   * relleno denso de la serie (R7/R8/R9) lo hace el servicio, que es quien sabe si la metrica es
   * de flujo o acumulada; la base solo dice lo que hay.
   *
   * Orden ESTABLE y explicito por `(indiceCubo, categoria, tipo)` (R26): sin `ORDER BY`, la
   * secuencia de filas la decidiria el plan de la base y el DTO dejaria de ser reproducible.
   */
  sumarPorCuboYCategoria(
    consulta: ConsultaAnalitica,
    cubos: readonly CuboTemporal[],
  ): Promise<readonly AgregadoCuboCategoriaCaja[]>;

  /**
   * Feature 187 (R1/R6) — UNA LECTURA CONSISTENTE: ejecuta `fn` sobre una instancia de este mismo
   * repositorio ligada a un unico snapshot de la base, y devuelve lo que `fn` devuelva.
   *
   * **QUE GARANTIZA.** Todas las consultas que se emitan por el repositorio que `fn` recibe ven
   * exactamente la MISMA foto de los datos, aunque otra conexion confirme escrituras en medio. Es
   * lo que hace cierta en runtime la invariante de la 180 —R12: «Σ de los importes de las filas ==
   * `total`»—, que hasta ahora se cumplia solo porque nadie escribia entre las dos consultas.
   *
   * **QUE NO GARANTIZA.** No es una cerradura: nadie queda bloqueado, ninguna escritura ajena se
   * retrasa y lo que se lee puede estar desactualizado respecto del instante en que la respuesta
   * llega al usuario. Tampoco protege nada que se lea por OTRO repositorio o fuera de `fn`.
   *
   * **EL TOTAL SIGUE SIENDO UNA CONSULTA APARTE** (D1 de `design.md` §2, R5). Este metodo NO
   * existe para fusionar `sumarPorCategoria` con `sumarPorCuboYCategoria` en una sola llamada: el
   * total se sigue pidiendo por su camino y el desglose por el suyo, y la igualdad entre ambos
   * sigue siendo una invariante comprobable entre DOS caminos independientes. Derivar el total
   * sumando las filas la convertiria en una tautologia, que es justo lo que la ficha prohibe.
   *
   * **VOCABULARIO DE DOMINIO, NO DE ORM** (R6). El servicio que lo llama no sabe —ni puede saber—
   * que por debajo hay una transaccion, ni con que nivel de aislamiento: eso vive entero en la
   * implementacion. Si esta firma mencionara `$transaction` o `isolationLevel`, la capa de
   * servicio quedaria atada a Prisma, que es lo que `docs/architecture.md` prohibe.
   *
   * **SOLO LECTURAS DENTRO** (R3): `fn` no debe emitir ninguna sentencia de escritura. No hay
   * `READ ONLY` en la base que lo impida —exigirlo obligaria a meter `$executeRaw` en el tipo del
   * cliente, o sea a abrir la puerta de la escritura para prometer que no se escribe—, asi que la
   * garantia la sostienen las consultas que hay dentro y el test que las censa.
   *
   * **LOS ERRORES SUBEN TAL CUAL** (R7): un fallo dentro del alcance aborta la transaccion y se
   * propaga. Ni `try`/`catch` ni importes por defecto.
   */
  enLecturaConsistente<T>(fn: (repo: IIngresosAnaliticaRepository) => Promise<T>): Promise<T>;
}
