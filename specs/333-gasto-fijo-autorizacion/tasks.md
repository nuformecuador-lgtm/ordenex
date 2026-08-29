# Ficha 333 — Tareas

> **Secuencia obligatoria: backend → frontend.** Zona `fullstack`; el `implementer` delega en
> `backend_dev` las tandas A–F y en `frontend_dev` la tanda G, **nunca en paralelo entre sí** (la G
> consume tipos y actions que nacen en la F).
>
> **Antes de empezar, dos condiciones que no son opcionales:**
>
> 1. **`DATABASE_URL` exportada en la sesión.** Trece requisitos de esta ficha viven en el motor
>    (índices únicos, CHECK, transacciones) y sin base **se saltan en silencio**: la suite sale verde
>    sin haber tocado la capa de datos. En un worktree el `.env` no viaja — es lo normal, no una
>    máquina rara.
> 2. **El gate de esta ficha es `./init.sh` COMPLETO.** El diff toca `db/migrations/**`,
>    `db/schema.prisma`, `lib/types/**` y una docena de archivos con nombre de dinero: `--rapido`
>    **se niega solo**. No lo intentes «por si acaso»: cuesta el mismo minuto y termina en `fail`.
>
> **Y una tercera, para el leader:** esta ficha **no puede correr en paralelo con la 332** (ni con la
> 85). Las tres tocan `GastosFijosPlantillasPanel.tsx`, `GastoFijoPlantillaDialog.tsx`,
> `lib/types/gasto-fijo-plantilla.ts`, `lib/services/GastoFijoPlantillaService.ts` y
> `lib/actions/gasto-fijo-plantilla.ts` — conflicto de archivos según `AGENTS.md > Paralelismo`.
>
> Marcas: `[P]` = puede ir en paralelo con las otras `[P]` de su misma tanda.

---

## T0 · Preparación

- [ ] **T0.1** — Rama `feature/333-gasto-fijo-autorizacion` desde `origin/dev`, con `git fetch origin
  dev` inmediatamente antes.
  **Hecho cuando:** `git log --oneline -1 origin/dev` coincide con la base de la rama.
- [ ] **T0.2** — Confirmar en el archivo real (no en el grafo) que siguen vivos:
  `wallet_movimiento_origen_categoria_uq`, `notificacion_dedupe_key`, `esAccesoTotal`, `periodoDe`,
  `notificadorNoOp` y el `Promise.all` de `app/(app)/wallet/page.tsx`.
  **Hecho cuando:** los seis están citados con archivo:línea en `progress/impl_333.md`.
- [ ] **T0.2b** — Comprobar **en el árbol** si la ficha **332** ya está mergeada: ¿existe
  `eliminarPlantilla` en `lib/services/GastoFijoPlantillaService.ts`? La respuesta decide la rama de
  **F1b** y si **G7** cubre R55 o lo declara no aplicable.
  **Hecho cuando:** la respuesta (sí/no, con archivo:línea o con la constancia de la ausencia) está en
  `progress/impl_333.md`.
- [ ] **T0.3** — `pnpm exec prisma migrate status` para saber **contra qué base** se va a migrar y que
  no haya drift previo.
  **Hecho cuando:** la salida (host incluido, sin credencial) está pegada en `progress/impl_333.md`.

---

## Tanda A · Datos (backend) — bloquea todo lo demás

- [ ] **A1** — Migración `<ts>_gasto_fijo_cobro`: `CREATE TYPE gasto_fijo_cobro_estado`,
  `CREATE TABLE gasto_fijo_cobro` con los **cinco CHECK**, las **tres FK** (`plantilla_id` SET NULL,
  `decidido_por` RESTRICT, `movimiento_id` RESTRICT), `gasto_fijo_cobro_origen_uq`, los tres índices,
  `ENABLE ROW LEVEL SECURITY`, y `ALTER TABLE gasto_fijo_plantilla ADD COLUMN requiere_aprobacion
  BOOLEAN NOT NULL DEFAULT true`. Generada con `pnpm run db:migrate:create` (no aplica sola).
  **Depende de:** T0. **Hecho cuando:** el `.sql` existe, lleva cabecera explicando por qué cada CHECK,
  y **no** contiene ningún `UPDATE`/`DELETE` sobre tablas existentes.
- [ ] **A2** — `down.sql` de A1: `DROP TABLE gasto_fijo_cobro` → `DROP TYPE gasto_fijo_cobro_estado` →
  `ALTER TABLE gasto_fijo_plantilla DROP COLUMN requiere_aprobacion`, en ese orden.
  **Depende de:** A1. **Hecho cuando:** `pnpm run db:rollback` aplica y vuelve a aplicar sin error en la
  base local.
- [ ] **A3** — Migración `<ts+1>_notificacion_evento_gasto_fijo_cobro`: los **dos**
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS` (`notificacion_evento` += `gasto_fijo_cobro_pendiente`;
  `notificacion_entidad_tipo` += `gasto_fijo_cobro_dia`). **Archivo aparte y timestamp propio**
  (`55P04`).
  **Depende de:** A1. **Hecho cuando:** el `.sql` contiene sólo esos dos `ALTER TYPE` y su cabecera
  explica por qué va sola.
- [ ] **A4** — `down.sql` de A3: recrear **los dos** tipos con la lista previa exacta (**ocho** valores
  en `notificacion_evento`, **seis** en `notificacion_entidad_tipo`), patrón literal del down de la
  262. Cabecera con la pregunta obligatoria respondida sobre los **cuatro** downs previos y con la
  precondición ruidosa.
  **Depende de:** A3. **Hecho cuando:** ningún `down.sql` anterior aparece en `git diff --name-only`.
- [ ] **A5** — `db/schema.prisma`: modelo `GastoFijoCobro`, enum `GastoFijoCobroEstado`, columna
  `requiereAprobacion` en `GastoFijoPlantilla` y las **tres back-relations** (`GastoFijoPlantilla`,
  `Usuario`, `WalletMovimiento`). Comentarios de cabecera del modelo explicando la clave `origen_id` y
  las copias de concepto/monto.
  **Depende de:** A1. **Hecho cuando:** `pnpm exec prisma validate` pasa y `prisma migrate diff` no
  propone nada que las migraciones no hayan escrito.
- [ ] **A6** — Aplicar (`pnpm run db:migrate`) y regenerar el cliente. **Reiniciar el dev server** si
  estaba levantado (un cliente Prisma rancio da 404 con el armazón pintado).
  **Depende de:** A2, A4, A5. **Hecho cuando:** `prisma migrate status` dice «up to date».
- [ ] **A7** — `tests/integration/db/gasto-fijo-cobro-migration.test.ts`: RLS habilitada (**R50**),
  CHECK de monto (**R52**), `DELETE` de plantilla con pendiente vivo **falla** y tras cancelar
  **funciona** (**R46**), y el cobro decidido sobrevive con su copia (**R47**). Contra Postgres real,
  envuelto en `HAY_BASE_DE_DATOS`.
  **Depende de:** A6. **Hecho cuando:** los cuatro casos **corren** (no «skipped») y uno de ellos muere
  al quitar el CHECK.
- [ ] **A8** `[P]` — `tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts`: los dos
  valores existen, `notificacion_dedupe_key` conserva `NULLS NOT DISTINCT` y su `WHERE` parcial tras la
  reconstrucción del down (**R53**), y el down aborta si queda una fila con el valor nuevo (**R54**).
  **Depende de:** A6.

---

## Tanda B · Tipos y contratos (backend)

- [ ] **B1** — `lib/types/gasto-fijo-cobro.ts`: `GastoFijoCobroDTO` (monto **STRING**), schemas zod
  `.strict()` de las tres actions y los tipos de resultado de servicio/action.
  **Depende de:** A5. **Hecho cuando:** `pnpm typecheck` pasa y el DTO **no** expone `origenId`,
  `plantillaId` ni `movimientoId`.
- [ ] **B2** `[P]` — `lib/types/gasto-fijo-plantilla.ts`: `requiereAprobacion` en el DTO y en los
  schemas de crear/actualizar **con `.default(true)`** (patrón de la periodicidad de la 84) (**R2**).
  **Depende de:** A5.
- [ ] **B3** `[P]` — `lib/types/notificacion.ts`: el evento `gasto_fijo_cobro_pendiente` y el
  `entidad_tipo` `gasto_fijo_cobro_dia`, **con el comentario que declara que la entidad es EL DÍA y no
  una fila de tabla**, citando el fallo de la 262.
  **Depende de:** A5.
- [ ] **B4** — Interfaces: `lib/interfaces/repositories/IGastoFijoCobroRepository.ts` y
  `lib/interfaces/services/IGastoFijoCobroService.ts`; ampliar
  `IGeneracionGastosFijosService.GeneracionGastosFijosResult` con `cobrosPendientesCreados` y
  `cobrosPendientesTotales`; ampliar `IWalletMovimientoRepository` con `obtenerPorOrigen`.
  **Depende de:** B1.

---

## Tanda C · Repositorios (backend)

- [ ] **C1** — `lib/repositories/GastoFijoCobroRepository.ts`: `crearPendientes(tx, inputs)` con
  `createMany({ skipDuplicates: true })`, `obtenerPorId(tx?, id)`, `listarPendientes(tope)` +
  `contarPendientes()`, `marcarDecidido(tx, id, estado, actorId, ahora)` con
  **`WHERE id AND estado='pendiente'`** devolviendo el `count`, `enlazarMovimiento(tx, id, movId)` y
  `cancelarPendientesDePlantilla(tx, plantillaId, actorId, ahora)` devolviendo el `count`.
  Money-safe: `Decimal → toFixed(2)` en el mapper, `new Prisma.Decimal(string)` al escribir.
  **Depende de:** B4. **Hecho cuando:** el archivo no contiene `parseFloat`, `Number(` ni `+monto`.
- [ ] **C2** — `WalletMovimientoRepository.obtenerPorOrigen(tx, origenTipo, origenId, categoria)`
  (`findFirst`, único por el índice). **No** se añade ningún `update` ni `delete`: el libro sigue
  inmutable.
  **Depende de:** B4. **Hecho cuando:** la clase sigue sin exponer mutaciones del libro.
- [ ] **C3** `[P]` — `GastoFijoPlantillaRepository`: `requiereAprobacion` en `toDTO`, en `crear` y en
  `actualizar`.
  **Depende de:** B2.

---

## Tanda D · Servicios (backend)

- [ ] **D1** — `lib/auth/acceso-total.ts`: `ROLES_DECIDEN_COBRO_GASTO_FIJO` y
  `puedeDecidirCobroGastoFijo`, con el comentario que declara la excepción a la paridad de la 94.
  **`esAccesoTotal` no se modifica.**
  **Depende de:** T0. **Hecho cuando:** `git diff lib/auth/acceso-total.ts` es puramente aditivo.
- [ ] **D2** — `lib/services/GastoFijoCobroService.ts`: `listarPendientes` (guard `esAccesoTotal`),
  `aprobar` y `rechazar` (guard `puedeDecidirCobroGastoFijo`), `cancelarPorPlantilla`. `aprobar`
  sigue **exactamente** la secuencia de `design.md` §6.3 dentro de `$transaction`, con reloj
  inyectado.
  **Depende de:** C1, C2, D1. **Hecho cuando:** el servicio no importa Prisma directamente y recibe
  repos + cliente de escritura por constructor.
- [ ] **D3** — `lib/services/GeneracionGastosFijosService.ts`: partición por `requiereAprobacion`, las
  **dos** escrituras dentro de **una** `$transaction`, conteo de pendientes totales y llamada al
  notificador **fuera** de la transacción. El camino «cobra sola» queda **idéntico**.
  **Depende de:** C1, E2. **Hecho cuando:** los tests existentes de
  `generacion-gastos-fijos-service.test.ts` pasan **sin editarlos** para el camino automático.
- [ ] **D4** `[P]` — `GastoFijoPlantillaService`: pasar `requiereAprobacion` en crear/actualizar. Sin
  tocar guards.
  **Depende de:** C3.
- [ ] **D5** — `tests/unit/services/gasto-fijo-cobro-service.test.ts`: **R14, R16, R20, R21, R23, R24,
  R25, R45, R49** con dobles.
  **Depende de:** D2.
- [ ] **D6** — `tests/unit/services/generacion-gastos-fijos-service.test.ts` (ampliar): **R5, R6, R7,
  R8, R11, R12**.
  **Depende de:** D3.
- [ ] **D7** — `tests/integration/db/gasto-fijo-cobro-aprobacion.test.ts` (Postgres real): **R15, R17,
  R18, R19**, incluidas **dos aprobaciones concurrentes** del mismo cobro.
  **Depende de:** D2, A6. **Hecho cuando:** el caso concurrente deja **un** movimiento y **una**
  decisión, y muere al quitar el `estado='pendiente'` del `WHERE`.
- [ ] **D8** — `tests/integration/db/gasto-fijo-cobro-idempotencia.test.ts` (Postgres real): **R9,
  R10, R22, R51**.
  **Depende de:** D3, A6. **Hecho cuando:** el caso de R51 muere al borrar
  `gasto_fijo_cobro_origen_uq`, y esa mutación queda anotada en `progress/impl_333.md`.

---

## Tanda E · Notificación (backend)

- [ ] **E1** — `lib/notificaciones/emitir.ts`: `textoCobrosGastoFijoPendientes(n)` (singular/plural),
  `GastoFijoCobroPendienteContexto { pendientes, diaCR }` y `emitirGastoFijoCobroPendiente`, con
  `entidadTipo: "gasto_fijo_cobro_dia"`, `entidadId: diaCR`, destinatario `rol: maestro`,
  `tipo: "warning"`, `anexo: null`. El texto **sólo** vive aquí.
  **Depende de:** B3.
- [ ] **E2** — `lib/notificaciones/notificadores.ts`: el tipo del notificador,
  `notificarGastoFijoCobroPendienteCon(repo, logger?)` (best-effort) y el binding
  `notificarGastoFijoCobroPendienteReal`. `notificadorNoOp` gana el nuevo tipo en su intersección.
  **Depende de:** E1.
- [ ] **E3** — `app/api/cron/generar-gastos-fijos/route.ts`: `buildService()` **inyecta**
  `notificarGastoFijoCobroPendienteReal`. Nada más cambia (el `CRON_SECRET` sigue verificándose antes
  de cualquier efecto).
  **Depende de:** E2, D3. **Hecho cuando:** borrar esa línea pone rojo el test de E5.
- [ ] **E4** — `tests/unit/notificaciones/gasto-fijo-cobro-aviso.test.ts`: **R29, R30, R32, R33, R35**
  con repositorio doble.
  **Depende de:** E2.
- [ ] **E5** — Ampliar `tests/unit/services/notificacion-notificadores-reales.test.ts`: el cableado del
  cron entra en el censo **afirmando sobre el uso efectivo** (`fuenteSinImportsNiComentarios`), y
  `GeneracionGastosFijosService.ts` entra en `SERVICES_CON_NOTIFICADOR` (**R34**).
  **Depende de:** E3. **Hecho cuando:** borrar el argumento del composition root lo pone rojo, y
  borrar sólo el `import` **también**.
- [ ] **E6** — Ampliar la lista literal de
  `tests/unit/services/notificacion-productores-wiring.test.ts` con el evento nuevo (**R36**).
  **Depende de:** B3. **Hecho cuando:** la lista tiene nueve valores y sigue siendo literal (no
  derivada del schema).
- [ ] **E7** — `tests/integration/db/gasto-fijo-cobro-aviso-dedupe.test.ts` (Postgres real): dos
  corridas del **mismo** día ⇒ **un** aviso; dos días distintos ⇒ **dos** (**R31**, contraparte de
  R30).
  **Depende de:** E3, A6.

---

## Tanda F · Borde (backend)

- [ ] **F1** — `lib/actions/gasto-fijo-cobro.ts`: las **cuatro** Server Actions (listar, aprobar,
  rechazar, contar-pendientes-de-una-plantilla) con el patrón exacto de `wallet-egresos.ts`
  (actor → `UnauthenticatedError` → `parse` → servicio bajo `withErrorHandler`). Ninguna acepta monto
  del cliente.
  **Depende de:** D2, B1.
- [ ] **F1b** — Sutura con la **332** (`specs/332-…/design.md §5`, su R26):
  - Si `eliminarPlantilla` **ya existe** en el árbol (332 mergeada): **modificarlo** para abrir
    transacción, llamar a `cancelarPendientesDePlantilla` y devolver el conteo real en
    `EliminarPlantillaServiceResult`; actualizar los tests de la 332 que toque (**R45, R56**).
  - Si **no existe** (333 va primero): dejar el método del repositorio + la guardia condicional de
    H4, y **no** inventar el borrado.
  **Depende de:** C1, D2. **Hecho cuando:** `progress/impl_333.md` dice cuál de los dos casos era, con
  la evidencia de haberlo comprobado en el archivo real.
- [ ] **F2** — `tests/unit/actions/gasto-fijo-cobro-actions.test.ts`: **R26** (las tres sin sesión, sin
  tocar el servicio) + traducción de `validation_error`.
  **Depende de:** F1.
- [ ] **F3** `[P]` — `tests/unit/guards/gasto-fijo-decision-rol.guardia.test.ts`: **R27** (el camino de
  decisión no usa `esAccesoTotal`) y **R28** (los demás servicios de wallet/plantillas siguen
  usándolo). Sobre fuente **sin imports ni comentarios**.
  **Depende de:** D2.
- [ ] **F4** `[P]` — `tests/unit/guards/gasto-fijo-cobro-money-safe.guardia.test.ts`: **R43** — ningún
  archivo nuevo de la ficha contiene `parseFloat`, `Number(`, `toFixed()` sobre un `number` ni
  aritmética sobre montos fuera de `Prisma.Decimal`.
  **Depende de:** C1, D2, F1.

---

## Tanda G · Pantalla (frontend) — arranca sólo con A–F cerradas

- [ ] **G1** — `app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx`: `Card` +
  `CardHeader` + `CardTitle` + `CardDescription` + `CardAction` con `Badge variant="warning"` +
  `DataTable`. Sin `descarga`, sin `Pagination`, **sin `({X.length})`**: el número sale del `total`
  del servidor. Acciones por fila sólo si `puedeDecidir`.
  **Depende de:** F1. **Hecho cuando:** `pnpm lint` y `pnpm typecheck` pasan y el archivo no contiene
  `parseFloat` ni `Number(`.
- [ ] **G2** — `WalletModule.tsx`: monta la sección **entre** la tarjeta de la caja y la de la
  ganancia; si `total === 0` no la renderiza; tras aprobar/rechazar recarga sección + libro + resumen
  + composición + desglose con los filtros vigentes.
  **Depende de:** G1.
- [ ] **G3** — `app/(app)/wallet/page.tsx`: añade `listarCobrosPendientesAction({})` al `Promise.all`
  ya existente y pasa `{ items, total }` y `puedeDecidir = actor.rol === RolValue.maestro` por props.
  El guard de la página **no se toca**.
  **Depende de:** G2.
- [ ] **G4** `[P]` — `GastoFijoPlantillaDialog.tsx` + `GastosFijosPlantillasPanel.tsx`: interruptor
  «Cobra sola» / «Requiere aprobación» en el diálogo y columna `Badge` en la tabla, con el texto
  saliendo de un módulo puro. Y **corregir la descripción de la tarjeta**, que hoy afirma que el
  sistema cobra automáticamente cada mes (**R4**).
  **Depende de:** B2, D4.
- [ ] **G5** — `tests/unit/components/wallet-cobros-pendientes-panel.test.tsx`: **R37, R38, R39, R40,
  R42**.
  **Depende de:** G2.
- [ ] **G6** `[P]` — `tests/unit/components/wallet-page-cobros-pendientes.test.tsx`: **R44** (la página
  pre-obtiene y pasa por props; sin sesión o sin acceso total, `notFound`).
  **Depende de:** G3.
- [ ] **G7** `[P]` — `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` (ampliar): **R4** y
  **R48** en la superficie, y —**sólo si la 332 ya está mergeada**— **R55**: el diálogo de
  confirmación de borrado llama a `contarCobrosPendientesDePlantillaAction` al abrirse y enseña «se
  cancelarán N cobros pendientes» **antes** de aceptar.
  **Depende de:** G4, F1b.

---

## Tanda H · Censos y guardias que esta ficha DEBE actualizar

> Ninguna de estas tres se selecciona por el grafo de imports: **corren siempre** y se ponen rojas
> solas si se olvidan. Están aquí para que no se descubran en el gate.

- [ ] **H1** — `tests/unit/descarga/censo-tablas.ts`: registrar
  `app/(app)/wallet/_components/CobrosGastoFijoPendientesPanel.tsx` como `fuera` con su **nota
  obligatoria** (cola de decisión efímera; lo aprobado aterriza en el libro de la caja, que sí
  descarga), y actualizar los totales de la cabecera con el número **real** medido, no con el del
  spec 170.
  **Depende de:** G1. **Hecho cuando:** `cobertura-tablas.guardia` pasa.
- [ ] **H2** — Verificar `tests/unit/descarga/contadores-cabecera.guardia.test.ts`: **no** debe hacer
  falta registrar nada (no hay `({X.length})`). Si hiciera falta, es señal de que G1 se escribió mal.
  **Depende de:** G1.
- [ ] **H3** — `tests/unit/guards/superficie-de-uso.guardia.test.ts`: comprobar que las cuatro actions
  nuevas tienen consumidor de producción; si alguna no lo tuviera, **es un bug de G**, no una
  excepción que declarar.
  **Depende de:** G3, G4.
- [ ] **H4** — `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` (el archivo que la
  **332** ya nombra en su trazabilidad): **R57** — *si* existe en el árbol una operación que borra
  plantillas, su fuente **sin imports ni comentarios** debe contener la llamada a
  `cancelarPendientesDePlantilla`. Condicional a que el símbolo exista, para que valga con la 332
  mergeada o sin ella.
  **Depende de:** F1b. **Hecho cuando:** con la 332 presente, borrar esa llamada lo pone rojo; sin la
  332, el caso se declara **no aplicable en voz alta** (no «passed» por vacío).

---

## Tanda I · Cierre

- [ ] **I1** — `progress/impl_333.md`: archivos tocados, mapa **`R1..R57 → test`** completo, salida
  real de los tests, y las **tres mutaciones** de la regla de dinero (R14, R16, R51) con su resultado.
  **Depende de:** todas. **Hecho cuando:** no queda ni un `R<n>` sin test nombrado.
- [ ] **I2** — `./init.sh` **completo**, con `DATABASE_URL` exportada y `INIT_EXIT=$?` escrito
  **dentro** del log (un `echo` posterior tapa el exit code; ya pasó).
  **Depende de:** I1. **Hecho cuando:** el veredicto del baseline es verde y el log dice cuántos
  archivos contra Postgres **se ejecutaron** (no «se saltaron»).
- [ ] **I3** — Ver la app con ojos: entrar a `/wallet` como maestro con un pendiente sembrado, aprobar
  uno, rechazar otro, y comprobar la campana. Los tests no ven un texto roto ni un botón que no hace
  nada.
  **Depende de:** I2. **Hecho cuando:** las cuatro comprobaciones están anotadas con lo que se vio.
- [ ] **I4** — `git fetch origin dev` + merge, PR a `dev` con `gh pr create`. **Antes de mergear,
  releer esta ficha**: un PR verde es un build de Vercel y **no corre un solo test**.
  **Depende de:** I3.

---

## Lo que esta ficha NO hace (para que nadie lo añada de paso)

- No toca `periodoDe` ni `aplicaHoy`.
- No toca la reversa del libro ni el cálculo del balance.
- No añade cron ni entrada en `vercel.json`.
- No añade pantalla de histórico de cobros decididos.
- No modifica `esAccesoTotal` ni la autorización de ninguna otra operación.
- No edita ningún `down.sql` anterior.
