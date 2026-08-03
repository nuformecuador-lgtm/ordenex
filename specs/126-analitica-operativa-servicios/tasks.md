# Feature 126 — analítica: servicios operativos · tasks

Convenciones: `[P]` = paralelizable con las tareas de su mismo bloque. Cada tarea lleva
**Hecho:** (criterio observable) y **R:** (requisitos que traza). La puerta **T0 está cerrada
(2026-08-02)**: no hay ninguna tarea condicional ni ninguna pregunta abierta en este archivo.

---

## T0 — PUERTA: **CERRADA el 2026-08-02**. Cero preguntas abiertas

- [x] **T0.1** Las cinco preguntas fueron llevadas al humano y **respondidas el 2026-08-02**.
      Registro completo en `requirements.md > Decisiones del humano (2026-08-02)`:

  | # | Respuesta del humano |
  |---|---|
  | **Q1** | **(B)** completar el día abierto **en vivo**; la migración de índices sobre `gestion_orden.created_at` **entra en el alcance** de la 126 |
  | **Q2** | **(B)** bloque `cobertura` en la respuesta, reusando `esNoComparable` / `HORIZONTE_HISTORIAL_CR` de la 125; la 131/133 **debe pintarlo** |
  | **Q3** | **(C)** ficha propia de corrección del catálogo = **feature 175**, con **(A)** como estado transitorio: la 126 **NO toca `lib/analytics/metrics.ts`** |
  | **Q4** | **(A)** derivar `sin_gestionar` del embudo, sin migración, con la semántica «HOY / universo B2» **escrita en el contrato** |
  | **Q5** | **(A)** cerrar el oráculo en la 126: `forbidden` + auditoría en un **helper reutilizable** que la 134 consume; no se parchea `recortarFiltro` de la 122 |

  **Hecho:** las cinco respuestas escritas y fechadas en `requirements.md`. El paso a
  `spec_ready`/aprobado en `feature_list.json` lo hace el leader (el spec_author no edita ese
  archivo).

- [x] **T0.2** Spec reescrito sobre las respuestas:
      **R18, R19, R24, R25** reescritos · **R33** (equivalencia intradía↔rollup), **R34**
      (`cobertura` obligatoria + aviso dirigido), **R35** (semántica de `sin_gestionar`),
      **R36** (helper único del oráculo) añadidos · **D6, D9, D12** ya no condicionales ·
      **D13** (el intradía NO reusa el repositorio de la 124) y **D14** añadidas ·
      `design.md §9` nueva con las tres divergencias que hereda la **ficha 175** ·
      apertura del guardia R42 cuantificada en `design.md > D11`.
      **Hecho:** no queda ningún ⚠ ni ningún «sujeto a T0» en los tres archivos.

> **Puerta cerrada: T1 en adelante puede arrancar.** T6 y T7 **existen** (Q1 = B) y son el
> bloque más caro de la feature. Si durante la implementación T7 (índices) se cayera del
> alcance, el intradía deja de ser viable y hay que volver al humano en vez de seguir
> adelante (riesgo dimensionado en `design.md §8`).

---

## T1 — Cimientos: tipos y contratos (sin lógica)

- [ ] **T1.1** `lib/types/analitica-operativa.ts`: `ResultadoOperativo`, `SerieOperativa`,
      `PuntoSerie`, `Cobertura` (`design.md §5.2`).
      **Hecho:** `pnpm run typecheck` verde; ningún `BigInt` ni `Date` en el tipo de salida.
      **R:** R30.
- [ ] **T1.2** `[P]` `lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts`.
      **Hecho:** compila; todas las firmas reciben `ConsultaAnalitica` y ninguna
      `AnaliticaFiltroInput`. **R:** R4.
- [ ] **T1.3** `[P]` `lib/interfaces/repositories/IAnaliticaOperativaVivaRepository.ts`.
      **Hecho:** ídem. **R:** R4, R17.
- [ ] **T1.4** `[P]` `lib/interfaces/services/IAnaliticaOperativaService.ts`.
      **Hecho:** ídem; el servicio no nombra `Request`, `Response` ni `next/headers`.
      **R:** R4.

## T2 — Corrección de `whereRollup` (defecto confirmado de la 122)

- [ ] **T2.1** Cambiar en `lib/analytics/alcance-columnas.ts` el retorno de `whereRollup` a
      `Prisma.AnalyticsDailyWhereInput` y la clave `mensajeroAsignadoId` → `mensajeroId`.
      **Hecho:** compila; revertir la clave **no compila**. **R:** R21. **Depende de:** T1.
- [ ] **T2.2** Test discriminante en `tests/unit/analytics/alcance-adaptadores.test.ts`:
      «whereRollup nombra la columna del rollup, no la de orden».
      **Hecho:** el test cae si se revierte T2.1. **R:** R21.

## T3 — Repositorio del rollup

- [ ] **T3.1** `lib/repositories/AnaliticaOperativaRollupRepository.ts`: `agregarCubos` con
      **una** agregación por grano, `where` compuesto por `whereRollup(consulta.alcance)` +
      el filtro ya recortado + el rango por fechas calendario.
      **Hecho:** el test de conteo de llamadas ve **una** consulta para cinco métricas.
      **R:** R4, R16, R26. **Depende de:** T2.
- [ ] **T3.2** `[P]` `etiquetasDeEstatus`: lookup contra `order_status`, sin mapa hardcodeado.
      **Hecho:** un id fuera de `ORDER_STATUS_SEED` devuelve su etiqueta real y no lanza.
      **R:** R13.
- [ ] **T3.3** Re-alcanzar el guardia R42 en
      `tests/integration/db/analytics-daily-guards.test.ts`: **un solo** archivo lector
      autorizado (este repositorio); cualquier otro lector → rojo.
      **Hecho:** mutación «leer el rollup desde el servicio» pone rojo el guardia; la lista de
      autorizados no crece a un directorio. **R:** R27. **Depende de:** T3.1.

## T4 — Servicio: proyección y composición

- [ ] **T4.1** `lib/services/AnaliticaOperativaService.ts`: proyección de las 13 métricas de
      rollup desde los cubos; reloj y repositorios por constructor.
      **Hecho:** dos llamadas con el mismo `now` inyectado dan el mismo resultado. **R:** R31.
      **Depende de:** T3.
- [ ] **T4.2** `[P]` Tasas: `Σ num / Σ DENOMINADOR_GESTIONES`; denominador 0 ⇒ `null`.
      **Hecho:** el test «divide entre gestiones, no entre órdenes» cae si se usa
      `ordenesCreadas`. **R:** R10.
- [ ] **T4.3** `[P]` `tiempo_ciclo`: sumar `acum`/`n` antes de dividir; sin `BigInt` en la
      salida. **Hecho:** `JSON.stringify(resultado)` no lanza. **R:** R14, R30.
- [ ] **T4.4** `[P]` Embudo `ordenes_por_estado` como **serie por fecha**, nunca sumado.
      **Hecho:** rango de tres días ⇒ tres puntos; el tripwire R43 de la 124 sigue verde.
      **R:** R12.
- [ ] **T4.5** `[P]` `motivos_devolucion` con el cubo `causa_devolucion IS NULL` etiquetado.
      **Hecho:** el test cae si se añade `{ not: null }`. **R:** R15.
- [ ] **T4.6** Guardia de sumabilidad: ninguna composición suma métricas con
      `sonSumables(a,b) === false`.
      **Hecho:** añadir una serie `entregas + ordenes_creadas` pone rojo el guardia. **R:** R11.
- [ ] **T4.7** `[P]` Errores envueltos con operación + métrica, sin ids ajenos.
      **Hecho:** el mensaje no contiene ningún uuid del filtro. **R:** R32.

## T5 — Métrica `live`: aging

- [ ] **T5.1** `lib/repositories/AnaliticaOperativaVivaRepository.ts` → `agingPorEstado` sobre
      `orden` + `orden_historial_estado`, apoyada en `@@index([ordenId, createdAt])` (existente).
      **Hecho:** guardia «la única métrica live no lee el rollup» verde; `EXPLAIN` sin
      `Seq Scan` sobre `orden_historial_estado`. **R:** R17.
      **Depende de:** T1.

## T6 — Intradía en vivo *(T0-Q1 = B; sub-decisión ya tomada en D13)*

- [x] **T6.1** Sub-decisión de `design.md > D13`: **no** se reusa `IAnaliticaRollupRepository`
      (sus seis consultas son plantillas `$queryRaw` cerradas sobre `VentanaDia`, sin costura
      para inyectar un `where`); la 126 declara consultas propias con el alcance en el `WHERE`.
      **Hecho:** escrita en `design.md > D13` con su alternativa descartada y su precio, antes
      de escribir código.
- [ ] **T6.2** `cubosDelDiaEnCurso(consulta, corteAt)` con ventana
      `[inicioDelDiaCREnUtc(hoy), ahora)`; sin `startOfDayCR` ni aritmética horaria propia; el
      alcance va al `WHERE`, nunca a un filtro en memoria.
      **Hecho:** el guardia de reuso de `fecha-cr` sigue verde y el censo R18 de la 122 no marca
      el archivo. **R:** R18. **Depende de:** T6.1, T7.
- [ ] **T6.3** Marcado `parcial: true` + `corteAt` en el punto del día abierto.
      **Hecho:** el test cae si el punto viaja indistinguible de un día cerrado. **R:** R18.
- [ ] **T6.4** **Test de equivalencia intradía↔rollup** (contención de la duplicación de D13):
      para una fecha ya cerrada, el camino intradía con `corteAt` = corte de ese día reproduce
      cubo a cubo y medida a medida las filas que escribió el job de la 124.
      **Hecho:** cambiar **una sola** definición del camino intradía (quitar
      `anulada_at IS NULL`, o usar `gestion_orden.mensajero_id` como coordenada en vez del
      mensajero de la orden) pone rojo
      `analitica-operativa-equivalencia.test.ts`. **R:** R33. **Depende de:** T6.2.
      **Sin esta tarea, D13 no se sostiene: no es opcional.**

## T7 — Migración de índices *(T0-Q1 = B; alcance firme)*

- [ ] **T7.1** `pnpm run db:migrate:create` con el índice de `gestion_orden(created_at[, anulada_at])`
      + `@@index` en `db/schema.prisma` (si no se declara, `migrate dev` propondrá borrarlo).
      **Hecho:** `migration.sql` creado, **no** aplicado aún.
- [ ] **T7.2** `down.sql` escrito a mano (obligatorio).
      **Hecho:** `pnpm run db:rollback` aplica y resuelve sin error. **R:** R25.
      **Depende de:** T7.1.
- [ ] **T7.3** Test de integración: `EXPLAIN` de la consulta intradía sin `Seq Scan` sobre
      `gestion_orden`. **Hecho:** el test cae si se retira el índice. **R:** R25.

## T8 — Cobertura y ventana ciega *(T0-Q2 = B)*

- [ ] **T8.1** Bloque `cobertura` reusando `esNoComparable` / `HORIZONTE_HISTORIAL_CR` de
      `lib/analytics/backfill-rango.ts`; **no** se declara una segunda constante de horizonte.
      **Hecho:** un rango que cruza el 2026-07-13 enumera sus fechas no comparables; el censo
      encuentra la fecha literal en **un** solo archivo del árbol de código. **R:** R19, R20.
- [ ] **T8.2** `cobertura` **obligatorio** en `SerieOperativa` (nunca `cobertura?`).
      **Hecho:** declararlo opcional no compila el fixture de contrato y pone rojo
      `operativa-contrato-salida.test.ts` > «cobertura es obligatoria en toda respuesta ok».
      **R:** R34.
- [ ] **T8.3** `[P]` Aviso dirigido a la **131** y la **133** escrito en `design.md > D9` y
      repetido en `progress/impl_126.md`: el bloque `cobertura` y el punto `parcial: true` **se
      pintan**; si no llegan al píxel, la decisión de Q2 no compra nada.
      **Hecho:** el aviso existe en los dos sitios y nombra a las dos features. **R:** R34.

## T8bis — `sin_gestionar` derivada *(T0-Q4 = A)*

- [ ] **T8bis.1** Proyección de `ordenes_estado_stock` sobre el estatus `sin_gestionar`, sin
      migración y sin tocar el job de la 124.
      **Hecho:** la serie existe y no suma entre fechas. **R:** R35, R12. **Depende de:** T4.4.
- [ ] **T8bis.2** Declaración de semántica en la respuesta: **«sin gestionar HOY»**, universo
      **B2** de la 124, **no** acumuladas.
      **Hecho:** borrar la declaración pone rojo `operativa-sin-gestionar.test.ts` > «la serie
      declara la semántica HOY (universo B2)»; servirla como suma del rango pone rojo el otro
      caso. **R:** R35.
      **Frontera:** esta semántica **no** se escribe en `lib/analytics/metrics.ts` (archivo de
      la 127): queda anotada para la **ficha 175** en `design.md §9`.

## T9 — Borde: Server Actions

- [ ] **T9.1** `lib/actions/analitica-operativa.ts` (`'use server'`): actor →
      `prepararConsultaAnalitica` → servicio.
      **Hecho:** ninguna ruta bajo `app/api/` sirve analítica operativa. **R:** R1, R4.
      **Depende de:** T4.
- [ ] **T9.2** `forbidden` → `logger.logError(describirDenegado(...))` **antes** de responder.
      **Hecho:** el test espía el logger, no el status; quitar la llamada lo pone rojo.
      **R:** R5.
- [ ] **T9.3** `[P]` `validation_error` sin tocar la base.
      **Hecho:** el repositorio mockeado recibe **cero** llamadas. **R:** R6.
- [ ] **T9.4** Seudonimización antes de serializar; `null → MENSAJERO_SIN_ASIGNAR` antes de
      seudonimizar. **Hecho:** ningún uuid de mensajero sobrevive a `JSON.stringify` con
      política seudónima; el cubo sin asignar sigue presente. **R:** R7, R8.
- [ ] **T9.5** *(T0-Q5 = A)* Rechazo de `mensajero_id` bajo política seudónima, con auditoría.
      **Hecho:** un `adminTienda` que filtra por mensajero recibe `forbidden` y deja rastro; y
      **sigue viendo** la desagregación seudónima por mensajero (mutación (b) de R24 lo prueba).
      **R:** R24.
- [ ] **T9.6** El predicado del rechazo vive en un **helper exportado único**
      (`sondeaIdentidadDeMensajero`), no inline en la acción, para que la **134** consuma el
      mismo.
      **Hecho:** copiarlo dentro de la acción y borrar el helper pone rojo
      `operativa-oraculo.test.ts` > «el predicado del oráculo se exporta una sola vez».
      **R:** R36. **Depende de:** T9.5.

## T10 — Aislamiento multi-tenant

- [ ] **T10.1** `[P]` Test: `mensajero` no ve el cubo `MENSAJERO_SIN_ASIGNAR` ni filas de otro.
      **Hecho:** añadir `OR mensajeroId IS NULL` al recorte lo pone rojo. **R:** R22.
- [ ] **T10.2** `[P]` Test: `adminSatelite` recorta por la zona **de la orden**.
      **Hecho:** recortar por `usuario.zona_id` lo pone rojo. **R:** R23.

## T11 — Deudas heredadas del review de la 122

- [ ] **T11.1** `alcance-obligatorio.guardia.test.ts`: censar también `as ConsultaAnalitica` y
      `as unknown as ConsultaAnalitica` (deuda (a)).
      **Hecho:** un forjador sintético con cast sale rojo; el consumidor legítimo sigue verde.
      **R:** R28.
- [ ] **T11.2** `alcance-bordes.guardia.test.ts`: censar los bordes reales de `app/` y
      `lib/actions/` (deuda (b)).
      **Hecho:** quitar el logger de T9.2 pone rojo **este** guardia además del de T9.2.
      **R:** R29. **Depende de:** T9.

## T12 — Guardias propios de la 126

- [ ] **T12.1** `[P]` `operativa-solo-lectura.guardia.test.ts`: ninguna escritura sobre rollup
      ni dominio; ningún `new Date()` en el servicio. **R:** R2, R31.
- [ ] **T12.2** `[P]` `operativa-fuente.guardia.test.ts`: `snapshot` ⇒ rollup, `live` ⇒ tablas
      vivas. **R:** R16, R17.
- [ ] **T12.3** `[P]` `operativa-frontera.guardia.test.ts`: nada en `app/api/`. **R:** R1.
- [ ] **T12.4** `operativa-frontera-127.guardia.test.ts`: el diff contra `dev` no toca ningún
      archivo de la lista de la 127 ni crea `lib/actions/analitica.ts`. **R:** R3.

## T13 — Cierre

- [ ] **T13.1** Decidir **en este PR** la retirada del guardia branch-scoped T12.4: al mergear
      pasa a juzgar toda rama posterior. **Hecho:** la decisión (retirar / convertir en guardia
      permanente de nombres) queda escrita en el PR, no diferida.
- [ ] **T13.2** `progress/impl_126.md` con el mapa `R1..R36 → test nombrado` **y** la copia de
      las tres divergencias del catálogo heredadas por la **ficha 175** (`design.md §9`),
      incluida la que puede hacer que la 133 oculte el panel de `incidentes`.
      **Hecho:** ningún requisito sin test; el reviewer puede verificarlo sin leer el código.
- [ ] **T13.3** `pnpm run typecheck`, `pnpm run lint`, `pnpm test` y `./init.sh` en verde.
      **Hecho:** delta 0 de rojos respecto del baseline medido **el mismo día** sobre esta rama
      (los baselines citados en la bitácora caducan con cualquier PR ajeno).
      **Nota:** no correr `pnpm build` (encadena `migrate deploy` contra una base real); usar
      `pnpm exec next build` si hace falta comprobar la frontera RSC.
- [ ] **T13.4** Todas las tareas marcadas `[x]` (`CHECKPOINTS.md`).

---

## Grafo de dependencias (resumen)

```
T0 (CERRADA 2026-08-02)
 └─► T1 ──► T2 ──► T3 ──► T4 ──► T9 ──► T9.6 ──► T11.2
      │             └──► T3.3   │       └──► T10
      ├──► T5                   └──► T8bis
      ├──► T7 ──► T6 ──► T6.4        (T7 antes que T6: la consulta
      ├──► T8                          intradía nace con su índice)
      └──► T11.1, T12.*  [P]
                              └──► T13
```

Sin conditionals: **todas** las tareas de este archivo están en alcance. `[x]` en T0.1, T0.2 y
T6.1 = ya hechas por el spec_author; el resto las ejecuta el implementer.
