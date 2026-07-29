# review_154 — Catálogo de estados v2 (`por_recolectar_en_tienda` + `incidente`)

> Rama: `feature/154-catalogo-estados-v2` @ `a92d6fd` (7 commits sobre `origin/dev` @ `0ed3125`)
> Worktree: `.claude/worktrees/lote-135` · Revisor: reviewer · Fecha: 2026-07-29
> Spec: `specs/154-catalogo-estados-v2/` (R1–R33) · Bitácora: `progress/impl_154.md`

## VEREDICTO: **APROBADO-CON-NOTAS** (0 bloqueantes)

Los 33 requisitos tienen test real y verificado **por mutación**, no por lectura de la bitácora.
La guardia sigue fallando CERRADO. El alcance declarado se cumple al pie de la letra. Las notas
de abajo son deudas y roces de mantenimiento, ninguna impide el merge; **la nota `menor-1`
(round-trip de migraciones inexistente) y la `menor-3` (cache de catálogo por proceso) deben
llegar al plan de despliegue del tren 154+155+156.**

---

## 1. Verificación ejecutable — números REALES de esta revisión

Corridos por el revisor en este worktree, no copiados de la bitácora.

```
$ ./init.sh                                   -> exit 0, "== init OK =="
  OK node v24.13.0 · OK dependencias · OK regla max-2-por-zona (in_progress=2)
  OK specs presentes · OK typecheck · OK lint · OK test
  OK todas las migraciones tienen down.sql · OK .env presente

$ pnpm run typecheck   -> 0 errores (no hizo falta `pnpm db:generate`)
$ pnpm run lint        -> 10 problems (0 errors, 10 warnings)
$ pnpm run test        -> Test Files 547 passed (547) · Tests 5735 passed (5735) · 131.98s
$ pnpm exec vitest run tests/integration/db
                       -> Test Files 67 passed (67) · Tests 614 passed (614) · 6.05s
$ git status --porcelain -> VACÍO (árbol limpio, sin basura sin trackear)
```

**Cuadran con lo que reporta el implementador**: 547 archivos / 5735 tests / 0 fallos, y 67
archivos en `tests/integration/db`. Añado el dato que faltaba en la bitácora: **614 tests** en
`tests/integration/db`.

- La base declarada (`dev`: 543 / 5655) **no la corrí contra `dev`**. Lo que sí verifiqué es que
  el delta de archivos es exacto: la 154 crea **4** archivos de test nuevos y 547 − 4 = 543. El
  «+80 tests» queda como dato del implementador, no verificado por mí.
- **Los 10 warnings de lint son preexistentes de `dev`** y lo comprobé archivo por archivo:
  `Sidebar.tsx`, `CobroVehiculoTarifas.tsx`, `TiendasModule.tsx`, `UbicacionMapaInner.tsx`,
  `OrdenesApartado.tsx`, `OrdenesModule.tsx`, `MisAsignacionesModule.test.tsx`,
  `WebhookAccionCell.test.tsx`, `google-adc-token.test.ts`, `api-key-repository.test.ts`.
  **Ninguno** de esos 10 archivos aparece en el diff de la 154. Cero warnings nuevos.

---

## 2. Trazabilidad R1–R33 — VERIFICADA POR MUTACIÓN, no por declaración

El brief exigía comprobar que cada `R<n>` tiene una aserción que **fallaría** si el
comportamiento se rompiera. Abrí los tests uno por uno y además apliqué **28 mutaciones** al
código de producción, a los cuatro `.sql` y a las listas de los guards, restaurando cada archivo
con `git checkout --` inmediatamente después. Resultado: **26 mutantes MUERTOS, 2 supervivientes
—los dos controles, que DEBÍAN sobrevivir—.**

| # | Mutación aplicada | Requisito atacado | Resultado |
| --- | --- | --- | --- |
| M0 | *(control)* añade un comentario al mapa de transiciones | — | **SOBREVIVE** (esperado: prueba que el arnés no está siempre rojo) |
| M1 | quita la arista `#43` del mapa | R14 | MUERTA |
| M2 | quita la arista `#44` del mapa | R15 | MUERTA |
| M3 | saca `incidente` de `ESTADOS_TERMINALES` | R16 | MUERTA |
| M4 | saca `por_recolectar_en_tienda` de `ESTADOS_CREACION` | R13 | MUERTA |
| M5 | label `"Incidente"` -> `"Incidencia"` | R30 | MUERTA |
| M6 | variante de `incidente` `danger` -> `warning` | R30 | MUERTA |
| M7 | variante de `por_recolectar_en_tienda` `warning` -> `info` | R29 | MUERTA |
| M8 | mete `incidente` en `ORIGEN_TIPOS_CON_GESTION` | R12 | MUERTA |
| **M9** | **`valueDe` deja de lanzar y devuelve un value por defecto (FALLO ABIERTO)** | **R32** | **MUERTA** |
| **M10** | **el resolvedor mete en el mapa los values que el build NO conoce (FALLO ABIERTO)** | **R32** | **MUERTA** |
| M11 | el UP de la migración A pierde un `WHERE NOT EXISTS` | R4 | MUERTA |
| M12 | el DOWN de la A pierde la guarda de `orden_historial_estado` | R6 | MUERTA |
| M13 | el DOWN de la A borra además un value previo (`por_devolver`) | R5 | MUERTA |
| M14 | el UP de la migración B pierde un `ADD VALUE` | R7/R8 | MUERTA |
| M15 | el DOWN de la B deja `incidente` en el enum recreado | R10 | MUERTA |
| M16 | el DOWN de la B pierde el `USING (...::text::...)` | R10/R11 | MUERTA |
| M17 | el DOWN de la B borra las filas ofensoras antes de recrear | R11 | MUERTA |
| M18 | `GuiaAsignacionService` empieza a nombrar `recoleccion_tienda` | R28 | MUERTA |
| M19 | `CierresAdminService` empieza a nombrar `incidente` | R28 | MUERTA |
| M19b | `OrdenRepository` empieza a nombrar `por_recolectar_en_tienda` | R28 | MUERTA |
| M20 | *(control)* un service dice «solo las **coincidentes**» | R28 | **SOBREVIVE** (esperado: la frontera `\bincidente\b` no da falso positivo) |
| M21 | `FAMILIAS_SIN_PRODUCTOR` gana una tercera familia (`gestion`) | R28 | MUERTA |
| M22 | reordena `ORDER_STATUS_SEED` (los 18 previos se mueven) | R3 | MUERTA |
| M23 | el SEED de familias pierde `incidente` (drift código <-> enum) | R9 | MUERTA |
| M24 | el mapa gana una arista fantasma que el inventario no tiene | R27 | MUERTA |
| M25 | `recoleccion_tienda` aparece en `PUNTOS_DE_ESCRITURA` (adquiere productor) | R28 | MUERTA |
| M26 | se apende una carpeta de migración `20260728130000_*` | *(test relajado, §3.4)* | MUERTA |

**Árbol limpio tras las 28 mutaciones** (`git status --porcelain` vacío, `HEAD` = `a92d6fd`).

### Mapa R -> test, con mi juicio sobre cada uno

| R | Test que lo cubre | ¿Aserción real? |
| --- | --- | --- |
| R1/R2 | `unit/types/order-status.test.ts`, `integration/db/order-status-v2-migration.test.ts`, `unit/scripts/seed-order-status.test.ts` | Sí — M22/M11 |
| R3 | `order-status.test.ts` › "los 18 values previos siguen intactos y en su posicion" (`slice(0,18)` contra lista transcrita a mano) | Sí — M22 |
| R4 | `order-status-v2-migration.test.ts` (regex del `WHERE NOT EXISTS` + simulación en memoria del UP x2) · `order-status.test.ts` (seed x3, ids estables) | Sí — M11 |
| R5 | `order-status-v2-migration.test.ts` › "borra exactamente los dos values nuevos" (lista `IN` exacta + ninguno de los 18) | Sí — M13. **Estático**, ver `menor-1` |
| R6 | idem › "el DELETE esta guardado por ausencia de referencias" | Sí — M12. **Estático** |
| R7/R8 | `orden-historial-...-incidente-migration.test.ts` + `unit/types/orden-historial-types.test.ts` | Sí — M14/M23 |
| R9 | `orden-historial-types.test.ts` › "coincide 1:1 con los valores del enum Prisma" + `satisfies` + `_EnsureExhaustive` (rompen el BUILD) | Sí — M23 |
| R10 | migración B › enum recreado con 22, derivado del SEED · `ALTER COLUMN ... USING` · `DROP TYPE ..._old` | Sí — M15/M16. **Estático** |
| R11 | idem › ausencia de `DELETE`/`UPDATE` sobre `orden_historial_estado` | Parcial — M17 mata la parte "sin borrar"; la parte "aborta ruidosamente" es aserción sobre el COMENTARIO. Ver `menor-2` |
| R12 | migración B › `ORIGEN_TIPOS_CON_GESTION` es exactamente `["gestion","deshacer_gestion"]` | Sí — M8 |
| R13 | `guardia.test.ts` › "R13: es LEGAL que una orden nazca en por_recolectar_en_tienda" | Sí — M4 |
| R14 | `guardia.test.ts` › R14 + `registrar-cambio-estado.guardia.test.ts` data-driven (#43 atraviesa el choke point real) | Sí — M1 |
| R15 | `guardia.test.ts` › R15 + choke point (#44) | Sí — M2 |
| R16 | `connectividad.test.ts` › "incidente es terminal, alcanzable (#44) y SIN ninguna arista de salida" + `guardia.test.ts` (bucle sobre los 20 destinos) | Sí — M3 |
| R17 | `connectividad.test.ts` + `guardia.test.ts` › "la unica salida legal … es en_ruta_bodega_central" (`toEqual`, no `toContain`) | Sí |
| R18–R21 | **DIFERIDOS** (decisión Q2). `guardia.test.ts` › describe "BAJAS DIFERIDAS: R18-R21 se mudan a las 155/156" — 4 casos que afirman que la arista **sigue** siendo legal y nombran la feature que la retirará | Sí, invertidos a propósito. Ver §5 |
| R22 | `guardia.test.ts` › "en_preparacion -> en_bodega_central sigue legal" | Sí |
| R23 | `guardia.test.ts` › 3 casos de asignación desde bodega | Sí |
| R24 | `guardia.test.ts` › igualdad EXACTA del mensaje + bucle sobre pares ilegales con los values nuevos + `not.toMatch(/UUID/)` | Sí |
| R25 | `connectividad.test.ts` › los dos values clasificados, sin sobrantes · **+ el BUILD**: `satisfies Record<OrderStatusValue, …>` y `_EnsureExhaustive` INTACTOS | Sí — M24 |
| R26 | `connectividad.test.ts` › 3 tests de grados; los mensajes nombran los `value` ofensores (`callejon sin salida: …`) | Sí — M1/M3 |
| R27 | `guardia.test.ts` › "el mapa declara exactamente las aristas del inventario, ni una mas" + recuentos 45/41/4 | Sí — M24 |
| R28 | `unit/guards/censo-catalogo-estados-v2.test.ts` (5 tests, escaneo `fs` de app/lib/components/hooks/scripts/e2e) + `orden-historial-cobertura.test.ts` | Sí — M18/M19/M19b/M21/M25 |
| R29/R30 | `components/EstatusBadgeCatalogoV2.test.tsx` (label exacto + igualdad de clases del DOM contra el gemelo `por_devolver`/`rechazada`) + `EstatusLabel.test.ts` | Sí — M5/M6/M7 |
| R31 | `EstatusBadgeCatalogoV2.test.tsx` › value crudo con variante neutra, distinta de las dos nuevas | Sí |
| R32 | `registrar-cambio-estado.guardia.test.ts` › "un estado de la DB que el build no reconoce -> motivo `estatus_desconocido`" (comprueba `motivo` Y `lado`) | Sí — **M9 y M10** |
| R33 | idem › replay de las 43 aristas previas con la foto de la DB sin los dos values nuevos | Sí |

**Conclusión de trazabilidad: 33/33 cubiertos. Ningún requisito sin test, ningún test vacío.**

---

## 3. Los puntos que el brief pidió mirar a fondo

### 3.1 La guardia NO falla ABIERTA (precedente de la 140) — VERIFICADO

El hueco de la 140 (`esOrderStatusValue` descartaba filas y la transición pasaba sin validar)
**sigue cerrado y los dos values nuevos no lo reabren**:

- `resolverCatalogoEstadosReal` sigue filtrando por `esOrderStatusValue`, pero `valueDe` **lanza**
  `TransicionNoValidableError("estatus_desconocido", lado)` cuando el id no resuelve
  (`lib/repositories/registrar-cambio-estado.ts:102`). "No sé" = "no".
- Lo probé de las dos formas posibles de reabrirlo: **M9** (que `valueDe` devuelva un value en
  vez de lanzar) y **M10** (que el resolvedor meta en el mapa lo que el build no conoce). **Los
  dos mutantes MUEREN.** La red existe y aprieta.
- Los dos values nuevos entran al catálogo del build, así que las filas de la DB con esos values
  sí se clasifican y sí se validan contra `TRANSICIONES` — que es lo correcto: `#43`/`#44`
  legales, todo lo demás ilegal (M1/M2/M3 lo confirman).

### 3.2 El `satisfies` no se relajó — VERIFICADO

`lib/types/order-status-transiciones.ts:173` conserva
`} as const satisfies Record<OrderStatusValue, readonly DestinoTransicion[]>;` y las líneas
217–224 conservan el `_EnsureExhaustive`. `lib/types/orden-historial.ts` conserva sus dos
(`satisfies readonly PrismaOrdenHistorialOrigenTipo[]` + `_EnsureExhaustive`). `EstatusBadge.tsx`
conserva `Record<OrderStatusValue, string>` y `Record<OrderStatusValue, BadgeVariant>` sin
`Partial` (el único `Partial` es `ORDER_STATUS_CLASS`, y ya era `Partial` en `dev`). Nada se
aflojó para que compilara: los dos values entraron a mano en los cuatro mapas.

### 3.3 `FAMILIAS_SIN_PRODUCTOR` — escape LEGÍTIMO y ACOTADO, no un agujero

Mi juicio: **es un escape legítimo**, y por tres razones concretas, no por buena voluntad.

1. **Está acotado por igualdad exacta.** El test afirma
   `expect(FAMILIAS_SIN_PRODUCTOR.map(f => f.origenTipo)).toEqual(["recoleccion_tienda","incidente"])`.
   Una tercera familia futura no se «cuela»: rompe ese `toEqual`. **M21 lo confirma** (meter una
   tercera familia pone el archivo rojo).
2. **La biyección se conserva, no se relaja.** La aserción pasó de `puntos == enum` a
   `puntos ∪ sin_productor == enum` **más** «los dos conjuntos no se solapan». Sigue siendo
   cobertura exacta del enum, con la ventana declarada explícita.
3. **Está doblemente guardado.** Si la 157/158 instrumenta un productor y lo registra en
   `PUNTOS_DE_ESCRITURA` sin sacarlo de aquí -> rojo (**M25**). Y si lo instrumenta y **olvida**
   `PUNTOS_DE_ESCRITURA`, el guard de censo de R28 lo caza igual, porque el literal aparecería en
   un archivo de `lib/`/`app/` fuera de la allowlist (**M18/M19/M19b**). Hay que fallar en los dos
   sitios a la vez para que algo pase inadvertido.

La alternativa fácil —inventar un punto de escritura falso— habría hecho mentir al test; el
implementador la descartó y lo dejó escrito. Correcto.

### 3.4 El test de orden de migraciones que se relajó — SIGUE VERIFICANDO ALGO REAL

`tests/integration/db/order-status-en-reparto-migration.test.ts` pasó de «la 153 es la ÚLTIMA
carpeta del repo» a «la 153 es la última **descontando las apendidas después**», que es el patrón
de denylist ya usado por `zonas-migration.test.ts` y `notificacion-migration.test.ts`.

**No es un test vacío.** Lo comprobé creando temporalmente una carpeta
`db/migrations/20260728130000_zzz_prueba_reviewer/` (posterior a la 153, no excusada por la
denylist): **el test se pone ROJO** (M26). Sigue exigiendo que la 153 no haya nacido antes de lo
que ya existía y que toda carpeta nueva se declare a conciencia. Deuda de mantenimiento sí
(`menor-4`), test hueco no.

### 3.5 Las dos migraciones y sus `down.sql` — revisión POR LECTURA

Los cuatro `.sql` calcan patrones que ya existen en el repo y los revisé línea a línea:

- **A/up** (`20260729120000_order_status_v2_por_recolectar_incidente/migration.sql`):
  dos `INSERT ... SELECT gen_random_uuid()::text, '<value>' WHERE NOT EXISTS (...)`. Idéntico al
  UP de la 139 (`20260724140000_order_status_devolucion_rechazadas`). `order_status` es TABLA
  desde `20260714123909`, así que `INSERT` es lo correcto y no `ALTER TYPE`. Correcto.
- **A/down**: `DELETE ... WHERE value IN (los dos) AND NOT EXISTS(orden) AND NOT EXISTS(historial)`.
  Cubre las tres FKs reales (`orden.estatus_id`, `historial.estatus_origen_id`,
  `historial.estatus_destino_id`). Best-effort declarado. Correcto.
- **B/up**: dos `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, sin ninguna sentencia que USE los values
  nuevos -> no dispara 55P04. Precedente exacto de dos values en una migración: la 99. Correcto.
- **B/down**: RENAME -> CREATE TYPE con **22** values -> `ALTER COLUMN ... USING (::text::)` ->
  `DROP TYPE ..._old`. Comparé los 22 contra el down de la 139 (21) + `devolucion_rechazada`:
  **coinciden value a value y en el mismo orden**. `origen_tipo` no tiene `DEFAULT` en
  `schema.prisma`, así que no falta ningún `DROP DEFAULT`/`SET DEFAULT`. Correcto.
- **Los 8 `down.sql` previos NO se tocaron**, y eso es lo correcto para este enum concreto: son
  fotos históricas y el rollback es secuencial. Lo que se ajustó son los **tests** que derivaban
  la lista del SEED vigente (67/99/100/106/138), que es exactamente lo que dicta el precedente.
  Hay un test que verifica archivo por archivo los recuentos históricos 11/12/13/15/17/18/20/21.

> **DIGO EXPLÍCITAMENTE, COMO PIDE EL BRIEF: la verificación de round-trip contra Postgres NO
> EXISTE.** Ni el implementador la hizo (T5.3 sin marcar) ni yo la hice (no hay base en este
> entorno). Los cuatro `.sql` están verificados **solo por lectura y por test estático de regex**.
> Nadie ha ejecutado `prisma migrate deploy` -> `db:rollback` x2 -> `deploy` contra un Postgres
> real con estas migraciones. Ver `menor-1`.

### 3.6 Alcance — CONFIRMADO CONTRA EL DIFF

`git diff --stat origin/dev...HEAD`: 36 archivos. Producción:

- `lib/types/order-status.ts`, `lib/types/orden-historial.ts`,
  `lib/types/order-status-transiciones.ts` (los tres SEED/mapa)
- `db/schema.prisma` (+2 values del enum, comentario 18 -> 20)
- `db/migrations/` x 2 carpetas nuevas (4 `.sql`)
- `app/(app)/ordenes/_components/EstatusBadge.tsx` — **el único `.tsx` de producción tocado**

**Cero** `lib/services/`, **cero** `lib/repositories/`, **cero** `actions.ts`, **cero** `route.ts`,
**cero** `lib/interfaces/`. Confirmado. El resto del diff es `tests/` (18 archivos),
`specs/154-*` (3), `progress/impl_154.md` y `feature_list.json`.

### 3.7 Basura sin trackear — NO HAY

`git status --porcelain` -> **vacío**, tanto al empezar como después de mis 28 mutaciones. Los
guards que recorren `fs.readdir` (censo de la 154, censo del rename de la 153, tests de orden de
migraciones) no tienen nada suelto que marcar. El gate no se cae por esto.

---

## 4. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con requisitos EARS numerados R1–R33.
- [x] `design.md` con alternativas descartadas y su porqué (§6; A1 pasó de descartada a **elegida**
      y el texto original se conservó como registro — bien hecho).
- [~] `tasks.md`: **28 de 29 tasks en `[x]`**. **T5.3 queda en `[ ]` a propósito** con la etiqueta
      «NO HECHO — DEUDA DECLARADA». Ver `menor-1`.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto. **Verificado por mutación, no por lectura.**
- [x] `progress/impl_154.md` contiene el mapa `R<n> -> test` (§6), completo y con nombres exactos.

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (10 warnings, todos preexistentes, ninguno en archivos de la 154).
- [x] `pnpm test` en verde: 547/547 archivos, 5735/5735 tests.
- [x] E2E no aplica: la feature no toca auth, pagos, recaudo, ingesta ni webhooks, y los dos
      estados nuevos **no son alcanzables por la UI** (nadie los produce). Justificado en
      `impl_154.md` §8.4. Los dos chips se verifican con render en jsdom.

### Datos y seguridad (Supabase)
- [x] **Sin tablas nuevas** -> no aplica RLS nueva. Las dos migraciones son aditivas y hay tests
      que asertan que ni el UP ni el DOWN contienen `CREATE POLICY` ni `ROW LEVEL SECURITY`.
- [~] Migraciones versionadas y con `down.sql` (`init.sh` lo valida). **`db:rollback` no se ejecutó**
      -> `menor-1`.
- [x] Ningún secreto hardcodeado. Barrí el diff con un grep de SUPABASE / SERVICE_ROLE / API_KEY /
      secret / password / token / Bearer: solo un falso positivo de un `split(" -> ")` en un test.
- [x] Webhooks: sin cambios. `EVENTOS_PUBLICOS` intacto; el emisor no se toca. Firma/idempotencia
      fuera de alcance.

### Patrón de capas
- [x] Ningún controller, service ni repository tocado (§3.6). Las capas ni se rozan.
- [x] Los tipos de dominio siguen en `lib/types/`; la presentación en el componente.

### Permisos / multi-país
- [x] Sin cambios de permisos ni de rutas protegidas.
- [x] Sin hardcode de país, moneda ni cuenta. Barrido del diff por CRC / Costa Rica / Ecuador /
      USD: nada.

### Verificación final
- [x] `./init.sh` termina en verde (exit 0).
- [x] `progress/review_154.md` existe (este archivo).
- [ ] **Entrada en `progress/history.md`: pendiente.** Es del leader, al cerrar/mergear. `menor-6`.

---

## 5. Hallazgos

### BLOQUEANTES: **ninguno**.

### Menores

**`menor-1` — El round-trip real de migraciones contra Postgres NO EXISTE (deuda declarada).**
`T5.3` sigue en `[ ]`. Los cuatro `.sql` se verificaron por lectura (yo) y por test estático de
regex (el implementador). **No está probado empíricamente** que: (a) el `USING` del down de la B
aborte de verdad ante una fila con los orígenes nuevos (R11); (b) el `DELETE` guardado del down de
la A deje exactamente 18 filas con la base limpia (R5) ni que no borre nada con una referencia
viva (R6); (c) la migración B no dispare 55P04 en un `prisma migrate deploy` real. Es **la misma
deuda que arrastran la 137, la 138 y la 139**, así que **no la convierto en bloqueante por sí
sola** — pero no la doy por hecha y **debe saldarse en el despliegue del tren 154+155+156**,
igual que se hizo en la 153 (donde el leader corrió el round-trip contra `localhost` tras
verificar que `DATABASE_URL` no apuntaba a producción). Recomendación: repetir ese procedimiento.

**`menor-2` — R11 se apoya en parte sobre una aserción de COMENTARIO.**
`orden-historial-...-incidente-migration.test.ts` › "R11: documenta la precondicion … y que el
rollback ABORTA" asserta `downSql` contra `/Precondicion/i`, `/RUIDOSAMENTE/i` y `/ABORTA/i`: eso
verifica que el comentario está escrito, no que el rollback aborte. La mitad **estructural** de
R11 («sin borrar ni reescribir esas filas») sí está cubierta de verdad — hay aserciones negativas
de `DELETE`/`UPDATE` sobre `orden_historial_estado` y **M17 muere**. Mismo patrón, más leve, en
"R6: documenta que si algo referencia NO borra" (pero R6 tiene además las dos guardas `NOT EXISTS`
asertadas, y **M12 muere**). No lo escalo: es consecuencia directa de `menor-1`, y esas líneas
quedarán probadas el día que se corra el round-trip.

**`menor-3` — La cache de catálogo por proceso no se invalida, y la 154 hace crecer el catálogo en caliente.**
`catalogoCache` (`lib/repositories/registrar-cambio-estado.ts:56`) se llena una vez por proceso y
nunca se refresca; el comentario dice «el catálogo es inmutable tras el seed». Con la 154 deja de
serlo: la migración A **añade dos filas a `order_status` en producción**. Un proceso Node que haya
cacheado las 18 filas antes de la migración seguirá sin conocer las dos nuevas hasta reiniciar.
El comportamiento es **CERRADO** (rechaza con `estatus_desconocido`, no cuela nada), y hoy el
impacto es nulo porque nadie produce esos values — pero **cuando la 157/158 empiece a producirlos,
el orden de despliegue importa**: migrar y **después** desplegar/reiniciar, no al revés. Es
preexistente de la 140; lo anoto aquí porque la 154 es la primera feature que lo hace relevante.
**Debe ir al plan de release del tren.**

**`menor-4` — Deuda de mantenimiento: toda migración futura hay que apendearla ya a TRES denylists.**
`zonas-migration.test.ts`, `notificacion-migration.test.ts` y ahora
`order-status-en-reparto-migration.test.ts`. El patrón crece linealmente y cada feature nueva paga
el peaje. El implementador siguió el patrón del repo, así que no es un desvío — pero conviene que
alguien lo unifique en un helper compartido antes de que sean cinco.

**`menor-5` — `progress/current.md` contiene una advertencia OBSOLETA que contradice la decisión Q2.**
Dice literalmente: «154 + 155 + 156 suben a producción JUNTAS o no suben. Por separado dejan el
flujo roto en el intermedio: **la 154 sola deja `generar guía` lanzando `TransicionIlegalError`**».
Eso era cierto con el spec original; con la decisión Q2 (solo aditiva) **la 154 sola NO rompe nada**
— no retira ninguna arista. El acoplamiento del tren viene de la 155/156. Es un archivo del leader,
no del implementador, y la nota correcta ya está escrita en `impl_154.md` §7 esperando a que se
copie. Corregirlo antes de planificar el release, o alguien tomará una decisión con información falsa.

**`menor-6` — Pendientes de cierre que son del leader, no del implementador.**
(a) Falta la entrada en `progress/history.md` (CHECKPOINTS la exige). (b) `feature_list.json`
sigue en `in_progress` — normal en el momento de la review. (c) Copiar la nota de release de
`impl_154.md` §7 a `progress/current.md` (T5.6 lo deja explícitamente al leader).

**`menor-7` — Comentarios desactualizados (cosmético, cero impacto funcional).**
Quedaron cuatro sitios diciendo 18/43/3 donde ahora hay 20/45/4:
- `lib/repositories/registrar-cambio-estado.ts:64` — «Lee el catalogo COMPLETO (**18 filas**)».
- `tests/fixtures/catalogo-estados.ts` — «cargada con los **18** value del ORDER_STATUS_SEED» y
  «id sintetico … por cada uno de los **18**».
- `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts:24` — «los **18** value del
  SEED» y, más llamativo, el título del test "el test recorre el inventario COMPLETO (43 aristas
  de flujo + 3 de creacion)", cuyo cuerpo **sí** asserta contra `RECUENTO_INVENTARIO` (45/4). El
  título miente aunque la aserción sea correcta.

Nada de esto afecta al comportamiento ni a la red de seguridad.

**`menor-8` — Efecto visible aceptado y sin test que lo fije.**
`listarOrderStatus` pasará a devolver 20 filas: los dos estados nuevos aparecerán en el desplegable
de filtro de listados **sin resultados** hasta la 155/157. Está declarado en `design.md` §7 y en
`impl_154.md` §7, y ningún requisito pide lo contrario (Q6 lo dejó fuera de alcance, es trabajo de
la 157). Lo dejo anotado para que no sorprenda en QA, no como incumplimiento.

---

## 6. Lo que NO reporto como hallazgo (decisiones ya cerradas, verificadas)

Confirmo haber comprobado cada una en el código, no dado por buena:

- **La 154 es SOLO ADITIVA.** Verificado: el mapa conserva las 43 aristas previas y suma 2 (45), y
  `#1`/`#2`/`#3`/`#4`/`#5`/`#6`/`#7b`/`#7c` **siguen todas legales**. El test "el mapa declara
  exactamente las aristas del inventario, ni una mas" lo fija bidireccionalmente.
  **La constancia de la discrepancia está dejada en CUATRO sitios**, no escondida: bloque «PUERTA
  T0 CERRADA» en `requirements.md`, `design.md` §3.2 (BAJAS -> BAJAS DIFERIDAS) + §3.4 + §3.5 +
  §6/A1, `impl_154.md` §3.1, y un `describe` dedicado en `guardia.test.ts` que afirma la legalidad
  y **nombra la feature que retirará cada arista**. Ese describe es un contrato de postergación:
  cuando la 155/156 retire la arista, se pondrá rojo y obligará a mover el caso. Buen trabajo.
- **`incidente` es TERMINAL sin salidas.** Correcto por decisión del 2026-07-29. `incidente: []`,
  entra en `ESTADOS_TERMINALES`, tiene entrada (#44) -> cumple R26. El `indemnizada` no se declara
  ni se deja preparado, tal como se pidió.
- **La familia `incidente` del enum sin productor hasta la 158**, con `#44` vía `gestion`.
  Deliberado (Q4). Cubierto por `FAMILIAS_SIN_PRODUCTOR` + el censo de R28.
- **Labels y variantes**: "Por recolectar en tienda"/`warning` y "Incidente"/`danger`, sin acento
  de marca. Confirmados por el humano y verificados en el DOM (M5/M6/M7).

---

## 7. Veredicto

**APROBADO-CON-NOTAS.** 0 bloqueantes.

- **33/33 requisitos con test real**, verificados por mutación (26 mutantes muertos, 2 controles
  vivos por diseño).
- **La guardia sigue fallando CERRADO**; el hueco de la 140 no se reabre (M9/M10 muertos).
- **`./init.sh` en verde**: 547 archivos / 5735 tests / 0 fallos; `tests/integration/db` 67/614.
- **Alcance respetado al pie de la letra**: 0 services, 0 actions, 0 repositories; un solo `.tsx`.
- **Árbol limpio.**

Puede mergearse. Las notas `menor-1` (round-trip inexistente), `menor-3` (cache de catálogo por
proceso frente al orden de despliegue) y `menor-5` (`current.md` desactualizado) **deben llegar al
plan de release del tren 154 + 155 + 156** antes de tocar producción.
