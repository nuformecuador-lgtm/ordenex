# tasks.md — enriquecer validación previa a la carga masiva (feature 29)

> Checklist discreta y verificable. `[P]` = paralelizable. Cada task indica los R
> que cubre, su criterio de "hecho" y su(s) test(s). Frontend puro: sin cambios en
> backend, DB, migraciones ni Server Actions.

## T0 — Puerta humana (RESUELTA)

- [x] **T0.1** Puerta F1.4 resuelta (2026-07-10). Decisiones firmes:
  **[RESUELTO-1]** opción A (frontend puro), B descartada; **[RESUELTO-2]** con
  `creadas===0` y `duplicadas>0` se AVANZA al resumen mostrando solo existentes;
  **[RESUELTO-3]** filas `error` se muestran con DETALLE por fila; **[RESUELTO-4]**
  estado como ETIQUETA legible (mapa nuevo en frontend, no existe reutilizable).
  **Hecho:** decisiones fijadas en `requirements.md` (Preguntas abiertas → Ninguna
  pendiente) y `design.md`. Sin preguntas pendientes.
  Depende de: —.

## T1 — Helper puro de clasificación del `BulkSummary` (R1, R2, R3, R15)

- [x] **T1.1** Crear `app/(app)/ordenes/_components/carga-masiva-clasificacion.ts`
  con `clasificarBulkSummary(data: unknown): ClasificacionCarga` y los tipos
  `OrdenExistente` / `OrdenConError` / `ClasificacionCarga` (ver design D2). Guards
  defensivos, sin `any`, sin lanzar. Refactorizar `extractNumRemisionesCreadas`
  para delegar (o reutilizar el mismo guard) sin cambiar su salida.
  **Hecho:** compila en strict; `data` no-objeto o `filas` no-array → tres grupos
  vacíos; separa `creada`/`duplicada`/`error`; `estatus` ausente → `null`; filas
  `error` conservan `fila`/`numRemision`/`errores` (`{}` si ausente).
  Cubre R1, R2, R3, R15.
  Depende de: T0.1.

- [x] **T1.2** `[P]` Test unitario del helper:
  `tests/components/CargaMasivaClasificacion.test.ts` (sin jsdom).
  Casos: mezcla creada/duplicada/error → tres grupos correctos; `result.data`
  malformado → tres grupos vacíos (`separa el resumen incluso con data desconocida`);
  fila `duplicada` sin `estatus` → `estatus: null` sin fallar; fila `error` sin
  `errores` → `errores: {}` conservando `fila`/`numRemision`.
  **Hecho:** tests verdes; mapea R1, R2, R3.
  Depende de: T1.1.

## T1b — Helper puro de etiqueta de estado (R17)

- [x] **T1b.1** `[P]` Crear `app/(app)/ordenes/_components/estatus-label.ts` con
  `estatusLabel(value): string` y el `Record<(typeof ORDER_STATUS_SEED)[number],
  string>` que cubre TODOS los `value` de `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`), importando el seed para anclar las claves (build
  rompe si falta uno). Fallback: `value` desconocido → value crudo; `null`/vacío →
  "—". Sin `any`. (Ver design D5.)
  **Hecho:** compila en strict; los 8 estados devuelven etiqueta legible.
  Cubre R17. Depende de: T0.1.

- [x] **T1b.2** `[P]` Test unitario `tests/components/EstatusLabel.test.ts` (sin
  jsdom): cada value de `ORDER_STATUS_SEED` → etiqueta esperada
  (`traduce todos los estados del seed`); value desconocido → devuelve el crudo
  (`cae al value crudo si el estado es desconocido`); `null`/`undefined` → "—".
  **Hecho:** tests verdes; mapea R17.
  Depende de: T1b.1.

## T2 — Sección de solo lectura de órdenes existentes (R4, R5, R6, R7)

- [x] **T2.1** Crear componente de la tabla de existentes (p. ej.
  `app/(app)/ordenes/_components/OrdenesExistentesTabla.tsx`) con
  `DataTable<OrdenExistente>`: columnas `numRemision` y estado renderizado con
  `estatusLabel(r.estatus)` (T1b), `rowKey="numRemision"`, `ariaLabel` accesible.
  Sin `Select`, sin botones, sin acciones. Encabezado textual "Órdenes ya
  existentes".
  **Hecho:** renderiza filas de solo lectura con etiqueta legible; no existe ningún
  control de recarga/asignación en el subtree. Cubre R5, R6.
  Depende de: T1.1, T1b.1.

- [x] **T2.2** Test de componente
  `tests/components/OrdenesExistentesTabla.test.tsx` (jsdom): renderiza
  `numRemision` + estado como **etiqueta legible** (p. ej. `en_preparacion` →
  "En preparación") (`muestra el estado como etiqueta legible`); verifica que NO
  hay botones/selects (`no ofrece ninguna accion de recarga sobre las existentes`);
  `estatus` ausente → "—".
  **Hecho:** tests verdes; mapea R5, R6 (y R17 en integración).
  Depende de: T2.1.

## T2b — Sección de solo lectura de órdenes con ERROR (R18, R19)

- [x] **T2b.1** Crear componente de la tabla de errores (p. ej.
  `app/(app)/ordenes/_components/OrdenesConErrorTabla.tsx`) con
  `DataTable<OrdenConError>`: columnas `fila`, `numRemision` y `motivo`
  (`formatErrores(errores)`; fallback genérico si vacío), `rowKey` estable, encabezado
  "Órdenes con error", variante visual de error. Sin acciones/recarga.
  **Hecho:** lista cada fila con error con su motivo legible; solo lectura.
  Cubre R18, R19. Depende de: T1.1.

- [x] **T2b.2** Test de componente
  `tests/components/OrdenesConErrorTabla.test.tsx` (jsdom): con varias filas error
  → aparece una fila por cada una con `fila`/`numRemision` y su motivo
  (`lista cada fila con error con su motivo`); `errores` vacío → motivo genérico
  (`muestra motivo generico si no hay detalle de errores`); sin controles de
  recarga.
  **Hecho:** tests verdes; mapea R18, R19.
  Depende de: T2b.1.

## T3 — Contenedor del paso "resumen" con las tres secciones (R4, R7, R8, R9, R10, R16, R18)

- [x] **T3.1** Crear/ajustar el contenedor del paso "resumen" (p. ej.
  `app/(app)/ordenes/_components/OrdenesCargaResumenPaso.tsx`) que recibe la
  `ClasificacionCarga` y compone: (1) `Alert` informativo con "N nuevas cargadas"
  y, si hay existentes, "M ya existían y no se recargan" (R7, R8); (2)
  `OrdenesCargaResumen` con `numRemisiones = numRemisionesNuevas` solo si hay
  nuevas (R9, R10); (3) `OrdenesExistentesTabla` solo si hay existentes (R4);
  (4) `OrdenesConErrorTabla` solo si hay errores (R18). NO modificar
  `OrdenesCargaResumen`, `DataTable`, `Modal`, `Select`, `Alert`, `useToast`,
  `BulkUpload` (R16).
  **Hecho:** las tres secciones se renderizan condicionalmente; `OrdenesCargaResumen`
  intacto; sin `any`. Cubre R4, R7, R8, R9, R10, R16, R18.
  Depende de: T1.1, T2.1, T2b.1.

- [x] **T3.2** Test de componente
  `tests/components/OrdenesCargaResumenPaso.test.tsx` (jsdom, mockeando las Server
  Actions de `lib/actions/mensajeros` como en `OrdenesCargaResumen.test.tsx`):
  con nuevas + existentes + errores → aparecen las tres secciones y el aviso
  explícito de que solo se cargan las nuevas (`deja claro que solo se cargan las
  nuevas`); la tabla de existentes y la de errores son de solo lectura; el `Select`
  de mensajero sigue presente en las nuevas (`conserva el select de mensajero por
  fila para las nuevas`).
  **Hecho:** tests verdes; mapea R4, R7, R8, R9, R10, R18.
  Depende de: T3.1.

## T4 — Integración en `OrdenesCargaMasivaButton` (R11, R12, R13)

- [x] **T4.1** Modificar `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx`:
  en `handleSuccess`, además de `parseResumen` (toast) y `mutate` (sin cambios,
  R13), llamar `clasificarBulkSummary(result.data)` y guardar la clasificación en
  estado. Avanzar a `step="resumen"` si hay nuevas O existentes O errores;
  permanecer en "upload" (solo toast) si los tres vacíos. Renderizar
  `OrdenesCargaResumenPaso` en el paso "resumen". Resetear el estado de
  clasificación al cerrar el modal.
  **Hecho:** flujo POST-COMMIT y toast/SWR sin regresión (R13); casos límite R11,
  R12 cubiertos según [RESUELTO-2]. Cubre R11, R12, R13.
  Depende de: T1.1, T3.1.

- [x] **T4.2** Actualizar/añadir tests en
  `tests/components/OrdenesCargaMasivaButton.test.tsx` (jsdom): (a) `creadas>0` y
  `duplicadas>0` → avanza a resumen con secciones de nuevas y existentes; (b)
  `creadas===0` y `duplicadas>0` → **avanza** al resumen mostrando solo existentes
  (`avanza al resumen y muestra solo las existentes sin nuevas`); (c) `creadas===0`,
  `duplicadas===0`, `conError===0` → permanece en upload con solo toast
  (`no muestra secciones vacias cuando no hay filas`); (d) toast y
  `mutate(["ordenes:list"])` siguen invocándose (`revalida la lista tras la carga`).
  **Hecho:** tests verdes; mapea R11, R12, R13; los tests preexistentes del botón
  siguen verdes.
  Depende de: T4.1.

## T5 — Verificación y trazabilidad (R14, R15, R16)

- [x] **T5.1** Verificación estática de alcance frontend puro: confirmar por diff
  que no hay cambios bajo `lib/actions/`, `lib/services/`, `lib/repositories/`,
  `app/api/`, `db/` (R14); búsqueda de `any` en los archivos nuevos = 0 (R15);
  ninguna primitiva (`DataTable`/`Modal`/`Select`/`Alert`/`useToast`/`BulkUpload`)
  modificada (R16).
  **Hecho:** `./init.sh` verde; `tsc --noEmit` sin errores; diff acotado a
  `app/(app)/ordenes/_components/` y `tests/components/`.
  Depende de: T1–T4.

- [x] **T5.2** Completar el mapa de trazabilidad `R<n> → test` en
  `progress/impl_29-validacion-carga-masiva.md`: cada R1..R19 apuntando a su test
  (o, para R14/R16, a la verificación de revisión de T5.1).
  **Hecho:** los 19 requisitos mapeados; el reviewer puede validar sin huecos.
  Depende de: T5.1.

## Mapa R → task/test (resumen)

| R | Task | Test / verificación |
| --- | --- | --- |
| R1 | T1.1 | T1.2 |
| R2 | T1.1 | T1.2 |
| R3 | T1.1 | T1.2 |
| R4 | T3.1 | T3.2 |
| R5 | T2.1 | T2.2 |
| R6 | T2.1 | T2.2 |
| R7 | T3.1 | T3.2 |
| R8 | T3.1 | T3.2 |
| R9 | T3.1 | T3.2 |
| R10 | T3.1 | T3.2 |
| R11 | T4.1 | T4.2 |
| R12 | T4.1 | T4.2 |
| R13 | T4.1 | T4.2 |
| R14 | T5.1 | revisión de diff |
| R15 | T1.1 | T5.1 (grep `any`) + tsc |
| R16 | T3.1 | T5.1 (revisión de primitivas) |
| R17 | T1b.1 | T1b.2 (+ T2.2 integración) |
| R18 | T2b.1, T3.1 | T2b.2, T3.2 |
| R19 | T2b.1 | T2b.2 |
