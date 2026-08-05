import type { WalletMovimientoCategoria, WalletMovimientoTipo } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";

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
}
