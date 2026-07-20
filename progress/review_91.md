# Review — Feature 91 · Geocodificación de direcciones de órdenes

- **Worktree:** `ordenex-f91`, rama `feature/91-geocodificacion-ordenes`
- **Commit revisado:** `40962f7` · **Base:** `af55013` (`origin/dev`, ya con la cola de la 90)
- **Veredicto: APROBADO** — 0 bloqueantes, 4 hallazgos menores.

---

## 1. Checklist de CHECKPOINTS.md

### Especificación
- [x] `requirements.md` con R1–R34 en EARS numerados.
- [x] `design.md` con alternativas descartadas y su porqué (incl. §0 con C1/C2/C3).
- [x] `tasks.md` con **17/17 tasks marcadas**, ninguna sin marcar.

### Trazabilidad
- [x] **Los 34 requisitos mapean a un test concreto, nombrado y ejecutado.** Verificado
      test a test con `--reporter=verbose`, no por lectura del informe. Ningún test vacío
      ni "cubierto por". 96 tests en 9 archivos.
- [x] `progress/impl_91.md` contiene el mapa R-n a test.

### Calidad de código
- [x] Typecheck: **0 errores** (medido, exit 0).
- [x] Lint: **0 errores / 140 warnings** (medido).
- [~] Tests: **3444 passed / 2 failed**. Los 2 rojos son **preexistentes** y **no
      atribuibles a la 91** (ver seccion 4). Ver hallazgo menor M4.
- [n/a] E2E: backend puro sobre la cola de jobs, sin UI ni flujo de auth/pagos nuevo.

### Datos y seguridad
- [x] **RLS habilitada sin policies en `geocode_cache`** — verificado contra un Postgres 16
      REAL: `relrowsecurity = t`, 0 policies.
- [x] Migraciones reversibles con `down.sql`; **round-trip UP-DOWN-REUP verificado
      independientemente** (ver seccion 3).
- [x] Sin secretos hardcodeados: la credencial sale de `process.env`.
- [n/a] No hay webhooks nuevos.

### Patrón de capas
- [x] Controller (`route.ts`) solo registra el handler; sin queries ni negocio.
- [x] `GeocodificacionService` no conoce HTTP: DI por interfaces.
- [x] Los dos repositorios nuevos solo ejecutan queries Prisma.
- [x] Interfaces separadas por categoría en `lib/interfaces/`.

### Permisos / Multi-país
- [n/a] Sin páginas ni Server Actions nuevas.
- [~] País hardcodeado. Ver hallazgo menor M1.

---

## 2. Los cuatro puntos críticos — verificados POR MUTACIÓN, no por lectura

### 2.1 dedupeKey con hash8 (Q4 / R12 / R13) — GUARDIA REAL, VERIFICADA

El precedente de la 81 (guardia que parecía proteger y corría sobre el mock) obligaba a no
aceptar la palabra del implementador. Mutación aplicada al código real:

    -  return `${DEDUPE_PREFIX}:${ordenId}:${hash.slice(0, 8)}`;
    +  return `${DEDUPE_PREFIX}:${ordenId}`;

**Resultado: 5 tests en ROJO en 2 archivos**, incluida la regresión de integración
"corregir la direccion de una orden ya geocodificada encola un job nuevo". Código
restaurado y los 27 tests vuelven a verde con el árbol git limpio.

La guardia **no** es circular pese a que las aserciones usan `dedupeKeyGeocodificacion`:
lo que la salva son el `toHaveLength(2)` sobre una cola en memoria que replica el
ON CONFLICT DO NOTHING del índice único parcial, y el `not.toBe` entre la clave nueva y la
vieja. La cola fake honra la unicidad **sin acotar por estado**, que es exactamente la
propiedad del índice real de la 90 que hace peligroso el ordenId a secas.

### 2.2 Q1 — el CRUD NO puede escribir direccion. CONFIRMADO EN EL CÓDIGO REAL

- `lib/types/orden.ts:32-46` — `actualizarOrdenSchema` sigue `.strict()` y **no incluye
  direccion**. El archivo **no aparece siquiera en el diff del commit**.
- `lib/repositories/OrdenRepository.ts:632-648` — `toUpdateData()` proyecta 11 campos y
  **direccion no está entre ellos**. `update()` sigue siendo incapaz de escribirla.
- El único cambio es `UpdateOrdenData.direccion?` en la **interfaz** del repo
  (`lib/interfaces/repositories/IOrdenRepository.ts:43-51`), documentado como campo del
  guard latente.

**No hay ampliación del CRUD. La prohibición de la spec se respeta.** El guard de
`update()` (líneas 535-542 y 566-573) hace la pre-lectura **condicional**, como exige R11.

### 2.3 Round-trip de migraciones — REPETIDO INDEPENDIENTEMENTE EN DOCKER

Postgres 16 desechable (contenedor `f91rev`, puerto 55491, destruido al terminar). Método:

1. Base `revdb`: las **57** migraciones en orden, UP completo.
2. Base `refdb`: las mismas **excepto las 2 de la 91**, estado de referencia.
3. `revdb`: `down.sql` de `20260719130000_orden_geocode` y luego el de
   `20260719120000_job_tipo_geocodificacion`.
4. `pg_dump --schema-only` de `revdb` post-DOWN contra `refdb`.

**Resultado: diff vacío salvo el nonce aleatorio de pg_dump. El DOWN revierte el esquema
EXACTAMENTE (R5).**

- **Sin residuo `job_tipo_old`**: la consulta sobre `pg_type` devuelve 0 filas.
- `job_tipo` tras el DOWN contiene solo `liberar_reprogramadas`. El `down.sql` **RECREA el
  tipo** (Postgres no soporta DROP VALUE) y borra antes las filas `jobs` del tipo, o el
  ALTER ... USING fallaría.
- **RE-UP**: ambas reaplicadas, dump idéntico al UP completo (2301 líneas ambos).
- R1/R2/R3 verificados contra el motor real: 5 columnas nullable en `orden`, índice
  `geocode_cache_direccion_hash_key` UNIQUE, RLS habilitada con 0 policies.
- El ADD VALUE va en migración **separada** (error 55P04), con el precedente correcto.

### 2.4 GUARDRAIL — la DATABASE_URL compartida NO se tocó

- El commit **no modifica `.env` ni `_prisma_migrations`**.
- Toda mi verificación corrió vía `docker exec` contra un contenedor desechable con
  credenciales propias. **En ningún momento se exportó ni se leyó `DATABASE_URL`**, ni se
  invocó `prisma migrate deploy`. Contenedor destruido y verificado sin rastro.

---

## 3. Resto de puntos exigidos

**Degradación sin GOOGLE_MAPS_API_KEY (R25) — OK.** `loadGeocodeConfig()` nunca lanza
(ausente o vacío devuelve null) y `buildGeocodificacionService` construye el cliente
igualmente, así que un despliegue sin credencial **no rompe la carga del módulo del cron**.
`JobQueueService.drenar` envuelve cada handler en try/catch por job (líneas 67-77),
contabiliza y **continúa**. El test de R25 no se queda en el rejects: monta el **drenador
real** con dos jobs y comprueba que `liberar_reprogramadas` — que comparte el cron y **ya
está en producción** — se completa igual. El título del test no promete más de lo que
asevera.

**PII (R31) — OK.** Cero `console.*` en todo el código nuevo (única aparición: una palabra
dentro de un comentario). Los mensajes de error citan la OPERACIÓN, nunca la URL (que lleva
la credencial como query param), ni la dirección, ni las coordenadas. Los conteos del cron
son agregados. El payload del job solo lleva ordenId. Verificado **además empíricamente**
que `payload_crudo` no arrastra `formatted_address` ni `address_components` (ver M2).

**Fugas de alcance — NINGUNA.** El diff son 34 archivos y el único tocado bajo `app/` es
`app/api/cron/procesar-jobs/route.ts`, exclusivamente para registrar el handler y exportar
`buildHandlers`/`buildRecurrencias` para el test de R32. **Cero UI. Cero backfill
histórico**: no hay script ni migración que recorra órdenes existentes.

**Tests heredados — NINGUNO borrado ni aflojado.** `git diff --diff-filter=D` sale vacío.
El único heredado modificado es `zonas-migration.test.ts`, con el mantenimiento previsto de
las features 67/69/73/76/81/90: **solo se añaden dos exclusiones `endsWith` a la lista**. El
invariante sigue intacto — la aserción sigue siendo `expect(thisDir >= previas[...]).toBe(true)`.
**No se convirtió ningún `toBe` exacto en `toBeGreaterThan`**; el `>=` es preexistente y
está documentado en el propio test.

**Desviación 1 — el bug del undefined: corrección CORRECTA y regresiones REALES.**
`construirQueryDireccion` se llama **dentro de la transacción de creación de la orden**, y
`collapseSpaces(undefined)` habría lanzado abortando `create()` en producción. La corrección
es en el CÓDIGO (los componentes aceptan `string | null | undefined` y `normalizar()` trata
ausente como vacío), **no en los tests**. Verificado **por mutación**: revirtiendo
`normalizar` a comprobar solo `=== null`, los 2 tests de "robustez en el borde del writer"
se ponen en ROJO con el TypeError esperado. Las regresiones cubren el bug de verdad. Buen
hallazgo, y el enfoque fue el correcto.

**Desviación 2 — `.env.example` inexistente: ACEPTABLE.** Confirmado que el archivo no
existe en el repo. El implementador no podía añadir una línea a un archivo ausente y no
inventó uno, lo cual es correcto: crear convenciones nuevas no era su decisión. Queda como
seguimiento. Ver M3.

---

## 4. Clasificación de los 2 rojos — CONFIRMADA de forma independiente

Reproduje ambos fallos en un **worktree limpio en `af55013`** (sin nada de la 91): fallan
idénticamente. **Coincido con la clasificación: son preexistentes.**

1. `tests/components/CierreDiaPage.test.tsx` — rojo ya conocido.
2. `tests/integration/actions/generar-gastos-fijos-route.test.ts:109` — **coincido en que
   es deuda de la feature 90, no de la 91.** Cadena causal verificada: el commit `57c53ea`
   ("feat(90): infraestructura de cola de jobs...") reescribió `vercel.json` sustituyendo
   `/api/cron/liberar-reprogramadas` por `/api/cron/procesar-jobs` — hoy los crons son
   `corte-diario`, `generar-gastos-fijos` y `procesar-jobs` — pero **no actualizó ese
   test**, que sigue aseverando la ruta vieja. La 91 no toca `vercel.json` ni ese test.

Es exactamente el patrón de drift entre sesiones paralelas que ya golpeó al repo varias
veces. **Debe abrirse un ticket de deuda contra la 90**; no es motivo para rechazar la 91.

---

## 5. Hallazgos

Ninguno bloqueante.

- **M1 · menor — país hardcodeado.** `lib/geo/direccion-query.ts:21`, la constante
  `PAIS = "Costa Rica"`. CHECKPOINTS.md, sección Multi-país, pide "no se hardcodeó país...
  todo se resuelve por configuración". Hay precedente de CR-hardcode en el repo
  (`lib/utils/fecha-cr.ts`, `lib/utils/telefono-cr.ts`), por lo que no lo trato como
  bloqueante — pero existe también el patrón opuesto y mejor en `lib/config/moneda.ts`
  (`readNonEmpty("MONEDA_CURRENCY", "CRC")`), y esta feature **ya tiene** un
  `lib/config/geocode.ts` con helpers de entorno. Costaría unas 3 líneas y sería
  retrocompatible. Recomendado: `GEOCODE_PAIS` con default "Costa Rica".

- **M2 · menor con filo — comentario falso que invita a una fuga de PII.**
  `lib/clients/google-geocode.ts:34-35` afirma que hay un ".passthrough() implícito: campos
  extra del proveedor no rompen". **Es factualmente incorrecto**: el default de `z.object()`
  es *strip*, no *passthrough*. El comportamiento real es el SEGURO y lo verifiqué
  empíricamente (inyecté una respuesta con `formatted_address` y `address_components` y el
  crudo sale limpio), pero el riesgo es que alguien "corrija el código para que coincida con
  el comentario": con `.passthrough()` real, `formatted_address` — la dirección en claro,
  dato personal — **se persistiría en `geocode_cache.payload_crudo`**, contradiciendo R31 y
  el comentario de la propia migración ("la direccion en claro NO se persiste"). **Ningún
  test guarda hoy esa propiedad.** Recomendado: corregir el comentario y añadir la
  regresión.

- **M3 · menor — variables de entorno sin documentar en ningún sitio desplegable.**
  `GOOGLE_MAPS_API_KEY` y `GEOCODE_TIMEOUT_MS` solo viven en `design.md` e `impl_91.md`. Al
  no existir `.env.example`, quien despliegue no tiene dónde descubrirlas. La degradación es
  limpia (los jobs fallan y reintentan, nada más se rompe), así que no es bloqueante.
  Recomendado: crear `.env.example` como chore aparte.

- **M4 · menor, no atribuible — init.sh NO termina en verde.** El checkpoint de
  verificación final no se cumple literalmente, pero es por los 2 rojos preexistentes de la
  sección 4. No hay nada que la 91 pueda hacer al respecto. Es decisión de merge del
  leader/humano; desde el contenido de esta feature no hay objeción.

---

## 6. Números que MEDÍ yo (no aceptados del informe)

| Métrica | Reportado | Medido | OK |
| --- | --- | --- | --- |
| Typecheck | 0 | **0** (exit 0) | si |
| Lint | 0 err / 140 warn | **0 err / 140 warn** | si |
| Tests de la feature | 96/96 en 9 archivos | **96/96 en 9 archivos** | si |
| Suite completa | 3444 passed / 2 failed | **3444 passed / 2 failed** (356 archivos) | si |
| Rojos preexistentes en af55013 | 2 | **2, reproducidos en worktree base** | si |
| Mutación dedupeKey sin hash | "se pone rojo" | **5 tests rojos en 2 archivos** | si |
| Mutación normalizar sin undefined | "2 regresiones" | **2 tests rojos** | si |
| Round-trip migraciones PG16 | hecho en docker | **repetido: diff vacío, sin job_tipo_old** | si |

Todas las cifras del implementador se confirman. La bitácora es fiable.

---

## Veredicto: APROBADO

0 bloqueantes. Los 34 requisitos tienen test real y ejecutado; el dedupeKey compuesto está
protegido por una guardia que **verifiqué que muerde**; el CRUD no se amplió; el round-trip
de migraciones es limpio y no se tocó la base compartida; la degradación sin credencial no
compromete el cron compartido con producción; no hay fugas de alcance, ni UI, ni backfill,
ni tests heredados debilitados.

Los 4 hallazgos menores son mejoras recomendadas, no condiciones de merge. **M2 merece
atención pronta** por ser un comentario incorrecto sobre un punto de privacidad.
