# Feature 149 — Tareas

> `[P]` = paralelizable con las tareas de su mismo bloque.
> Cada task tiene criterio de HECHO verificable. Los requisitos `R1`-`R40` viven en
> `requirements.md`; la matriz de trazabilidad `R -> test` está al final y es BLOQUEANTE.

---

## F0 — Base de datos y dominio (bloquea todo lo demás)

- [x] **T0.1 — Migración del enum.**
  Crear `db/migrations/20260728120000_orden_historial_origen_deshacer_asignacion/` con
  `migration.sql` (`ALTER TYPE ... ADD VALUE IF NOT EXISTS 'deshacer_asignacion'`, sola en su
  transacción) y `down.sql` (recreación del enum con los 22 valores previos), copiando el
  contenido de `design.md` §4.
  **Hecho:** `pnpm run db:migrate` aplica en verde; `pnpm run db:rollback` revierte en verde
  sobre una DB sin filas `deshacer_asignacion`; `down.sql` existe.

- [x] **T0.2 — Enum en el schema Prisma.** [P con T0.3]
  Añadir `deshacer_asignacion` al enum `OrdenHistorialOrigenTipo` de `db/schema.prisma`, con
  comentario `// feature 149: reversión de asignación/ruteo antes de la recogida`.
  **Hecho:** `pnpm db:generate` regenera el cliente y `OrdenHistorialOrigenTipo` incluye el valor.

- [x] **T0.3 — SEED de tipos de origen.** [P con T0.2]
  Añadir `"deshacer_asignacion"` a `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`
  (`lib/types/orden-historial.ts`) y documentar en comentario, siguiendo el formato de las
  features 99/100/109, POR QUÉ **no** entra en `ORIGEN_TIPOS_CON_GESTION` (nunca enlaza gestión;
  destino nunca `devuelta`).
  **Hecho:** `pnpm typecheck` en verde (el `satisfies` y `_EnsureExhaustive` no rompen);
  `ORIGEN_TIPOS_CON_GESTION` sigue con dos valores.

- [x] **T0.4 — Aristas nuevas en la guardia (140).** Depende de T0.3.
  Declarar #43/#44/#45 en `lib/types/order-status-transiciones.ts` exactamente como en
  `design.md` §2, con el comentario `// #4x (149)`.
  **Hecho:** `pnpm typecheck` en verde; `assertTransicionValida` acepta los tres pares nuevos.

- [x] **T0.5 — Actualizar el inventario-fixture de la 140.** Depende de T0.4.
  Añadir a mano las 3 filas a `INVENTARIO_FLUJO` (`tests/fixtures/inventario-transiciones-140.ts`)
  y actualizar `RECUENTO_INVENTARIO` a `aristasFlujo: 46`, `paresUnicos: 42`.
  **Hecho:** el test «el mapa declara exactamente las aristas del inventario» pasa.

---

## F1 — Tests de dominio (guardia) — pueden escribirse en paralelo a F2

- [x] **T1.1 — Reparar y extender el unit de la guardia.** Depende de T0.5.
  En `tests/unit/domain/order-status-transiciones.guardia.test.ts`: retirar
  `["por_recoger", "en_bodega_satelite"]` de la lista de pares ilegales (ahora es #44), sustituirlo
  por `["por_recoger", "en_preparacion"]`, actualizar el título/recuento del test de conteo y
  añadir un bloque «REGRESIÓN 149» que afirme que #43/#44/#45 pasan.
  **Cubre:** R27, R28. **Hecho:** suite `order-status-transiciones` en verde.

- [x] **T1.2 — Test de no-regresión del conjunto de orígenes con gestión.** [P con T1.1]
  Nuevo `tests/unit/domain/orden-historial-origen-149.test.ts`: `deshacer_asignacion` está en el
  SEED y NO está en `ORIGEN_TIPOS_CON_GESTION`.
  **Cubre:** R25, R26.

- [x] **T1.3 — Test de conectividad sin cambios.** [P con T1.1]
  Ejecutar `order-status-transiciones.connectividad.test.ts` sin tocarlo y confirmar verde
  (catálogo sigue en 18, sin terminales nuevos).
  **Hecho:** verde sin modificar el archivo. Si hiciera falta modificarlo, es señal de que se
  declaró una arista de más: parar y revisar.

---

## F2 — Capa de datos

- [x] **T2.1 — Lectura del origen para la reversión.**
  Añadir `findOrigenesReversion` a `IOrdenHistorialRepository` y a `OrdenHistorialRepository`
  (`DISTINCT ON (orden_id)`, `ORDER BY orden_id, created_at DESC, id DESC`, join al `value` del
  estado de origen; una sola consulta para el lote).
  **Hecho:** unit con doble de Prisma verifica la forma del query y el mapeo `ordenId -> value|null`.

- [x] **T2.2 — Escritura transaccional del lote.** [P con T2.1]
  Añadir `deshacerAsignacionLote` a `IOrdenRepository` y `OrdenRepository` según `design.md`
  §3.2: UPDATE guardado por `estatus_id` de origen + `deleted_at IS NULL` + `zona_id` opcional,
  **SIN guarda de `cierre_dia`** (Q1 CERRADA); `RETURNING id`; si `rows.length !== items.length`
  lanza `DeshacerAsignacionConflictoError` (revierte la tx); pre-read que captura el
  `mensajero_asignado_id` previo; `appendCambioEstado` con `origenTipo: "deshacer_asignacion"` y
  `motivo`; comentario-ancla `TODO(146)` literal tras el append (design §3.2 paso 4).
  **Hecho:** no toca `num_guia` ni `prioridad` (verificable en el `SET` del SQL); el ancla
  `TODO(146)` está en el archivo; unit en verde.

- [x] **T2.3 — Mensajes de bloqueo tipados.** [P con T2.1/T2.2]
  `lib/services/mensajes-deshacer-asignacion.ts` con las constantes de motivo (patrón
  `mensajes-bloqueo.ts`).
  **Hecho:** ningún literal de motivo duplicado entre service, tests y UI.

---

## F3 — Servicio (lógica de negocio)

- [x] **T3.1 — Interfaz del service.** Depende de T2.1/T2.2.
  `lib/interfaces/services/IDeshacerAsignacionService.ts` con input, resultado y
  `DeshacerAsignacionResultadoItem`.
  **Hecho:** `pnpm typecheck` en verde.

- [x] **T3.2 — `DeshacerAsignacionService`.** Depende de T3.1.
  Implementar la secuencia de `design.md` §1 (autorización → zona → GAM → validación por orden →
  derivación/normalización → coherencia zona/destino → cierre del mensajero → catálogo →
  escritura), con `Pick<IOrdenRepository, ...>` para los dobles de test.
  **Hecho:** el service no importa Prisma ni nada de `next/`; se instancia en test con dobles.

- [x] **T3.3 — Server Action.** Depende de T3.2.
  `lib/actions/deshacer-asignacion.ts` con `withErrorHandler` + `resolveActorFromSession` + zod
  (`ordenIds` uuid no vacío, `motivo` trim 10..300) + fábrica del service.
  **Hecho:** un input inválido devuelve `validation_error` SIN construir el service.

---

## F4 — Tests de servicio y borde (bloque grande; se puede repartir)

- [x] **T4.1 — Autorización por rol.** [P]
  `tests/unit/services/deshacer-asignacion.autz.test.ts`: `maestro`/`admin` pasan;
  `adminTienda`/`mensajero`/`apiKey` → `forbidden` sin llamar a ningún writer.
  **Cubre:** R1, R2, R3.

- [x] **T4.2 — Scoping por zona del `adminSatelite`.** [P]
  Zona ajena en una orden del lote → `forbidden` y cero escrituras; sin zona → `sin_zona`;
  destino derivado `en_bodega_central` con actor `adminSatelite` → `forbidden`.
  **Cubre:** R4, R5, R6.

- [x] **T4.3 — Caso (a).** [P]
  Orden `por_recoger` con origen `en_bodega_central` → destino `en_bodega_central`, mensajero y
  `asignado_at` a NULL; ídem con origen `en_bodega_satelite` → `en_bodega_satelite`.
  **Cubre:** R8, R9.

- [x] **T4.4 — Caso (b).** [P]
  Orden `en_ruta_bodega_satelite` → `en_bodega_central`, mensajero/`asignado_at` NULL.
  **Cubre:** R10.

- [x] **T4.5 — Derivación y normalización.** [P]
  Los cuatro orígenes de la tabla D3' producen el destino esperado; se afirma que la derivación
  usa el historial y NO la zona (caso testigo: orden de zona satélite cuyo historial dice
  `en_bodega_central` no puede terminar en `en_bodega_satelite`).
  **Cubre:** R11, R12.

- [x] **T4.6 — Fallo cerrado de la derivación.** [P]
  Sin fila de historial → `conflict`; origen NULL (creación) → `conflict`; origen fuera de la
  tabla (`en_ruta`, `devuelta`) → `conflict`. En los tres casos, cero escrituras.
  **Cubre:** R13.

- [x] **T4.7 — Coherencia zona/destino.** [P]
  Destino `en_bodega_central` con orden no-GAM → `conflict`; destino `en_bodega_satelite` con
  orden GAM → `conflict`.
  **Cubre:** R14, R15.

- [x] **T4.8 — Bloqueos de estado y existencia.** [P]
  `en_ruta`, `en_bodega_satelite`, `entregada`, `reprogramada`, `devuelta`, `rechazada`,
  `sin_gestionar` → `conflict` con el estado en el motivo; orden borrada → «orden borrada»; id
  inexistente → «orden no existe».
  **Cubre:** R16, R17, R18.

- [x] **T4.9 — ASIMETRÍA asignar/deshacer con cierre pendiente (Q1 CERRADA).** [P]
  `tests/unit/services/deshacer-asignacion.cierre-asimetria.test.ts`, DOS aserciones sobre el
  MISMO mensajero con un cierre `solicitado`:
  (a) `DeshacerAsignacionService.deshacer` sobre su orden en `por_recoger` → `ok`, la orden
      transiciona y el service NO invoca `findMensajerosBloqueados` (espía en el doble de repo);
  (b) `GuiaAsignacionService.asignarDesdeBodega` con ese mismo mensajero → `conflict` con
      `MSG_MENSAJERO_BLOQUEADO` (test de no-regresión del gate vigente).
  **Cubre:** R19.

- [x] **T4.10 — Todo-o-nada y carrera.** [P]
  Lote de 3 con una orden inválida → cero escrituras en las otras dos; simulación de carrera
  (`deshacerAsignacionLote` lanza `DeshacerAsignacionConflictoError`) → `conflict` con detalle y
  sin efectos parciales.
  **Cubre:** R20, R21.

- [x] **T4.11 — Motivo obligatorio (borde zod).** [P]
  `tests/unit/actions/deshacer-asignacion.action.test.ts`: motivo ausente, `""`, `"   "`, 9
  caracteres y 301 caracteres → `validation_error` con `fieldErrors.motivo`, sin construir el
  service; motivo válido con espacios se pasa RECORTADO al service; sin sesión →
  `unauthenticated`.
  **Cubre:** R7, R22, R24.

- [x] **T4.12 — Invariantes de columnas.** [P]
  Tras una reversión, `num_guia` conserva su valor y `prioridad` NO cambia en ninguna dirección
  (Q2 CERRADA): una orden con `prioridad = false` sigue en `false` —la pérdida del flag es la
  limitación aceptada de R30— y una con `true` sigue en `true`. El `SET` del UPDATE no menciona
  ninguna de las dos columnas.
  **Cubre:** R29, R30.

- [x] **T4.13 — Mensajes sin PII.** [P]
  Ningún `motivo` de `conflict` ni mensaje de error contiene un UUID (regex de UUID) ni el nombre
  o teléfono del destinatario.
  **Cubre:** R40.

- [x] **T4.14 — Sin notificación al mensajero + ancla 146 (Q5 CERRADA).** [P]
  (a) Test: una reversión exitosa NO invoca ningún productor de notificaciones —el único job
  encolado es el webhook de estado del choke point— y la orden desaparece del listado de
  asignaciones del mensajero.
  (b) Test-ancla: el archivo `lib/repositories/OrdenRepository.ts` contiene la cadena
  `TODO(146)` dentro de `deshacerAsignacionLote` (lectura del propio fuente en el test, patrón de
  censo del repo), de modo que borrar el ancla ROMPE la suite.
  **Cubre:** R41.

---

## F5 — Integración (repo + choke point + guardia real)

- [x] **T5.1 — Bitácora y webhook.** Depende de T2.2.
  `tests/integration/repositories/deshacer-asignacion.historial.test.ts`: una reversión escribe
  EXACTAMENTE una fila de historial por orden, con origen real, destino, actor, `origen_tipo =
  deshacer_asignacion` y el motivo; el emisor de webhooks se invoca en la misma tx; si la tx
  revierte, no queda ni fila ni job.
  **Cubre:** R23, R31, R32, R33.

- [x] **T5.2 — La guardia real acepta las tres aristas.** Depende de T0.4.
  Reversión de las tres combinaciones a través de `appendCambioEstado` SIN mockear la guardia:
  ninguna lanza `TransicionIlegalError`.
  **Cubre:** R27.

---

## F6 — UI

- [ ] **T6.1 — Modal del maestro.** Depende de T3.3.
  `app/(app)/ordenes/_components/DeshacerAsignacionModal.tsx` +
  `deshacer-asignacion-error-messages.ts`.
  **Hecho:** una sola llamada a la Server Action con el lote completo; botón deshabilitado sin
  motivo válido.

- [ ] **T6.2 — Cableado del listado.** Depende de T6.1.
  `OrdenesListado.tsx`: acción `deshacer` en `por_recoger` y `en_ruta_bodega_satelite`, unión
  `ModalAbierto`, montaje del modal, `onSuccess = handleSuccess`.
  **Hecho:** la acción aparece con una selección de esos estados y no aparece en los demás.

- [ ] **T6.3 — Grupo `asignadas` en la satélite.** [P con T6.1]
  `RecepcionSateliteService.listar` + `IRecepcionSateliteService` + `page.tsx`: nuevo bucket
  `asignadas` (`por_recoger` de la zona).
  **Hecho:** unit del service verifica la clasificación del nuevo bucket.

- [ ] **T6.4 — Sección y modal de la satélite.** Depende de T6.3 y T6.1.
  `RecepcionSateliteModule.tsx`: sección «Asignadas (por recoger)» con selección propia + botón +
  `DeshacerAsignacionSateliteModal.tsx`; sin acción de deshacer en «Por recibir».
  **Hecho:** `router.refresh()` tras éxito.

- [ ] **T6.5 — Tests de UI.** Depende de T6.2 y T6.4.
  `tests/unit/components/deshacer-asignacion.ui.test.tsx`: la acción se ofrece en los dos estados
  del listado del maestro; el `adminSatelite` la ve sobre sus `por_recoger` y NO sobre
  `en_ruta_bodega_satelite`; el botón de confirmar está deshabilitado con motivo inválido y
  habilitado con motivo válido; el éxito dispara la revalidación y el aviso con el número de
  órdenes; cada `status`/motivo de error produce su mensaje accionable distinto.
  **Cubre:** R34, R35, R36, R37, R38, R39.

---

## F7 — Cierre

- [ ] **T7.1 — Suite completa y arnés.** Depende de todo lo anterior.
  `./init.sh`, `pnpm typecheck`, `pnpm lint`, `pnpm test` en verde; delta de tests fallidos
  respecto al baseline medido = 0.
- [ ] **T7.2 — Bitácora de implementación.**
  `progress/impl_149.md` con la matriz `R -> test` REAL (archivo + nombre del test), el registro
  de los tests de la 140 modificados y por qué, y una sección «Deuda diferida a la 146» que
  apunte al ancla `TODO(146)` (archivo + función) para que la feature 146 la encuentre.
  **Hecho:** los 41 requisitos aparecen mapeados; el reviewer puede verificar cada uno y el ancla
  está registrada.

---

## Matriz de trazabilidad R -> task de test (bloqueante para el reviewer)

| R | Task de test |
| --- | --- |
| R1 | T4.1 |
| R2 | T4.1 |
| R3 | T4.1 |
| R4 | T4.2 |
| R5 | T4.2 |
| R6 | T4.2 |
| R7 | T4.11 |
| R8 | T4.3 |
| R9 | T4.3 |
| R10 | T4.4 |
| R11 | T4.5 |
| R12 | T4.5 |
| R13 | T4.6 |
| R14 | T4.7 |
| R15 | T4.7 |
| R16 | T4.8 |
| R17 | T4.8 |
| R18 | T4.8 |
| R19 | T4.9 |
| R20 | T4.10 |
| R21 | T4.10 |
| R22 | T4.11 |
| R23 | T5.1 |
| R24 | T4.11 |
| R25 | T1.2 |
| R26 | T1.2 |
| R27 | T1.1, T5.2 |
| R28 | T1.1 |
| R29 | T4.12 |
| R30 | T4.12 |
| R31 | T5.1 |
| R32 | T5.1 |
| R33 | T5.1 |
| R34 | T6.5 |
| R35 | T6.5 |
| R36 | T6.5 |
| R37 | T6.5 |
| R38 | T6.5 |
| R39 | T6.5 |
| R40 | T4.13 |
| R41 | T4.14 |
</content>
</invoke>
