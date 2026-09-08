# Ficha 381 — tareas

**Zona:** fullstack ⇒ se secuencia **backend → frontend**. `[P]` = paralelizable con las tareas
marcadas igual dentro de la misma tanda.

> Las decisiones D1–D4 están **firmadas por el humano (2026-09-07)** y esta lista ya está podada a
> ellas: no hay puerto de caja, no hay abono manual, y la categoría del ledger es propia.
> **El commit `486d5dee` de la rama es un `wip` del diseño derogado: no se reutiliza nada de él.**

---

## Tanda 0 — antes de tocar código

- [ ] **T0.1 — Registrar la ficha 381 en `feature_list.json`.** Comprobado el 2026-09-07: no existe
      `"id": 381`. Lo hace el leader, no un subagente, y no con agentes trabajando dentro del árbol.
      **Hecho cuando:** la ficha existe con `zone: fullstack`, `sdd: true`,
      `branch: feat/381-cargo-manual-a-tienda`, estado `spec_ready`, y su id no colisiona con
      `origin/dev`.
- [ ] **T0.2 — Q1 (nombres) respondida.** Valor de enum `cobro_manual`, etiqueta de libro «Cobro de
      Ordenex», etiqueta de selector «Cobrar un costo a una tienda».
      **Hecho cuando:** los tres textos están confirmados por escrito. Si cambian, cambian en un
      sitio cada uno (el enum en la migración + schema; las dos etiquetas en su `Record`).

---

## Tanda A — cimientos de tipos (backend). Depende de: T0.2

- [ ] **A.1 [P] — `CrearMovimientoTiendaInput` gana `id?: string`.**
      `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` + el `map` de
      `WalletTiendaMovimientoRepository.crearMovimientos`, con el mismo
      `...(m.id !== undefined ? { id: m.id } : {})` de `WalletMovimientoRepository:105`.
      **Hecho cuando:** `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` afirma
      que sin `id` la clave NO viaja (los escritores actuales siguen en el `@default`) y con `id` sí.
- [ ] **A.2 [P] — `registrarCobroTiendaSchema` en `lib/types/wallet-tienda.ts`**, reutilizando
      `montoPositivoSchema` y `fechaMovimientoSchema` de `lib/types/wallet.ts`, con `.strict()`.
      **Hecho cuando:** existe `tests/unit/types/wallet-tienda-cobro-schema.test.ts` y una **mutación
      manual** del regex del monto lo pone rojo (no vale un test que compare el schema consigo
      mismo).
- [ ] **A.3 [P] — `IUserRepository.obtenerCuentaTienda(id)`** → `{ rol, estado } | null`, proyección
      mínima (nada de email/teléfono/cédula/hash).
      **Hecho cuando:** hay test unitario del repositorio y **no** se reusa
      `UserRepository.listCuentasTienda`, cuyo docstring declara que su único llamador es
      `FiltrosOrdenesService` y que por eso su `WHERE` puede vivir ahí.

## Tanda B — las DOS migraciones (backend). Depende de: T0.2

> Van separadas porque Postgres prohíbe **usar** un valor de enum en la misma transacción que lo
> añade (55P04) y el CHECK lo nombra. Precedente:
> `20260906120100_historial_accion_nodo_geografico/migration.sql:24-26`.

- [ ] **B.1 — Migración 1: `<ts>_wallet_tienda_categoria_cobro_manual`.** Un solo
      `ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'cobro_manual';`
      **Hecho cuando:** generada con `pnpm run db:migrate:create`, aditiva, y sin editar ninguna
      migración ya aplicada.
- [ ] **B.2 — `down.sql` de la migración 1.** Recrea-con-lista los **10** valores originales de
      `20260712170000_wallet_tienda_movimiento/migration.sql:20-31` con la coreografía completa:
      soltar CHECK + `wallet_tienda_movimiento_tienda_id_categoria_idx` +
      `wallet_tienda_movimiento_origen_uq` → renombrar/crear/recastear/dropear → recrear los dos
      índices con **el mismo nombre y la misma forma** (el parcial con su `WHERE "origen_id" IS NOT
      NULL`) y el CHECK con su lista original. Plantilla:
      `20260827120000_premio_ranking_devengo/down.sql:35-51,90-107`.
      **Hecho cuando:** lleva la precondición ruidosa escrita y **ningún `down.sql` previo se ha
      tocado** (verificado con `git diff --name-only`).
- [ ] **B.3 — Migración 2: `<ts>_wallet_tienda_check_cobro_manual`.** DROP + ADD del CHECK
      `wallet_tienda_movimiento_tipo_categoria_check` con `cobro_manual` en la rama `debito`, más
      `ADD VALUE` de `cobro_tienda_registrado` (`historial_accion_tipo`) y de
      `wallet_tienda_movimiento` (`historial_accion_entidad`).
      **Hecho cuando:** la lista del CHECK es la de `20260802120000_liquidacion_pago:131-136` **más**
      `cobro_manual`, sin quitar ni reordenar nada.
- [ ] **B.4 — `down.sql` de la migración 2.** El CHECK vuelve a su lista original **primero** (porque
      nombra un valor que la migración 1 retira después: los downs corren del más nuevo al más
      viejo), luego `historial_accion_tipo` con **49** valores y `historial_accion_entidad` con
      **20**, según las listas de `design.md` §1.3.
      **Hecho cuando:** existe, con precondición ruidosa para las dos columnas de `historial_accion`.
- [ ] **B.5 — `db/schema.prisma`:** los tres enums ganan su valor con comentario de ficha.
      **Hecho cuando:** `prisma validate` verde y `prisma migrate status` al día en la base local
      (**avisando antes a quien la comparta**).
- [ ] **B.6 — `tests/integration/db/wallet-tienda-cobro-migration.test.ts`.** Reconstruye el estado
      previo ejecutando las migraciones REALES anteriores y compara **valor a valor y en orden**,
      arriba y abajo, para el enum de categoría **y para la lista del CHECK**. Molde:
      `historial-accion-zona-central-migration.test.ts`.
      **Hecho cuando:** pasa contra Postgres real y **no** contiene ningún `if (!x) return;` que lo
      deje verde sin datos.
- [ ] **B.7 [P] — `tests/integration/db/historial-accion-cobro-tienda-migration.test.ts`**, idem para
      los dos enums de historial.
      **Hecho cuando:** igual que B.6.

## Tanda C — el abanico del valor nuevo (backend). Depende de: B.5

> Cinco de estos seis los **obliga el compilador** (`Record` totales sin `default`). El sexto no, y
> por eso va con aviso.

- [ ] **C.1 [P] — `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`** gana `cobro_manual`.
      **Hecho cuando:** `_EnsureCategoriaExhaustive` compila y
      `tests/unit/utils/desglose-tienda.test.ts` (que recorre el SEED en runtime) sigue verde.
- [ ] **C.2 [P] — `CUBETA_POR_CATEGORIA.cobro_manual = "cargos"`** (`lib/utils/desglose-tienda.ts`) y
      **`FUENTE_TIENDA.cobro_manual = { tipo: "sin_reparto", motivo: "no_nace_de_un_cierre" }`**
      (`lib/utils/aporte-por-orden.ts`).
      **Hecho cuando:** `desglose-tienda.test.ts` y `aporte-por-orden.test.ts` cubren el valor nuevo,
      y abrir el detalle de un cobro responde «no nace de un cierre» en vez de buscar uno inexistente.
- [ ] **C.3 — `lib/analytics/metrics.ts` → `cuenta_por_pagar_tienda`** gana `cobro_manual` en su lista
      de categorías (`:746-757`). **⚠️ Este campo está tipado `readonly string[]`: el build NO lo
      obliga.**
      **Hecho cuando:** el valor está y, si el informe de implementación menciona ese campo entre
      comillas invertidas, la entrada del catálogo **cita ese documento con su fecha** —
      `tests/unit/analytics/catalogo-produccion.guardia.test.ts` escanea `progress/` (no `specs/`) y
      exige la cita. Comprobar la guardia en verde **después** de escribir el informe, no antes.

## Tanda D — el rastro (backend). Depende de: A.1, B.5

- [ ] **D.1 [P] — `lib/types/historial-accion.ts`:** `cobro_tienda_registrado` en
      `HISTORIAL_ACCION_TIPOS`, `wallet_tienda_movimiento` en `HISTORIAL_ACCION_ENTIDADES`, entrada
      en `CATEGORIA_POR_ACCION` (`mueve_dinero`, R41) y en `ACCION_LABELS` («Cobró un costo a una
      tienda»).
      **Hecho cuando:** compila (los `Record` son exhaustivos) y el comentario de cabecera dice «los
      49… la ficha 381 añade el décimo».
- [ ] **D.2 [P] — `lib/types/historial-accion-etiquetas.ts`:** clave
      `wallet_tienda_movimiento: { tiendaNombre: string | null }` y su resolvedor `unir(...)`.
      **Hecho cuando:** hay test con nombre presente y con `null`, y **no** entra la `descripcion`
      del cobro (R43).
- [ ] **D.3 — `WalletTiendaMovimientoRepository.registrarCobroEnHistorial(tx, …)`**, forma
      `recibe_tx`: lee el nombre de la tienda con `tx.usuario.findUnique` y llama a `appendAccion`
      con `resolverActorCongelado`. Depende de D.1, D.2.
      **Hecho cuando:** el método NO abre transacción propia (el tipo no se lo permite) y su test
      afirma que el `monto` llega como `Prisma.Decimal` construido del STRING.
- [ ] **D.4 — CENSO de la guardia.** Entrada nueva en
      `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: tipo
      `cobro_tienda_registrado`, archivo `lib/repositories/WalletTiendaMovimientoRepository.ts`,
      método `registrarCobroEnHistorial`, forma `recibe_tx`, mutación `/tx\.usuario\.findUnique\(/`.
      **Hecho cuando:** la guardia pasa **y** su contraprueba sigue funcionando (quitar el
      `appendAccion` del cuerpo la pone roja).

## Tanda E — el servicio de escritura (backend). Depende de: A.*, D.3

- [ ] **E.1 — `ICobroTiendaService` + `CobroTiendaService.registrarCobro`.** Orden fijo: rol → escala
      2 → validación de la tienda → `randomUUID` → `runTransaction` (asiento + historial) → saldo
      derivado con su `signo`. **Sin candado y sin comprobación de disponible** (R27).
      **Hecho cuando:** `tests/unit/services/cobro-tienda-service.test.ts` cubre cada rama, afirma
      que **con rol no autorizado ningún doble de repositorio recibe una sola llamada** (R12), y
      afirma que un cobro que deja el saldo negativo **se acepta** y devuelve `signo: "negativo"`.
- [ ] **E.2 — Guardia de R24: el cobro no toca la caja.** Un test que monta el servicio con un doble
      del repositorio de `wallet_movimiento` y afirma **cero llamadas**; y una comprobación de que
      `CobroTiendaService.ts` no importa `WalletMovimientoRepository` ni ningún puerto de caja.
      **Hecho cuando:** ambas pasan. Es la decisión D1 convertida en algo que se rompe si alguien la
      deshace.

## Tanda F — el borde (backend). Depende de: E.1

- [ ] **F.1 — `registrarCobroTiendaAction` en `lib/actions/wallet-tienda.ts`**, con
      `resolveActorFromSession` + `UnauthenticatedError` + `withErrorHandler`, y `deps` inyectables.
      **Hecho cuando:** `tests/unit/actions/wallet-tienda-cobro-action.test.ts` cubre
      `unauthenticated`, `forbidden`, `validation_error` (ZodError traducido) y `ok`.
- [ ] **F.2 — Composition root.** La `build…` de esa action construye los dos repositorios y el
      servicio.
      **Hecho cuando:** un test comprueba que alguien **PASA** cada dependencia, no sólo que el
      archivo la importa.

## Tanda G — Postgres real (backend). Depende de: E.*, F.*, B.*

- [ ] **G.1 — `tests/integration/db/wallet-tienda-cobro.test.ts`.** Contra Postgres real:
      (a) el `INSERT` de un `debito`/`cobro_manual` **pasa** el CHECK recreado;
      (b) un `credito`/`cobro_manual` lo **rechaza** la base;
      (c) el cobro baja el saldo derivado exactamente en su importe (R26);
      (d) un cobro mayor que el saldo lo deja **negativo** y no se rechaza (R27);
      (e) un fallo forzado en la escritura del historial no deja el asiento (R25/R42);
      (f) el cobro **no aparece** en el libro de otra tienda (R38);
      (g) **no aparece ninguna fila nueva en `wallet_movimiento`** (R24).
      **Hecho cuando:** cada aserción se mata con una mutación deliberada antes de creérsela, y el
      archivo no sale como `skipped` por falta de `.env`.

## Tanda H — pantalla del administrador (frontend). Depende de: F.1, C.*

- [ ] **H.1 — `wallet-conceptos-manuales.ts`:** la categoría se muda dentro de `DestinoConcepto`,
      entra la clase `cobro_tienda` y `nombreEnElLibro` resuelve por clase (`design.md` §4).
      **Hecho cuando:** `tests/unit/components/wallet-conceptos-manuales.test.ts` sigue verde para
      los cuatro conceptos existentes (R11) y añade el quinto; el módulo sigue sin React y sin reloj.
- [ ] **H.2 — `RegistrarMovimientoCajaDialog.tsx`:** campo de tienda condicional, tercera rama de
      enrutado por clase, `reset()` que limpia la tienda, texto de R4 y aviso de R6.
      **Hecho cuando:** `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` afirma
      que con los otros cuatro conceptos el payload **no gana ninguna clave** (R3), que sin tienda
      elegida no se llama al servidor (R7) y que lo tecleado sobrevive a un rechazo (R10).
- [ ] **H.3 [P] — Catálogo de tiendas** vía `listarAdminTiendas`, con la degradación **ruidosa** de
      R6 (distinta del silencio de `GenerarApiKeyForm`, y por eso hay que probarla).
      **Hecho cuando:** hay un test con la action devolviendo `forbidden` y otro lanzando, y en los
      dos los otros cuatro conceptos siguen registrándose.
- [ ] **H.4 [P] — Anti-doble-envío (R8).** No se implementa nada: se comprueba que el `Modal` ya lo
      bloquea. **Hecho cuando:** hay un test con dos clics seguidos y una sola llamada.

## Tanda I — lo que ve la tienda, y el negativo (frontend). Depende de: C.*

> Casi todo aquí **ya funciona**: son tests que lo fijan. La única línea de producción es I.3.

- [ ] **I.1 [P] — `CATEGORIA_TIENDA_LABEL.cobro_manual = "Cobro de Ordenex"`**
      (`app/(app)/mi-wallet/_components/mi-wallet-labels.ts`).
      **Hecho cuando:** `tests/unit/components/desglose-tienda-labels.test.ts` sigue verde (compara
      las opciones contra el SEED), y un test afirma que la etiqueta del cobro es **distinta** de la
      de `ajuste_debito` (R33) y que `ajuste_debito` **no ha cambiado**.
- [ ] **I.2 [P] — El cobro se ve y se filtra en las dos pantallas** (R32/R34/R35/R39): tabla del
      libro de `/mi-wallet` (`DesgloseTiendaLedger`), tabla del admin
      (`DesgloseMovimientosTienda`), los dos selectores de concepto y las dos descargas.
      **Hecho cuando:** hay un test por superficie. No hace falta tocar código: todas leen
      `CATEGORIA_TIENDA_LABEL` / `CATEGORIA_TIENDA_OPTIONS`.
- [ ] **I.3 — `DESGLOSE_MI_WALLET_LABEL.cargosHint`** deja de decir sólo «Fletes, comisión e IVA»
      (R37). **Es la única línea de producción de esta tanda.**
      **Hecho cuando:** un test afirma que la aclaración nombra los cobros, y el aviso compuesto
      `DESGLOSE_MI_WALLET_AVISO` —que se construye con los rótulos reales— sigue coherente.
- [ ] **I.4 [P] — El saldo negativo se ve entero, en las dos pantallas** (R28/R29/R30).
      **Hecho cuando:** hay un test por pantalla con `saldo: "-15000.00"`, `signo: "negativo"`, que
      afirma (a) que el importe se pinta con su signo y sin recortar, y (b) que la marca legible
      («En contra») lo distingue de positivo y de cero. Superficies: `SaldoTiendaCard` y
      `SaldosTiendasTable`.
- [ ] **I.5 [P] — Con saldo no positivo no se ofrece pagar, y se dice por qué** (R31).
      **Hecho cuando:** un test de `PagoTiendaAcciones` con `signo: "negativo"` afirma botón
      deshabilitado + el texto que ya existe, y otro con `signo: "positivo"` afirma lo contrario (sin
      esa segunda mitad, el test pasaría con el botón deshabilitado siempre).

## Tanda J — cierre. Depende de: todas

- [ ] **J.1 — Mapa R→test en `progress/impl_381-cargo-manual-a-tienda.md`.** Los **43** requisitos,
      cada uno con archivo y nombre de test. **Ojo con C.3** al redactarlo.
      **Hecho cuando:** no queda ni un `R<n>` sin fila. El reviewer rechaza si falta alguno.
- [ ] **J.2 — Gate.** `./init.sh --rapido` **se negará solo** (el diff toca `db/schema.prisma`,
      `lib/types/` y dos migraciones) ⇒ corre `./init.sh` completo.
      **Hecho cuando:** `INIT_EXIT=0` escrito **dentro** del log, y los `skipped` revisados uno a uno
      (78 archivos de `integration/db` se saltan sin `.env` y aun así el init dice OK).
- [ ] **J.3 — Ver la app.** Cobrarle de verdad a una tienda en local y comprobar con los ojos:
      (a) aparece en `/wallet/tiendas` dentro del desglose de ESA tienda, con el nombre nuevo;
      (b) aparece en `/mi-wallet` de esa tienda (entrando como esa tienda, no como admin);
      (c) si el cobro supera el saldo, las dos pantallas lo enseñan en negativo y el botón de pagar
      está deshabilitado;
      (d) aparece en el historial de acciones;
      (e) **no** aparece nada nuevo en el libro de la caja de `/wallet`.
      **Hecho cuando:** las cinco están vistas, con el importe **idéntico** en todas. Un backend sin
      pantalla no es entrega.

---

## Trazabilidad R → test

| R | Qué prueba | Dónde |
| --- | --- | --- |
| R1 | el catálogo tiene cinco conceptos y el quinto es el cobro | `tests/unit/components/wallet-conceptos-manuales.test.ts` |
| R2 | elegido el cobro, el campo de tienda está en el DOM | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R3 | con los otros cuatro, el payload no gana ninguna clave | idem |
| R4 | el diálogo nombra libro y nombre del concepto elegido | idem |
| R5 | el selector se puebla con las tiendas activas, en orden | idem (con `listarAdminTiendas` mockeada) |
| R6 | catálogo caído ⇒ aviso + cobro bloqueado, resto usable | idem |
| R7 | confirmar sin tienda ⇒ error de campo y cero llamadas | idem |
| R8 | dos clics ⇒ una llamada | idem |
| R9 | ok ⇒ toast, cierre y `onRegistrado` | idem |
| R10 | rechazo ⇒ lo tecleado sobrevive y el motivo va bajo su campo | idem |
| R11 | los cuatro conceptos previos, byte a byte | `wallet-conceptos-manuales.test.ts` + el de diálogo |
| R12 | rol no autorizado ⇒ `forbidden` **sin llamar a ningún repo** | `tests/unit/services/cobro-tienda-service.test.ts` |
| R13 | sin sesión ⇒ `unauthenticated` | `tests/unit/actions/wallet-tienda-cobro-action.test.ts` |
| R14 | monto inválido ⇒ rechazo | `tests/unit/types/wallet-tienda-cobro-schema.test.ts` |
| R15 | descripción vacía ⇒ rechazo | idem |
| R16 | fecha inválida/futura/fuera de ventana, mismo texto | idem |
| R17 | tienda inexistente / rol / inactiva ⇒ error de campo, cero escrituras | `cobro-tienda-service.test.ts` |
| R18 | el STRING llega intacto a la base; ni un `Number()` | `wallet-tienda-cobro-schema.test.ts` + `tests/integration/db/wallet-tienda-cobro.test.ts` |
| R19 | el asiento con tipo, categoría propia, monto, descripción, fecha y actor | `cobro-tienda-service.test.ts` + integración (a) |
| R20 | `origen_tipo = manual`, `origen_id = NULL` | `cobro-tienda-service.test.ts` |
| R21 | sin fecha elegida ⇒ la clave no viaja (default de columna) | idem |
| R22 | el servicio no expone editar/borrar/reversar un cobro | guardia de superficie en `cobro-tienda-service.test.ts` |
| R23 | un cobro produce **una** fila en el ledger, no dos | idem + integración |
| R24 | **cero filas nuevas en `wallet_movimiento`**; el servicio no importa la caja | `cobro-tienda-service.test.ts` (E.2) + integración (g) |
| R25 | fallo en la segunda escritura ⇒ no queda la primera | integración (e) |
| R26 | el saldo derivado baja exactamente el importe | integración (c) + `tests/unit/utils/desglose-tienda.test.ts` |
| R27 | cobro > saldo ⇒ se acepta y el saldo queda negativo | `cobro-tienda-service.test.ts` + integración (d) |
| R28 | `/wallet/tiendas` pinta `-15.000,00` entero y sin recortar | `tests/unit/components/saldos-tiendas-table.negativo.test.tsx` |
| R29 | `/mi-wallet` idem | `tests/unit/components/saldo-tienda-card.negativo.test.tsx` |
| R30 | marca legible distinta para negativo / positivo / cero, en las dos | los dos anteriores (los tres casos, no solo el negativo) |
| R31 | saldo no positivo ⇒ no se ofrece pagar y se dice por qué; positivo ⇒ sí | `tests/unit/components/pago-tienda-acciones.test.tsx` |
| R32 | el cobro aparece en el libro de `/mi-wallet` de esa tienda | `tests/unit/components/desglose-tienda-ledger.test.tsx` |
| R33 | su nombre es distinto del de `ajuste_debito`, que no cambia | `tests/unit/components/desglose-tienda-labels.test.ts` |
| R34 | el admin lo presenta con el MISMO nombre | `tests/unit/components/desglose-movimientos-tienda.test.tsx` |
| R35 | el concepto se puede filtrar en las dos pantallas | `desglose-tienda-labels.test.ts` (opciones desde el SEED) + un test por selector |
| R36 | el cobro cae en `cargos`, no en `aFavor` ni en `pagado` | `tests/unit/utils/desglose-tienda.test.ts` |
| R37 | la aclaración de cargos nombra los cobros | `tests/unit/components/mi-wallet-labels.test.ts` |
| R38 | el cobro no aparece en el libro de otra tienda | integración (f) |
| R39 | la descarga usa el mismo nombre que la pantalla, en las dos | `tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts` + `mi-wallet-descarga-columnas` |
| R40 | la fila de historial con quién/cuándo/importe/tienda | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` |
| R41 | clasificada `mueve_dinero` | `tests/unit/types/historial-accion*.test.ts` |
| R42 | asiento no escrito ⇒ sin fila de historial | integración (e) |
| R43 | la etiqueta no lleva la descripción ni datos de destinatario | test de etiquetas + `historial-accion-sin-datos-cliente.guardia.test.ts` |
| — | el productor censado existe y es atómico | `historial-accion-escrituras-cubiertas.guardia.test.ts` |
| — | migración 1 y su down, valor a valor y en orden | `tests/integration/db/wallet-tienda-cobro-migration.test.ts` |
| — | migración 2: la lista del CHECK y los dos enums de historial | idem + `historial-accion-cobro-tienda-migration.test.ts` |

---

## Notas de ejecución (trampas medidas en este repo)

1. **Otro agente está trabajando en `app/(app)/configuracion/tarifas/`.** Esta ficha no toca ese
   árbol. Si aparece un conflicto ahí, no es de la 381.
2. **El `wip` `486d5dee` construía el puerto de caja derogado.** No se reutiliza; si algo suyo
   sobrevive en el árbol, se borra (R24 lo detecta).
3. **Base local compartida:** aplicar B.1/B.3 pone rojo el gate de otras ramas. Avisar antes.
4. **`prisma generate` se pisa entre worktrees**; un 404 con el armazón pintado suele ser un cliente
   Prisma rancio, y regenerar no basta: hay que reiniciar el dev server.
5. **No levantar un segundo dev server** si otro agente ya tiene el suyo: comparten `.next`.
6. **La trampa de C.3:** la guardia del catálogo de analítica escanea `progress/`. Nombrar
   `cuenta_por_pagar_tienda.definicion.categorias` entre comillas invertidas en el informe de
   implementación obliga a citarlo desde el catálogo. Comprobar la guardia **después** de escribir
   el informe.
7. **El informe de implementación y el de revisión se COMMITEAN.** Escribirlos y no commitearlos ya
   costó tres veces en un día.
8. **Un PR verde no dice nada de los tests:** el check de Vercel es un build.
