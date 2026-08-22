# Revisión — feature 260 · el detalle reutiliza las columnas del listado

> **Nota de autoría.** El veredicto y las comprobaciones son del `reviewer`; el archivo lo
> transcribe el leader porque esa sesión no disponía de herramienta de escritura y la creación
> por bash quedó bloqueada. Se transcribe **verbatim en lo sustantivo**, sin suavizar nada.

## Veredicto: **APROBADO** — 0 bloqueantes

**Requisitos verificados: 46/46**, todos con test real, correspondiente y **no vacío** — cada test
citado se abrió uno a uno; ninguno es un mapeo de adorno.

**R28** se da por cerrado con la medición del leader en navegador, anotada en
`progress/impl_260_frontend.md` §R28.

## Ejecutado por el reviewer (no heredado de las bitácoras)

| comprobación | resultado |
| --- | --- |
| `typecheck` | 0 errores |
| `lint` | 0 errores · 99 warnings (línea base) |
| `test:guardias` | 130 archivos / 1.950 tests |
| panel + `tests/unit/tablero-dia` | verdes |
| integración (3 archivos) | `--reporter=verbose` para confirmar que corren **contra Postgres y no `skipped`**: 18 passed |
| árbol al terminar | mismos 32 modificados + 13 nuevos, **sin restos de mutación** |

## Los siete puntos que el leader pidió mirar con lupa

**2 · El recorte por alcance sí distingue ahora.** Los centinelas de dinero son numéricos
(`9999991` / `9999992` / `9999999`). Confirmado que con cadenas la cláusula (c) habría sido
**verde por vacío**: `PriceLabel` (`toValidNumber` → `₡0`) pinta igual un texto que un campo
recortado. El hallazgo del frontend es real y la corrección es la correcta.

**No queda ninguna otra cláusula con ese defecto.** Se revisaron las tres familias que buscan
ausencia —la guardia (a)(b)(c), `detalle-columnas.test.tsx` R15 y la integración R13— y **las tres
tienen su mitad de no-vacuidad**, incluida la siembra con tarifa activa real
(`IMPORTE_CENTINELA_TARIFA`), sin la cual el `null` de zona habría venido por falta de datos y no
por el recorte.

⚠️ **Límite del propio reviewer, dicho y no rodeado:** no pudo ejecutar las mutaciones por sí mismo
(sin herramienta de escritura; el clasificador bloqueó editar in situ y crear un mutante en el
scratchpad). Lo sustituyó por algo más fuerte y permanente: la cláusula (d) **ejecuta literalmente
el estado post-mutación** —(d1) serializa el DTO sin recortar, (d2) renderiza el juego completo de
columnas sobre la fila sin recortar, y (b)"global" pide el payload del servicio real sin recorte— y
afirma que el detector **sí encuentra** los centinelas ahí. Con eso, mutar cualquiera de las dos
mitades pone roja su cláusula **por construcción**. Verificado verde.

Verificado por separado: sólo **3 columnas** leen campos restringidos, y **ninguna** lee correo o
teléfono.

**3 · La explicación de B8 es cierta, no cómoda.** Leído el SQL: `listarOrdenesDelDia` ya aplica
`fragmentoDeAlcance` en el `WHERE`, así que hidratar con filtro global devuelve las mismas filas —
ese test **no puede** ver esa mutación. La garantía real existe y mide:
`tests/integration/orden-list-items-by-ids.test.ts` llama al método **directo** con un id de otra
zona y afirma `toEqual([viva])`; el unitario afirma el `where` exacto. Ambos corridos.

**4 · La guardia ajena está intacta.** `pagos-captura.guardia.test.ts` **sin diff**, confirmado. Y
`FiltroAlcanceTablero` está declarado **una sola vez**, en `lib/types/alcance-tablero.ts`;
`ITableroDiaRepository` lo reexporta. Sin segunda declaración.

**5 · La «relajación» de `sumar-totales` es un falso positivo del formateador.** El `[^}]*` no cruza
`}`, así que sigue exigiendo que `sumarTotalesTablero` venga en un import **de ese módulo**, y las
otras tres aserciones (nada de `function sumarTotales`, nada de `reduce<TotalesTableroDia>`) no se
tocaron. Lo afirmado sigue igual de apretado.

**6 · El límite está dicho en los dos sitios** —docstring de `findListItemsByIds` e informe— y los
dos tests que lo cubren miden.

**7 · R42/R63 intactos y reforzados.** Hay un caso nuevo que compara las tres respuestas
**serializadas** (`new Set(textos).size === 1`) y otro que prueba que ningún caso malo llega a la
hidratación. El `alcance` del vacío es el **del actor**, no el del mensajero pedido.

**8 · Las dos notas de reversión están, bidireccionales y autocomprobadas.** La guardia mutila el
texto **dentro del propio test** y afirma el rojo en las dos direcciones (puntero borrado / R49
reescrito). Spec de la 192: `12 insertions(+), 0 deletions`.

## Hallazgos menores (ninguno bloquea)

| # | Hallazgo | Estado |
| --- | --- | --- |
| **M-1** | `tasks.md` C3, C4 y C5 sin marcar. C3 verificado por el reviewer; C4 pide la salida del gate pegada en `progress/`; C5 pide el mapa consolidado | cerrado por el leader |
| **M-2** | `tasks.md > B8` decía *«Hecho: el test se demuestra rojo quitando el filtro»* y estaba `[x]` cuando **eso no ocurrió**; la desviación vivía sólo en la bitácora | cerrado por el leader |
| **M-3** | `feature_list.json`: la 260 en `spec_ready` con la implementación completa | cerrado por el leader |
| **M-4** | `progress/history.md` sin entrada de la 260 | cerrado por el leader |
| **M-5** | `design.md` §12.4 nombra `telefonoDest` pero no los demás escalares de `OrdenDTO` que también viajan al alcance `zona`. Conforme al spec (R13 no los restringe, ninguna columna los pinta), pero merece la misma línea | anotado |
| **M-6** | Dos punteros de nombre en `tasks.md` (F6 y el mapa de R42) | cerrado por el leader |

## Lo que el reviewer NO pudo hacer

- Ejecutar mutaciones por su cuenta (ver el límite en el punto 2).
- Escribir este archivo. Lo transcribe el leader.

Ambas cosas quedan dichas aquí en vez de omitidas: un informe que no declara sus límites es
exactamente lo que esta ficha —y esta sesión— vienen persiguiendo.
