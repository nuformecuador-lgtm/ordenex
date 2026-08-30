# Ficha 334 — Un solo diálogo para mover dinero en la wallet · Tareas

> Orden por tandas. `[P]` = puede correr en paralelo con las demás `[P]` de su tanda.
> Cada task dice **cuándo está hecha**. Nada se da por hecho sin su criterio.
>
> **El gate rápido se va a negar solo** en esta ficha: el diff toca `lib/types/wallet.ts`
> (`lib/types/**`) y archivos con nombre de dinero. Es `fail`, no aviso (`docs/verification.md`).
> El cierre es con **`./init.sh` completo**.

---

## T0 — Preparación

- [ ] **T0.1 — Rama.** `git fetch origin dev && git checkout -b feature/334-movimiento-unificado-wallet origin/dev`.
  **Hecho:** la rama existe y `git log -1` coincide con `origin/dev`.
- [ ] **T0.2 — Base local al día.** `pnpm exec prisma migrate deploy` (no hay migración nueva en esta
  ficha; se corre para descartar una base rezagada de otra rama).
  **Hecho:** `prisma migrate status` dice «up to date» y nombra el host esperado.

---

## Tanda A — Borde: la fecha entra en los dos schemas

- [ ] **A1 — `fechaMovimientoSchema` en `lib/types/wallet.ts`.**
  Añade `esFechaMovimientoValida(value, now)` y `fechaMovimientoSchema` (design §8.1), reutilizando
  `esFechaCalendarioValida` y `fechaCalendarioCR` de `lib/utils/fecha-cr.ts`. No se promueve nada
  desde `lib/types/liquidacion.ts`.
  **Hecho:** `pnpm typecheck` verde y `tests/unit/types/wallet-fecha-movimiento-schema.test.ts`
  (T A2) pasa.

- [ ] **A2 [P] — Test del schema de fecha.** Nuevo `tests/unit/types/wallet-fecha-movimiento-schema.test.ts`:
  acepta hoy CR; rechaza mañana; rechaza `2026-02-31` (día inexistente, round-trip); rechaza
  `29-08-2026`; acepta una fecha pasada. Con `vi.useFakeTimers()` y **también** un caso a las 20:00
  de Costa Rica (02:00Z del día siguiente) que comprueba que «hoy» no se adelanta.
  **Hecho:** los cinco casos verdes; el caso de las 20:00 se pone ROJO si se sustituye
  `fechaCalendarioCR` por `toISOString().slice(0,10)` (comprobación manual del implementer, se anota
  en `progress/impl_334.md`).

- [ ] **A3 — `fecha` opcional en los dos schemas de registro.** `registrarMovimientoManualSchema` y
  `registrarEgresoAdministrativoSchema` ganan `fecha: fechaMovimientoSchema.optional()`.
  Depende de A1.
  **Hecho:** una entrada sin `fecha` sigue siendo válida (tests existentes de acciones verdes) y una
  con `fecha` futura devuelve `validation_error` con la clave `fecha`.

---

## Tanda B — Repositorio (depende de nada; puede ir en paralelo a la A)

- [ ] **B1 [P] — `id?: string` en `CrearMovimientoInput`.**
  `lib/interfaces/repositories/IWalletMovimientoRepository.ts` + `WalletMovimientoRepository.crearMovimientos`:
  la clave viaja **solo si el llamador la trae**, igual que `fechaMovimiento` (design §5).
  **Hecho:** test nuevo en `tests/unit/repositories/wallet-movimiento-repository.test.ts` que afirma
  que sin `id` la clave NO aparece en `createMany` y con `id` viaja tal cual; los cinco escritores
  existentes siguen sin pasarla.

- [ ] **B2 [P] — Orden total determinista en `listar`.**
  `orderBy: [{ fechaMovimiento: "desc" }, { createdAt: "desc" }, { id: "desc" }]` (design §4).
  **Hecho:** el literal de `wallet-movimiento-repository.test.ts:159` se reescribe con el **array
  completo** (no con `expect.anything()` ni derivándolo de la fuente) y queda verde.

- [ ] **B3 — La superficie del repositorio sigue siendo CINCO métodos.**
  Sin método nuevo (design §5, alternativa descartada).
  **Hecho:** `wallet-movimiento-repository.test.ts:284` («la superficie son CINCO métodos») verde
  sin tocar su lista.

---

## Tanda C — Servicios (depende de A3 y B1)

- [ ] **C1 — `WalletService.registrarMovimientoManual` acepta fecha y devuelve lo que creó.**
  `instanteDe(input.fecha)` (design §8.2) + `id = randomUUID()` + relectura con `obtenerPorId(id)`.
  **Hecho:** con `fecha` = hoy no viaja `fechaMovimiento`; con `fecha` = ayer viaja
  `${ayer}T06:00:00.000Z`; y con un movimiento MÁS RECIENTE de la misma categoría en el repo doble,
  el servicio devuelve **el suyo**, no el otro.

- [ ] **C2 — `WalletEgresoService.registrarEgreso`, idéntico.** Mismo tratamiento.
  **Hecho:** los mismos tres casos, en `tests/unit/services/wallet-egreso-service.test.ts`. Los
  dobles de repo existentes (`buildRepo`) ganan `obtenerPorId`; los casos actuales de la suite
  siguen verdes sin cambiar sus aserciones de payload (`toMatchObject` tolera el `id` nuevo).

- [ ] **C3 [P] — Bordes: la fecha inválida no llega al servicio.**
  Casos nuevos en `tests/unit/actions/wallet-actions.test.ts` y
  `tests/unit/actions/wallet-egresos-actions.test.ts`: `fecha` futura → `validation_error` **sin
  tocar el service**; `fecha` con día inexistente → `validation_error`.
  **Hecho:** los cuatro casos verdes y el espía del servicio con cero llamadas.

---

## Tanda D — Interfaz (depende de A3; puede empezar en paralelo a C)

- [ ] **D1 [P] — Catálogo de conceptos.** Nuevo
  `app/(app)/wallet/_components/wallet-conceptos-manuales.ts` con los cuatro conceptos, su destino
  (action + payload), su etiqueta de descripción y su placeholder (design §9). La columna «sale en el
  libro como» se **deriva** de `CATEGORIA_LABEL`; las etiquetas «Concepto del gasto» y «Trabajador y
  periodo» se conservan byte a byte.
  **Hecho:** `tests/unit/components/wallet-conceptos-manuales.test.ts` (T D2) verde.

- [ ] **D2 [P] — Test del catálogo.** Nuevo `tests/unit/components/wallet-conceptos-manuales.test.ts`:
  son exactamente cuatro; el conjunto de categorías destino es exactamente
  `{egreso_gasto_variable, egreso_sueldo, ingreso_ajuste, egreso_ajuste}`; **ninguno** mapea a
  `egreso_gasto_fijo` ni a ninguna otra categoría del SEED; cada concepto tiene etiqueta, etiqueta de
  descripción y nombre de libro no vacíos.
  **Hecho:** los cuatro casos verdes; el de exhaustividad se pone rojo si se añade un quinto concepto
  sin actualizarlo.

- [ ] **D3 — `RegistrarMovimientoCajaDialog.tsx`.** Componente nuevo (design §10) sobre
  `Modal`/`Select`/`FormField`/`Input`/`Label`. Cuatro campos, línea de ayuda con el nombre de libro,
  enrutado por el catálogo, `fecha` con `max` = hoy CR y valor inicial hoy CR, mapeo de
  `fieldErrors.fecha` a su campo, toasts en voseo, `router.refresh()` + `onRegistrado?.()`.
  Depende de D1.
  **Hecho:** `pnpm typecheck` y `pnpm lint` verdes; cero `Number(` y cero `parseFloat` en el archivo.

- [ ] **D4 — `WalletModule.tsx` monta UN solo diálogo.** Se sustituyen los dos hijos de la barra de
  acciones (líneas 202-207) por el nuevo, con el mismo `onRegistrado`.
  **Hecho:** la barra tiene un solo botón y `recargar(filtros, page)` se sigue disparando tras
  registrar.

- [ ] **D5 — Se borran los dos diálogos.** `RegistrarMovimientoManualDialog.tsx` y
  `RegistrarEgresoAdministrativoDialog.tsx`. Depende de D4.
  **Hecho:** `grep` sobre el árbol no deja ninguna referencia viva a esos dos símbolos fuera de
  `specs/` y `progress/`; la guardia `superficie-de-uso.guardia.test.ts` sigue verde.

- [ ] **D6 — La cobertura de los dos diálogos NO se pierde (R29).** Nuevo
  `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` que **absorbe los tres casos**
  del test del diálogo de egreso administrativo (el archivo está nombrado en R29 de
  `requirements.md`) y añade los del diálogo unificado. El archivo viejo se borra **en el mismo
  commit** que el nuevo. Depende de D3.
  **Hecho:** los tres casos migrados conservan sus aserciones (`"Gasto fijo"` no se ofrece;
  `{ tipoEgreso, monto, descripcion }` con `monto: "125.50"` string exacto; monto 0 + descripción
  vacía no llaman la action y pintan los dos mensajes). Ningún `specs/*/tasks.md` ni `design.md` cita
  el archivo borrado — verificado antes de borrarlo; si apareciera una cita, se anota con
  `<!-- @test-desaparecido … -->` en el `tasks.md` que la contiene.

---

## Tanda E — Verdad contra la base y cierre

- [ ] **E1 — Integración contra Postgres.** Nuevo `tests/integration/db/wallet-fecha-elegida.test.ts`:
  1. registra un movimiento con fecha de **ayer** y comprueba que `fecha_movimiento` es
     `${ayer}T06:00:00.000Z` y que **`created_at` ≠ `fecha_movimiento`** y cae en el presente (R22/R24);
  2. `FinanzasDiarioRepository.sumarPorDia` lo cuenta **en el día de ayer** y no en el de hoy (R25);
  3. el filtro `desde = ayer` lo devuelve (R27);
  4. tres filas con el MISMO `fecha_movimiento`, paginadas de dos en dos, devuelven **tres ids
     distintos** entre las dos páginas (R26).
  **Hecho:** los cuatro casos verdes **y** el implementer comprueba que el caso 2 se pone ROJO al
  neutralizar `instanteDe` (devolviendo siempre `undefined`). Ningún `if (!filas) return;`: si no hay
  datos, el test falla. Se anota el resultado de la comprobación en `progress/impl_334.md`.

- [ ] **E2 — Página: un botón, y lo demás intacto.** Casos en
  `tests/integration/wallet-page.test.tsx`: existe «Registrar movimiento» y **no** existe «Registrar
  egreso»; los casos actuales de la suite (roles, pre-fetch, STRING, descripción de la página) siguen
  verdes sin tocarlos.
  **Hecho:** la suite entera verde.

- [ ] **E3 — Gate completo.** `./init.sh` (no `--rapido`: se negaría solo). El log se escribe a
  archivo y el código de salida se captura DENTRO del log (`INIT_EXIT=$?`), no se infiere.
  **Hecho:** el log termina en verde con su `INIT_EXIT=0` explícito.

- [ ] **E4 — Bitácora y PR.** `progress/impl_334.md` con archivos tocados, mapa `R→test` ejecutado y
  salida de los tests; luego PR hacia `dev`.
  **Hecho:** el PR existe, su rama contiene los commits (verificado sobre el blob commiteado, no
  sobre el árbol local) y la URL está reportada.

---

## Mapa `R<n> → test`

| R | test |
| --- | --- |
| R1 | `tests/integration/wallet-page.test.tsx` › «la wallet ofrece un solo botón para registrar dinero» |
| R2 | `tests/integration/wallet-page.test.tsx` › «ya no hay un segundo botón de registro manual» |
| R3 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «el selector ofrece los cuatro conceptos» |
| R4 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «dice con qué nombre saldrá en el libro» |
| R5 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «gasto variable envía tipoEgreso=gasto_variable» |
| R6 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «sueldo envía tipoEgreso=sueldo y cambia el label» |
| R7 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «ajuste que suma envía ingreso/ingreso_ajuste» |
| R8 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «ajuste que resta envía egreso/egreso_ajuste» |
| R9 | `tests/unit/components/wallet-conceptos-manuales.test.ts` › «cada concepto trae su etiqueta de descripción» |
| R10 | `tests/integration/wallet-page.test.tsx` › los casos existentes de pre-fetch, roles y STRING |
| R11 | `tests/unit/components/wallet-conceptos-manuales.test.ts` › «ningún concepto mapea a egreso_gasto_fijo» |
| R12 | `tests/unit/actions/wallet-egresos-actions.test.ts` › «tipoEgreso 'gasto_fijo' → validation_error, sin tocar el service» *(existente)* |
| R13 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «descripción vacía no llama la action» |
| R14 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «monto 0 no llama la action» |
| R15 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «el monto viaja como STRING exacto, con sus dos decimales» |
| R16 | `tests/unit/actions/wallet-actions.test.ts` › «sin sesión → unauthenticated» y «rol no autorizado → forbidden» *(existentes)* |
| R17 | `tests/unit/repositories/wallet-movimiento-repository.test.ts` › «la superficie del repositorio son CINCO métodos» *(existente)* |
| R18 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «tras registrar avisa al módulo y refresca» |
| R19 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «la fecha arranca en el día de hoy de Costa Rica» |
| R20 | `tests/unit/types/wallet-fecha-movimiento-schema.test.ts` › «rechaza mañana» + `tests/unit/actions/wallet-actions.test.ts` › «fecha futura → validation_error sin tocar el service» |
| R21 | `tests/unit/types/wallet-fecha-movimiento-schema.test.ts` › «rechaza un día que no existe» |
| R22 | `tests/unit/services/wallet-service.test.ts` › «fecha de ayer → fechaMovimiento a las 06:00Z de ayer» + `tests/integration/db/wallet-fecha-elegida.test.ts` |
| R23 | `tests/unit/services/wallet-egreso-service.test.ts` › «fecha de hoy → la clave fechaMovimiento no viaja» |
| R24 | `tests/integration/db/wallet-fecha-elegida.test.ts` › «created_at es el instante real y no la fecha elegida» |
| R25 | `tests/integration/db/wallet-fecha-elegida.test.ts` › «el rollup diario lo cuenta en el día elegido» |
| R26 | `tests/unit/repositories/wallet-movimiento-repository.test.ts` › «el orden del libro desempata por creación y por id» + `tests/integration/db/wallet-fecha-elegida.test.ts` › «tres filas empatadas paginan sin repetir ni perder» |
| R27 | `tests/integration/db/wallet-fecha-elegida.test.ts` › «el filtro desde incluye el día elegido» |
| R28 | `tests/unit/services/wallet-service.test.ts` › «devuelve el movimiento creado aunque exista uno más reciente de la misma categoría» + `tests/unit/services/wallet-egreso-service.test.ts` (espejo) |
| R29 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › los tres casos migrados |
| R30 | `tests/unit/actions/wallet-actions.test.ts`, `tests/unit/actions/wallet-egresos-actions.test.ts`, `tests/unit/services/wallet-service.test.ts`, `tests/unit/services/wallet-egreso-service.test.ts`, `tests/unit/repositories/wallet-movimiento-repository.test.ts`, `tests/integration/wallet-page.test.tsx` |
| R31 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «los avisos hablan de vos» |
| R32 | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` › «los cuatro campos se alcanzan por su etiqueta» |

---

## Dependencias, de un vistazo

```
T0 ─┬─ A1 ── A3 ─┬─ C1 ─┐
    │      A2[P] │  C2 ─┼─ E1 ─┐
    ├─ B1[P] ────┘  C3[P]      ├─ E3 ── E4
    ├─ B2[P]                   │
    ├─ B3                      │
    └─ D1[P] ─ D2[P] ─ D3 ─ D4 ─ D5 ─ D6 ─ E2 ─┘
```

**Conflicto de archivos con otras features en curso:** esta ficha toca `lib/types/wallet.ts`,
`lib/interfaces/repositories/IWalletMovimientoRepository.ts`,
`lib/repositories/WalletMovimientoRepository.ts`, `lib/services/WalletService.ts`,
`lib/services/WalletEgresoService.ts`, `lib/actions/wallet.ts`, `lib/actions/wallet-egresos.ts` y
`app/(app)/wallet/_components/**`. Las fichas 85/332/333 (gastos fijos) tocan territorio vecino: el
leader debe validar la intersección antes de lanzarla en paralelo con cualquiera de ellas.
