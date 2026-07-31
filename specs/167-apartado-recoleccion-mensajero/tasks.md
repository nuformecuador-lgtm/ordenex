# Tasks — Feature 167: apartado propio de recolección para el mensajero

> Zona `fullstack`: **backend → frontend**, en la misma rama (`feature/167-apartado-recoleccion-mensajero`)
> y sin merge intermedio. Backend lo ejecuta `backend_dev`; frontend, `frontend_dev`.
> `[P]` = paralelizable con las demás `[P]` **de su mismo bloque**.
>
> ⚠️ La fase 1 deja el **typecheck global en rojo a propósito** desde T1.6 (Entregas pierde
> `porRecolectar` y la UI aún lo pasa). El criterio de "hecho" de cada task de la fase 1 es su propia
> suite, no el typecheck del repo entero. El primer punto en que el typecheck global debe estar verde
> es T3.1.

---

## Fase 0 — Puerta y censo

- [x] **T0.1 — Puerta de aprobación humana del spec.**
  El humano lee los tres archivos y responde "aprobado" o pide cambios. Las 5 preguntas abiertas de
  `requirements.md` se resuelven aquí (buscador, tope 100, borradas, etiqueta del menú, dirección de
  tienda).
  *Hecho:* la decisión queda escrita con fecha y autor en
  `progress/impl_167-apartado-recoleccion-mensajero.md`. Sin esto no se toca código.
  *Bloquea:* todo.

- [x] **T0.2 [P] — Censo de arranque.**
  Grep de `porRecolectar|RecoleccionTiendaPanel|useRecolectarPorGuia|recolectando` sobre `app/`,
  `lib/`, `components/`, `hooks/`, `tests/`.
  *Hecho:* la lista archivo:línea queda en la bitácora y **confirma o corrige** las tablas de
  `design.md §2.3` y `§9`. Si aparece un archivo no listado, se añade allí antes de seguir.
  *Depende de:* T0.1.

- [x] **T0.3 [P] — Verificar el punto de partida en verde.**
  `./init.sh` y `pnpm test` sobre la rama recién creada desde `origin/dev`.
  *Hecho:* salida pegada en la bitácora. Cualquier rojo previo se declara ANTES de tocar nada.
  *Depende de:* T0.1.

---

## Fase 1 — Backend

### Datos

- [x] **T1.1 — Índice en `orden_historial_estado`.**
  `db/schema.prisma` (modelo `OrdenHistorialEstado`, ~línea 1281) gana
  `@@index([actorUsuarioId, origenTipo, createdAt], map: "orden_historial_actor_origen_created_idx")`.
  Migración `db/migrations/<ts>_orden_historial_idx_actor_origen_created/` con `migration.sql`
  (CREATE INDEX) y `down.sql` (DROP INDEX IF EXISTS). SQL exacto en `design.md §4.2`.
  *Depende de:* T0.2. *Cubre:* R32.
  *Hecho:* `pnpm run db:migrate:create` genera solo el SQL, el `down.sql` está escrito a mano,
  `prisma validate` pasa y `prisma format` no produce diff. El nombre del índice es el explícito
  (no el truncado por defecto).

- [x] **T1.2 — Probar el rollback.**
  `pnpm run db:migrate` y después `pnpm run db:rollback` contra una base de prueba.
  *Depende de:* T1.1. *Cubre:* R32.
  *Hecho:* tras el DOWN el índice no existe (`\d orden_historial_estado`), y re-aplicar el UP lo
  vuelve a crear. Salida real pegada en la bitácora.

- [x] **T1.3 [P] — Test de la migración.**
  `tests/integration/db/orden-historial-actor-origen-index-migration.test.ts`, modelado sobre los
  `*-migration.test.ts` existentes de `tests/integration/db/`.
  *Depende de:* T1.1. *Cubre:* R32.
  *Hecho:* pasa, y falla si se cambia el nombre del índice o el orden de las columnas en cualquiera
  de los dos archivos (verificado por mutación).

### Tipos, repositorio y servicio

- [x] **T1.4 [P] — Tipos del apartado.**
  `lib/types/recoleccion-tienda.ts` gana `RecoleccionOrdenDTO`, `RecolectadaHoyDTO` y
  `ListarRecoleccionResult` (`design.md §5.1`). `lib/interfaces/services/IRecoleccionTiendaService.ts`
  gana `ListarRecoleccionServiceResult` y la firma `listarRecoleccion(actor)`.
  *Depende de:* T0.2. *Cubre:* R38.
  *Hecho:* compila; `RecoleccionOrdenDTO` NO declara `montoCobrar`, `latitud`, `longitud` ni
  `secuenciaRuta`.

- [x] **T1.5 — Repositorio: `findRecoleccionesDeActor`.**
  Método nuevo en `IOrdenHistorialRepository` + `OrdenHistorialRepository` (`design.md §5.3`): where
  por actor + `origen_tipo = recoleccion_tienda` + rango `[desde, hasta)` + `orden.deletedAt = null`,
  `orderBy createdAt desc`, `take: limite`, include de `numGuia`/`numRemision`/`tienda.nombre`.
  *Depende de:* T1.4. *Cubre:* R25, R26, R28, R29.
  *Hecho:* test unitario del repo (doble de Prisma) que asevera el `where` completo, el `orderBy`, el
  `take` y que **NO** filtra por `estatus_destino_id`; `limite <= 0` no emite consulta.

- [x] **T1.6 — Service: `RecoleccionTiendaService.listarRecoleccion`.**
  Amplía el constructor con `Pick<IGestionOrdenRepository,"findMisAsignaciones">`,
  `Pick<IOrdenHistorialRepository,"findRecoleccionesDeActor">` y el reloj inyectable
  `now: () => Date`. Ventana de "hoy" con `fechaCalendarioCR` + `inicioDelDiaCREnUtc` +
  `inicioDelDiaSiguienteCREnUtc` (`design.md §6`). Tope `TOPE_RECOLECTADAS_HOY = 100`, pidiendo
  `TOPE + 1` para derivar `recolectadasHoyRecortada`.
  *Depende de:* T1.5. *Cubre:* R21, R24, R25, R27, R31, R38.
  *Hecho:* `tests/unit/services/recoleccion-tienda-service.test.ts` gana el bloque `listarRecoleccion`
  con, al menos: rol no mensajero → `forbidden`; pendientes acotados al actor y al estado
  `recolectando`; el DTO no lleva cobro ni ruta; la lista sale del historial y sobrevive a que la
  orden esté en `en_bodega_central`; no trae la de otro actor ni la de ayer; bordes de la ventana con
  reloj inyectado (23:59 y 00:00 CR); tope 100 + `recolectadasHoyRecortada`.
  **Los casos R26–R35 de la 157 del mismo archivo siguen verdes sin tocarlos** (R16).

- [x] **T1.7 — Server Action `listarRecoleccion`.**
  En `lib/actions/recoleccion-tienda.ts` (mismo archivo que la confirmación), con `withErrorHandler`
  + `resolveActorFromSession` + `deps` inyectable (`design.md §5.4`).
  *Depende de:* T1.6. *Cubre:* R6.
  *Hecho:* `tests/unit/actions/recoleccion-tienda-action.test.ts` gana los casos: sin sesión →
  `unauthenticated`; rol no mensajero → `forbidden` (viene del service); ok → payload del service.

### Corte limpio en Entregas

- [x] **T1.8 — `MisAsignacionesService`: retirar el tercer bucket.**
  Quitar `ORIGEN_RECOLECCION` (`:42`), su entrada en `findMisAsignaciones` (`:139-143`), el array
  `porRecolectar` y su rama del bucle (`:163-189`) y el campo del `return` (`:216-224`).
  *Depende de:* T1.4. *Cubre:* R34, R36.
  *Hecho:* la llamada queda `findMisAsignaciones(actor.usuarioId, ["por_recoger", "en_reparto"])` y
  0 ocurrencias de `recolect` en el archivo.

- [x] **T1.9 — Contratos de Entregas: retirar `porRecolectar`.**
  `lib/interfaces/services/IMisAsignacionesService.ts:144-149` y `lib/types/gestion-orden.ts:209-210`.
  *Depende de:* T1.8. *Cubre:* R34.
  *Hecho:* compila el backend; a partir de aquí la UI **no** compila hasta la fase 2 (esperado).

- [x] **T1.10 — Adaptar los tests de backend de Entregas.**
  `tests/unit/services/mis-asignaciones-service.test.ts`: retirar el `describe` "tercer grupo por
  recolectar" (7 casos) y **endurecer** la aserción de `:223` a la lista EXACTA
  `["por_recoger","en_reparto"]`. `tests/unit/actions/mis-asignaciones-action.test.ts`,
  `…-causa-devolucion.test.ts`, `…-evidencias.test.ts`: fixtures sin `porRecolectar`.
  *Depende de:* T1.9. *Cubre:* R34, R36.
  *Hecho:* ningún `describe` queda vacío, ningún assert ajeno se pierde, y
  `pnpm test tests/unit tests/integration` pasa.

**Cierre de fase 1:** `tests/unit` + `tests/integration` en verde. Typecheck global en rojo por la UI;
se documenta en la bitácora y se continúa.

---

## Fase 2 — Frontend

### Navegación

- [x] **T2.1 — `IconKey` + ítem de menú.**
  `lib/auth/menu-visibility.ts`: `IconKey` gana `"store"` (con el comentario del porqué, molde de
  `shieldAlert`/`chartColumn`) y `SIDEBAR_ITEMS` gana el ítem "Recolección" → `/recoleccion`, roles
  `["mensajero"]`, justo después de "Entregas". `app/(app)/_components/Sidebar.tsx`: `ICON_BY_KEY`
  gana `store: Store`.
  *Depende de:* fase 1. *Cubre:* R4, R5.
  *Hecho:* `pnpm run typecheck` no se queja del `Record<IconKey, SidebarIcon>` y el ítem aparece solo
  para el mensajero.

- [x] **T2.2 [P] — Tests de navegación.**
  `tests/unit/auth/menu-visibility.test.ts`: la lista exacta del mensajero pasa a
  `["Entregas","Recolección","Ranking","Cierre del día","Perfil"]`; ningún otro rol lo ve; la clave de
  icono es única (molde del R11 de la 129). `tests/components/Sidebar.test.tsx`: `TODAS_LAS_CLAVES`
  gana `"store"` y un caso comprueba que resuelve a su icono PROPIO (clase `lucide-store`).
  *Depende de:* T2.1. *Cubre:* R4, R5.
  *Hecho:* los dos archivos pasan y fallan si el ítem se le da a otro rol o si `store` se mapea al
  icono de otra sección.

### Página y componentes

- [x] **T2.3 — Página `/recoleccion`.**
  `app/(app)/recoleccion/page.tsx`, Server Component calcado de `mis-asignaciones/page.tsx`:
  `resolveActorFromSession` + `notFound()`, `listarRecoleccion()`, `estadoBloqueoMensajero()`,
  `AppPage` con título y descripción, datos al módulo **por props**.
  *Depende de:* T1.7, T2.1. *Cubre:* R1, R2, R3, R6.
  *Hecho:* `tests/components/RecoleccionPage.test.tsx` cubre: rol distinto de mensajero → `notFound`
  (mockeado) sin renderizar datos; sin sesión → `notFound`; mensajero → módulo montado con los datos
  del payload.

- [x] **T2.4 — Mover el hook y retirar el pre-chequeo local.**
  `git mv` de `useRecolectarPorGuia.ts` a `app/(app)/recoleccion/_components/`; su firma pasa a
  `RecoleccionOrdenDTO[]` o a ninguna lista, y se retira el rechazo local de guías ajenas
  (`design.md §7.2`). Se conserva el mapa de toasts por resultado.
  *Depende de:* T2.3. *Cubre:* R10, R12, R13.
  *Hecho:* una guía que no está en la lista cargada **sí** llega a la action; el toast de
  `no_encontrada` sale del resultado del servidor; el corte de código mal formado sigue en el cliente.

- [x] **T2.5 — `RecoleccionModule.tsx`.**
  `git mv` de `RecoleccionTiendaPanel.tsx` + los cuatro cambios de `design.md §7.1`: fuera el
  `return null` de la lista vacía, estado vacío explícito, aviso de bloqueo propio (texto extraído a
  constante compartida con Entregas) y montaje de `RecolectadasHoyLista`.
  *Depende de:* T2.4. *Cubre:* R7, R8, R9, R14, R15, R17, R18, R19, R20, R22, R23.
  *Hecho:* con `porRecolectar = []` el bloque de escaneo sigue en el DOM; con `bloqueado` no está y
  el aviso sí; la agrupación por tienda y el contacto se conservan.

- [x] **T2.6 [P] — `RecolectadasHoyLista.tsx`.**
  Lista más reciente primero con guía, remisión, tienda y hora; vacío explícito; nota de recorte.
  *Depende de:* T2.3. *Cubre:* R24, R28, R30, R31.
  *Hecho:* renderiza el orden recibido sin reordenar, muestra el mensaje de vacío y la nota de
  recorte solo cuando el flag viene en `true`.

- [x] **T2.7 — Tests del apartado nuevo.**
  Renombrar `tests/components/RecoleccionTiendaPanel.test.tsx` →
  `tests/components/RecoleccionModule.test.tsx` según la tabla de `design.md §9`: conservar
  agrupación, contacto ×2, sin gestión, vía manual, código inválido, idempotencia y bloqueo;
  **sustituir** los dos casos invalidados (lista vacía oculta el panel → ahora lo mantiene; guía ajena
  cortada en cliente → ahora la decide el servidor); **añadir** los casos de «Recolectadas hoy» y del
  aviso de bloqueo.
  *Depende de:* T2.5, T2.6. *Cubre:* R7–R23 (parte de componente), R28, R30, R31.
  *Hecho:* `pnpm test tests/components/RecoleccionModule.test.tsx` pasa y ningún assert de la 157 se
  pierde sin sustituto declarado en la bitácora.

### Corte limpio en la UI de Entregas

- [x] **T2.8 — `MisAsignacionesModule.tsx` y `mis-asignaciones/page.tsx`.**
  Quitar el import (`:28`), el bloque montado (`:423-433`), la prop `porRecolectar` (`:62-69`,
  `:108`) y el paso desde la página (`:46`). Sin aviso, sin conteo, sin enlace (decisión 2 del
  humano).
  *Depende de:* T2.5. *Cubre:* R33, R35.
  *Hecho:* 0 ocurrencias de `recolect` en los dos archivos y el typecheck de la UI vuelve a compilar.

- [x] **T2.9 — Adaptar los tests de Entregas.**
  `tests/components/MisAsignacionesModule.test.tsx`: retirar el `describe` de la 157 (`:2448-2514`),
  quitar `porRecolectar` de `renderModule` (`:185`) y añadir el caso "Entregas no monta ninguna
  superficie de recolección". `tests/components/MisAsignacionesPage.test.tsx`: fixtures sin
  `porRecolectar`.
  *Depende de:* T2.8. *Cubre:* R33, R35.
  *Hecho:* `pnpm test tests/components` pasa; los casos de gestión, foco, buscador y filtro siguen
  verdes **sin tocarlos**.

- [x] **T2.10 [P] — Guard de no-reintroducción.**
  `tests/unit/guards/entregas-sin-recoleccion.test.ts` (`design.md §8`), con el molde de
  `tests/unit/guards/recoleccion-no-contamina.test.ts` (incluida su función `sinComentarios`).
  Ámbito: `MisAsignacionesModule.tsx`, `mis-asignaciones/page.tsx`, `MisAsignacionesService.ts`.
  *Depende de:* T2.9. *Cubre:* R33, R34.
  *Hecho:* pasa; y se demuestra que **falla** reintroduciendo a mano una línea con
  `RecoleccionTiendaPanel` (evidencia pegada en la bitácora, línea revertida después).

- [x] **T2.11 [P] — Comprobar que `recoleccion-no-contamina.test.ts` sigue verde SIN tocarlo.**
  *Depende de:* T2.9. *Cubre:* R37, R39.
  *Hecho:* `git diff` de ese archivo **vacío** y el archivo en verde. Si algo lo obliga a cambiar, es
  señal de que la feature tocó el cierre o el ranking: parar y volver a la puerta.

---

## Fase 3 — Cierre

- [x] **T3.1 — Verificación completa.**
  `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `./init.sh`.
  *Depende de:* fase 2. *Cubre:* todos.
  *Hecho:* los cuatro en verde con la salida real pegada en la bitácora. Este es el primer punto en
  que el typecheck global debe estar verde.

- [x] **T3.2 — Mapa de trazabilidad `R<n> → test`.**
  Los 39 requisitos, cada uno con archivo y nombre del test que lo cubre.
  *Depende de:* T3.1.
  *Hecho:* `progress/impl_167-apartado-recoleccion-mensajero.md` contiene la tabla completa, sin
  ningún `R<n>` sin test. Si alguno queda sin cubrir, se declara en vez de ocultarse.

- [x] **T3.3 [P] — E2E: declarar el estado real.**
  No hay harness de Playwright ejecutable en este repo (los specs existentes lo registran como
  `NOT EXECUTED`).
  *Depende de:* T3.1.
  *Hecho:* la bitácora declara el checkpoint E2E **inaplicable**, con el riesgo cubierto por la lista
  de verificación en pantalla de T3.4.

- [x] **T3.4 — Lista de verificación humana en pantalla.**
  *Depende de:* T3.1.
  *Hecho:* la bitácora deja la lista y el humano la recorre: (1) el mensajero ve "Recolección" en el
  menú; (2) entra **sin ninguna recolección asignada** y el escáner está ahí, con el vacío explicado;
  (3) escanea el QR de una etiqueta suya y la orden salta de "por recolectar" a "recolectadas hoy";
  (4) la bodega central la recibe (138) y la orden **sigue** en "recolectadas hoy"; (5) con un cierre
  pendiente no hay escáner pero sí aviso, lista e historial del día; (6) Entregas no menciona la
  recolección por ningún lado.

- [x] **T3.5 — Estado y bitácora.**
  `feature_list.json` (167 → `done`, `branch`, `spec_path`, `status_note` de 3–6 líneas),
  `progress/current.md` y una entrada en `progress/history.md`.
  *Depende de:* T3.2, T3.4.
  *Hecho:* los tres archivos actualizados y `./init.sh` en verde tras el cambio de estado.
