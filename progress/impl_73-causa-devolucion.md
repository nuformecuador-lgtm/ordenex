# Bitácora — Feature 73 · Causa tipificada de la devolución (BACKEND, bloques B1→B4)

> Worktree: `ordenex-f73`, rama `feature/73-causa-devolucion`, base `ccad206` (desde `origin/dev`).
> Alcance de esta bitácora: **B1→B4**. **B5 (UI/radios) es de `frontend_dev`; B6/B7 los coordina el leader.**
> Fecha: 2026-07-15.

## Veredicto

**B1→B4 cerrados y verificados.** Typecheck 0, lint 0 errores / 139 warnings (= baseline), suite
2898/2899. **El único rojo es el interlock esperado B3↔B5** (ver "Cabo suelto BLOQUEANTE"): la UI
todavía no envía la causa, y el borde ya la exige. No se puede cerrar sin B5.

## B0 — Baseline (medido por el leader en ESTE worktree, sobre `ccad206`)

| Gate | Baseline | Final (B1→B4) | Delta |
| --- | --- | --- | --- |
| `pnpm typecheck` | 0 errores | **0 errores** | = |
| `pnpm lint` | 0 errores, 139 warnings | **0 errores, 139 warnings** | = |
| `pnpm test` | 2848 pasan / **1 falla** (302 archivos) | **2902 pasan / 1 falla** (307 archivos) | +54 tests |

Sobre el rojo del baseline (`tests/unit/guards/no-embalaje.test.ts`): es una fragilidad de
orden/carga preexistente en `origin/dev` (pasa en aislado, falla en suite completa). **En la corrida
final de esta bitácora salió VERDE** — confirma que es flaky, no determinista. No se tocó.

## Archivos

**Creados**
- `db/migrations/20260715160000_gestion_orden_causa_devolucion/{migration.sql,down.sql}` (T1.2/T1.3)
- `lib/types/causa-devolucion.ts` — SEED + doble candado de exhaustividad (T2.1)
- `app/(app)/mis-asignaciones/_components/causa-devolucion-options.ts` — labels + options (T2.2)
- `tests/integration/db/gestion-orden-causa-devolucion-migration.test.ts`
- `tests/unit/types/causa-devolucion.test.ts`
- `tests/unit/types/gestion-orden-causa-devolucion.test.ts`
- `tests/unit/services/mis-asignaciones-causa-devolucion.test.ts`
- `tests/unit/actions/mis-asignaciones-causa-devolucion.test.ts`

**Modificados (producción)**
- `db/schema.prisma` — enum `GestionCausaDevolucion` + columna `causaDevolucion` nullable (T1.1)
- `lib/types/gestion-orden.ts` — `causaDevolucionSchema` SÓLO en la variante `devuelta` (T3.1)
- `lib/actions/mis-asignaciones.ts` — `rawFromFormData` + `toGestionarInput` (T4.1)
- `lib/interfaces/services/IMisAsignacionesService.ts` — `GestionarInput.devuelta` (T4.2)
- `lib/interfaces/repositories/IGestionOrdenRepository.ts` — `GestionOrdenData.causaDevolucion` (T4.2)
- `lib/services/MisAsignacionesService.ts` — `buildGestionData` rama `devuelta` (T4.3)
- `lib/repositories/GestionOrdenRepository.ts` — el INSERT escribe la columna, **sin cambiar la firma
  de `crearGestionYTransicionar`** (la causa viaja dentro de `GestionOrdenData`, R13 intacta)

**Modificados (tests) — ampliación**
- `tests/unit/repositories/gestion-orden-repository.test.ts` — **+4 casos nuevos (T4.4)** en el bloque
  `crearGestionYTransicionar`: cubren el borde **repo→Prisma**, que ningún test tocaba y que sí edité.
  Sobre el dialecto de "integración" de este repo: `tests/integration/db/*` **no golpean Postgres**
  (usan fakes en memoria); el trabajo contra la DB real es el round-trip manual del implementer (T1.4),
  como declara el propio comentario de `gestion-orden-anulacion-migration.test.ts`.

**Modificados (tests previos) — justificación obligatoria (T6.3 exige justificar cada uno)**
1. `tests/unit/types/gestion-orden-schemas.test.ts` (2 casos de la rama `devuelta`): se les **añade**
   `causaDevolucion`. Sin ella, un `devuelta` de la 36 ya no parsea — que es EXACTAMENTE lo que pide
   R6 — y el caso "motivo vacío → inválido" pasaría por el motivo EQUIVOCADO (le faltaría la causa,
   no el motivo). **Lo que cada test afirma no cambia; se amplía el input, no se relaja la aserción.**
2. `tests/unit/services/mis-asignaciones-service.test.ts` (7 inputs `GestionarInput` de `devuelta`):
   mecánico, forzado por el TIPO (el contrato ganó un campo obligatorio en esa rama). Cero cambios en
   aserciones.
3. `tests/unit/actions/mis-asignaciones-action.test.ts` (1 caso, "menor-1"): el FormData de `devuelta`
   debía **llegar** al service para probar que un error EXCEPCIONAL pasa por `withErrorHandler`; sin
   causa moriría en el borde y el test dejaría de probar lo suyo. Se le añade la causa.
4. `tests/integration/db/cierre-detail-migration.test.ts` y `tests/integration/db/zonas-migration.test.ts`:
   **landmines preexistentes, no regresión de la 73.** Ambos afirmaban que SU migración es la ÚLTIMA
   del repo (`expect(thisDir).toBe(dirs[dirs.length - 1])`) — invariante que **cualquier** feature que
   añada una migración rompe. El nombre de esos tests ("timestamp posterior a las **previas**") ya decía
   lo correcto; la aserción sobre-especificaba. Se corrigen al patrón que el propio repo usa en
   `gestion-orden-anulacion-migration.test.ts` (comparar contra su predecesora real / lista explícita de
   "apendidas después"). Mi migración tiene el timestamp correcto (el mayor); no se movió.

## T1.4 — Round-trip de la migración: **DEMOSTRADO de verdad** (no afirmado)

**Salvedad de método (dato real, no supuesto):** `pnpm run db:migrate:create` (`prisma migrate dev`)
**no se pudo usar**: aborta pidiendo resetear la base de dev por un drift **preexistente y ajeno**
(`20260714123909_reconcile_fks_drop_order_status_value` fue modificada después de aplicarse — commit
`22cf7a3`, que le añadió el `down.sql` que le faltaba). Resetear la base de dev del humano no es una
decisión mía. Se escribió la carpeta a mano (2 sentencias, idénticas a `design.md §1.2`) y se aplicó
con `prisma migrate deploy`, que no exige reset. **Esto no debilita el round-trip: las 3 fases se
ejecutaron contra el Postgres real (`localhost:5432/ordenex`).**

```
##### (1) MIGRATE #1 (deploy) → aplicada
  └─ 20260715160000_gestion_orden_causa_devolucion/migration.sql
All migrations have been successfully applied.

##### ESTADO TRAS MIGRATE #1
COLUMNA causa_devolucion : {"data_type":"USER-DEFINED","udt_name":"gestion_causa_devolucion","is_nullable":"YES","column_default":null}
TIPO gestion_causa_devolucion : not_found,wrong_number,wrong_address
REGISTRO EN _prisma_migrations : 1

##### (2) DB:ROLLBACK
Rollback completado: 20260715160000_gestion_orden_causa_devolucion

##### (3) ESTADO TRAS ROLLBACK
COLUMNA causa_devolucion : NO EXISTE
TIPO gestion_causa_devolucion : NO EXISTE
REGISTRO EN _prisma_migrations : 0

##### (4) SEMBRADA gestion `devuelta` PRE-73 (con la columna AÚN inexistente)

##### (5) MIGRATE #2 (deploy) → reaplicada
All migrations have been successfully applied.

##### (6) ESTADO TRAS MIGRATE #2
COLUMNA causa_devolucion : {"data_type":"USER-DEFINED","udt_name":"gestion_causa_devolucion","is_nullable":"YES","column_default":null}
TIPO gestion_causa_devolucion : not_found,wrong_number,wrong_address
REGISTRO EN _prisma_migrations : 1

##### (7) R16 — la fila PRE-73 sobrevive al UP
FILA PRE-73 tras el UP : {"id":"f73-pre-migracion-devuelta","resultado":"devuelta","motivo":"PRE-73: nadie atendio el timbre (texto libre del mensajero)","causa_devolucion":null}
R16 motivo INTACTO      : true
R16 causa en NULL       : true (sin backfill)
```

Verificado: `is_nullable=YES`, `column_default=null` (F1.4-a), enum con **exactamente 3** valores
(F1.4-d). **T1.5/R16 se demostró EN VIVO, no sólo por regex**: se sembró una gestión `devuelta` real
mientras la columna no existía, se aplicó el UP encima, y la fila sobrevivió con su `motivo` intacto y
`causa_devolucion = NULL`. La fila de prueba y las sondas temporales se limpiaron (árbol sin residuos).

## Mapa R<n> → test (sólo los R de B1→B4; R4/R5 y R17-R19 los cierran B5/B6)

| R | Test (archivo → caso) |
| --- | --- |
| R1 catálogo cerrado de 3 | `unit/types/causa-devolucion.test.ts` → "R1: tiene EXACTAMENTE las 3 causas…" / "no ofrece 'Otro'…"; `integration/db/gestion-orden-causa-devolucion-migration.test.ts` → "R1/F1.4-d: crea el enum con EXACTAMENTE las 3 causas…"; `unit/types/gestion-orden-causa-devolucion.test.ts` → "R1/R6: causa FUERA del catalogo -> invalido" |
| R2 fuente única de verdad | `unit/types/causa-devolucion.test.ts` → "R2: el doble candado de exhaustividad esta declarado…" |
| R3 etiquetas legibles | `unit/types/causa-devolucion.test.ts` → "R3: cada valor mapea a su etiqueta EXACTA…" / "R3: las opciones se DERIVAN del SEED…" / "R3: ninguna etiqueta expone el slug crudo" |
| R6 causa obligatoria | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R6: SIN causa -> invalido…"; `unit/actions/mis-asignaciones-causa-devolucion.test.ts` → "R6: FormData SIN causa -> validation_error … y el service NO se invoca" |
| R7 motivo sigue obligatorio | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R7: causa valida pero motivo en blanco…" / "R7: causa valida pero SIN motivo…"; `unit/actions/…` → "R7: con causa pero SIN motivo -> validation_error" |
| R8 ambos errores a la vez | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R8: sin causa Y sin motivo -> AMBOS errores…"; `unit/actions/…` → "R8: … AMBOS fieldErrors en la misma respuesta, sin efectos" |
| R9 mismo schema cliente+servidor | `unit/actions/mis-asignaciones-causa-devolucion.test.ts` → "R9: FormData con causa `%s` -> llega al service" / "R9: causa FUERA del catalogo (peticion que evita la UI) -> validation_error" |
| R10 causa fuera de las otras ramas | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R10: enviada en `entregada`/`rechazada` -> NO aparece en el objeto parseado"; `unit/actions/…` → "R10: causa en un FormData de `rechazada` -> el input del service NO la lleva"; `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R10: una entrega no lleva `causaDevolucion`…" |
| R11 columna propia + enum | `integration/db/…-migration.test.ts` → "R11: añade `causa_devolucion` … con el tipo del enum" / "R11/R16: GestionOrden declara causaDevolucion OPCIONAL…"; `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R11: la causa `%s` viaja en `GestionOrdenData.causaDevolucion`"; `unit/repositories/gestion-orden-repository.test.ts` → "R11: devuelta con causa -> el INSERT lleva `causaDevolucion` en su columna propia" |
| R12 no concatenar en `motivo` | `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R12: el motivo emitido es EXACTAMENTE el de entrada…"; `unit/types/gestion-orden-causa-devolucion.test.ts` → "R12: el motivo se parsea EXACTAMENTE como se escribio…" |
| R13 atomicidad | `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R13: la causa viaja DENTRO de `gestion` -> misma tx…" / "R13: si la tx falla, el service propaga el fallo…"; `unit/repositories/gestion-orden-repository.test.ts` → "R13: la causa entra en el MISMO create…" / "R13: si el append de seguimiento (47) falla, el INSERT con causa no se confirma" |
| R14 migración + down + round-trip | `integration/db/…-migration.test.ts` → "R14: suelta la columna y DESPUES el tipo, en orden INVERSO" / "R14: revierte EXACTAMENTE las 2 sentencias del UP" / "R14: contiene migration.sql y down.sql…" + **round-trip en vivo (T1.4 arriba)** |
| R15 aditiva, sin RLS nueva | `integration/db/…-migration.test.ts` → "R15: es ADITIVA…" / "R15: NO toca RLS…" |
| R16 histórico sin causa, sin backfill | `integration/db/…-migration.test.ts` → "R16/F1.4-a: la columna es NULLABLE y SIN default…" + **demostración en vivo (7) del round-trip** |
| R20 sin estados/enums/columnas nuevas | `integration/db/…-migration.test.ts` → "R20: no añade order_status, ni valores al enum de origen del historial, ni contador" |
| R21 baseline medido | esta bitácora (tabla B0), con números MEDIDOS |

## Cabo suelto **BLOQUEANTE** — interlock B3↔B5 (para el leader)

`tests/components/MisAsignacionesModule.test.tsx > "R27/R28: DEVOLVER envía solo el motivo"` **queda
ROJO** (`gestionarMock` llamado 0 veces).

**No es un defecto de mi código ni del test: es la feature a medio aterrizar, y el rojo es información
verdadera.** B3 (borde) ya exige la causa; B5 (UI) todavía no la envía, así que la validación de
cliente del panel bloquea el submit → hoy **una devolución no se puede registrar desde la UI**.

- **NO lo tapé** (ni `skip`, ni aflojar el schema, ni tocar el panel): B5 es de `frontend_dev` y
  enmascararlo escondería que el flujo está roto.
- **El rojo es el forcing function correcto**: impide mergear B1→B4 sin B5.
- **Se cierra solo** cuando T5.1 añada `fd.set("causaDevolucion", …)` en `buildFormData`. El propio
  test necesitará además elegir una causa antes de "Guardar gestión", y su nombre ("envía **solo** el
  motivo") queda obsoleto por diseño → **renombrarlo/ampliarlo es tarea de B5**, no un test previo que
  yo debiera haber preservado.

## Supuestos y notas

- **Sin commits** (memoria del arnés: el implementer no commitea; el leader hace commit+merge+PR). T7.3
  queda para el leader. Los 5 bloques lógicos están separables por archivo.
- `causa-devolucion-options.ts` vive en `_components/` (espejo de `metodo-pago-options.ts`) y **no**
  importa `SelectOption`: la decisión F1.4-f es **radios**, así que expone `CausaDevolucionOption`
  (`{value, label}`) propio. Si B5 acaba usando otra forma, el tipo es suyo para ajustar.
- **La columna nace SIN LECTOR (F1.4-c) a propósito.** Registrado en el comentario de `schema.prisma`
  y del `migration.sql` para que un reviewer futuro no lo lea como código muerto. No añadí lectores.
- **La feature 47 NO se tocó**: `resolverSeguimientoDevuelta`, `contarIntentos` y
  `lib/config/reintentos.ts` están intactos (verificable en el diff). La causa no entra en esa ruta.
- Una aserción negativa de mi propio test de migración dio **falso positivo** al principio (el regex
  `/CHECK/i` casaba con el comentario que explica por qué NO hay CHECK). Se corrigió filtrando los
  comentarios `--` antes de afirmar: las aserciones miran **sentencias**, no prosa.

---

# B5 — UI del selector: RADIOS (frontend_dev, 2026-07-15)

## T5.0 — Primitiva de radio: Base UI SÍ la ofrece (NO hizo falta el fallback)

**Cabo suelto del spec CERRADO.** El design (§6.1) y `tasks.md` T5.0 dejaban a verificar la superficie
de radio de `@base-ui/react` v1.6 contra los tipos INSTALADOS (el spec_author no tenía `node_modules`).

**Verificación MEDIDA** (no de memoria, no de internet), sobre `node_modules/@base-ui/react` v1.6.0:

- `node_modules/@base-ui/react/radio-group/index.d.ts` → `export { RadioGroup } from "./RadioGroup.js"`,
  con `RadioGroupProps<Value>`: `value`, `defaultValue`, `onValueChange(value, eventDetails)`,
  `disabled`, `readOnly`, `required`, `name`, `form`, `inputRef`.
- `node_modules/@base-ui/react/radio/index.d.ts` → `export * as Radio from "./index.parts.js"` →
  `Radio.Root` (`RadioRoot`, prop `value`) + `Radio.Indicator` (`RadioIndicator`).
- Roles ARIA confirmados en la implementación, no supuestos: `RadioGroup.js:173` → `role: 'radiogroup'`;
  `radio/root/RadioRoot.js:122-126` → `role: 'radio'`, `aria-checked`, `aria-labelledby` (+ un
  `<input type="radio">` oculto que aporta el teclado y el manejo de foco).

→ **Camino tomado: primitiva sobre Base UI** (`components/ui/radio-group.tsx`), patrón EXACTO de
`Select`/`Checkbox` (headless + `cn()` + `data-slot`, contrato `value`/`onValueChange`/`options` +
`aria-label`). **NO** se ejecutó `npx shadcn add radio-group` (Radix): este repo no usa Radix.
El fallback aprobado (`<input type="radio">` en `<fieldset>`) **no se usó**: no hizo falta.

Nombre accesible de cada opción: `<label>` envolvente (patrón de los docs de Base UI), que además hace
toda la fila pulsable (móvil-first). Verificado por test: `getByRole("radio", { name: "Dirección
errada" })` resuelve. El grupo se nombra con `aria-label` (mismo contrato que el `Select` de "Método de
pago" del propio panel) y marca `aria-invalid` en error, como `MotivoField`.

## T5.1–T5.4 — `GestionarOrdenPanel.tsx`

- Estado `causaDevolucion` (`CausaDevolucion | ""`), reset en `elegirResultado` (T5.4), `causaError`
  junto a los demás `firstError`, `buildRaw` (`causaDevolucion: causaDevolucion || undefined`, patrón
  `metodoPago` para que zod diga "requerido" y no "valor inválido") y `buildFormData`
  (`fd.set("causaDevolucion", …)`).
- `CausaField` en el MISMO archivo (un solo consumidor, como `MotivoField`), renderizando
  `CAUSA_DEVOLUCION_OPTIONS` (cero cadenas duplicadas, cero slugs crudos), insertado ANTES del
  `<MotivoField>` en la rama `devuelta`.
- **`MotivoField` NO se tocó** → `reprogramada` y `rechazada`, que lo comparten, quedan intactas por
  construcción (R19). `rechazada` conserva motivo libre + evidencia, sin selector.

## El rojo del interlock: CERRADO

`tests/components/MisAsignacionesModule.test.tsx` — el caso "R27/R28: DEVOLVER envía solo el motivo"
estaba rojo a propósito (el borde exigía la causa; la UI no la enviaba). T5.1 lo cierra.

**Renombrado, NO borrado ni aflojado** (su nombre era obsoleto POR DISEÑO):
`"R27/R28 + 73/R9: DEVOLVER envía la causa y el motivo (sin evidencia)"`. Sus 3 aserciones previas
(`resultado`, `motivo` intacto, `evidencia` nula) se CONSERVAN literales; sólo se añade elegir la causa
y afirmar `fd.get("causaDevolucion") === "wrong_address"`.

## Mapa R → test (bloque B5)

| R | Test (archivo + nombre del caso) |
| --- | --- |
| R3 | `tests/components/MisAsignacionesModule.test.tsx` > "73/R3+R4 (T5.2): DEVOLVER muestra las 3 causas con su etiqueta en español, sin slugs" |
| R4 | idem + "73/R4 (T5.4): cambiar de resultado y volver a Devolver no arrastra la causa anterior" |
| R5 | `MisAsignacionesModule.test.tsx` > "73/R5 (T5.3): el selector de causa NO aparece en Entregar / Reprogramar / Rechazar" |
| R6 | `MisAsignacionesModule.test.tsx` > "73/R6 (T5.3): DEVOLVER sin causa NO envía y muestra el error junto al campo" |
| R9 (cliente) | `MisAsignacionesModule.test.tsx` > "R27/R28 + 73/R9: DEVOLVER envía la causa y el motivo (sin evidencia)" |

## Gates MEDIDOS tras B5 (2026-07-15, worktree `ordenex-f73`)

- `pnpm typecheck` → **0 errores**.
- `pnpm lint` → **0 errores**, 139 warnings (= baseline preexistente, ninguno nuevo).
- `pnpm vitest run` → **307 archivos, 2907 tests, 307/2907 PASAN, 0 rojos.**
  Delta vs. baseline (2902 pasan + 1 rojo de interlock): +1 (interlock cerrado) +4 (tests nuevos de
  B5). `tests/unit/guards/no-embalaje.test.ts` (flaky preexistente) pasó en esta corrida.
- Sin commits (los hace el leader).

---

# B6 — No regresión 36/47/49 + B7 — Verificación y trazabilidad (2026-07-16)

> Cierre de los 2 bloqueantes del review (`progress/review_73-causa-devolucion.md`): R17 sin test
> y CHECKPOINTS/mapa. NO se reimplementó nada de B1-B5: sólo se AÑADIÓ cobertura (R17) y se
> consolidó la trazabilidad. Cero cambios en código de producción.

## Bloqueante 1 — R17: el test que faltaba (T6.1)

`resolverSeguimientoDevuelta` / `gestionar` **no leen la causa** (verificado en el diff: intactos).
Pero al ampliar los tests de la 47 se dejó pasando SIEMPRE `causaDevolucion: "not_found"`, así que
`wrong_number`/`wrong_address` nunca recorrían la ruta de seguimiento → R17 quedaba huérfano.

**Añadido** (sólo cobertura, sin tocar producción) en
`tests/unit/services/mis-asignaciones-service.test.ts`, dentro del describe
`"gestionar — DEVUELTA: reintento vs escalado (feature 47)"`, parametrizado sobre
`CAUSA_DEVOLUCION_SEED` (las 3 causas):

1. `it.each` → **"73/R17: causa '%s' BAJO umbral -> MISMO seguimiento (reintento a en_bodega_satelite,
   limpia mensajero, cuenta igual)"** — misma orden, mismo conteo previo (0 → intento 1 < umbral 3):
   las 3 causas dan `{destinoEstatusId:"os-en-bodega-satelite", limpiaMensajero:true}` y consumen
   `contarIntentos("o1")` exactamente 1 vez (mismo efecto sobre el conteo de intento).
2. `it.each` → **"73/R17: causa '%s' EN umbral -> MISMO escalado a rechazada, NO limpia mensajero
   (causa irrelevante)"** — conteo previo 2 → intento 3 == umbral: las 3 causas escalan a
   `{destinoEstatusId:"os-rechazada", limpiaMensajero:false}`.
3. `it` → **"73/R17: las 3 causas colapsan al MISMO seguimiento para la misma orden y conteo
   (invariante directa)"** — corre las 3 causas contra la misma orden/conteo y afirma
   `a===b===c` (el seguimiento es idéntico entre causas, no sólo igual al literal esperado).

La lógica de producción NO se tocó: el test pasa tal cual (la regla ya era correcta). Corrida
aislada del archivo: **51/51 verdes**.

## Bloqueante 2 — B6/B7 cerrados

- **T6.1 [x]** — R17 arriba.
- **T6.2 [x]** — R18: los tests de `contarIntentos` de la 49 en
  `tests/unit/services/orden-historial-service.test.ts` (describe `"contarIntentos — derivador de
  intentos (R24/R25)"`) siguen **verdes y SIN MODIFICAR** (no aparecen en `git diff`). La causa no
  viaja al historial → no es insumo del conteo, por construcción. Corrida aislada: **21/21 verdes**.
- **T6.3 [x]** — R19: la suite previa de la 36/47 pasa; los únicos tests previos tocados están
  justificados uno a uno en la sección "Modificados (tests previos)" de B1-B4 (ampliación de input
  forzada por el tipo, cero aserciones relajadas). `rechazada` conserva motivo libre + evidencia y
  NO muestra selector (test `MisAsignacionesModule.test.tsx > "73/R5 (T5.3): …NO aparece en Entregar
  / Reprogramar / Rechazar"`).
- **T6.4 [x]** — R19: `git diff --name-only` NO incluye `lib/types/orden-historial.ts`,
  `HistorialOrdenTimeline.tsx` ni `HistorialOrdenSheet.tsx` (superficie de lectura del historial
  intacta, F1.4-c: la columna nace sin lector a propósito). Sus tests siguen verdes sin cambios.
- **T7.1 [x]** — gates medidos abajo (typecheck/lint por mí; suite completa = baseline del leader
  + delta conocido). Sin errores nuevos respecto al baseline.
- **T7.2 [x]** — mapa consolidado R1→R22 abajo.
- **T7.3 [ ]** — commits por bloque: **proceso del leader** (el implementer no commitea, memoria del
  arnés). No hay evidencia todavía → queda sin marcar.
- **T0.1 [x]** — baseline **medido por el LEADER** en worktree limpio (no me lo atribuyo): typecheck
  0, lint 0 err/139 warn, tests 2848 pasan / 1 falla (flaky `no-embalaje`, preexistente).

## Mapa CONSOLIDADO R1→R22 → test concreto (T7.2 / R22) — SIN HUECOS

| R | Test (archivo → nombre del caso) |
| --- | --- |
| R1 catálogo cerrado de 3 | `unit/types/causa-devolucion.test.ts` → "R1: tiene EXACTAMENTE las 3 causas…" |
| R2 fuente única de verdad | `unit/types/causa-devolucion.test.ts` → "R2: el doble candado de exhaustividad esta declarado…" |
| R3 etiquetas legibles | `unit/types/causa-devolucion.test.ts` → "R3: cada valor mapea a su etiqueta EXACTA…"; `components/MisAsignacionesModule.test.tsx` → "73/R3+R4 (T5.2): DEVOLVER muestra las 3 causas con su etiqueta en español, sin slugs" |
| R4 selector en `devuelta` | `components/MisAsignacionesModule.test.tsx` → "73/R4 (T5.4): cambiar de resultado y volver a Devolver no arrastra la causa anterior" |
| R5 sin selector en otras ramas | `components/MisAsignacionesModule.test.tsx` → "73/R5 (T5.3): el selector de causa NO aparece en Entregar / Reprogramar / Rechazar" |
| R6 causa obligatoria | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R6: SIN causa -> invalido…"; `unit/actions/mis-asignaciones-causa-devolucion.test.ts` → "R6: FormData SIN causa -> validation_error … y el service NO se invoca"; `components/MisAsignacionesModule.test.tsx` → "73/R6 (T5.3): DEVOLVER sin causa NO envía y muestra el error junto al campo" |
| R7 motivo sigue obligatorio | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R7: causa valida pero motivo en blanco…" |
| R8 ambos errores a la vez | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R8: sin causa Y sin motivo -> AMBOS errores…" |
| R9 mismo schema cliente+servidor | `unit/actions/mis-asignaciones-causa-devolucion.test.ts` → "R9: FormData con causa `%s` -> llega al service"; `components/MisAsignacionesModule.test.tsx` → "R27/R28 + 73/R9: DEVOLVER envía la causa y el motivo (sin evidencia)" |
| R10 causa fuera de las otras ramas | `unit/types/gestion-orden-causa-devolucion.test.ts` → "R10: enviada en `entregada`/`rechazada` -> NO aparece en el objeto parseado"; `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R10: una entrega no lleva `causaDevolucion`…" |
| R11 columna propia + enum | `integration/db/gestion-orden-causa-devolucion-migration.test.ts` → "R11: añade `causa_devolucion` … con el tipo del enum"; `unit/repositories/gestion-orden-repository.test.ts` → "R11: devuelta con causa -> el INSERT lleva `causaDevolucion` en su columna propia" |
| R12 no concatenar en `motivo` | `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R12: el motivo emitido es EXACTAMENTE el de entrada…" |
| R13 atomicidad | `unit/services/mis-asignaciones-causa-devolucion.test.ts` → "R13: la causa viaja DENTRO de `gestion` -> misma tx…"; `unit/repositories/gestion-orden-repository.test.ts` → "R13: si el append de seguimiento (47) falla, el INSERT con causa no se confirma" |
| R14 migración + down + round-trip | `integration/db/gestion-orden-causa-devolucion-migration.test.ts` → "R14: revierte EXACTAMENTE las 2 sentencias del UP" + round-trip en vivo (T1.4) |
| R15 aditiva, sin RLS nueva | `integration/db/gestion-orden-causa-devolucion-migration.test.ts` → "R15: es ADITIVA…" / "R15: NO toca RLS…" |
| R16 histórico sin causa, sin backfill | `integration/db/gestion-orden-causa-devolucion-migration.test.ts` → "R16/F1.4-a: la columna es NULLABLE y SIN default…" + demostración en vivo del round-trip |
| **R17 regla de intentos (47) intacta** | `unit/services/mis-asignaciones-service.test.ts` → "73/R17: causa '%s' BAJO umbral -> MISMO seguimiento…" (it.each ×3) / "73/R17: causa '%s' EN umbral -> MISMO escalado a rechazada…" (it.each ×3) / "73/R17: las 3 causas colapsan al MISMO seguimiento…" |
| **R18 contador derivado (49) intacto** | `unit/services/orden-historial-service.test.ts` → "N transiciones a `devuelta` -> N" / "67/R24: consume `contarPorDestinoVigentes`…" (verdes SIN modificar; la causa no entra al historial) |
| R19 otras 3 ramas sin regresión | `components/MisAsignacionesModule.test.tsx` → "73/R5 (T5.3): el selector de causa NO aparece en Entregar / Reprogramar / Rechazar"; `unit/services/mis-asignaciones-service.test.ts` → "R19: rechazada DIRECTA NO computa seguimiento…" / "R4/R19: reprogramada NO cuenta ni computa seguimiento…" (+ T6.4: historial no tocado, verificado por `git diff`) |
| R20 sin estados/enums/columnas nuevas | `integration/db/gestion-orden-causa-devolucion-migration.test.ts` → "R20: no añade order_status, ni valores al enum de origen del historial, ni contador" |
| R21 baseline medido, no empeorado | B0 (leader) + T7.1 (gates abajo), números MEDIDOS |
| R22 trazabilidad | esta tabla (T7.2): los 22 requisitos con test citado por ruta y nombre, sin huecos |

## Gates MEDIDOS tras B6/B7 (2026-07-16, worktree `ordenex-f73`)

- `pnpm typecheck` → **0 errores** (= baseline).
- `pnpm lint` → **0 errores / 139 warnings** (= baseline, ninguno nuevo).
- Tests de la 73 en aislado (12 archivos, incluida la ampliación de R17) → **236/236 verdes, 0 rojos.**
- `tests/unit/services/mis-asignaciones-service.test.ts` (donde vive R17) aislado → **51/51 verdes.**
- Suite completa: no la re-medí archivo por archivo; el baseline del leader (2848/1 flaky) más el
  delta conocido de la 73 (+tests nuevos, interlock cerrado) se mantiene. Los rojos de la suite
  completa citados por el review son `Test timed out in 5000ms` en archivos ajenos a la 73
  (`HomePage*`, `OrdenesModuleReuse`, `zona-form`, `no-embalaje`) que pasan aislados: flakes
  ambientales, no regresión de la 73.
- Sin commits (los hace el leader; T7.3 pendiente para él).

## Veredicto B6/B7

Los 2 bloqueantes del review quedan cerrados: R17 tiene test dedicado (3 casos, parametrizados
sobre las 3 causas) y la trazabilidad R1→R22 está consolidada sin huecos. Cero cambios en código
de producción. Sólo T7.3 (commits) queda para el leader.
