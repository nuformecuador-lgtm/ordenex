# Ficha 381 — tareas

**Zona:** fullstack ⇒ se secuencia **backend → frontend**. `[P]` = paralelizable con las tareas
marcadas igual dentro de la misma tanda.

> **Puerta previa:** nada de esto se empieza sin la respuesta a **Q1** (y a **Q1.a** si Q1 = «sí»).
> Las tareas marcadas **[Q1]** existen solo si la respuesta es «sí»; si es «no», se borran de esta
> lista junto con R31–R35.

---

## Tanda 0 — antes de tocar código

- [ ] **T0.1 — Registrar la ficha 381 en `feature_list.json`.** Comprobado el 2026-09-07: no existe
      `"id": 381`. Lo hace el leader, no un subagente, y no con agentes trabajando dentro del árbol.
      **Hecho cuando:** la ficha existe con `zone: fullstack`, `sdd: true`,
      `branch: feat/381-cargo-manual-a-tienda` y estado `spec_ready`, y su id no colisiona con
      `origin/dev`.
- [ ] **T0.2 — Q1 y Q1.a firmadas por el humano**, anotadas en `progress/`.
      **Hecho cuando:** la respuesta está por escrito y esta lista está podada en consecuencia.

---

## Tanda A — cimientos de tipos (backend). Depende de: T0.2

- [ ] **A.1 [P] — `CrearMovimientoTiendaInput` gana `id?: string`.**
      `lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts` + el `map` de
      `WalletTiendaMovimientoRepository.crearMovimientos`, con el mismo
      `...(m.id !== undefined ? { id: m.id } : {})` de `WalletMovimientoRepository:105`.
      **Hecho cuando:** `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` afirma
      que sin `id` la clave NO viaja (los cinco escritores actuales siguen en el `@default`) y con
      `id` sí. Typecheck verde.
- [ ] **A.2 [P] — `registrarCargoTiendaSchema` en `lib/types/wallet-tienda.ts`**, reutilizando
      `montoPositivoSchema` y `fechaMovimientoSchema` de `lib/types/wallet.ts`, con `.strict()`.
      **Hecho cuando:** existe `tests/unit/types/wallet-tienda-cargo-schema.test.ts` y una **mutación
      manual** del regex del monto lo pone rojo (no vale un test que compare el schema consigo
      mismo).
- [ ] **A.3 [P] — `IUserRepository.obtenerCuentaTienda(id)`** → `{ rol, estado } | null`, proyección
      mínima (nada de email/teléfono/cédula/hash).
      **Hecho cuando:** hay test unitario del repositorio y **no** se reusa
      `UserRepository.listCuentasTienda`, que tiene escrito en su docstring que su único llamador es
      `FiltrosOrdenesService` y que por eso su `WHERE` puede vivir ahí.

## Tanda B — la migración (backend). Depende de: T0.2

- [ ] **B.1 — `db/migrations/<ts>_historial_accion_cargo_tienda/migration.sql`** con
      `ADD VALUE IF NOT EXISTS 'cargo_tienda_registrado'` (tipo) y `'wallet_tienda_movimiento'`
      (entidad). **[Q1.a=enlace]** además `ADD VALUE IF NOT EXISTS 'wallet_tienda_movimiento'` en
      `wallet_origen_tipo`.
      **Hecho cuando:** `pnpm run db:migrate:create` la generó, es ADITIVA (ni tablas, ni columnas,
      ni índices, ni RLS) y no se editó ninguna migración ya aplicada.
- [ ] **B.2 — `down.sql` manual.** Recrea-con-lista (los dos enums de historial NO se dropean).
      Listas exactas en `design.md` §1.2: **49** tipos y **20** entidades. **[Q1.a=enlace]** además
      la coreografía de `wallet_origen_tipo`: 6 índices fuera → recrear el tipo → recastear las
      **tres** tablas → 6 índices dentro, copiada de
      `20260827120000_premio_ranking_devengo/down.sql:45-107`.
      **Hecho cuando:** el archivo existe, lleva la precondición ruidosa escrita, y **ningún
      `down.sql` previo se ha tocado** (verificado con `git diff --name-only`).
- [ ] **B.3 — `db/schema.prisma`:** los enums ganan sus valores con comentario de ficha.
      **Hecho cuando:** `prisma validate` verde y `prisma migrate status` dice que la base local está
      al día (avisando antes a quien comparta base).
- [ ] **B.4 — `tests/integration/db/historial-accion-cargo-tienda-migration.test.ts`.** Reconstruye
      el estado previo ejecutando las migraciones REALES anteriores y compara valor a valor **y en
      orden**, arriba y abajo. Molde: `historial-accion-zona-central-migration.test.ts`.
      **Hecho cuando:** pasa contra Postgres real y **no** contiene ningún `if (!x) return;` que lo
      deje verde sin datos.

## Tanda C — el catálogo de acciones (backend). Depende de: B.3

- [ ] **C.1 — `lib/types/historial-accion.ts`:** `cargo_tienda_registrado` en
      `HISTORIAL_ACCION_TIPOS`, `wallet_tienda_movimiento` en `HISTORIAL_ACCION_ENTIDADES`, entrada
      en `CATEGORIA_POR_ACCION` (`mueve_dinero`, R28) y en `ACCION_LABELS`.
      **Hecho cuando:** compila (los `Record` son exhaustivos: falta una clave ⇒ error) y el
      comentario de cabecera dice «los 49… la ficha 381 añade el décimo».
- [ ] **C.2 — `lib/types/historial-accion-etiquetas.ts`:** clave
      `wallet_tienda_movimiento: { tiendaNombre: string | null }` y su resolvedor `unir(...)`.
      **Hecho cuando:** hay test de la etiqueta con nombre presente y con `null`, y **no** entra la
      `descripcion` del cargo (R30).

## Tanda D — el rastro (backend). Depende de: A.1, C.1, C.2

- [ ] **D.1 — `WalletTiendaMovimientoRepository.registrarCargoEnHistorial(tx, …)`**, forma
      `recibe_tx`: lee el nombre de la tienda con `tx.usuario.findUnique` y llama a `appendAccion`
      con `resolverActorCongelado`.
      **Hecho cuando:** el método NO abre transacción propia (el tipo no se lo permite) y su test
      unitario comprueba que el `monto` llega como `Prisma.Decimal` construido del STRING.
- [ ] **D.2 — CENSO de la guardia.** Entrada nueva en
      `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`: tipo
      `cargo_tienda_registrado`, archivo `lib/repositories/WalletTiendaMovimientoRepository.ts`,
      método `registrarCargoEnHistorial`, forma `recibe_tx`, mutación `/tx\.usuario\.findUnique\(/`.
      **Hecho cuando:** la guardia pasa **y** su contraprueba sigue funcionando (quitar el
      `appendAccion` del cuerpo la pone roja).

## Tanda E — el servicio de escritura (backend). Depende de: A.1, A.2, A.3, D.1

- [ ] **E.1 — `ICargoTiendaService` + `CargoTiendaService.registrarCargo`.** Orden fijo: rol →
      escala 2 → validación de la tienda → `randomUUID` → `runTransaction` → saldo derivado.
      **Hecho cuando:** `tests/unit/services/cargo-tienda-service.test.ts` cubre cada rama y verifica
      que **con rol no autorizado ningún doble de repositorio recibe una sola llamada** (R12: el
      guard va antes de la base, no después).
- [ ] **E.2 [Q1] — `ICajaCargoTiendaPort` + `CajaCargoTiendaService`**, `ingreso` /
      `ingreso_ajuste`, con el enlace de Q1.a.
      **Hecho cuando:** un test afirma la categoría **literal** `ingreso_ajuste` (es el contrato: es
      lo que la hace `propio` y por tanto ganancia, R32) y otro afirma que el `monto` del ingreso es
      el MISMO string que el del asiento de la tienda (R31).
- [ ] **E.3 [Q1] — Cablear el puerto en `CargoTiendaService`**, sin valor por defecto en el
      constructor.
      **Hecho cuando:** quitar el argumento del composition root **no compila** — el criterio de
      `LiquidacionService.ts:246-252` y la cicatriz del *composition root que no inyecta*.

## Tanda F — el borde (backend). Depende de: E.1 (+E.3 si Q1)

- [ ] **F.1 — `registrarCargoTiendaAction` en `lib/actions/wallet-tienda.ts`**, con
      `resolveActorFromSession` + `UnauthenticatedError` + `withErrorHandler`, y `deps` inyectables.
      **Hecho cuando:** `tests/unit/actions/wallet-tienda-cargo-action.test.ts` cubre
      `unauthenticated`, `forbidden`, `validation_error` (ZodError traducido) y `ok`.
- [ ] **F.2 — Composition root.** La `build…` de esa action construye repositorio(s), servicio y
      **[Q1]** puerto.
      **Hecho cuando:** un test comprueba que alguien **PASA** el puerto, no solo que el archivo lo
      importa.

## Tanda G — Postgres real (backend). Depende de: E.*, F.*, B.*

- [ ] **G.1 — `tests/integration/db/wallet-tienda-cargo.test.ts`.** Contra Postgres real:
      (a) el `INSERT` del cargo pasa el CHECK `tipo`/`categoria`; (b) un `debito` con
      `ajuste_credito` lo RECHAZA la base; (c) el cargo baja el saldo derivado exactamente en su
      importe (R24); (d) **[Q1]** las dos filas nacen juntas y un fallo forzado en la segunda no deja
      la primera (R26); (e) **[Q1.a=enlace]** dos cargos distintos ⇒ dos ingresos (R35).
      **Hecho cuando:** cada aserción se mata con una mutación deliberada antes de creérsela, y el
      archivo no aparece como `skipped` por falta de `.env`.

## Tanda H — pantalla (frontend). Depende de: F.1

- [ ] **H.1 — `wallet-conceptos-manuales.ts`:** la categoría se muda dentro de `DestinoConcepto`,
      entra la clase `cargo_tienda` y `nombreEnElLibro` resuelve por clase (`design.md` §4).
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

## Tanda I — cierre. Depende de: todas

- [ ] **I.1 — Mapa R→test en `progress/impl_381-cargo-manual-a-tienda.md`.** Los **35** requisitos
      (o **30** si Q1 = «no»), cada uno con archivo y nombre de test.
      **Hecho cuando:** no queda ni un `R<n>` sin fila. El reviewer rechaza si falta alguno.
- [ ] **I.2 — Gate.** `./init.sh --rapido` **se negará solo** (el diff toca `db/schema.prisma`,
      `lib/types/` y una migración) ⇒ corre `./init.sh` completo.
      **Hecho cuando:** `INIT_EXIT=0` escrito **dentro** del log, y los `skipped` revisados uno a uno
      (78 archivos de `integration/db` se saltan sin `.env` y aun así el init dice OK).
- [ ] **I.3 — Ver la app.** Registrar un cargo real en local y comprobar con los ojos: aparece en
      `/wallet/tiendas` dentro del desglose de ESA tienda, en `/mi-wallet` de esa tienda, en el
      historial de acciones, y **[Q1]** en el libro de la caja de `/wallet`.
      **Hecho cuando:** las cuatro (o tres) pantallas están vistas, con el importe **idéntico** en
      todas. Un backend sin pantalla no es entrega.

---

## Trazabilidad R → test

| R | Qué prueba | Dónde |
| --- | --- | --- |
| R1 | el catálogo tiene cinco conceptos y el quinto es el cargo | `tests/unit/components/wallet-conceptos-manuales.test.ts` |
| R2 | elegido el cargo, el campo de tienda está en el DOM | `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R3 | con los otros cuatro, el payload no gana ninguna clave | idem |
| R4 | el diálogo nombra libro y nombre del concepto elegido | idem |
| R5 | el selector se puebla con las tiendas activas, en orden | idem (con `listarAdminTiendas` mockeada) |
| R6 | catálogo caído ⇒ aviso + cargo bloqueado, resto usable | idem |
| R7 | confirmar sin tienda ⇒ error de campo y cero llamadas | idem |
| R8 | dos clics ⇒ una llamada | idem |
| R9 | ok ⇒ toast, cierre y `onRegistrado` | idem |
| R10 | rechazo ⇒ lo tecleado sobrevive y el motivo va bajo su campo | idem |
| R11 | los cuatro conceptos previos, byte a byte | `wallet-conceptos-manuales.test.ts` + el de diálogo |
| R12 | rol no autorizado ⇒ `forbidden` **sin llamar a ningún repo** | `tests/unit/services/cargo-tienda-service.test.ts` |
| R13 | sin sesión ⇒ `unauthenticated` | `tests/unit/actions/wallet-tienda-cargo-action.test.ts` |
| R14 | monto inválido ⇒ rechazo | `tests/unit/types/wallet-tienda-cargo-schema.test.ts` |
| R15 | descripción vacía ⇒ rechazo | idem |
| R16 | fecha inválida/futura/fuera de ventana, mismo texto | idem |
| R17 | tienda inexistente / rol / inactiva ⇒ error de campo, cero escrituras | `cargo-tienda-service.test.ts` |
| R18 | el STRING llega intacto a la base; ni un `Number()` | `wallet-tienda-cargo-schema.test.ts` + `tests/integration/db/wallet-tienda-cargo.test.ts` |
| R19 | el asiento con tipo, categoría, monto, descripción, fecha y actor | `cargo-tienda-service.test.ts` + integración |
| R20 | `origen_tipo = manual`, `origen_id = NULL` | `cargo-tienda-service.test.ts` |
| R21 | sin fecha elegida ⇒ la clave no viaja (default de columna) | idem |
| R22 | el servicio no expone editar/borrar/reversar un cargo | guardia de superficie en `cargo-tienda-service.test.ts` |
| R23 | un cargo produce **una** fila en el ledger de la tienda, no dos | idem |
| R24 | el saldo derivado baja exactamente el importe | `tests/integration/db/wallet-tienda-cargo.test.ts` |
| R25 | el cargo no aparece en el libro de otra tienda | idem (dos tiendas sembradas) |
| R26 | fallo en cualquiera de las escrituras ⇒ no queda ninguna | idem |
| R27 | la fila de historial con quién/cuándo/importe/tienda | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` |
| R28 | clasificada `mueve_dinero` | `tests/unit/types/historial-accion*.test.ts` |
| R29 | asiento no escrito ⇒ sin fila de historial | integración (`wallet-tienda-cargo.test.ts`) |
| R30 | la etiqueta no lleva la descripción ni datos de destinatario | `historial-accion-etiquetas` test + `historial-accion-sin-datos-cliente.guardia.test.ts` |
| — | el productor censado existe y es atómico | `historial-accion-escrituras-cubiertas.guardia.test.ts` |
| — | migración y `down.sql` exactos, valor a valor y en orden | `tests/integration/db/historial-accion-cargo-tienda-migration.test.ts` |
| **R31** [Q1] | el ingreso de caja, mismo importe y misma fecha | `tests/unit/services/caja-cargo-tienda.test.ts` + integración |
| **R32** [Q1] | categoría literal `ingreso_ajuste` (⇒ naturaleza `propio`) | `caja-cargo-tienda.test.ts` |
| **R33** [Q1] | el enlace caja ↔ cargo | integración |
| **R34** [Q1] | el cargo se ve en el libro de la caja | `tests/integration/wallet-*.test.tsx` |
| **R35** [Q1] | dos cargos ⇒ dos ingresos, ninguno descartado en silencio | integración |

---

## Notas de ejecución (trampas medidas en este repo)

1. **Otro agente está trabajando en `app/(app)/configuracion/tarifas/`.** Esta ficha no toca ese
   árbol. Si aparece un conflicto ahí, no es de la 381.
2. **Base local compartida:** aplicar B.3 pone rojo el gate de otras ramas. Avisar antes.
3. **`prisma generate` se pisa entre worktrees**; un 404 con el armazón pintado suele ser un cliente
   Prisma rancio, y regenerar no basta: hay que reiniciar el dev server.
4. **No levantar un segundo dev server** si otro agente ya tiene el suyo: comparten `.next`.
5. **El informe del reviewer y el de la implementación se COMMITEAN.** Escribirlos y no commitearlos
   ya costó tres veces en un día.
6. **Un PR verde no dice nada de los tests:** el check de Vercel es un build.
