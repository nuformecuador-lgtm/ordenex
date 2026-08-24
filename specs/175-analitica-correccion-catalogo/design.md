# 175 — Diseño: corrección del catálogo de métricas

> Zona `backend`, complejidad `small`. Archivos de producción esperados: **dos**
> (`lib/analytics/metrics.ts`, `lib/analytics/types.ts`). Sin migración, sin RLS, sin endpoints,
> sin cambios de contrato de salida. Todo lo demás son tests.

## 1. Inventario de hechos leídos en el código (archivo y línea)

Nada de lo que sigue es memoria ni parafraseo de una spec: está releído en `C:/w175`.

### 1.1 El catálogo

| Hecho | Ubicación |
| --- | --- |
| `DENOMINADOR_GESTIONES = ["entregas","devoluciones","rechazos","incidentes"]` | `lib/analytics/metrics.ts:79` |
| `incidentes` con `estadoProduccion: "declarada"` y comentario «ni la ficha de la 126 ni las medidas del rollup de la 123 la comprometen» | `lib/analytics/metrics.ts:218-220` |
| `ordenes_por_estado`: descripción «entre los 19 values vigentes del catalogo», `definicion.estados = ORDER_STATUS_SEED` | `lib/analytics/metrics.ts:118`, `:127` |
| `sin_gestionar`: `clase: "snapshot"`, `fuente: rollup`, `estadoProduccion: "declarada"`, `definicion.estados = ["sin_gestionar"]` | `lib/analytics/metrics.ts:232-247` |
| Las tres tasas citan el denominador de cuatro términos | `lib/analytics/metrics.ts:262`, `:282`, `:302` |
| `estadoProduccion` como filtro de `listarMetricas` (única lectura en runtime del repo) | `lib/analytics/metrics.ts:591-603` |
| `DefinicionMetrica` tiene 7 campos, todos opcionales | `lib/analytics/types.ts:147-166` |
| `Metrica` tiene 12 campos (R3 de la 135); `definicion` es uno de ellos | `lib/analytics/types.ts:172-193` |
| `snapshot ⟺ fuente rollup` es invariante declarado | `lib/analytics/types.ts:27` |

### 1.2 El rollup real

| Hecho | Ubicación |
| --- | --- |
| Columnas de medida de `AnalyticsDaily`: `ordenesCreadas`, `ordenesEstadoStock`, `entregas`, `devoluciones`, `rechazos`, `reprogramaciones`, **`incidentes`**, `primerIntentoOk`, `segCicloAcum`, `segCicloN` | `db/schema.prisma:1885-1894` |
| `incidentes` con comentario «4.o termino de DENOMINADOR_GESTIONES (R18)» | `db/schema.prisma:1891` |
| **No existe** ninguna columna `sin_gestionar` ni `sinGestionar` en el modelo | `db/schema.prisma:1876-1905` (censo completo del modelo) |
| `ordenesEstadoStock` es un STOCK al corte que «NO sumar por fecha» | `db/schema.prisma:1886` |
| Universo B2, texto normativo | `specs/124-…/requirements.md:234-241`, `specs/124-…/design.md:139-145` |
| Aviso de la 124 **dirigido a la 135**: «O el catálogo acota esa definición, o queda declarada la divergencia» | `specs/124-…/design.md:515-518` |

### 1.3 Lo que la 126 hace de verdad

| Hecho | Ubicación |
| --- | --- |
| `MEDIDA_DE_METRICA`: `sin_gestionar → ordenesEstadoStock` (la misma medida que `ordenes_por_estado`) | `lib/services/AnaliticaOperativaService.ts:87-88` |
| `sin_gestionar` se deriva filtrando los cubos por el estatus `sin_gestionar` | `lib/services/AnaliticaOperativaService.ts:316-318`, `:348-362` |
| La respuesta viaja con `nota: NOTA_SIN_GESTIONAR` **solo** para esa métrica | `lib/services/AnaliticaOperativaService.ts:187` |
| `NOTA_SIN_GESTIONAR = "sin_gestionar_es_del_dia_universo_b2"` y su frontera anotada **a la ficha 175** | `lib/types/analitica-operativa.ts:64-77` |
| El denominador de las tasas de la 126 son las mismas cuatro medidas, `incidentes` incluida | `lib/services/AnaliticaOperativaService.ts:69-82` |
| Las tres divergencias, declaradas por la 126 y heredadas a esta ficha | `specs/126-…/design.md:463-481` |

### 1.4 El estado de `order_status` (hallazgo 4)

`ORDER_STATUS_SEED` tiene **20** entradas: `lib/types/order-status.ts:54-79` (la 155 retiró
`en_fulfillment` dejando 19, y la **157** añadió `recolectando`, `:74-78`). La descripción del
embudo (`metrics.ts:118`) sigue diciendo 19, y el guard `definiciones-catalogo.guardia.test.ts:60-62`
se titula «diecinueve» mientras afirma `toHaveLength(20)`.

## 2. Quién lee `estadoProduccion` HOY (comprobado, no supuesto)

Censo del repo (`rg estadoProduccion`, excluyendo `specs/` y `progress/`):

| Consumidor | Qué hace | Qué le cambia con la 175 |
| --- | --- | --- |
| `lib/analytics/metrics.ts:591-603` (`listarMetricas`) | **Única** lectura en runtime: filtro opcional | El filtro `{estadoProduccion:"declarada"}` pasa a devolver `[]` si Q2 = sí. **Ningún llamador de producción usa ese filtro** (`AnaliticaFinancieraService.ts:59` solo lo nombra en un comentario) |
| **131** `app/(app)/analitica/_components/operativo/catalogo-paneles.ts:1-22` y `PanelesOperativos.tsx:14` | **NO lo lee**: lo prohíbe explícitamente y su test lo censa | Nada funcional. Solo su test (§4) |
| **132** (tablero financiero) | `specs/132-*` **no existe** y no hay código suyo | Nada hoy. El aviso es a futuro (§5) |
| **133** (recortes por rol) | `specs/133-*` **no existe**; su ficha dice que decide qué paneles ve cada rol | **Aquí sí cambia algo**: verá `incidentes` (y `sin_gestionar` con Q2) como métricas **con productor**. Ver §5 |
| `tests/unit/analytics/financiera-produccion.guardia.test.ts:45,95-98` | Filtra `dominio: "financiera"` | Nada: la corrección es de métricas operativas |
| Fixtures sintéticas (`metrics-dinero.guardia:98,155`, `financiera-alcance.guardia:75`, `alcance-fuente-unica.guardia:174`, `alcance-dinero.guardia:93`) | Construyen métricas de mentira | Nada |
| `tests/unit/analytics/metrics.test.ts:266-300` | Verifica el dominio cerrado y el filtro | Un caso rojo por diseño con Q2 = sí (§4) |
| `tests/unit/analytics/tablero-catalogo-paneles.test.ts:43-44` | Afirma el valor `"declarada"` de las dos métricas | **Rojo por diseño** (§4) |

**Conclusión operativa:** `estadoProduccion` es un campo **con consumidores**, pero hoy **ninguno de
producción decide datos con él**. Por eso la corrección es segura ahora y peligrosa después: la 133
lo va a leer, y llegaría al código creyendo que `incidentes` no tiene productor.

## 3. Decisiones

### D1 — `incidentes.estadoProduccion` pasa a `"producida"` (R1)

Tiene columna (`schema.prisma:1891`), la 126 la lee y **divide entre ella** en las tres tasas. Se
reescribe además el comentario de `metrics.ts:218-219`, que hoy afirma un hecho falso.

**Precedente de forma:** ⟨D8⟩ de la 127 hizo exactamente esto con `egresos` y lo dejó firmado en el
propio catálogo (`metrics.ts:462-465` → `progress/decision_C2_127.md:39`). Se repite el patrón:
`progress/decision_175.md` con fecha, citado desde la entrada (R14).

### D2 — La anti-regresión de D1 es **derivada**, no una lista (R2)

Una guardia que dijera `expect(getMetrica("incidentes").estadoProduccion).toBe("producida")` fija el
síntoma. La que se escribe recorre el catálogo, junta los ids citados en cualquier
`definicion.razon` (numerador + denominador) y exige que ninguno esté `declarada`. Es la regla real:
**si una tasa se sirve, sus términos tienen productor**. Cubre futuras tasas sin tocarla.

### D3 — El universo B2 se declara **en el dato**, no solo en la prosa (R5, R9)

Se añaden a `DefinicionMetrica` (`lib/analytics/types.ts`) dos campos **opcionales y de dominio
cerrado**:

```ts
/** 175 — universo temporal de la medida del rollup que la encarna (D2-B2 de la 124). */
readonly universo?: "b2_vivas_mas_cierres_del_dia";
/** 175 — la métrica NO tiene medida propia: se proyecta de esta otra (`sin_gestionar`). */
readonly derivadaDe?: TMetricaId;
```

- `ordenes_por_estado`: `universo: "b2_vivas_mas_cierres_del_dia"`.
- `sin_gestionar`: `universo: "b2_vivas_mas_cierres_del_dia"` + `derivadaDe: "ordenes_por_estado"`.

`derivadaDe` se estrecha con `TMetricaId`, así que citar un id inexistente **no compila** — el mismo
mecanismo que ya protege `razon` (`types.ts:155-159`, `metrics.ts:572-577`).

Por qué campos y no solo texto: el aviso de la 124 (`design.md:515-518`) ofrecía «acotar la
definición **o** dejar declarada la divergencia». Se acota, y en un sitio que una guardia puede leer.
Una descripción es texto y solo admite `toContain`, que se satisface con una frase parecida.

### D4 — `definicion.estados` de `ordenes_por_estado` **no se toca** (R8)

Podría parecer que «acotar» significa recortar `estados` a los no terminales. **Sería falso**: B2
incluye las órdenes que llegaron a terminal ese día, así que los tres estados terminales sí aparecen
en la columna. Lo que la 124 acota es la **ventana temporal** del stock, no el vocabulario. Por eso
la corrección va a `universo` y a la `descripcion`, y `definiciones-catalogo.guardia.test.ts:87-91`
sigue **verde**.

### D5 — `sin_gestionar` conserva `clase: "snapshot"` y `fuente: rollup` (R12)

La divergencia 3 se enuncia como «figura como snapshot con `fuente: rollup` pero no hay columna». El
matiz que el código obliga a respetar: **sí se sirve del rollup**, de la columna
`ordenes_estado_stock` de `analytics_daily` (`AnaliticaOperativaService.ts:88`). Cambiar `fuente`
rompería el invariante `snapshot ⟺ rollup` (`types.ts:27`, R5 de la 135) y pondría rojo
`operativa-fuente.guardia.test.ts:50-53` **sin ganar verdad**. Lo que faltaba no era la fuente: era
decir que **no tiene medida propia** y que su semántica es del día. Eso es `derivadaDe` + `universo`
+ descripción (R9, R10).

### D6 — La guardia de la divergencia 3 lee el esquema (R11)

`db/schema.prisma` se lee en crudo (mismo patrón que `analytics-daily-contrato.test.ts:4-13` y
`definiciones-catalogo.guardia.test.ts:30-39`) para afirmar dos cosas: que `AnalyticsDaily` **no**
tiene columna `sin_gestionar`, y que la métrica declara `derivadaDe`. Si mañana alguien añade la
columna de verdad (cambio legítimo), la guardia se pone roja y **obliga** a actualizar el catálogo.
Ese acoplamiento es el objetivo, no un efecto colateral.

### D7 — Ninguna cifra cambia, y se demuestra (R13)

Comprobado leyendo el código: en runtime **nadie** consume `definicion.estados` de una métrica
operativa (los repositorios financieros sí consumen `definicion.categorias`:
`IngresosAnaliticaRepository.ts:51`, `RecaudoAnaliticaRepository.ts:58`) y **nadie** de producción
llama a `listarMetricas({estadoProduccion})`. Por tanto: cambiar `estadoProduccion`, añadir
`universo`/`derivadaDe` y reescribir descripciones **no puede** mover un número. La guardia de R13
censa el árbol (no imports) para que siga siendo verdad.

## 4. Guards afectados — cuáles se ponen rojos POR DISEÑO

| Archivo:línea | Qué afirma | Efecto de la 175 |
| --- | --- | --- |
| `tests/unit/analytics/tablero-catalogo-paneles.test.ts:43-44` | `incidentes` y `sin_gestionar` son `"declarada"` | **ROJO POR DISEÑO.** Se reexpresa: el caso debe seguir matando la mutación `filter(estadoProduccion === "producida")` **sin afirmar el valor** del campo (R21 de la 131 quiere independencia del campo, no un valor concreto). Q4 |
| `tests/unit/analytics/metrics.test.ts:273` | `listarMetricas({estadoProduccion:"declarada"}).length > 0` | **ROJO POR DISEÑO si Q2 = sí** (el catálogo se quedaría sin ninguna `declarada`). Se reexpresa como partición + caso sintético (R4) |
| `tests/unit/analytics/metrics.test.ts:344-350` | Toda `descripcion` cita `gestion anulada|anulada_at` | **Restricción de redacción**: las descripciones reescritas de `ordenes_por_estado` y `sin_gestionar` deben seguir citándolo |
| `tests/unit/analytics/definiciones-catalogo.guardia.test.ts:87-91` | El embudo enumera exactamente `ORDER_STATUS_SEED` | **Verde** (D4). Solo se corrige el título de `:60-62` («diecinueve» → veinte), Q7 |
| `tests/unit/analytics/metrics.test.ts:61-65` | 12 claves exactas por métrica | **Verde**: los campos nuevos van dentro de `definicion` |
| `tests/unit/analytics/metrics.test.ts:266-300` (R33) | Dominio cerrado del campo | **Verde** salvo `:273` |
| `tests/unit/analytics/metrics-dinero.guardia.test.ts:98,155` | Fixtures sintéticas | **Verde** |
| `tests/unit/analytics/financiera-produccion.guardia.test.ts:45,95-98` | Declaradas del dominio financiero | **Verde** |
| `tests/unit/analytics/analytics-daily-contrato.test.ts:77-140,191-215` | Deriva del catálogo las dimensiones y los términos de las razones contra las columnas reales | **Verde** (no cambian `granos`, `fuente` ni `razon`); además ya exige que `incidentes` exista como medida (`:202`) |
| `tests/unit/analytics/operativa-fuente.guardia.test.ts:50-53` | Hay 14 snapshot y ninguna toca tablas vivas | **Verde** (D5) |
| `tests/unit/analytics/operativa-contrato-catalogo.test.ts:43-47` | 15 operativas | **Verde** |
| `tests/unit/analytics/modulo-puro.guardia.test.ts:45-70` | `lib/analytics/**` no importa runtime prohibido | **Verde**, y condiciona el diseño: `metrics.ts` **no** importará `NOTA_SIN_GESTIONAR` desde `lib/types/analitica-operativa.ts`; la coherencia entre ambos textos se ata **por test** |
| `tests/unit/analytics/types.test.ts` | Tipos contra el esquema | **Verde** (campos opcionales aditivos) |

Guards **nuevos** de esta feature: `tests/unit/analytics/catalogo-produccion.guardia.test.ts` (R1,
R2, R3, R13, R14) y `tests/unit/analytics/catalogo-universo.guardia.test.ts` (R5, R6, R7, R9, R10,
R11).

## 5. Avisos dirigidos a otras features

- **→ 133 (recortes por rol), el importante.** Hoy `incidentes` (y `sin_gestionar`) figuran
  `declarada`. Si la 133 aterrizara antes que esta corrección y decidiera paneles con
  `estadoProduccion`, **borraría de la pantalla dos KPI vivos sin excepción, sin log y sin hueco
  visible** (`specs/126-…/design.md:471-474`; el mismo razonamiento está escrito en
  `app/(app)/analitica/_components/operativo/catalogo-paneles.ts:3-15`). Después de la 175 ese riesgo
  desaparece **para estas dos métricas**, pero la lección se mantiene: `estadoProduccion` dice si hay
  productor, **no** si el panel se pinta. La 131 ya resolvió esto con una lista declarativa (R21/D6);
  la 133 debería heredar esa forma, no reinventar un filtro.
- **→ 131 (tablero operativo, `in_progress`).** Su test `tablero-catalogo-paneles.test.ts:43-44`
  queda rojo por diseño. **Avisar antes de mergear** (Q4). Su comentario en `catalogo-paneles.ts:6-10`
  cita `metrics.ts:220` y `:242` con la palabra «declarada»: hay que actualizarlo o queda como una
  afirmación falsa dentro del archivo que más se lee del tablero.
- **→ 132 (tablero financiero).** Sin código ni spec. Solo hereda que **no** debe decidir paneles por
  `estadoProduccion`.
- **→ 176 (modo agregado).** Frontera limpia: la 176 toca `AnaliticaOperativaService` y su contrato
  de salida; la 175 toca `metrics.ts` + `types.ts`. Intersección de archivos: **cero**. Punto de
  contacto conceptual: la 176 va a necesitar los términos del denominador por cubo, y R2 de esta
  feature deja garantizado que esos cuatro términos tienen productor declarado.
- **→ 124/126.** Sus avisos (`124/design.md:515-518`, `126/design.md:463-481`) quedan **cerrados**
  por esta feature. Conviene que el implementer los marque como resueltos en el PR.

## 6. Riesgo tratado: ninguna corrección cambia una cifra

Recorrido explícito, corrección a corrección:

| Corrección | ¿Puede mover un número? | Por qué |
| --- | --- | --- |
| `incidentes` → `producida` | No | Nadie de producción filtra por ese campo (§2) |
| `sin_gestionar` → `producida` (Q2) | No | Ídem |
| `universo` en dos métricas | No | Campo nuevo; solo lo leen las guardias |
| `derivadaDe` en `sin_gestionar` | No | Ídem; la derivación real ya la hace la 126 y no consulta el catálogo para hacerla |
| Reescritura de dos `descripcion` | No | Texto de UI/documentación |
| Retirada del literal «19» | No | Texto |

Si el implementer encuentra **cualquier** camino por el que una de estas ediciones altere una
respuesta servida, **para y lo declara**: eso es alcance nuevo y sale de esta ficha.

## 7. Alternativas descartadas

**Alternativa 1 — corregir solo las `descripcion` (texto), sin tocar `types.ts`.**
Descartada. Es lo más barato y lo que casi hace la 126, pero deja R5/R9 verificables solo por
`toContain("B2")`: una frase parecida los satisface y la divergencia puede volver sin poner nada
rojo. El encargo pide requisitos que **impidan la regresión**, y una guardia sobre prosa no lo hace.
Queda como plan B si Q3 se responde «no».

**Alternativa 2 — añadir `columnasRollup?: readonly string[]` a las 12 métricas de rollup y validar
cada una contra `AnalyticsDaily`.**
Descartada, aunque es la versión más completa del contrato. Dos motivos: (a) duplicaría
`MEDIDA_DE_METRICA` (`AnaliticaOperativaService.ts:85-95`), creando **dos fuentes de verdad** sobre
qué columna encarna cada métrica — exactamente el defecto que la 126 evita en `operativa-contrato-
catalogo.test.ts:5-11`; (b) obligaría a editar las 15 entradas operativas en una feature declarada
`small` cuyo propósito es no cambiar nada. Se deja **propuesta para ficha propia**, con el matiz de
que `tiempo_ciclo` necesita dos columnas (`seg_ciclo_acum`, `seg_ciclo_n`).

**Alternativa 3 — acotar `ordenes_por_estado.definicion.estados` a los estados no terminales.**
Descartada por **falsa**: B2 incluye las órdenes que llegaron a terminal ese día
(`specs/124-…/requirements.md:234-237`), así que los tres terminales sí están en la columna. Además
rompería `definiciones-catalogo.guardia.test.ts:87-91` cambiando una mentira por otra.

**Alternativa 4 — mover `sin_gestionar` a `clase: "live"` / `fuente: tabla_viva`.**
Descartada: se sirve del rollup (`AnaliticaOperativaService.ts:88`), y el cambio rompería el
invariante `snapshot ⟺ rollup` de la 135 y `operativa-fuente.guardia.test.ts:50-53` sin ganar
ninguna verdad (D5).

**Alternativa 5 — importar `NOTA_SIN_GESTIONAR` en `metrics.ts` para no repetir el texto.**
Descartada: metería una dependencia de `lib/types/analitica-operativa.ts` (mundo de la 126) en el
módulo fundacional, contra el espíritu de `modulo-puro.guardia.test.ts:5-16`. La coherencia entre los
dos textos se ata **por test**, no por import.

## 8. Hallazgo adicional (cuarta divergencia)

**No se absorbe en silencio.** La descripción de `ordenes_por_estado` (`metrics.ts:118`) afirma «los
**19** values vigentes»; `ORDER_STATUS_SEED` tiene **20** desde la 157 (`recolectando`,
`lib/types/order-status.ts:74-78`). El mismo desfase aparece en el título del caso
`definiciones-catalogo.guardia.test.ts:60-62` («diecinueve») y en la cabecera de ese archivo
(`:16-21`).

**Propuesta: entra en esta ficha** (Q6). Razón: vive **dentro del mismo literal** que R6 reescribe;
sacarla a ficha propia obligaría a editar la misma línea desde dos ramas y a coordinar un conflicto
por una palabra. Coste marginal: cero líneas nuevas de producción. Y la corrección duradera no es
escribir «20», sino **prohibir el conteo literal** (R7): el número volverá a cambiar.

## 9. Modelo de datos, rutas, contratos

- **Modelo de datos:** sin cambios. Sin migración, sin `down.sql`, sin RLS que revisar.
- **Rutas/endpoints:** ninguno. La feature no toca Server Actions ni `app/`.
- **Contrato de entrada/salida:** `SerieOperativa` (`lib/types/analitica-operativa.ts:97-108`) **no
  cambia**. `Metrica` gana dos campos opcionales **dentro de `definicion`**, así que las 12 claves de
  R3 de la 135 siguen siendo 12.
- **Integraciones externas:** ninguna.
- **Capas:** el cambio vive entero en el módulo puro `lib/analytics/`; no hay controller, service ni
  repository implicados.
