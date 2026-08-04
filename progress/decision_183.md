# Decisión ⟨D12⟩ — el `neto` de las cuatro métricas de caja (feature 183)

**Fecha: 2026-08-04 · Autor: humano · Estado: CERRADA.**

**Esta decisión SUSTITUYE a la que quedó escrita en la `status_note` de la 183 el mismo día**
(«retirar la distinción en las CUATRO, y NO que `egresos` gane `ingreso_ajuste`»). No la
contradice por criterio: la sustituye porque **el motivo que aquella declaraba es falso contra la
base**, y porque separa dos casos que aquella trataba como uno solo. Ver §3.

## 1. Por qué esta decisión tiene que existir

La cabecera de `lib/analytics/metrics.ts:5-7` fija que el contenido del catálogo **no es opinión
del implementer**, y la nota de cierre de la 127 lo endurece: *«esa autorización no se hereda: la
siguiente feature que necesite ese archivo necesita la suya»*. Esta feature cambia
`egresos.definicion.categorias`, que es **la definición de una métrica de dinero servida en
producción**. Sin este documento, el cambio sería exactamente lo que esa línea prohíbe.

Precedentes de forma: ⟨D10⟩ (`progress/decision_C2_127.md`) y ⟨D11⟩ (`progress/decision_175.md`).

## 2. Lo decidido — las cuatro métricas NO reciben el mismo trato

**Q1 — `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`: RETIRAR la distinción. Solo `bruto`.**

Ninguna de las tres tiene categoría que la revierta. Sus listas son homogéneas de prefijo
`ingreso_*` y, con el `CHECK` categoría↔tipo que introdujo la 173, cada categoría admite un solo
`tipo`: `Σ egreso = 0` siempre, luego `neto = +bruto` **siempre**. El campo no informa de nada y
sostenerlo invita a leerlo como si informara. `ingreso_flete_devolucion` no es una reversión: es
un ingreso más, y por eso no rescata la distinción.

**Q2 — `egresos`: NO retira el `neto`. Gana `ingreso_ajuste` en `definicion.categorias`.**

Es el caso que la nota anterior metió en el mismo saco sin serlo. `WalletEgresoService.ts:89-96`
revierte un egreso anulado emitiendo un `ingreso_ajuste` de igual monto, y la métrica declara las
ocho categorías `egreso_*` **pero no esa**. Consecuencia hoy: **anular un egreso no lo descuenta
nunca de la cifra de egresos**. Es el patrón de N1 (los brutos inflados de la 172) reaparecido en
analítica, y el `neto` es justo el campo que lo haría visible.

Con `ingreso_ajuste` dentro, la lista deja de ser homogénea y el `neto` que `derivarBalance` (R20)
ya produce pasa a significar **lo que realmente salió de caja**. `egresos` deja de ser degenerado,
que es la condición bajo la cual la propia ficha 183 dice retirar («la ficha es *retirar donde es
degenerado*, no *retirar el campo*»). Por eso esta decisión no rompe el criterio de la ficha: lo
aplica.

## 3. El motivo de la decisión anterior, refutado con la base delante

Aquella nota justificaba no tocar `egresos` así: *«esa segunda opción cambia el número de una
métrica de dinero YA PUBLICADA, que es justo lo que la P4 de la 173 quiso evitar»*.

Medido por MCP contra producción (`wallet_movimiento`, agregado por categoría y tipo) el
**2026-08-04, antes de decidir**:

| categoría | filas | total |
| --- | --- | --- |
| `egreso_pago_mensajero` | 4 | ₡22.000,00 |
| `egreso_indemnizacion` | 1 | ₡42,40 |
| **`ingreso_ajuste`** | **0** | **—** |
| **`egreso_ajuste`** | **0** | **—** |

**No existe ni una sola anulación de egreso en producción.** Añadir `ingreso_ajuste` a la
definición **no mueve hoy ningún número**: `egresos` seguirá valiendo ₡22.042,40 de bruto. La
analogía con la P4 de la 173 no aplica — allí `egreso_pago_tienda` **sí** pasó a tener emisor y la
cifra saltaba de verdad, y por eso hubo que declararlo en el catálogo.

Es además la ventana barata: **corregir la definición ahora cuesta cero discontinuidad**; hacerlo
después de la primera anulación obliga a declarar un salto que hoy no existe.

## 4. Alcance — lo que esta decisión NO autoriza

- **No autoriza añadir ni quitar métricas.** Los 23 ids de ⟨D1⟩ siguen intactos; `egresos` conserva
  su `id`, su `etiqueta` y su `estadoProduccion`.
- **No autoriza retirar el `neto` del sistema.** Se retira **solo** en las tres métricas de Q1. En
  la vista B (ledger de tienda), en `derivarBalance` y en las dos métricas de tesorería de la 173
  (`dinero_en_caja`, `ganancia_ordenex`, que mezclan prefijos a propósito) el neto con signo
  significa algo real y **se conserva**.
- **No autoriza tocar `NATURALEZA_POR_CATEGORIA`.** `ingreso_ajuste` sigue siendo `propio`
  (`lib/utils/caja-tesoreria.ts:51`), y la razón escrita en `caja-tesoreria.ts:59-60` sigue vigente:
  reusarlo para dinero de terceros subiría la ganancia al anular un pago a tienda.
- **No es autorización general sobre `definicion.categorias`.** Cualquier cambio futuro de ese campo
  necesita su propia decisión fechada.

## 5. Consecuencias aceptadas, conocidas antes de decidir

1. **R14 y R16 de la 132 son requisitos VIVOS de una feature `done`**: el `TableroFinanciero` pinta
   el `neto` como KPI principal con el `bruto` en línea secundaria, y dibuja dos series con él. Para
   las tres métricas de Q1 esos requisitos dejan de tener material. El spec **debe** decir qué pasa
   con ellos en vez de dejar que el implementer lo resuelva por su cuenta.
2. **La descripción de `egresos` vuelve a cambiar**, y ya cambió en la 173. Debe decir que las
   anulaciones se descuentan, porque quien lee la cifra necesita saberlo.
3. **Los dos dobles en memoria dejan de necesitar filas imposibles.** Hoy afirman con datos que el
   `CHECK` de la base ya no acepta —`financiera-ingresos-repo.test.ts:124` (`egreso_ajuste` +
   `tipo: ingreso`) y `analitica-financiera-derivacion.test.ts:177` (`ingreso_flete` + `tipo:
   egreso`)—. Con Q2, el caso de cancelación se puede escribir **con el par real** (`egreso_*` de
   tipo `egreso` + `ingreso_ajuste` de tipo `ingreso`), que es la única forma de que el test mida lo
   que dice medir.
