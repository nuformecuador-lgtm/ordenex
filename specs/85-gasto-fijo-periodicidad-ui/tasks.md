# Ficha 85 — Periodicidad y día de cobro del gasto fijo en la UI · tasks

> Secuencia obligatoria: **backend → frontend** (la ficha es `fullstack`). `[P]` = puede ir en
> paralelo con las tareas marcadas igual dentro de su misma fase.
> Regla del gate: los subagentes corren `pnpm typecheck`, `pnpm lint` y
> `pnpm exec vitest related --run <sus archivos>`. **La suite completa la corre el leader.**

## Fase 0 — preparación

- [ ] **T0.1** Rama `feature/85-gasto-fijo-periodicidad-ui` desde `origin/dev`.
  *Hecho cuando:* `git status` limpio sobre la rama nueva y `git log origin/dev..HEAD` vacío.
- [ ] **T0.2** Confirmar en el árbol real (no en el grafo) que siguen existiendo
  `periodicidadFields` (`lib/types/gasto-fijo-plantilla.ts:36`), `aplicaHoy`/`periodoDe`
  (`lib/utils/periodicidad.ts`) y las tres columnas en `db/schema.prisma:1836-1849`.
  *Hecho cuando:* los tres símbolos están citados con archivo y línea en `progress/impl_85.md`.

---

## Fase B — backend (`backend_dev`)

- [ ] **B1** [P] **Borde de actualizar sin defaults** (`lib/types/gasto-fijo-plantilla.ts`).
  Partir `periodicidadFields` en reglas de campo declaradas una vez + dos aplicaciones
  (`periodicidadConDefault` para crear, `periodicidadRequerida` para actualizar vía `.extend`), y
  añadir `.refine(esFechaCalendarioValida)` a `fechaCobro` (design §2.1/§2.4). Actualizar el
  comentario de cabecera del bloque: hoy dice que la UI «todavía NO envía periodicidad», y con la
  85 deja de ser cierto.
  *Depende de:* T0.2. *Hecho cuando:* `pnpm typecheck` verde y, en un REPL o test temporal,
  `actualizarGastoFijoPlantillaSchema.safeParse({id, concepto, monto})` es `success: false` con
  las tres claves en `error.flatten().fieldErrors`, mientras `crearGastoFijoPlantillaSchema.parse({concepto, monto})`
  sigue devolviendo `meses`/`1`/hoy.
  *No toca:* servicio, repositorio, interfaces, migraciones.

- [ ] **B2** [P] **`proximoCobro` puro** (`lib/utils/periodicidad.ts`).
  Añadir la función descrita en design §3: `proximoCobro(plantilla: PlantillaPeriodica, now: Date): string`,
  reutilizando `startOfDayCR`, `diffEnDias`, `diffEnMeses` y `ultimoDiaDelMes` que ya viven en el
  módulo. Sin Prisma, sin HTTP, sin `Date.now()`.
  *Depende de:* T0.2. *Hecho cuando:* exportada, `pnpm typecheck` verde y el módulo sigue sin
  importar nada fuera de `lib/utils/fecha-cr`.

- [ ] **B3** **Tests del borde** — `tests/unit/types/gasto-fijo-plantilla-schema.test.ts` (nuevo).
  Cubre **R4** (crear sin ciclo → `meses`/`1`/fecha CR, con `vi.setSystemTime(new Date("2026-03-15T18:00:00.000Z"))`
  y el literal `"2026-03-15"` esperado — **nunca** comparado contra `fechaCalendarioCR()`), **R5**
  (`2026-02-31` rechazada al crear y al actualizar) y **R6** (cantidad `0`, cantidad `1.5`, unidad
  `"anual"`).
  *Depende de:* B1. *Hecho cuando:* los tres casos pasan y cada uno falla si se revierte B1.

- [ ] **B4** **Test de la acción** — `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts`.
  (a) Caso nuevo **R1**: `actualizarPlantillaAction({ id, concepto, monto })` → `status: "validation_error"`
  con `fieldErrors.periodicidadUnidad`, `.periodicidadCantidad` y `.fechaCobro` presentes, y
  `service.actualizarPlantilla` **no** llamado.
  (b) Arreglar el caso existente «not_found se propaga desde el service» (líneas 130-137), que hoy
  manda el payload corto y a partir de B1 moriría antes en el borde: completarlo con el ciclo.
  *Depende de:* B1. *Hecho cuando:* el archivo entero pasa y (a) se pone rojo si se devuelven los
  defaults al schema de actualizar.

- [ ] **B5** **Test de servicio — persistencia del ciclo (R2)** —
  `tests/unit/services/gasto-fijo-plantilla-service.test.ts`.
  Doble de repositorio **con estado**: siembra una plantilla con `periodicidadUnidad: "semanas"`,
  `periodicidadCantidad: 2`, `fechaCobro: "2026-03-31"`; se llama `actualizarPlantilla` con ese
  mismo ciclo y `monto: "999.00"`; se comprueba con **literales** que la fila guardada sigue en
  `"semanas"`, `2`, `"2026-03-31"` y que el monto es `"999.00"`.
  *Los literales están elegidos a propósito:* ninguno coincide con los defaults del schema
  (`meses`/`1`/hoy), así que el test no puede estar verde por construcción.
  *Depende de:* B1. *Hecho cuando:* pasa, y falla si el doble escribe `meses`/`1`/hoy.

- [ ] **B6** [P] **Tests de `proximoCobro`** — `tests/unit/utils/periodicidad-proximo-cobro.test.ts` (nuevo).
  Cubre **R7-R12**: las cuatro periodicidades del pedido con fechas literales; antes del ancla
  (R8); hoy dispara → hoy (R9); ancla 31 → `2026-02-28`, `2028-02-29`, `2026-04-30` (R10);
  **barrido diferencial** de 400 días contra `aplicaHoy` (R11); dos instantes del mismo día CR
  (`06:00Z` y `23:00Z`) dan el mismo resultado (R12).
  *Depende de:* B2. *Hecho cuando:* pasan los seis bloques y el barrido recorre de verdad los 400
  días (se asevera el número de días evaluados, para que un bucle vacío no reporte verde).

- [ ] **B7** **Autocomprobación de las guardias (obligatoria, no opcional).**
  Mutar a mano y de forma temporal el borde —devolver `.default("meses")` a
  `actualizarGastoFijoPlantillaSchema`— y comprobar que **B4(a) y B5 se ponen ROJOS**; revertir la
  mutación. Repetir con `proximoCobro` devolviendo siempre el ancla y comprobar que B6 enrojece.
  *Depende de:* B4, B5, B6. *Hecho cuando:* `progress/impl_85.md` recoge las dos salidas rojas
  (con el nombre del test que cayó) y el árbol queda revertido —`git diff` no muestra la mutación—.
  *Motivo:* en este repo ya hubo un arnés de mutaciones que reportó supervivientes sin haber
  ejecutado un solo test.

- [ ] **B8** **Corrida acotada del backend.**
  *Depende de:* B7. *Hecho cuando:* `pnpm typecheck`, `pnpm lint` y
  `pnpm exec vitest related --run lib/types/gasto-fijo-plantilla.ts lib/utils/periodicidad.ts`
  terminan en verde, con la salida pegada en `progress/impl_85.md`.

- [ ] **B9** **Comprobación de alcance.**
  *Depende de:* B8. *Hecho cuando:* `git diff --name-only origin/dev...HEAD` no contiene
  `db/migrations/`, `db/schema.prisma`, `vercel.json`, `lib/services/GeneracionGastosFijosService.ts`
  ni `lib/repositories/GastoFijoPlantillaRepository.ts`.

---

## Fase F — frontend (`frontend_dev`)

> Arranca con la fase B completa **en la rama** (no en paralelo: el diálogo depende del contrato
> nuevo y el panel de `proximoCobro`).

- [ ] **F1** [P] **Etiquetas** (`app/(app)/wallet/_components/wallet-labels.ts`) + su test
  `tests/unit/components/wallet-periodicidad-labels.test.ts` (nuevo, **R20**).
  Añadir `PERIODICIDAD_PRESETS`, `periodicidadLegible`, `presetDePeriodicidad` y
  `proximoCobroTexto` (design §4.2). Módulo puro: sin React, sin `Intl`, sin leer ningún reloj —el
  instante entra por parámetro—.
  *Depende de:* B2. *Hecho cuando:* el test fija con **literales** «Diaria», «Semanal»,
  «Quincenal», «Mensual», «Cada 3 días», «Cada 6 meses» (no derivados de la tabla de presets), y
  `proximoCobroTexto` devuelve «No se cobra» para una plantilla inactiva.

- [ ] **F2** **Diálogo** (`GastoFijoPlantillaDialog.tsx`) + `tests/unit/components/wallet-gasto-fijo-plantilla-dialog.test.tsx` (nuevo).
  Controles de periodicidad y fecha (design §4.3), siembra al editar, envío de los cinco campos,
  mapeo de `fieldErrors` de los campos nuevos, textos sin «cada mes», etiqueta del monto → «Monto».
  Cubre **R3, R13, R14, R15, R16, R17, R24**.
  *Depende de:* B1, F1. *Hecho cuando:* pasan todos los casos y **en particular la guardia R3**:
  abrir en modo editar una plantilla `semanas`/`2`/`2026-03-31`, cambiar **solo** el monto a
  `"999.00"`, guardar, y aseverar que `actualizarPlantillaAction` recibió exactamente
  `{ id, concepto, monto: "999.00", periodicidadUnidad: "semanas", periodicidadCantidad: 2, fechaCobro: "2026-03-31" }`.
  Los tres valores del ciclo van escritos como literales en la aserción; **no** se comparan contra
  los defaults del schema ni contra la propia plantilla de entrada por spread.

- [ ] **F3** **Panel** (`GastosFijosPlantillasPanel.tsx`) + casos nuevos en
  `tests/unit/components/wallet-gastos-fijos-panel.test.tsx`.
  Prop `ahoraIso: string` **requerida**, columnas «Periodicidad» y «Próximo cobro», encabezado
  «Monto», descripción de la tarjeta y avisos de activar/desactivar sin «cada mes».
  Cubre **R18, R19, R22, R23**.
  *Depende de:* F1. *Hecho cuando:* el test monta el panel con `ahoraIso` de un día conocido y
  asevera la fecha esperada de próximo cobro; una plantilla inactiva muestra «No se cobra»; y un
  caso barre los textos del panel comprobando que ninguno contiene «cada mes».

- [ ] **F4** **Cadena de props** (`app/(app)/wallet/page.tsx` → `WalletModule.tsx` → panel).
  *Depende de:* F3. *Hecho cuando:* `pnpm typecheck` verde **sin** ningún `ahoraIso` opcional ni
  valor por defecto en la cadena (la inyección la garantiza el compilador, no la buena voluntad),
  y `page.tsx` resuelve el instante server-side.

- [ ] **F5** [P] **Archivo descargable** (`gastos-fijos-descarga-columnas.ts`) +
  `tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts`.
  Cinco columnas en el orden de la pantalla, `filaDescargaGastoFijo(plantilla, ahora)`, monto
  crudo, periodicidad con la misma etiqueta que la tabla, próximo cobro como `YYYY-MM-DD` y
  «No se cobra» en inactivas. Cubre **R21** y la parte de archivo de **R24**.
  *Depende de:* F1. *Hecho cuando:* el `toEqual` de claves y encabezados está **actualizado a
  mano** con los cinco literales nuevos (ese literal ES el contrato: se cambia deliberadamente,
  no se sustituye por una derivación de la propia constante) y el punto de llamada del panel pasa
  el mismo `ahora` que pinta la tabla.

- [ ] **F6** **Montajes existentes del panel.**
  Pasar `ahoraIso` en `tests/unit/components/wallet-gastos-fijos-panel.test.tsx`,
  `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx:666` y
  `tests/components/descarga/WalletPropsDescarga.test.tsx:223`; y actualizar en el primero los
  `getByLabelText("Monto mensual")` y el `/automáticamente cada mes/`.
  *Depende de:* F3, F4. *Hecho cuando:* los tres archivos pasan sin `@ts-expect-error` ni casts.

- [ ] **F7** [P] **Regresión de la regla del pedido (R25)** —
  `tests/unit/components/wallet-registrar-egreso-dialog.test.tsx`.
  Caso nuevo: el diálogo de egreso manual **no** ofrece ningún control de periodicidad ni de fecha
  de cobro (un variable no puede ser periódico). Sin código de producción nuevo.
  *Depende de:* nada de esta fase. *Hecho cuando:* el caso pasa y falla si se le añadiera un
  selector de periodicidad a ese diálogo.

- [ ] **F8** **Corrida acotada del frontend.**
  *Depende de:* F2, F3, F4, F5, F6, F7. *Hecho cuando:* `pnpm typecheck`, `pnpm lint` y
  `pnpm exec vitest related --run` sobre los archivos tocados terminan en verde, con la salida en
  `progress/impl_85.md`.

---

## Fase Z — cierre

- [ ] **Z1** `progress/impl_85.md` con: archivos tocados, mapa **R1-R25 → test** (los 25, ninguno
  vacío), salida real de las corridas y el resultado de la autocomprobación B7.
  *Hecho cuando:* el archivo existe **y está commiteado** (en este repo ya se perdió más de un
  informe por quedarse sin commitear).
- [ ] **Z2** (leader) `./init.sh` **completo** —el diff toca `lib/types/`, así que el modo rápido
  se niega solo—. *Hecho cuando:* termina en verde con el exit code capturado dentro del log.
- [ ] **Z3** (leader) Sincronizar con `origin/dev`, abrir PR hacia `dev` y reportar la URL.
  *Hecho cuando:* el PR existe y el blob de `specs/85-gasto-fijo-periodicidad-ui/` y de los
  archivos tocados está verificado en el remoto (no basta con que el árbol local lo muestre).

---

## Fuera de alcance (no abrir aquí)

Ficha 332 (borrar plantillas), ficha 333 (aprobación de cobros), ficha 334 (unificar diálogos de
movimiento), cualquier cambio de migración/enum/cron/clave de idempotencia, y `feature_list.json`
o `progress/current.md`, que los mantiene el leader.
