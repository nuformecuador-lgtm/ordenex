# Feature 135 — analítica: catálogo de KPIs + rangos temporales · tasks

Convenciones: `[P]` = paralelizable con las demás tareas marcadas `[P]` del mismo bloque.
Cada tarea lleva su criterio de **hecho**. Un commit por tarea (`feat(135): …` / `test(135): …`).
Ningún archivo fuera de `lib/analytics/**` y `tests/unit/analytics/**` (R25).

---

## T0 — PUERTA HUMANA (bloquea absolutamente todo lo demás)

- [ ] **T0.1** Obtener respuesta a las 10 preguntas abiertas de `requirements.md`.
  Mínimo imprescindible para desbloquear cada bloque:
  - **Q1** (lista v1 de métricas) y **Q7** (alcance financiero por rol) y **Q8** (métricas sin
    productor) y **Q10** (gestión vs orden) → bloquean **T3** (catálogo).
  - **Q2** (semana lunes/domingo), **Q3** (mes calendario vs 30 días; período en curso vs
    completo) y **Q6** (día operativo canónico) → bloquean **T4** (rangos).
  - **Q4** (rango arbitrario + tope) → bloquea **T5** (filtros).
  - **Q5** (órdenes sin mensajero) y **Q9** (zona de la orden vs del mensajero) → bloquean
    **T3** y condicionan el grano que la 123 llevará a `analytics_daily`.
  **Hecho:** las respuestas quedan escritas en `feature_list.json > status_note` de la 135 y
  reflejadas como decisiones cerradas en `requirements.md` (bloque de preguntas → bloque de
  decisiones fechadas). Sin esto, **no se escribe una sola línea de `lib/analytics/`**.

- [ ] **T0.2** Si Q4 se aprueba, añadir a `requirements.md` el requisito EARS del rango
  arbitrario (formato `YYYY-MM-DD`, no invertido, tope de ventana) con su fila en la tabla de
  trazabilidad. **Hecho:** requirements.md renumerado y coherente; el reviewer puede mapear el
  nuevo R a un test previsto.

---

## T1 — Andamiaje (depende de T0.1)

- [ ] **T1.1** Crear `lib/analytics/types.ts` con los dominios cerrados de `design.md §3.1`
  (`MetricaDominio`, `MetricaClase`, `MetricaUnidad`, `DimensionAnalitica`, `RolAnalitica`,
  `AlcanceMetrica`, `RangoPreset`) y las interfaces `FuenteMetrica`, `DefinicionMetrica`,
  `Metrica`. Sin datos, sin imports de runtime.
  **Hecho:** `pnpm run typecheck` en verde; el archivo no importa nada salvo `type`.

- [ ] **T1.2 [P]** Test de consistencia de roles: los 5 literales de `RolAnalitica` existen en
  `RolValue` del esquema y `apiKey` NO está.
  **Hecho:** `tests/unit/analytics/types.test.ts` en verde; falla si alguien renombra un rol en
  `db/schema.prisma`.

---

## T2 — Guards de frontera (depende de T1.1; `[P]` entre sí)

- [ ] **T2.1 [P]** `tests/unit/analytics/modulo-puro.guardia.test.ts` (R1/R2): censo sobre
  `lib/analytics/**` de `'use server'`, `next/headers`, `@/lib/db`, `@/lib/repositories`,
  `@/lib/services`, `@prisma/client` en import de valor; + import de los 4 módulos con el
  entorno sin `DATABASE_URL` sin que lance; + censo de declaraciones de métricas fuera de
  `metrics.ts`. **Hecho:** el guard pasa y falla si se le añade a mano un import prohibido.

- [ ] **T2.2 [P]** `tests/unit/analytics/frontera.guardia.test.ts` (R25): la rama no añade
  carpetas en `db/migrations/`, ni archivos en `app/**`, `components/**`, `lib/actions/**`,
  `lib/services/**`, `lib/repositories/**`. **Hecho:** el guard pasa contra el diff de la rama.

---

## T3 — Catálogo de métricas (depende de T0.1 con Q1/Q5/Q7/Q8/Q9/Q10 respondidas, y de T1.1)

- [ ] **T3.1** Escribir `lib/analytics/metrics.ts` con `METRICAS` (`as const`) según la lista
  aprobada en Q1, `MetricaId`, `getMetrica`, `listarMetricas`, `ANALITICA_TAGS`, `tagDeDominio`.
  Cada entrada con `descripcion` de una frase que diga también qué **no** cuenta (p. ej.
  gestiones anuladas). **Hecho:** typecheck en verde; `getMetrica` es total y no lanza.

- [ ] **T3.2** `tests/unit/analytics/metrics.test.ts` — invariantes estructurales:
  R3 (claves exactas, con un caso `@ts-expect-error`), R4 (ids únicos/snake_case/lookup),
  R5 (`snapshot` ⇔ `rollup`), R7 (los 5 roles, sin `apiKey`, maestro/admin `total`),
  R10 (`granos ⊆ DIMENSIONES` e incluye `fecha`), R12 (tags estables).
  **Hecho:** los 6 grupos de aserciones en verde y cada uno etiquetado con su `R<n>`.

- [ ] **T3.3** `tests/unit/analytics/metrics-dinero.guardia.test.ts` (R6): toda métrica
  financiera cita solo ledgers/cierres; intersección con `orden`/`gestion_orden`/
  `orden_historial_estado`/`analytics_daily` vacía. **Hecho:** el guard falla si se declara a
  mano una métrica financiera leyendo `orden`.

- [ ] **T3.4** `tests/unit/analytics/definiciones-catalogo.guardia.test.ts` (R8/R9): todo estado
  citado ∈ `ORDER_STATUS_SEED` (con caso explícito para `en_fulfillment`) y toda categoría ∈ el
  enum correspondiente del esquema. **Hecho:** en verde; documenta en un comentario que el
  catálogo vigente tiene **19** values.

- [ ] **T3.5** (solo si Q10/Q1 incluyen la métrica de intentos) test de R11: la definición
  remite a `criterio: "intentos_vigentes_historial"` y no declara umbral propio.
  **Hecho:** test en verde, o `it.skip` con la razón escrita si la métrica no entró en v1.

---

## T4 — Rangos (depende de T0.1 con Q2/Q3/Q6 respondidas, y de T1.1; `[P]` respecto de T3)

- [ ] **T4.1** Escribir `lib/analytics/ranges.ts`: `resolverRango(preset, now?)` construido
  **solo** sobre `fechaCalendarioCR` / `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`.
  **Hecho:** typecheck en verde; el archivo no contiene ninguna constante de offset propia.

- [ ] **T4.2** `tests/unit/analytics/ranges.test.ts`: R13 (forma + semiapertura), R15 (caso
  canónico y borde `T05:59:59.999Z`), R16 (invariantes por preset, incluidos cruces de mes y de
  año), R17 (`now` inyectable, sin fake timers), R18 (`TZ` = `UTC` / `Asia/Tokyo` dan lo mismo).
  **Hecho:** todos en verde con `now` explícito en cada caso.

- [ ] **T4.3** `tests/unit/analytics/ranges-reuso.guardia.test.ts` (R14): `ranges.ts` importa de
  `@/lib/utils/fecha-cr`; censo de `6 * 60 * 60 * 1000`, `toISOString().slice` y `startOfDayCR`
  en `lib/analytics/**` = 0. **Hecho:** el guard pasa y su comentario cita la trampa de
  `startOfDayCR` (`RankingService.ts:60-61`) para que nadie la "arregle" copiándola.

---

## T5 — Filtros zod (depende de T0.1 con Q4 respondida, y de T1.1; `[P]` respecto de T3/T4)

- [ ] **T5.1** Escribir `lib/analytics/filters.ts`: `analiticaFiltroSchema` `.strict()` con
  `rango` obligatorio e `idList` para `zona_id`/`tienda_id`/`mensajero_id`; `parseAnaliticaFiltro`
  con resultado discriminado y `fieldErrors`. Si Q4 se aprobó, añadir la rama de rango
  arbitrario con sus `refine`. **Hecho:** typecheck en verde; el schema no expone rol ni sesión.

- [ ] **T5.2** `tests/unit/analytics/filters.test.ts`: R19 (clave desconocida), R20 (rango
  ausente/ inválido / cada preset válido), R21 (escalar, `[]`, `[""]`, lista válida, ausencia),
  R22 (instante ISO, epoch y offset rechazados), R23 (`fieldErrors` con la clave culpable, sin
  `throw`), R24 (`rol` y `usuario_id` rechazados).
  **Hecho:** los 6 grupos en verde, cada test nombrado por comportamiento
  (`rechaza la lista vacia de zona_id`, no `test schema`).

---

## T6 — Cierre (depende de T2–T5)

- [ ] **T6.1** Ejecutar `pnpm run typecheck`, `pnpm run lint`, `pnpm test` y `./init.sh`.
  **Hecho:** los cuatro en verde, con la salida real pegada en `progress/impl_135.md`.

- [ ] **T6.2** Escribir en `progress/impl_135.md` el mapa completo `R1..R26 → test` (archivo +
  nombre del test). **Hecho:** los 26 requisitos aparecen, ninguno con "pendiente"; el reviewer
  puede verificar cada fila sin abrir el código.

- [ ] **T6.3** Actualizar `progress/current.md` y la entrada de la 135 en `feature_list.json`
  (`status`, `status_note` con las decisiones de T0.1). **Hecho:** `./init.sh` valida el estado
  del arnés en verde y el diff de `feature_list.json` contiene **solo** la modificación de la
  135 (nunca un `git checkout` para deshacer).

- [ ] **T6.4** Documentar en `progress/impl_135.md` los dos hallazgos colaterales para que no se
  pierdan: (a) la divergencia de "día" entre `RankingService` y los filtros de la 144 (Q6), y
  (b) la fila huérfana `en_fulfillment` que puede aparecer en un `GROUP BY estatus_id` real, que
  la 123/126 deben tolerar. **Hecho:** ambos apuntados con su referencia de archivo:línea; si el
  humano decide abrir tickets, sale de aquí.
