# Feature 135 — analítica: catálogo de KPIs + rangos temporales · tasks

Convenciones: `[P]` = paralelizable con las demás tareas marcadas `[P]` del mismo bloque.
Cada tarea lleva su criterio de **hecho**. Un commit por tarea (`feat(135): …` / `test(135): …`).
Ningún archivo fuera de `lib/analytics/**` y `tests/unit/analytics/**` (R25).

> **Puerta T0 CERRADA el 2026-07-30** con las 10 decisiones del humano (D1–D10 en
> `requirements.md`). T1–T6 están desbloqueadas. Requisitos vigentes: **R1–R36**.

---

## T0 — PUERTA HUMANA · ✅ **CERRADA el 2026-07-30**

> Las 10 preguntas fueron respondidas por el humano el **2026-07-30** (Q7 respondida y
> **rectificada** el mismo día). Las decisiones están escritas **en el spec**, no solo en la
> bitácora: `requirements.md > Decisiones del humano (2026-07-30)`, D1–D10. **T3, T4 y T5 quedan
> desbloqueadas.**

- [x] **T0.1** ✅ **2026-07-30** — Respuestas obtenidas y escritas: D1 «todas» (catálogo entero),
  D2 «lunes», D3 «últimos 30» (+ supuesto explícito "período en curso"), D4 «abierto y presets»
  (tope 366 declarado como recomendación no objetada), D5 «sin asignar», D6 «sí» (día natural CR
  + ticket para `RankingService`, divergencia aceptada), D7 «el maestro solamente» →
  **rectificada a «admin y maestro pueden»**, D8 «sí», D9 «orden», D10 «por gestión».
  **Hecho (verificado):** las decisiones están en `requirements.md` con enunciado original
  conservado, autor y consecuencia aceptada; `design.md §3.3` pasó de propuesta a contrato;
  §4.3 y §6.1 documentan rangos y herencias. Pendiente de bookkeeping en T6.3:
  `feature_list.json > status_note`.

- [x] **T0.2** ✅ **2026-07-30** — Q4 aprobada: añadidos a `requirements.md` los requisitos
  nuevos **R27–R36** (apendados; ningún id anterior reutilizado ni desplazado) y **reescritos en
  su sitio** R3, R7, R11, R13, R16, R20 y R22, cada uno con la nota de qué decisión lo cambió.
  **Hecho (verificado):** 36 requisitos, tabla de trazabilidad completa con un test unitario
  nombrado para cada R nuevo o reescrito.

- [ ] **T0.3** Abrir el **ticket de saneamiento de `RankingService`** acordado en D6
  (`lib/services/RankingService.ts:60-61` usa `startOfDayCR` + 24 h ⇒ ventana 18:00–18:00 CR).
  Es trabajo **fuera** de la 135 y **no la bloquea**. **Hecho:** entrada nueva en
  `feature_list.json` (o issue) referenciando D6 y esta feature; anotado en
  `progress/impl_135.md > hallazgos colaterales`.

---

## T1 — Andamiaje (T0.1 ✅ cerrada)

- [x] **T1.1** Crear `lib/analytics/types.ts` con los dominios cerrados de `design.md §3.1`
  (`MetricaDominio`, `MetricaClase`, `MetricaUnidad`, `DimensionAnalitica`, `RolAnalitica`,
  `AlcanceMetrica`, `RangoPreset` **de 4 valores incl. `personalizado`** (D4), `UnidadDeConteo`
  (D10), `EstadoProduccion` (D8), la constante `MENSAJERO_SIN_ASIGNAR` (D5) y
  `RANGO_TOPE_DIAS = 366` (D4)) y las interfaces `FuenteMetrica`, `DefinicionMetrica` (con
  `excluye`, `sinAsignar`, `atribucionZona` y `razon.denominador` como **lista**), `Metrica` (los
  **12** campos de R3) y `EntradaRango`. Sin datos, sin imports de runtime.
  **Hecho:** `pnpm run typecheck` en verde; el archivo no importa nada salvo `type`; `Metrica`
  tiene exactamente 12 claves.

- [x] **T1.2 [P]** Test de consistencia de roles: los 5 literales de `RolAnalitica` existen en
  `RolValue` del esquema y `apiKey` NO está.
  **Hecho:** `tests/unit/analytics/types.test.ts` en verde; falla si alguien renombra un rol en
  `db/schema.prisma`.

---

## T2 — Guards de frontera (depende de T1.1; `[P]` entre sí)

- [x] **T2.1 [P]** `tests/unit/analytics/modulo-puro.guardia.test.ts` (R1/R2): censo sobre
  `lib/analytics/**` de `'use server'`, `next/headers`, `@/lib/db`, `@/lib/repositories`,
  `@/lib/services`, `@prisma/client` en import de valor; + import de los 4 módulos con el
  entorno sin `DATABASE_URL` sin que lance; + censo de declaraciones de métricas fuera de
  `metrics.ts`. **Hecho:** el guard pasa y falla si se le añade a mano un import prohibido.

- [x] **T2.2 [P]** `tests/unit/analytics/frontera.guardia.test.ts` (R25): la rama no añade
  carpetas en `db/migrations/`, ni archivos en `app/**`, `components/**`, `lib/actions/**`,
  `lib/services/**`, `lib/repositories/**`. **Hecho:** el guard pasa contra el diff de la rama.

---

## T3 — Catálogo de métricas (T0.1 ✅; depende de T1.1)

- [x] **T3.1** Escribir `lib/analytics/metrics.ts` con `METRICAS` (`as const`) = **las 23
  métricas de `design.md §3.3`** (15 operativas + 8 financieras, aprobadas íntegras por D1),
  `MetricaId`, `getMetrica`, `listarMetricas` (con filtro `estadoProduccion`), `sonSumables`,
  `ANALITICA_TAGS`, `tagDeDominio`. Cada entrada con `descripcion` de una frase que diga también
  qué **no** cuenta (gestiones anuladas) y, en las tasas, que el denominador **no** es el número
  de órdenes (D10). Asignar `estadoProduccion` métrica a métrica según lo comprometido por la
  126/127 y dejar la lista en `progress/impl_135.md` (D8).
  **Hecho:** typecheck en verde; `METRICAS.length === 23`; `getMetrica` es total y no lanza.

- [x] **T3.2** `tests/unit/analytics/metrics.test.ts` — invariantes estructurales:
  R3 (**12** claves exactas, con `@ts-expect-error` al omitir `unidadDeConteo`), R4 (ids
  únicos/snake_case/lookup), R5 (`snapshot` ⇔ `rollup`), R7 (los 5 roles, sin `apiKey`,
  maestro/admin `total` contrastado contra `esAccesoTotal`), R10 (`granos ⊆ DIMENSIONES` e
  incluye `fecha`), R12 (tags estables), **R30** (cubo `sin_asignar` en todo grano `mensajero` +
  constante única), **R33** (`estadoProduccion` cerrado y filtrable), **R35** (las 5 métricas por
  gestión citan `anulada_at`, no existe familia paralela `*_por_orden`, tasas sobre gestiones),
  **R36** (`unidadDeConteo` + `sonSumables`).
  **Hecho:** los 10 grupos de aserciones en verde y cada uno etiquetado con su `R<n>`.

- [x] **T3.3** `tests/unit/analytics/metrics-dinero.guardia.test.ts` (R6 + **R32**): toda métrica
  financiera cita solo ledgers/cierres, con intersección vacía con `orden`/`gestion_orden`/
  `orden_historial_estado`/`analytics_daily`; **y** su alcance es `total` para `maestro` y
  `admin` (los dos de `esAccesoTotal`) y `prohibido` para `adminSatelite`, `adminTienda` y
  `mensajero`, sin ninguna `acotado`; `listarMetricas({ rol })` devuelve **cero** financieras
  para esos tres roles. **Hecho:** el guard falla si se declara a mano una métrica financiera
  leyendo `orden` **o** si alguien le abre el dinero a un cuarto rol.

- [x] **T3.4** `tests/unit/analytics/definiciones-catalogo.guardia.test.ts` (R8/R9 + **R34**):
  todo estado citado ∈ `ORDER_STATUS_SEED` (con caso explícito para `en_fulfillment`), toda
  categoría ∈ el enum correspondiente del esquema, y toda métrica con grano `zona` declara
  `atribucionZona: "orden"` (censo de `usuario.zona_id` en `lib/analytics/**` = 0).
  **Hecho:** en verde; documenta en un comentario que el catálogo vigente tiene **19** values.

- [x] **T3.5** Test de **R11**: `getMetrica("primer_intento_ok")` remite a
  `criterio: "intentos_vigentes_historial"` y no declara umbral propio.
  **Hecho:** test en verde. *(Ya no es condicional: D1 metió la métrica en v1; sin `it.skip`.)*

---

## T4 — Rangos (T0.1 ✅ con D2/D3/D4/D6; depende de T1.1; `[P]` respecto de T3)

- [x] **T4.1** Escribir `lib/analytics/ranges.ts`: `resolverRango(entrada, now?)` para los
  **cuatro** casos de `design.md §4.3` — `dia`, `semana` (**empieza lunes**, D2), `mes`
  (**ventana móvil de 30 días**, D3) y `personalizado` (D4) — construido **solo** sobre
  `fechaCalendarioCR` / `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (D6). Comentario
  de cabecera obligatorio: (a) por qué `semana` tiene borde de calendario y `mes` no, y que **no
  se homogeneízan** (D3); (b) que el período es el **EN CURSO** y eso es un supuesto del spec,
  no una decisión del humano; (c) la divergencia aceptada con `RankingService` (D6).
  **Hecho:** typecheck en verde; el archivo no contiene ninguna constante de offset propia y sí
  contiene los tres comentarios.

- [x] **T4.2** `tests/unit/analytics/ranges.test.ts`: R13 (forma + semiapertura, preset y
  arbitrario), R15 (caso canónico y borde `T05:59:59.999Z`), R16 (invariantes (b)–(e) para las
  cuatro entradas + (a) solo para presets, con cruces de mes y de año), R17 (`now` inyectable,
  sin fake timers), R18 (`TZ` = `UTC` / `Asia/Tokyo` dan lo mismo), **R27** (lunes: caso
  canónico + `now` en domingo + cruce de mes), **R28** (30 días móviles: duración exacta
  `30*24 h` + `now` el día 1 del mes), **R31** (todo borde en `T06:00:00.000Z`, nunca en
  `T00:00:00.000Z`). **Hecho:** todos en verde con `now` explícito en cada caso.

- [x] **T4.3** `tests/unit/analytics/ranges-reuso.guardia.test.ts` (R14): `ranges.ts` importa de
  `@/lib/utils/fecha-cr`; censo de `6 * 60 * 60 * 1000`, `toISOString().slice` y `startOfDayCR`
  en `lib/analytics/**` = 0. **Hecho:** el guard pasa y su comentario cita la trampa de
  `startOfDayCR` (`RankingService.ts:60-61`) para que nadie la "arregle" copiándola.

---

## T5 — Filtros zod (T0.1 ✅ con D4; depende de T1.1; `[P]` respecto de T3/T4)

- [x] **T5.1** Escribir `lib/analytics/filters.ts`: `analiticaFiltroSchema` `.strict()` con
  `rango` obligatorio sobre los **cuatro** valores, `idList` para
  `zona_id`/`tienda_id`/`mensajero_id`, y la rama de rango arbitrario aprobada en D4 —`desde`/
  `hasta` como `YYYY-MM-DD` de ancho fijo más los cuatro `.refine` de `design.md §5`
  (obligatorios con `personalizado`, prohibidos con preset, no invertido, tope
  `RANGO_TOPE_DIAS = 366` inclusive)—; `parseAnaliticaFiltro` con resultado discriminado y
  `fieldErrors`. **Hecho:** typecheck en verde; el schema no expone rol ni sesión; el tope vive
  en una constante única, no en un literal.

- [x] **T5.2** `tests/unit/analytics/filters.test.ts`: R19 (clave desconocida), R20 (rango
  ausente / `"trimestre"` / los 4 válidos), R21 (escalar, `[]`, `[""]`, lista válida, ausencia),
  R22 (instante ISO, epoch, offset y `"2026-7-5"` rechazados), R23 (`fieldErrors` con la clave
  culpable, sin `throw`), R24 (`rol` y `usuario_id` rechazados), **R29** (`personalizado` sin
  `desde`/`hasta`; rango invertido; **367 días rechazados y 366 aceptados**; `desde` junto a un
  preset).
  **Hecho:** los 7 grupos en verde, cada test nombrado por comportamiento
  (`rechaza la lista vacia de zona_id`, no `test schema`).

---

## T6 — Cierre (depende de T2–T5)

- [ ] **T6.1** Ejecutar `pnpm run typecheck`, `pnpm run lint`, `pnpm test` y `./init.sh`.
  **Hecho:** los cuatro en verde, con la salida real pegada en `progress/impl_135.md`.

- [x] **T6.2** Escribir en `progress/impl_135.md` el mapa completo **`R1..R36 → test`** (archivo
  + nombre del test). **Hecho:** los **36** requisitos aparecen, ninguno con "pendiente"; el
  reviewer puede verificar cada fila sin abrir el código.

- [ ] **T6.3** Actualizar `progress/current.md` y la entrada de la 135 en `feature_list.json`
  (`status`, `status_note` con las **10 decisiones D1–D10 del 2026-07-30**, incluida la
  rectificación de D7). **Hecho:** `./init.sh` valida el estado del arnés en verde y el diff de
  `feature_list.json` contiene **solo** la modificación de la 135 (nunca un `git checkout` para
  deshacer). *(La `status_note` es bookkeeping: la fuente de verdad de las decisiones es el
  spec, no la bitácora.)*

- [x] **T6.4** Documentar en `progress/impl_135.md` los hallazgos colaterales y las consecuencias
  aceptadas para que no se pierdan: (a) la divergencia de "día" entre `RankingService` y los
  filtros de la 144, **aceptada en D6**, con el ticket de T0.3; (b) la fila huérfana
  `en_fulfillment` que puede aparecer en un `GROUP BY estatus_id` real, que la 123/126 deben
  tolerar; (c) el `mensajero_id` **nullable** del grano del rollup (D5) y el índice único parcial
  / centinela que la 123 debe elegir; (d) el supuesto no confirmado "período EN CURSO" (D3).
  **Hecho:** los cuatro apuntados con su referencia de archivo:línea o de decisión.

- [ ] **T6.5 [P]** Avisar en `feature_list.json > status_note` (o en el spec de cada una) a las
  features **123, 126, 127, 132 y 133** de lo que heredan según `design.md §6.1`.
  **Hecho:** las cinco tienen la referencia a `specs/135-analitica-catalogo-kpis-rangos/design.md
  §6.1`; en particular la 132 y la 133 saben que el dominio financiera es de **dos roles**
  (`esAccesoTotal`) y que no existe vista financiera recortada para tienda, satélite ni mensajero.
