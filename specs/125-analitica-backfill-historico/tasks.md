# Feature 125 — backfill histórico de `analytics_daily` · tasks

> **Zona:** backend. **Rama:** `feature/125-analitica-backfill-historico`, sobre `origin/dev`
> @ `5314a2a8` (que **ya incluye la 124**).
>
> Todas las tareas se ejecutan con **pnpm**. **Nunca `pnpm build`**: encadena `migrate-deploy`
> contra una base real; para comprobar compilación, `pnpm typecheck`.

---

## T0 — Puerta de decisiones · CERRADA el 2026-08-02

**Hecho** cuando las diez decisiones están escritas con su consecuencia aceptada y no queda ninguna
`⧗Q` en la spec. **Cumplido**: `requirements.md > Decisiones cerradas — puerta T0 · 2026-08-02`.

Resumen de lo que la puerta produjo en este archivo:

- **D1 cambia de sentido**: la 125 **consume** el agregador de la 124. Se eliminan todas las tareas
  de «construir el agregador» (era el bloque más grande de la versión del 2026-08-01).
- **D2 se resuelve aguas arriba**: no hay tareas de `DELETE + INSERT` por fecha; la retirada de
  rancias de la 124 está **verificada** (ver la evidencia en `requirements.md > D2`).
- **D6 se retira**: no hay tareas de «evitar `@/lib/analytics/`».
- **D7**: no hay tareas de modo de borrado de rango.
- **D5/D10**: T6 y T7 son obligatorias y son criterio de cierre.

**Requisitos vigentes:** R1–R35 (35), todos con test nombrado en la tabla de trazabilidad.

---

## T1 — Planificador puro del rango  ·  R6–R10, R20

Sin dependencias. Bloquea T2 y T3.

- **T1.1** `lib/analytics/backfill-rango.ts`: `HORIZONTE_HISTORIAL_CR` (con comentario que cite
  `db/migrations/20260713120000_orden_historial_estado/migration.sql` y diga que fue **aditiva sin
  backfill**) y `planificarBackfill({ desde, hasta, ahora })` → `{ fechas, noComparables }` o un
  resultado de rechazo con motivo.
  **Hecho:** el módulo solo importa `@/lib/utils/fecha-cr`; no hay `process.env`, `console` ni
  aritmética de zona horaria propia.
- **T1.2** `tests/unit/analytics/backfill-rango.test.ts`: N fechas para N días, orden ascendente sin
  repetidos, cruce de fin de mes / fin de año / bisiesto, rechazo de formato inválido, de
  `desde > hasta`, de hoy CR y de futuro con reloj inyectado, y clasificación `no_comparable` por
  debajo del horizonte.
  **Hecho:** `pnpm vitest run tests/unit/analytics/backfill-rango.test.ts` en verde y R6–R10 + R20
  cubiertos.
- **T1.3 [P]** Reejecutar `pnpm vitest run tests/unit/analytics/modulo-puro.guardia.test.ts`.
  **Hecho:** verde con el archivo nuevo dentro del censo de `lib/analytics/`.

---

## T2 — Servicio iterador  ·  R3, R11–R18, R21–R23, R25, R31

Depende de T1.

- **T2.1** `lib/interfaces/services/IAnaliticaBackfillService.ts`: `OpcionesBackfill`,
  `ClasificacionFecha` (`procesada` | `no_comparable` | `fallida` | `estable` | `cambiada`),
  `LineaFecha`, `ResumenBackfill` y el puerto de progreso.
  **Hecho:** `pnpm typecheck` limpio; ni un `any`.
- **T2.2** `lib/config/analitica-rollup.ts`: añadir `FALLOS_CONSECUTIVOS_QUE_ABORTAN` con su
  comentario de procedencia.
  **Hecho:** `pnpm vitest run tests/unit/analytics/rollup-guards.test.ts` sigue verde (el nombre no
  casa el patrón de R47(d), `(UMBRAL|LIMITE|MAX)…(FILAS|VOLUMEN|CUBOS)`).
- **T2.3** `lib/services/AnaliticaBackfillService.ts`: recorre el plan, llama `agregarFecha` una vez
  por fecha, clasifica, emite progreso, acumula, aplica pausa y aplica el corte por fallos
  consecutivos. Sin Prisma, sin `console` directo (todo por el puerto de progreso).
  **Hecho:** el servicio se construye en test con un agregador falso y no importa `@/lib/db`.
- **T2.4** `tests/unit/services/analitica-backfill-service.test.ts`: una llamada por fecha en orden y
  ninguna fuera del rango; fecha que lanza ⇒ fallida + sigue + código final ≠ 0; N fallos
  consecutivos ⇒ aborta diciendo cuántas quedaron; pausa respetada con reloj falso y no respetada con
  el default; línea de progreso con los cinco campos; resumen con los siete; fecha no comparable
  pasada igual al agregador y con resumen intacto; cero bajo horizonte distinguible de cero por día
  vacío; clasificación de las cuatro categorías del modo verificar; error registrado con su fecha.
  **Hecho:** verde, y R3, R11, R13–R18, R21–R23, R25 y R31 quedan cubiertos.

---

## T3 — CLI y reporte de corrida  ·  R1, R2, R6, R7, R19, R24, R26–R30

Depende de T2.

- **T3.1** `scripts/backfill-analitica.ts`: parseo con zod, eco (host/puerto/base sin credenciales),
  confirmación con reintroducción literal del rango, construcción de dependencias reales con
  `buildAnaliticaRollupService`, escritura del reporte JSON, `process.exit` con 0/1/2, y
  auto-ejecución **solo** como entrypoint.
  **Hecho:** importar el módulo desde un test no ejecuta nada.
- **T3.2** Modo `--verificar --contra <reporte>`: carga y valida el reporte previo; si falta o no
  cubre el rango, aborta antes de invocar el agregador.
  **Hecho:** R23/R24 verificados por test.
- **T3.3** Salida sin ids por defecto (`fecha` + nombre del error + etapa) y `--verboso` con el error
  completo.
  **Hecho:** R30 verificado por test con un `PrimerIntentoIncoherenteError` simulado, comprobando que
  la clave del cubo **no** aparece en la salida por defecto.
- **T3.4** `tests/unit/scripts/backfill-analitica-cli.test.ts` con los casos de la tabla de
  trazabilidad (R1, R6, R7, R19, R24, R26, R27, R28, R29, R30).
  **Hecho:** verde; ninguna salida contiene usuario ni contraseña de la `DATABASE_URL` de prueba.

---

## T4 — Guardia estructural de la feature  ·  R2, R4, R5, R29, R32, R33

Depende de T3 (necesita la lista real de archivos). **[P]** con T5.

- **T4.1** `tests/unit/analytics/backfill-guards.test.ts`: censo sobre los archivos de la 125 —no
  nombran `analytics_daily` en código, no consultan tablas de analítica, no declaran superficie HTTP
  ni job recurrente, no mencionan las cinco tablas de dinero, no declaran medidas del rollup, no
  llevan URL de conexión ni `catch` vacíos— y comprobación de que la feature no añade carpetas bajo
  `db/migrations` ni modifica `db/schema.prisma`.
  **Hecho:** verde y con **autocomprobación por fixtures** (uno legítimo, dos infractores), para que
  no pueda pasar por vacío.
- **T4.2** Reejecutar los guardias heredados:
  `pnpm vitest run tests/unit/analytics/alcance-obligatorio.guardia.test.ts tests/unit/analytics/rollup-guards.test.ts tests/integration/db/analytics-daily-guards.test.ts`.
  **Hecho:** los tres verdes **sin haberlos editado**. Si alguno se pone rojo, se arregla el código de
  la 125, no el guardia.

---

## T5 — Integración contra Postgres local  ·  R12, R35 (primera mitad)

Depende de T3. **[P]** con T4.

- **T5.1** `tests/integration/db/analytics-daily-backfill.test.ts`, siguiendo el patrón de aislamiento
  de `tests/integration/db/analytics-daily-job.test.ts` (transacción de test + semilla propia):
  backfill de un rango pequeño sembrado, segunda pasada con `filasRetiradas === 0` y el mismo
  `filasEscritas` por fecha, y una fecha bajo horizonte que termina en éxito con cero filas y sale
  clasificada `no_comparable`.
  **Hecho:** verde contra la base local; R12 cubierto y L1 demostrada, no solo afirmada.

---

## T6 — Umbral de volumen con procedencia  ·  R34

Depende de T7.1–T7.3 (necesita la medición). No se hace antes: fijar el número sin dato es
exactamente lo que D5 prohíbe.

- **T6.1** Sustituir `UMBRAL_AVISO_FILAS_CORRIDA` por la cifra **medida**, con comentario que diga de
  qué corrida sale (rango, fecha de la medición, base) y que deje de decir «no medida».
  **Hecho:** la constante sigue estando **una sola vez** en `lib/config/analitica-rollup.ts`.
- **T6.2** Actualizar el allowlist `AJENAS_A_R47` de `tests/unit/analytics/rollup-guards.test.ts`:
  hoy exime **una** ocurrencia de `20_000` en `lib/clients/google-route-optimization.ts` y **una** en
  `lib/config/route-optimization.ts`, usadas como timeout. Al cambiar el valor del umbral esas
  entradas **quedan muertas** y el propio guardia se pone rojo por su caso «el allowlist no puede
  tener entradas muertas».
  **Hecho:** `pnpm vitest run tests/unit/analytics/rollup-guards.test.ts` verde, y el caso (a) del
  comentario provisional actualizado en coherencia con T6.1.

---

## T7 — Corrida real medida y runbook  ·  R35 (cierre de la feature)

Depende de T1–T5. **Es la última y es obligatoria.**

- **T7.1 — Sanear la base local antes de medir.**
  1. `pnpm db:generate` desde el schema limpio (el cliente Prisma generado sobrevive a los cambios de
     rama y mete tipos fantasma).
  2. `pnpm exec prisma migrate status` contra la base local. **Hecho:** dice que no hay migraciones
     pendientes ni drift. **Si hay drift, se para aquí**: una medición sobre una base a medio migrar
     no vale, y la 123 ya documentó que la local lo arrastraba.
  3. Comprobar que hay datos: que exista al menos un día con órdenes y gestiones dentro del rango que
     se va a medir, y **posterior al 2026-07-13** (si no, se mide el vacío).
- **T7.2 — Ensayo sin escribir.** Correr el script **sin `--confirmar`** sobre el rango elegido.
  **Hecho:** el eco imprime base, modo, rango, nº de fechas y nº de no comparables; el agregador **no
  se invoca ni una vez**.
- **T7.3 — Corrida real.** Repetir con `--confirmar "<desde>..<hasta>"` y `--reporte
  progress/backfill_125_reporte.json`.
  **Hecho:** todas las fechas procesadas o clasificadas `no_comparable`, cero fallidas, y el reporte
  escrito en disco.
- **T7.4 — Verificación.** `--verificar --contra progress/backfill_125_reporte.json` sobre el mismo
  rango.
  **Hecho:** todas las fechas `estable` o `no_comparable`; ninguna `cambiada`; código de salida 0.
- **T7.5 — Evidencia.** `progress/backfill_125.md` con: rango, base (host/puerto/base, **sin
  credenciales**), fecha de la corrida, tabla de `filasEscritas`/`filasRetiradas`/`ms` por fecha,
  totales, pico de filas de una sola fecha (que es lo que alimenta T6.1) y el resultado de T7.4.
  **Hecho:** el reviewer puede reproducir los números desde el reporte JSON pegado.
- **T7.6 — Runbook de producción** (en `progress/backfill_125.md`, no en el chat): variable
  `DATABASE_URL` exportada a mano, ensayo sin `--confirmar` **siempre primero**, lectura del eco antes
  de confirmar, rango reintroducido literalmente, pausa recomendada según lo medido, qué hacer si
  aparecen fechas fallidas (volver a correr **solo** ese subrango: la operación es idempotente) y el
  aviso de que **`--verificar` escribe**.
  **Hecho:** el runbook nombra el modo de fallo principal —recomputar el rango equivocado— y dice qué
  lo contiene.

---

## Cierre

- **T8.1** `pnpm typecheck` y `pnpm lint`: delta 0 respecto del baseline de `dev` **medido en esta
  misma rama y en esta misma sesión** (los baselines citados en bitácora caducan con cualquier PR
  ajeno).
- **T8.2** `pnpm test` completo. Comparar el **número de archivos** de la corrida con el de la
  medición de baseline: una suite degradada por saturación omite archivos enteros y parece verde.
  Los rojos que no reproduzcan en aislado se declaran flakes, con la prueba en aislado pegada.
- **T8.3** Mapa `R<n>` → test ejecutado y verde en `progress/impl_125.md`, con los 35 requisitos.
  **Hecho:** ningún requisito sin test que lo mida.
