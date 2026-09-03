# Ficha 366 — Tasks

Convención de "hecho": cada task se da por terminada cuando compila (`tsc` sin `any` nuevo), pasa lint,
y —si toca DB o repositorio— pasa contra Postgres real (`tests/integration/db`), no solo contra dobles
(ver T8: el `WHERE` de la reconciliación se mide, no se supone).

## 1 — Migración: nuevo tipo de acción del historial `[P]` (independiente del resto)

**Depende de:** nada.

- [ ] `pnpm run db:migrate:create` para generar la carpeta de la migración (nombre sugerido:
  `historial_accion_orden_zona_reconciliada`).
- [ ] `migration.sql`: `ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS
  'orden_zona_reconciliada';` — SOLA en su propia migración, sin backfill ni uso en la misma
  transacción (mismo motivo que `20260731120000_orden_historial_origen_asignacion_recoleccion`).
- [ ] `down.sql`: recrea `historial_accion_tipo` con los 42 valores previos exactos (el orden de
  `20260902120000_historial_accion/migration.sql`), con la MISMA precondición documentada que
  `20260731120000.../down.sql` (revertir solo es seguro si ninguna fila usa todavía el valor nuevo).
- [ ] `pnpm run db:migrate` en local; confirmar que `prisma migrate status` queda limpio.

**Hecho cuando:** la migración aplica limpia en local, el rollback (`pnpm run db:rollback`) también
funciona sobre una base sin filas del tipo nuevo, y `db/schema.prisma` refleja el enum ampliado tras
`prisma db pull`/`generate` (sin drift).

## 2 — Catálogo del historial de acciones (`lib/types/historial-accion.ts`) `[P]` (depende de T1 para el enum de Prisma, no para escribir el archivo)

**Depende de:** T1 (para que `PrismaHistorialAccionTipo` incluya el valor y el `satisfies`/`Exclude`
compilen).

- [ ] Añadir `"orden_zona_reconciliada"` a `HISTORIAL_ACCION_TIPOS`, en la sección "mueve dinero",
  junto a `orden_ubicacion_corregida` (mismo motivo textual).
- [ ] `CATEGORIA_POR_ACCION.orden_zona_reconciliada = "mueve_dinero"`.
- [ ] `ACCION_LABELS.orden_zona_reconciliada = "Actualizó la zona de una orden"`.
- [ ] Confirmar que `_AsegurarExhaustivoTipos` sigue compilando (el chequeo bidireccional ya existe;
  no se toca su mecanismo).

**Hecho cuando:** `tsc` limpio y el test existente de exhaustividad del catálogo (si lo hay bajo
`tests/unit/`) sigue en verde sin haberlo tocado.

## 3 — Refactor: extraer `zonaUnicaDeDistrito` a módulo compartido

**Depende de:** nada (puede ir en paralelo con T1/T2) `[P]`.

- [ ] Crear `lib/repositories/_shared/zona-colapso.ts` con
  `export function zonaUnicaDeDistrito<T>(zonas: readonly T[]): T | null { return zonas.length === 1
  ? zonas[0] : null; }` y el comentario de procedencia (327/B2, colapso 1/0/>1).
- [ ] `OrdenRepository`: quitar el método privado, importar la función del módulo nuevo, y actualizar
  sus dos call-sites (`findDistritosByCantonIds`, `findDistritoParaCorreccion`) para llamarla igual
  que antes (sin cambio de comportamiento).
- [ ] Correr la suite existente de `OrdenRepository` (unit + integration) para confirmar que el
  refactor es transparente: mismo resultado, ningún test tocado en su aserción.

**Hecho cuando:** `git diff` de `OrdenRepository.ts` en esta task NO cambia ningún `expect` de test
existente, solo el origen de la función.

## 4 — `IZonaRepository` / `ZonaRepository.update`: la reconciliación

**Depende de:** T3 (usa la función movida).

- [ ] `lib/interfaces/repositories/IZonaRepository.ts`: nuevo tipo `UpdateZonaResult { zona: ZonaDTO;
  ordenesReconciliadas: number }`; `update` pasa a `update(id, data, actorUsuarioId: string | null):
  Promise<UpdateZonaResult | null>` (design §5.1).
- [ ] `lib/repositories/ZonaRepository.ts`: implementar el flujo de design §6 dentro del
  `$transaction` ya existente de `update` — sin abrir una transacción nueva.
- [ ] `ZonaPrismaClient` (el `Pick<PrismaClient, ...>` del archivo): **no** hace falta ensancharlo
  (`tx` dentro del callback ya expone `orden`/`$queryRaw`/etc. con su tipo completo,
  independientemente del `Pick` del cliente exterior — confirmado en design §6).
- [ ] Reusar `appendAccion`/`resolverActorCongelado` (ya importados en el archivo) y
  `etiquetaDeEntidad` (importar desde `lib/types/historial-accion-etiquetas.ts`, aún no importado en
  este archivo).

**Hecho cuando (unit, con dobles, `tests/unit/repositories/` o `services/`):**
  - reconciliación agrupa por zona resuelta y actualiza solo `zonaId` (R9);
  - `ordenesReconciliadas` cuenta exactamente las filas tocadas (R12);
  - `loteId` es el mismo para todas las filas de historial de un mismo `update()` aunque haya >1 grupo
    (R11);
  - `create()` NO invoca ninguna pieza de este flujo (R13).

## 5 — `tests/integration/db`: el `WHERE` medido contra Postgres real, no contra dobles

**Depende de:** T4.

> Un test que hace `if (!datos) return;` reporta "passed" sin comprobar nada — no vale (lección
> repetida en este repo). Cada exclusión de abajo necesita UN caso semilla que la prueba en verde
> (se reconcilia) Y otro que la prueba en rojo (no se reconcilia, y la aserción falla si se quita la
> condición del `where`). Mutar a mano la condición correspondiente y confirmar que el test
> correspondiente se pone rojo es parte de "hecho", no un extra.

Semillas mínimas por escenario (una zona A con un distrito D, una zona B con distrito D2, etc. — el
detalle exacto de fixtures lo decide quien implemente, pero TODOS estos casos tienen que existir):

- [ ] **Caso base (R2/R4):** distrito D pasa a resolver únicamente la zona A; una orden con
  `distritoId = D`, `zonaId != A`, sin cierre, sin gestión vigente, sin borrar ⇒ tras `update(A, ...)`
  su `zonaId` es A, y hay una fila en `historial_accion` con `accion = 'orden_zona_reconciliada'`,
  `entidad_id` = esa orden, `valor_anterior`/`valor_nuevo`/`monto` NULL.
- [ ] **R3 — 0 zonas:** un distrito que queda sin ninguna fila en `zona_distrito` tras el guardado ⇒
  las órdenes de ese distrito NO cambian de `zonaId` y no aparece fila de historial por ellas.
- [ ] **R3 — >1 zonas:** un distrito que queda en `zona_distrito` de DOS zonas a la vez (posible por
  el `@@unique([zonaId, distritoId])`, no por `distritoId` solo) ⇒ mismo resultado que el caso
  anterior: sin cambios.
- [ ] **R6/R7 — ya facturada:** una orden con una fila en `cierre_detail` ⇒ NO se reconcilia, aunque
  su distrito resuelva otra zona. Mutación a probar: quitar la exclusión `cierreDetalles: { none: {}
  }` del `where` debe poner este test en rojo.
- [ ] **R6/R7 — gestión vigente:** una orden con una fila en `gestion_orden` con `anulada_at IS NULL`
  ⇒ NO se reconcilia. Mutación a probar: quitar `gestiones: { none: { anuladaAt: null } }` debe poner
  este test en rojo.
- [ ] **R6 — gestión anulada SÍ es elegible:** una orden con una fila en `gestion_orden` con
  `anulada_at` NOT NULL (anulada) ⇒ SÍ se reconcilia. Este caso es el que prueba que la condición
  filtra por `anuladaAt: null` y no por "sin ninguna fila de gestión, punto": mutar `anuladaAt: null`
  a "cualquier fila" debe poner este test en rojo (dejaría de reconciliar una orden que sí debería).
- [ ] **Orden borrada:** `deletedAt` NOT NULL en una orden cuyo distrito resuelve otra zona ⇒ sin
  cambios.
- [ ] **R5 — unión antes/después:** una zona A que se guarda SIN cambiar sus distritos (misma lista
  antes y después), con una orden ya desalineada de una edición anterior (simula el caso de
  producción: zona vieja estampada, `zona_distrito` ya apunta a otra) ⇒ el guardado la reconcilia
  igual (self-heal). Es el test que prueba literalmente "volver a guardar la zona reconcilia la
  deriva ya existente".
- [ ] **R5 — distrito recién quitado de esta zona:** distrito D estaba en la zona A y se guarda A SIN
  D en la lista nueva, y D ahora resuelve únicamente la zona B (ya configurada así antes de este
  guardado) ⇒ las órdenes de D con `zonaId = A` pasan a `zonaId = B` en ESTE MISMO guardado de A (no
  hace falta guardar B). Es el test que distingue la unión (§2) del "solo lista final".
- [ ] **R8 — inmutabilidad de `cierre_detail`:** capturar la fila de `cierre_detail` de la orden del
  caso "ya facturada" ANTES y DESPUÉS del `update()` de la zona ⇒ byte a byte idéntica.
- [ ] **R9 — nada más cambia:** capturar `estatusId`, `mensajeroAsignadoId`, `montoCobrar`,
  `direccion` de una orden reconciliada ANTES y DESPUÉS ⇒ idénticos; solo `zonaId` (y `updatedAt`)
  cambian.
- [ ] **R13 — `create()` no reconcilia:** crear una zona nueva con un distrito que YA resolvía otra
  zona de forma ambigua (o que deja una orden preexistente con drift) ⇒ ninguna orden cambia, ninguna
  fila de historial nueva.
- [ ] **R14 — idempotencia:** llamar `update()` dos veces seguidas con el mismo payload ⇒ la segunda
  llamada informa `ordenesReconciliadas: 0` y no añade filas de historial.

**Hecho cuando:** los ~13 casos de arriba están escritos, corren contra la base de test de Postgres
(no contra un doble de Prisma), y cada mutación descrita se probó manualmente al menos una vez durante
el desarrollo (déjalo dicho en el PR, no hace falta un test que pruebe al test).

## 6 — `ZonaService`, tipos y Server Action

**Depende de:** T4.

- [ ] `lib/interfaces/services/IZonaService.ts`: `ActualizarZonaServiceResult` gana
  `ordenesReconciliadas: number` en la rama `"ok"` (design §5.2).
- [ ] `lib/services/ZonaService.ts`: `actualizar` pasa `actor.usuarioId` a `this.repo.update(id, prep.data,
  actor.usuarioId)` y reenvía `ordenesReconciliadas`.
- [ ] `lib/types/zona.ts`: `ActualizarZonaResult` gana el mismo campo (design §5.3).
- [ ] `lib/actions/zonas.ts`: sin cambios de lógica (ya reenvía el resultado del service tal cual);
  confirmar que el tipo fluye sin `any`.

**Hecho cuando (unit, `tests/unit/services/ZonaService...` y `tests/unit/actions/zonas...`):**
`actualizar` con un repo doble que devuelve `ordenesReconciliadas: 5` lo reenvía sin tocarlo, y
`actor.usuarioId` llega al repo (mock) como tercer argumento de `update`.

## 7 — UI: el toast de guardar zona `[P]` (depende solo de T6 para el tipo)

**Depende de:** T6.

- [ ] `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`: en modo editar, si
  `res.ordenesReconciliadas > 0`, el `toast.success` incluye el conteo (texto sugerido: `Zona
  actualizada (N órdenes reubicadas)`; el texto final lo decide quien implemente, en español, sin
  jerga — ver `docs/conventions.md`). Con `0`, el mensaje queda igual que hoy ("Zona actualizada").

**Hecho cuando (component test, `tests/components/...`):** guardar con `ordenesReconciliadas: 3`
pinta el conteo en el toast; guardar con `0` no lo pinta; crear zona nunca lo pinta (el campo no
existe en `CrearZonaResult`).

## 8 — Guardia de "no se retarifa hacia atrás" (opcional pero recomendado)

**Depende de:** T4/T5.

- [ ] Evaluar si conviene un test de guardia (`tests/unit/guards/`) que falle si algún `write` nuevo
  del árbol toca `cierre_detail` o `wallet_movimiento`/`pago_mensajero_movimiento` fuera de los
  puntos ya conocidos — mismo espíritu que `cierre-detail-inmutable` (327). Si ya existe una guardia
  de esa forma, basta con confirmar que este cambio no la rompe; si no existe, es opcional para esta
  ficha (la garantía ya es estructural, §0 de `design.md`) y se puede dejar para quien la quiera
  reforzar.

## Trazabilidad R → test

| Requisito | Task | Test que lo prueba |
| --- | --- | --- |
| R1 | T4, T7 | T5 caso base (una sola llamada, sin confirmación intermedia) + T7 component test |
| R2 | T4 | T5 caso base |
| R3 | T4 | T5 casos "0 zonas" / ">1 zonas" |
| R4 | T4 | T5 caso base |
| R5 | T4 | T5 casos "unión antes/después" y "distrito recién quitado" |
| R6 | T4 | T5 casos "ya facturada", "gestión vigente", "gestión anulada sí elegible", "orden borrada" |
| R7 | T4 | T5 casos "ya facturada" / "gestión vigente" (sin fila de historial) |
| R8 | T4 | T5 caso "inmutabilidad de `cierre_detail`" |
| R9 | T4 | T5 caso "nada más cambia" |
| R10 | T4 | T5 caso base (forma de la fila de historial) |
| R11 | T4 | T5 caso base multi-grupo (unit T4) + integración con >1 zona resuelta si aplica |
| R12 | T4, T6 | T4 unit (`ordenesReconciliadas` cuenta lo tocado) + T6 unit (se reenvía) |
| R13 | T4 | T5 caso "`create()` no reconcilia" |
| R14 | T4 | T5 caso "idempotencia" |
