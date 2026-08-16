# Feature 227 — Hilo de notas por orden entre tienda y mensajero · tasks.md

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas de su mismo
> bloque. Cada task lleva su criterio de "hecho".
>
> **Spec CERRADO (2026-08-14).** Gate humano pasado en tres vueltas; no quedan preguntas abiertas ni
> tareas bloqueadas. Decisiones de cierre: ventana de escritura **asimétrica por rol** (D1), la
> notificación sale íntegra a la ficha **228** (D2) y **sin indicador** en las cards (D3).
>
> Gate de verificación: `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del
> PR, sin excepción** (`docs/verification.md`).

---

## Bloque 0 — Antes de tocar código

- [x] **T0.1 — Conteo informativo contra producción.** Ejecutar:
  `SELECT count(*) AS filas, count(DISTINCT usuario_id) AS mensajeros, min(created_at), max(created_at) FROM orden_mensajero_meta WHERE nota IS NOT NULL;`
  **Hecho:** la salida está pegada en `progress/impl_227.md` con fecha y entorno, y se cita en la
  cabecera de la migración M2 (R23). *Es informativo: NO reabre la decisión de borrar (P1).*
- [x] **T0.2 [P] — Corregir la ficha `feature_list.json` (id 227).** Su `description` dice «hilo
  append-only … sin update»; con P3a/P3c hay borrado lógico por el autor dentro de una ventana.
  **Hecho:** la ficha ya no afirma append-only estricto. *Lo hace el leader.*
  ✔ **2026-08-15 (leader):** hecho al dar de alta la ficha — la `description` dice «un HILO por
  orden … donde cada autor puede BORRAR sus propias notas», y el `status_note` deja escrito que la
  decisión de borrado retiró el append-only con el que nació.
- [x] **T0.3 [P] — Dar de alta la ficha 228** («transición habilitar novedad», `depends_on: 227`) con
  el checklist de arranque de design §8.4.
  **Hecho:** la ficha existe en `feature_list.json` y apunta a `specs/227-hilo-notas-orden/design.md`
  §8 como fuente de lo ya medido. *Lo hace el leader.*
  ✔ **2026-08-15 (leader):** ficha 228 dada de alta (`pending`, `fullstack`, `depends_on: 227`), con
  el coste del enum `NotificacionEvento` ya medido heredado en su `status_note` para que no se
  vuelva a medir, y con el aviso crítico de §8.1: si la transición aterriza en un estatus distinto
  de `en_reparto`, el mensajero podrá leer pero no responder y el aviso lo llevaría a un hilo mudo.

---

## Bloque 1 — Datos

- [x] **T1.1 — Modelo `OrdenNota` en `db/schema.prisma`** (design §1.1), con `deleted_at`.
  **Hecho:** `prisma validate` y `pnpm run typecheck` verdes; lleva `@@index([ordenId, createdAt])`,
  `@@index([autorId])` y `@@map("orden_nota")`.
- [x] **T1.2 — Migración M1 `<ts>_orden_nota`** (`migration.sql` + `down.sql`), design §1.3.
  **Hecho:** `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte dejando el esquema
  idéntico; sin drift.
- [x] **T1.3 — Test de migración M1** `tests/integration/db/orden-nota-migration.test.ts`.
  **Hecho:** verifica tabla, columnas, PK, las dos FK (cascade a `orden`, restrict a `usuario`), los
  dos índices, `relrowsecurity = true` y **cero policies**, y que borrar la orden arrastra sus notas.
  Cubre **R26, R28 (índice), R30**.

Dependencias: T1.2 ← T1.1; T1.3 ← T1.2.

---

## Bloque 2 — Backend (depende del Bloque 1)

- [x] **T2.1 [P] — Interfaces** `IOrdenNotaRepository.ts` e `IOrdenNotaService.ts` (design §2.1/§2.2).
  **Hecho:** typecheck verde; un archivo por interfaz, sin implementación dentro.
- [x] **T2.2 [P] — Tipos y zod** `lib/types/orden-nota.ts`: `CUERPO_MAX = 200`, los tres schemas y
  las tres uniones discriminadas, incluido `puedeEscribir` en el resultado de lectura (design §3).
  **Hecho:** typecheck verde; ningún `any`.
- [x] **T2.3 — Tabla `VENTANA_ESCRITURA` por rol** (design §2.2), reutilizando las constantes de
  estatus existentes (`ESTATUS_DEVUELTA`, `ESTADO_EN_REPARTO`), nunca literales nuevos.
  **Hecho:** un solo punto de decisión en el árbol; el `satisfies` obliga a que ambos valores existan
  en el catálogo de estatus.
- [x] **T2.4 — `OrdenNotaRepository`**: `listarPorOrden` (trae también las borradas, R34), `crear`,
  `marcarBorrada` (con `autorId` en el `where`), `findOrdenParaHilo`.
  **Hecho:** solo Prisma, sin permisos; `listarPorOrden` ordena `createdAt asc, id asc`.
- [x] **T2.5 — Test de integración del repo** `tests/integration/repositories/orden-nota.int.test.ts`.
  **Hecho:** cubre **R3** (orden con instantes repetidos), **R31** (el borrado lógico conserva la
  fila), **R32** (el `where` filtra por autor en el mismo statement).
- [x] **T2.6 — `OrdenNotaService`**: `listar`, `publicar`, `borrar`, con el orden de comprobaciones
  del design §2.2 y la proyección aislada de las notas borradas.
  **Hecho:** sin import de Prisma ni `next/headers`; construible con dobles; el cuerpo de una nota
  borrada nunca sale del service.
- [x] **T2.7 — Tests unitarios del service** `tests/unit/services/orden-nota-service.test.ts`.
  **Hecho:** cubre **R1, R4, R5, R9, R10, R11, R12, R14, R15, R25, R28, R31, R33, R34, R35**.
- [x] **T2.8 — Server Actions** `lib/actions/orden-notas.ts` (design §2.3).
  **Hecho:** `'use server'`; actor por sesión; zod en el borde; `withErrorHandler`; sin `catch`
  vacíos.
- [x] **T2.9 — Tests de las actions** `tests/unit/actions/orden-notas-action.test.ts`.
  **Hecho:** cubre **R6, R7, R8, R13, R27**; con actor `null`, el doble del service NO recibe
  llamadas.

Dependencias: T2.4 ← T2.1/T2.2; T2.6 ← T2.3/T2.4; T2.8 ← T2.6.

---

## Bloque 3 — UI (depende del Bloque 2)

- [x] **T3.1 — `components/shared/HiloNotasOrden.tsx`**: lista cronológica, autor+hora, propio vs
  ajeno, marca «nota eliminada», compositor con contador a 200, borrado de las propias, estado vacío,
  modo solo lectura por `puedeEscribir` (design §5).
  **Hecho:** solo primitivas existentes de `components/ui/`; `pnpm run lint` verde.
- [x] **T3.2 — Tests del componente** `tests/components/HiloNotasOrden.test.tsx`.
  **Hecho:** cubre **R16, R17, R18, R19, R34 (marca visible)**; el control de borrar aparece solo en
  notas propias y solo con `puedeEscribir`.
- [x] **T3.3 — Montaje en `/novedades`** (lado tienda, escribible en `devuelta`).
  **Hecho:** el hilo se abre por orden desde `NovedadesModule` sin añadir consultas al listado
  paginado.
- [x] **T3.4 — Montaje en el panel del mensajero** (`GestionarOrdenPanel`, donde estaba el editor de
  la nota privada retirada), carga bajo demanda.
  **Hecho:** el hilo NO viaja dentro de `listarMisAsignaciones` (sin N+1); el mensajero escribe en
  `en_reparto` y solo lee en el resto.
- [x] **T3.5 — Tests de los dos montajes** `tests/components/NovedadesModuleHilo.test.tsx` y
  `tests/components/GestionarOrdenPanelHilo.test.tsx`.
  **Hecho:** abrir una orden carga su hilo bajo demanda en ambas pantallas; ninguna lista lo pide
  para todas las órdenes.
- [x] **T3.6 — Guardia de bidireccionalidad real**
  `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts`: cruza `VENTANA_ESCRITURA` con el
  conjunto de estatus que lista la pantalla de cada rol (`novedadWhere` para la tienda; la lista de
  `listarMisAsignaciones` para el mensajero) y falla si alguna intersección queda vacía.
  **Hecho:** la guardia pasa y falla si se mueve una ventana o un corte de pantalla. Cubre **R38** y
  **R36** (comprueba además que la lista del mensajero sigue siendo exactamente `por_recoger` y
  `en_reparto`, feature 167/R34).
- [x] **T3.7 — Verificar que NO se añade indicador** (decisión D3): ninguna card gana badge, punto ni
  contador de notas.
  **Hecho:** las tres pos-card no muestran señal de hilo; queda escrito en `progress/impl_227.md`
  que, hasta 228, el mensajero solo ve el hilo si abre la orden.

---

## Bloque 4 — Retiro de la feature 116 (paralelo al Bloque 3)

- [x] **T4.1 — Borrar los módulos propios de la 116** (service, actions, tipos, interfaz, componente;
  design §4).
  **Hecho:** los cinco archivos ya no existen; typecheck verde.
- [x] **T4.2 — Desmontar del panel y del DTO**: `GestionarOrdenPanel.tsx:729-739`, `notaPrivada?` de
  `IMisAsignacionesService.ts:66` y su emisión en `MisAsignacionesService.ts:144-161,183,557-559`.
  **Hecho:** ningún DTO expone el campo; typecheck verde.
- [x] **T4.3 [P] — Retirar del meta-repo** `upsertNota`, `limpiarNota`, `findNotasByMensajero` (impl
  + interfaz).
  **Hecho:** los métodos no existen; los de `marcar_luego` quedan intactos.
- [x] **T4.4 [P] — Retirar badges y preview de las tres pos-card**
  (`PosOrderCard.tsx:203-212`, `PosOrderCardMosaico.tsx:189-198`,
  `PosOrderCardDetalle.tsx:117-122,143-147`).
  **Hecho:** las cards renderizan sin indicador de nota privada y sin huecos de layout. Con T4.2,
  cubre **R21** (tests: `tests/components/PosOrderCard*.test.tsx` +
  `tests/unit/services/mis-asignaciones-service.test.ts`).
- [x] **T4.5 — Limpiar tests**: borrar los cinco archivos propios de la 116 y quitar las referencias
  en los diez que la mencionan de refilón (design §4).
  **Hecho:** `rg "notaPrivada|NotaPrivadaMensajero|nota-privada" tests/ lib/ app/` sin resultados.
- [x] **T4.6 — Guardia de retirada** `tests/unit/guards/nota-privada-retirada.guardia.test.ts`:
  recorre el árbol (no depende del grafo de imports) y falla si reaparecen los símbolos/archivos de
  la 116 o si algún módulo/migración de la 227 lee `orden_mensajero_meta.nota`.
  **Hecho:** la guardia pasa y falla si se reintroduce a mano cualquiera de los dos casos. Cubre
  **R20, R22**.
- [x] **T4.7 — Reescribir el comentario de `lib/types/novedad.ts:32-33`** (design §4).
  **Hecho:** el archivo ya no razona sobre `notaPrivada`; explica que la conversación viaja por
  `orden_nota` y por qué no entra en el `NovedadDTO`.
- [x] **T4.8 — Verificar que la 115 sigue intacta.**
  **Hecho:** `tests/integration/repositories/orden-mensajero-meta.int.test.ts` pasa **sin
  modificarlo** (12 tests). *Corrección del reviewer (m2, 2026-08-15): `tests/components/MarcarLuegoToggle.test.tsx`
  SÍ está modificado (−6 líneas), y la afirmación original de esta celda era falsa. El cambio es
  correcto y obligado —se retiró el `vi.mock` de `lib/actions/notas-privadas-mensajero`, módulo que
  esta feature borra, y sin retirarlo el archivo reventaría al importar—, pero es un cambio de
  ANDAMIAJE, no de comportamiento: ninguna aserción del toggle se tocó. Lo que R24 exige —que
  `marcar_luego` siga comportándose igual— sigue demostrado.* Cubre **R24**.
- [x] **T4.9 — Verificar que `orden.notas` sigue intacta** en el detalle del mensajero.
  **Hecho:** `AsignacionDetalle` sigue mostrando la nota de la tienda con su etiqueta. *Corregido en
  implementación (2026-08-15): el spec suponía un test de componente «existente» y NO existía ninguno;
  se creó `tests/components/AsignacionDetalle.test.tsx`.* Con T2.7, cubre **R25**.
- [x] **T4.10 — Migración M2 (DESTRUCTIVA) `<ts>_orden_mensajero_meta_drop_nota`** + `down.sql` +
  `tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts`.
  **Hecho:** up quita la columna, down la repone nullable, el índice único y `marcar_luego` quedan
  intactos, y la cabecera cita el conteo de T0.1 y la decisión humana de pérdida definitiva. Cubre
  **R23**.
- [x] **T4.11 [P] — Nota histórica en `specs/116-notas-privadas-mensajero/`**: «RETIRADA por la
  feature 227 (2026-08-14)».
  **Hecho:** los tres archivos de la 116 llevan el aviso; no se borran.

---

## Bloque 5 — Cierre

- [x] **T5.1 — Guardia de higiene** `tests/unit/guards/orden-nota-frontera.guardia.test.ts`: sin
  `console.log` del cuerpo, sin `catch {}` vacío, y ninguna operación exportada que reescriba el
  cuerpo de una nota publicada.
  **Hecho:** la guardia pasa. Cubre **R2, R29**.
- [x] **T5.2 — Mapa `R<n> → test` en `progress/impl_227.md`** con la salida real de los tests.
  **Hecho:** los 37 requisitos tienen test nombrado y salida pegada (`docs/verification.md`).
- [x] **T5.3 — `./init.sh` COMPLETO antes del PR.**
  **Hecho:** **EXIT 0** verificado dos veces (agente + implementer), leyendo `$?` aparte y no por
  tubería: `Test Files 1105 passed (1105)` · `Tests 14149 passed (14149)` · `0 skipped` · `== init OK ==`.
  El total de 1105 archivos coincide con el que midió el reviewer, así que no es corrida degradada.
  > **CORRECCIÓN (m1, 2026-08-15): esta casilla estuvo marcada EN FALSO.** La primera entrega la dio
  > por «verde» y no lo estaba: `./init.sh` terminaba en **EXIT 1**. El implementer atribuyó los
  > rojos a flakes de saturación ajenos (`TableroOperativo`, `wallet-tiendas-desglose`) y ese
  > diagnóstico era **incompleto**: en la corrida del reviewer esos dos pasaron y afloró un rojo
  > **propio de la 227** —deadlock `40P01` entre los tres tests de DB nuevos (bloqueante B1)—, que
  > además dejaba 13 tests de R26/R28/R30 en `skipped` en vez de ejecutarlos. La casilla vuelve a
  > `[ ]` y solo se marca con `./init.sh` en **EXIT 0** verificado, leyendo `$?` aparte y no por
  > tubería. Estado real y evidencia: `progress/impl_227.md` §T5.3.

---

## Trazabilidad `R<n> → test`

Conjunto final: **R1–R36 + R38 = 37 requisitos**. `R37` fue RETIRADO (notificación → ficha 228) y su
número **no se reutiliza**.

| R | Qué verifica | Test |
| --- | --- | --- |
| R1 | publicar añade fila sin tocar las previas | `tests/unit/services/orden-nota-service.test.ts` — «publicar añade una nota sin alterar las previas del hilo» |
| R2 | no existe operación de edición del cuerpo | `tests/unit/guards/orden-nota-frontera.guardia.test.ts` — «el módulo del hilo no exporta ninguna operación que reescriba el cuerpo» |
| R3 | orden cronológico asc y determinista | `tests/integration/repositories/orden-nota.int.test.ts` — «devuelve el hilo en orden ascendente y estable con instantes repetidos» |
| R4 | rol del autor congelado | `tests/unit/services/orden-nota-service.test.ts` — «conserva el rol con el que se publicó aunque el rol del usuario cambie» |
| R5 | autor tomado del actor, nunca del input | `tests/unit/services/orden-nota-service.test.ts` — «ignora un autor enviado en la entrada y usa el de la sesión» |
| R6 | cuerpo en blanco rechazado | `tests/unit/actions/orden-notas-action.test.ts` — «rechaza un cuerpo que queda vacío al recortar y no crea nota» |
| R7 | tope de 200 caracteres | `tests/unit/actions/orden-notas-action.test.ts` — «acepta 200 caracteres y rechaza 201 sin crear nota» |
| R8 | orden inexistente sin fila huérfana | `tests/unit/actions/orden-notas-action.test.ts` — «devuelve rechazo tipado sobre una orden inexistente, sin excepción» |
| R9 | adminTienda solo su tienda | `tests/unit/services/orden-nota-service.test.ts` — «permite al adminTienda leer y publicar en una orden de su tienda» |
| R10 | orden de otra tienda, indistinguible de inexistente | `tests/unit/services/orden-nota-service.test.ts` — «rechaza igual una orden de otra tienda y una inexistente, sin revelar cuál es» |
| R11 | mensajero: acceso solo a sus órdenes asignadas | `tests/unit/services/orden-nota-service.test.ts` — «da acceso al mensajero asignado y rechaza al no asignado, también en lectura» |
| R12 | roles no autorizados, sin vista de supervisión | `tests/unit/services/orden-nota-service.test.ts` — «rechaza a maestro, admin y adminSatelite en leer, publicar y eliminar» |
| R13 | sin sesión | `tests/unit/actions/orden-notas-action.test.ts` — «devuelve no autenticado sin llamar al servicio» |
| R14 | ventana de escritura asimétrica por rol | `tests/unit/services/orden-nota-service.test.ts` — «la tienda publica solo en devuelta y el mensajero solo en en_reparto (matriz rol × estatus)» |
| R15 | lectura en cualquier estatus | `tests/unit/services/orden-nota-service.test.ts` — «devuelve el hilo completo con la orden ya fuera de devuelta» |
| R16 | autor, hora y propio/ajeno | `tests/components/HiloNotasOrden.test.tsx` — «pinta cada nota con su autor y su hora y distingue las propias» |
| R17 | refresco desde el servidor | `tests/components/HiloNotasOrden.test.tsx` — «tras publicar y tras eliminar solicita el refresco de datos del servidor» |
| R18 | rechazo con motivo accionable | `tests/components/HiloNotasOrden.test.tsx` — «muestra el motivo del rechazo y no pinta el cambio como aplicado» |
| R19 | estado vacío y modo solo lectura | `tests/components/HiloNotasOrden.test.tsx` — «con puedeEscribir muestra el compositor y sin él lo oculta junto a los controles de borrado» |
| R20 | la 116 no existe en el árbol | `tests/unit/guards/nota-privada-retirada.guardia.test.ts` — «no queda ningún archivo ni símbolo de la nota privada del mensajero» |
| R21 | DTO y cards sin nota privada | `tests/unit/services/mis-asignaciones-service.test.ts` — «el DTO no emite el campo de nota privada» + `tests/components/PosOrderCardSinNotaPrivada.test.tsx` — «la card … no muestra indicador de nota privada» (×3 vistas) *(archivo NUEVO: no existía ningún test dedicado a las pos-card)* |
| R22 | ninguna lectura de la columna retirada | `tests/unit/guards/nota-privada-retirada.guardia.test.ts` — «ninguna migración ni módulo de la 227 lee orden_mensajero_meta.nota» |
| R23 | drop reversible en estructura | `tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts` — «el up retira la columna y el down la repone nullable» |
| R24 | marcar_luego intacto | `tests/integration/repositories/orden-mensajero-meta.int.test.ts` (sin modificar) + `tests/components/MarcarLuegoToggle.test.tsx` |
| R25 | `orden.notas` intacta | `tests/unit/services/orden-nota-service.test.ts` — «publicar en el hilo no altera la nota de la tienda» + `tests/components/AsignacionDetalle.test.tsx` — «R25: el detalle del mensajero sigue mostrando la nota de la TIENDA con su etiqueta» *(archivo NUEVO: el spec lo daba por «existente» y no existía)* |
| R26 | RLS habilitada sin policies | `tests/integration/db/orden-nota-migration.test.ts` — «la tabla tiene RLS habilitada y ninguna policy» |
| R27 | validación de borde y resultado tipado | `tests/unit/actions/orden-notas-action.test.ts` — «devuelve validation_error con errores por campo ante una entrada mal formada» |
| R28 | una sola consulta + índice | `tests/unit/services/orden-nota-service.test.ts` — «lee el hilo con una sola llamada al repositorio» + `tests/integration/db/orden-nota-migration.test.ts` — «existe el índice (orden_id, created_at)» |
| R29 | sin logs de PII ni catch vacíos | `tests/unit/guards/orden-nota-frontera.guardia.test.ts` — «los módulos del hilo no registran el cuerpo ni tragan errores» |
| R30 | cascade al borrar la orden | `tests/integration/db/orden-nota-migration.test.ts` — «borrar la orden elimina sus notas sin dejar huérfanas» |
| R31 | el autor borra su nota (lógico, en ventana) | `tests/unit/services/orden-nota-service.test.ts` — «el autor elimina su nota dentro de su ventana y el resto del hilo queda intacto» + `tests/integration/repositories/orden-nota.int.test.ts` — «el borrado lógico conserva la fila y su autoría» |
| R32 | nadie borra notas ajenas | `tests/unit/services/orden-nota-service.test.ts` — «la contraparte y un maestro no pueden eliminar una nota ajena» + `tests/integration/repositories/orden-nota.int.test.ts` — «el borrado filtra por autor en el mismo statement» |
| R33 | borrado inexistente / ajeno / repetido | `tests/unit/services/orden-nota-service.test.ts` — «devuelve el mismo resultado tipado ante una nota inexistente, ajena o ya eliminada» |
| R34 | marca visible y cuerpo que no cruza el borde | `tests/unit/services/orden-nota-service.test.ts` — «una nota eliminada viaja marcada, con autor y hora, y con el cuerpo vacío» + `tests/components/HiloNotasOrden.test.tsx` — «pinta «nota eliminada» conservando el hueco» |
| R35 | congelado fuera de la ventana propia | `tests/unit/services/orden-nota-service.test.ts` — «fuera de su ventana, ningún rol puede eliminar ni siquiera sus propias notas» |
| R36 | el corte de la feature 167/R34 no se toca | `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` — «listarMisAsignaciones sigue leyendo exactamente por_recoger y en_reparto» |
| R38 | bidireccionalidad de hecho | `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` — «cada rol tiene al menos un estatus alcanzable en su pantalla donde puede publicar» |

**Regla del reviewer:** un `R<n>` sin test, o un test que no verifica el requisito que dice cubrir,
es hallazgo bloqueante (`docs/verification.md`).
