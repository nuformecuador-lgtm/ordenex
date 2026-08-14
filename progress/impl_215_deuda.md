# 215 — Cierre de la deuda declarada (2026-08-14)

Rama `chore/215-deuda`, sobre `dev` @ `8e168005`. **No es una feature nueva**: tres
arreglos acotados y dos correcciones de registro, todos auditados contra el código.
Spec: `specs/215-reintento-en-cierre/`. **`feature_list.json` NO se toca** (bookkeeping
del leader).

---

## 1. Archivos creados / modificados

| Archivo | Qué |
| --- | --- |
| `tests/unit/guards/deriva-primer-intento.guardia.test.ts` | **NUEVO.** La guardia de la deriva declarada de `primer_intento_ok` (22 casos) |
| `lib/repositories/GestionOrdenRepository.ts` | **Solo comentarios (R28).** Docstring de `reprogramarDesdeDevuelta` + nota de la rama `incidente` |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | **Solo comentarios (R28).** Contrato de `reprogramarDesdeDevuelta` |
| `specs/215-reintento-en-cierre/design.md` | §7.6 (sexta condición + premisa caducada), §7 punto 1, §7bis (b), §10 riesgos 3 y 7, encabezado |
| `specs/215-reintento-en-cierre/requirements.md` | R19 reexpresado; R18/R34/R12 marcados cumplidos con evidencia; §Supuesto operativo con la válvula; encabezado |
| `specs/215-reintento-en-cierre/tasks.md` | T25 (la guardia), T1/T0b, mapa `R → test` (R19, R24, R28, R35) |

Cero cambios en `db/` (R27), en `app/`, en `components/` y en la lógica: ninguna línea
de comportamiento se movió.

---

## 2. R28 — los tres comentarios que afirmaban el criterio VIEJO

Medido antes de tocar nada: `reprogramada` **sí** está en
`RESULTADOS_QUE_CUENTAN_COMO_INTENTO` (`lib/types/orden-historial.ts:75-79`), y lo que
excluye la reprogramación de tienda es el **origen** (`ORIGEN_TIPOS_VISITA_REAL`,
`:137-139`, aplicado en `whereIntentosVigentes`). El derivador por
`estatus_destino_id` ya no existe.

1. **`GestionOrdenRepository.reprogramarDesdeDevuelta` (docstring).** Decía «el destino
   es `reprogramada`, NO `devuelta`, así que NO cuenta como intento (R8)». Ahora dice
   que no cuenta **por su ORIGEN sintético** —su fila de historial nace con
   `origen_tipo = reprogramacion_tienda`, fuera de `ORIGEN_TIPOS_VISITA_REAL`, sexta
   condición de `whereIntentosVigentes`—, que el destino **no protege de nada** porque
   `reprogramada` sí es un resultado contable, y qué pasa si alguien mete esa familia
   en la lista creyendo lo contrario: +1 de más → umbral antes → `rechazada` antes →
   `cobroRechazado` (56, **dinero real**) antes de tiempo y en silencio.
2. **`IGestionOrdenRepository.reprogramarDesdeDevuelta`.** La misma corrección en el
   contrato, remitiendo al docstring del repositorio para el porqué completo.
3. **`GestionOrdenRepository`, rama `incidente` (~:453).** Citaba «el derivador de
   intentos (67/160) filtra por `estatus_destino_id IN (devuelta, reprogramada)`».
   Ahora dice que **ese derivador ya no existe** y que `incidente` sigue sin contar por
   **dos** razones independientes, ninguna de ellas el destino: (a) el resultado no
   está en la lista de inclusión (R2); (b) la familia no está en
   `ORIGEN_TIPOS_VISITA_REAL` (R34).

---

## 3. La guardia de la deriva (R24-b/c/d, R35) — antes no tenía dueño

`tasks.md` T23 le asignaba una «guardia de prosa» que **nunca se escribió**. Medido por
el leader sobre `dev`: borrar las 42 líneas del bloque de `metrics.ts` → **169 archivos
/ 1966 tests VERDES**; borrar los **1458 caracteres** de la deriva dentro del
`descripcion` → verde igual.

**Qué vigila** `tests/unit/guards/deriva-primer-intento.guardia.test.ts` (22 casos):

- los **cuatro** sitios: el bloque de comentario de `lib/analytics/metrics.ts`, el
  `descripcion` de `primer_intento_ok` **leído del catálogo importado** (`METRICAS`, el
  dato que se exporta — no el fuente en disco), y los docblocks **vecinos inmediatos**
  de `AnaliticaRollupService.contarPrimerIntento` y
  `AnaliticaOperativaService.completarPrimerIntentoEnCubos`;
- en cada uno, las **tres afirmaciones**: (1) el criterio cambió —ahora, cierre
  APROBADO— y el histórico **no se re-backfillea**; (2) el corte es por `updated_at`,
  **no** por `fecha`, y recalcular una fila la pasa al criterio nuevo; (3) el efecto
  **intradía** (sube durante el día, baja al aprobarse los cierres) es propiedad
  **nueva y permanente**, no un artefacto de la migración;
- **anclada por CONTENIDO**: el marcador `id: "primer_intento_ok"` y la llave que abre
  su objeto para el bloque; el docblock vecino inmediato de la función para los
  servicios; el catálogo importado para el dato. Ni una línea, ni un offset.
- cada afirmación se exige por **señales sinonímicas**, no por la prosa literal de hoy:
  reformular es verde, quitar una afirmación es rojo.
- **excepción declarada** a «ningún censo ancla en un comentario»: aquí el objeto
  vigilado **es** el comentario (R24-b lo exige por escrito), y así lo dice el docstring
  de la guardia para que nadie la «arregle» despiojando comentarios — hacerlo la vacía.
- **autocomprobación** en el propio archivo: los localizadores devuelven `null` cuando
  la declaración no está (y no siempre); un texto que dice las tres cosas **con otras
  palabras** pasa; quitar una sola afirmación lo pone rojo; un texto vacío falla las
  tres señales completas.

### Las mutaciones, ejecutadas de verdad

Commit `c450cb6a` **antes** de mutar; cada mutación verificada con `git diff` en el
árbol antes de creerse su resultado. Alcance de medición: `tests/unit/guards` +
`tests/unit/analytics` (el mismo del leader, + esta guardia).

| # | Mutación (script en scratchpad, no `node -e`) | `git diff` | Resultado |
| --- | --- | --- | --- |
| — | **baseline sin mutar** | limpio | **170 archivos / 1988 tests VERDES** |
| 1 | borrar el bloque «DERIVA DECLARADA» de `metrics.ts` (**45 líneas / 3683 caracteres**, medidas por el script) | `1 file changed, 45 deletions(-)` | 🔴 **5 fallos** / 1983 pasan (170 archivos, 1 rojo). Los 3 de las afirmaciones del sitio `definicion` + «la declaración sigue ahí» + «son cuatro sitios distintos» |
| 2 | borrar la deriva **dentro del `descripcion`** (**1458 caracteres** — el número del leader, clavado) | `1 file changed, 1 insertion(+), 1 deletion(-)` | 🔴 **3 fallos** / 1985 pasan. Los tres del sitio `catalogo`, con el detalle de qué señal falta |
| 3 | **INOCUA**: reformular las 5 líneas del párrafo (3) del bloque (444 → 486 caracteres) sin quitar ninguna de las tres afirmaciones | `1 file changed, 5 insertions(+), 5 deletions(-)` | 🟢 **170 archivos / 1988 tests VERDES** |
| 4 | *(extra)* quitar **solo** el párrafo (2) del aviso de `AnaliticaOperativaService` (945 caracteres / 11 líneas), dejando (1) y (3) | `1 file changed, 11 deletions(-)` | 🔴 **exactamente 1 fallo**: `operativa · R24-c/R35`. No es una guardia de «existe el comentario» |

Texto real de la mutación inocua (dice lo mismo con otras palabras):

> «…arrastra cierres todavía sin aprobar devuelve 0 intentos previos y, por tanto, pasa
> por primer intento: el indicador SUBE conforme avanza el día y BAJA en cuanto se
> aprueban los cierres. No estamos ante un artefacto pasajero del cambio de criterio, ni
> ante algo que la deriva declarada vaya a hacer desaparecer: es una propiedad nueva y
> permanente de la métrica…»

Árbol restaurado tras cada mutación (`git checkout --` + `git status` limpio).

---

## 4. R19 — la consulta incompleta y su premisa caducada

**La condición que faltaba** (`design.md §7.6`, CTE `n_nuevo`, que llevaba cinco
condiciones):

```sql
AND EXISTS ( SELECT 1 FROM "orden_historial_estado" h2
              WHERE h2."gestion_orden_id" = g."id"
                AND h2."orden_id" = v.orden_id
                AND h2."origen_tipo"::text IN ('gestion') )
```

**Verificado contra `whereIntentosVigentes`** (no copiado a ciegas): el predicado vivo
es `historialEstados: { some: { ordenId, origenTipo: { in: [...ORIGEN_TIPOS_VISITA_REAL] } } }`,
y `historialEstados` es la relación `OrdenHistorialEstado[]` de `GestionOrden` por
`gestionOrdenId` (`db/schema.prisma:791` ↔ `:1571`, `@relation(fields: [gestionOrdenId],
references: [id])`). El `some` se traduce exactamente a ese `EXISTS`, con los mismos tres
filtros y ningún otro. **Ni más estricta ni más laxa.** Dos precisiones honestas:

- usé `IN ('gestion')` y no `= 'gestion'` porque el original es una lista de INCLUSIÓN de
  un solo valor **hoy**: si `ORIGEN_TIPOS_VISITA_REAL` crece, la consulta crece con ella
  y quien la lea ve dónde añadir. Es semánticamente idéntico;
- en la variante de **lote** (`contarIntentosVigentesEnLote`), Prisma manda `{ in: [...] }`
  también dentro del `some`, así que en teoría admitiría una fila de historial de OTRA
  orden del lote; la forma escalar del `EXISTS` (`= v.orden_id`) es la de la variante
  individual. La diferencia es **inalcanzable** en la práctica —la fila de historial de una
  gestión se escribe en la misma transacción y con el mismo `orden_id`—, y la consulta mide
  orden por orden, así que la forma escalar es la correcta aquí.

El `orden_id` repetido se conserva y se explica **como rendimiento** en el propio SQL:
`orden_historial_estado` no tiene índice por `gestion_orden_id`, y así el planner entra
por `@@index([orden_id, created_at])`.

**La premisa caducó, y queda escrito.** R19 exigía medir «ANTES de activar el criterio
nuevo». **El criterio ya corre en producción**: `ORIGEN_TIPOS_VISITA_REAL` aparece **3
veces** en `origin/prod:lib/repositories/OrdenHistorialRepository.ts` y **1** en
`origin/prod:lib/types/orden-historial.ts` (medido con `git grep -c` sobre `origin/prod`,
2026-08-14). R19 se **reexpresa** como medición **posterior** —a cuántas órdenes movió el
cambio, con su fecha—, **no se borra ni se da por cumplida**: sigue sin ejecutarse contra
ninguna base. Reexpresado en `requirements.md` (R19), `design.md §7 punto 1` y §7.6, y en
`tasks.md` (T1, T0b, mapa).

---

## 5. Las dos correcciones de registro

**R18 ya no es deuda.** El cron escribe `origenTipo: "escalado_devuelta_sla"`
(`lib/repositories/DevolucionSlaRepository.ts:163`, misma tx que crea la gestión
sintética), y ese valor **no está** en `ORIGEN_TIPOS_VISITA_REAL`; como la sexta
condición de `whereIntentosVigentes` exige una fila de familia de visita real, esa
gestión **no puede** contar aunque su cierre se apruebe. R18-a/b se cumplen
**estructuralmente**. **R34, que lo generaliza, está en `dev` y en `origin/prod`**
(mismos conteos de arriba). Marcados como CUMPLIDOS con esa evidencia y con sus tests
(`criterio-intento-entrega.test.ts`, bloque «ORIGEN_TIPOS_VISITA_REAL — el discriminador
de las sinteticas (215/R34)»). **De paso: R12 arrastraba el mismo registro caducado**
(«⚠️ INCUMPLIDO en 7d9471c3») y lo cerró el mismo discriminador — corregido, conservando
el párrafo que describe cómo estuvo roto. Igual el encabezado de `requirements.md`, el de
`design.md` y los riesgos 3 y 7 de `design.md §10`.

**Q5 se pintaba peor de lo que es.** Es cierto que `ESTADOS_RESOLUBLES = ["solicitado"]`
(`CierresAdminRepository.ts:39`) y que un `vencido` no es aprobable directo, pero existe
**válvula de escape**: `forzarSolicitudVencido` (`CierresAdminRepository.ts:879`, feature
111/R16). El bucle **no es inescapable: es manual**. Añadido donde la nota lo afirmaba —
`requirements.md` §Supuesto operativo («qué pasa si el supuesto no se cumple»),
`design.md §7bis (b)` y `design.md §10` riesgo 3 — con la conclusión que importa: lo que
falta no es un camino de salida, es que el sistema **avise** de que hay que tomarlo (M3,
descartada por D14). Sirve para no volver a proponer código para algo que se destraba a
mano.

---

## 6. Mapa `R<n>` → test

| Req | Test / evidencia |
| --- | --- |
| R28 | `tests/unit/types/criterio-intento-entrega.test.ts` (el criterio vigente, sin derivador residual) + revisión de prosa de esta tanda. Los tres comentarios ya no afirman el criterio viejo |
| R24-b | `deriva-primer-intento.guardia.test.ts` · «la declaracion sigue ahi» × 4 sitios + «son cuatro sitios distintos y ninguno es copia textual de otro» |
| R24-a | `deriva-primer-intento.guardia.test.ts` · «`<sitio>` · R24-a» × 4 |
| R24-c / R35 | `deriva-primer-intento.guardia.test.ts` · «`<sitio>` · R24-c/R35» × 4 |
| R24-d | `deriva-primer-intento.guardia.test.ts` · «`<sitio>` · R24-d» × 4 |
| *(la guardia se mide a sí misma)* | `deriva-primer-intento.guardia.test.ts` · describe «autocomprobacion: la guardia detecta lo que dice detectar» (4 casos) |
| R18 | Evidencia estructural en `requirements.md` R18 + `criterio-intento-entrega.test.ts` (bloque R34) + `devolucion-sla-service.test.ts` / `devolucion-sla-dinero.test.ts` verdes sin tocar |
| R34 | `criterio-intento-entrega.test.ts` · «R34-a: la lista es EXACTAMENTE `gestion`», «R34-c: es lista de INCLUSION», «R34-c: el predicado usa la lista con `in` y NO contiene ningun `none` ni `notIn`» |
| R19 | **SIGUE SIN DUEÑO EJECUTABLE, y así queda declarado**: es una medición contra la base real, no un test. La consulta está corregida y lista en `design.md §7.6`; **no se ha ejecutado** |

---

## 7. Salidas reales

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: verde)

$ pnpm run lint
✖ 65 problems (0 errors, 65 warnings)      <- las 65 son preexistentes (`_var` sin usar en tests)

$ pnpm exec vitest run guard
 Test Files  99 passed (99)
      Tests  1472 passed (1472)

$ pnpm exec vitest run tests/unit/guards tests/unit/analytics
 Test Files  170 passed (170)
      Tests  1988 passed (1988)
```

`./init.sh --rapido` (salida al final de esta bitácora, §8).

---

## 8. `./init.sh --rapido`

Salida real (2026-08-14), sin editar más que el recorte de las 65 líneas de warnings de
lint, que son preexistentes y se listan enteras arriba:

```
== Arnes SDD :: init (modo: rapido) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=1)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
> tsc --noEmit
✓ typecheck paso
-> pnpm run lint
> eslint
[... 65 warnings preexistentes ...]
✖ 65 problems (0 errors, 65 warnings)
✓ lint paso
-> pnpm run test:rapido
> vitest run --changed origin/dev --passWithNoTests
 Test Files  50 passed (50)
      Tests  770 passed (770)
   Duration  65.27s
> vitest run guard
 Test Files  99 passed (99)
      Tests  1472 passed (1472)
   Duration  10.70s
✓ test:rapido paso
! modo rapido: solo los tests relacionados con tus cambios + las guardias.
! Antes de abrir el PR corre './init.sh' sin flags.
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

`EXIT=0`. **Ni un rojo.** El gate completo lo corre el leader.

---

## 9. Lo que NO se hizo, a propósito

- **`feature_list.json` intacto**: el bookkeeping lo lleva el leader.
- **Ni una línea de comportamiento**: R28 son comentarios; R19 y las correcciones de
  registro son spec; la guardia es un test nuevo. `db/`, `app/` y `components/` sin tocar.
- **R19 no se ejecuta**: no hay medición contra ninguna base en esta tanda. Reexpresarla
  no es cumplirla, y así está escrito en los cuatro sitios donde figura.
- **T24 (la fecha real del despliegue de la 215)** sigue pendiente y no se inventa. La
  guardia nueva **no** exige una fecha literal: exige la regla del corte por `updated_at`,
  que es justo lo que hace innecesario adivinarla (R35).
