> # ⚠ FUNCIONALIDAD RETIRADA por la feature 227 (2026-08-14)
>
> **Esta ficha ya no describe el sistema. Se conserva como REGISTRO HISTORICO, no como spec
> vigente.** La feature 227 («hilo de notas por orden entre tienda y mensajero») retiro la nota
> privada del mensajero por completo: su service, sus Server Actions, sus tipos, su interfaz, su
> componente, el campo `notaPrivada` del DTO, los metodos `upsertNota`/`limpiarNota`/
> `findNotasByMensajero` del meta-repo y los badges de las tres pos-card.
>
> La columna `orden_mensajero_meta.nota` se elimino con la migracion
> `20260815140000_orden_mensajero_meta_drop_nota`. **El contenido de las notas se perdio de forma
> definitiva y deliberada** (decision humana del 2026-08-14, P1 del gate de la 227): se habian
> escrito bajo una promesa literal de privacidad —«Solo tu puedes ver esta nota; no la ven la
> tienda ni otros mensajeros»— y copiarlas al hilo COMPARTIDO habria sido una fuga retroactiva.
> Por eso no se migraron.
>
> Lo que hoy existe en su lugar es la tabla `orden_nota`: un hilo bidireccional entre el
> adminTienda dueno de la orden y el mensajero asignado. Ver `specs/227-hilo-notas-orden/`.
>
> Una guardia (`tests/unit/guards/nota-privada-retirada.guardia.test.ts`) impide que los archivos
> y simbolos descritos aqui vuelvan al arbol.
>
> Lo que de esta ficha SIGUE VIVO: nada de la nota. `marcar_luego` es de la feature **115** y no
> se toco (R24 de la 227).

# Feature 116 — Mensajero: notas privadas por orden · requirements.md

Zone: `fullstack` · complexity: `medium` · depends_on: 115 · branch: `feature/116-notas-privadas-mensajero`

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto (el reviewer rechaza si
> falta trazabilidad). Esta feature es la nota **privada del mensajero** por orden: texto libre,
> visible SOLO para su autor, DISTINTA de `orden.notas` (que es la nota de la tienda).
> **NO crea migración:** reutiliza la tabla `orden_mensajero_meta` y su columna `nota text NULL`
> creadas por la feature 115 (ver design.md §2). En implementación, 116 va DESPUÉS de que 115 esté
> `done` (comparten tabla y algunos archivos de lectura del DTO).

---

## Contexto verificado (símbolos reales, no supuestos)

- **`orden.notas` = nota de la TIENDA (a NO confundir):** columna `notas String?` en
  `Orden` (`db/schema.prisma:365`, "R14a: texto nullable"). Se propaga al DTO del mensajero como
  `MiAsignacionRow.notas` → `MiAsignacionDTO.notas` (`GestionOrdenRepository.ts:48,77`;
  `IGestionOrdenRepository.ts:30`; `IMisAsignacionesService.ts:26`) y se muestra bajo la etiqueta
  **"Notas"** en el detalle (`AsignacionDetalle.tsx:89`). La nota privada de esta feature es un
  campo NUEVO y SEPARADO; NUNCA toca `orden.notas`.
- **Tabla de la feature 115 (fuente de la columna):** `orden_mensajero_meta` con
  `usuario_id`, `orden_id`, `marcar_luego boolean`, **`nota text NULL`**, y `UNIQUE(usuario_id,
  orden_id)`. La migración y la RLS las crea 115; 116 solo opera sobre `nota`. (Verificado: el
  modelo aún no existe en `db/schema.prisma` porque 115 está `pending`.)
- **Patrón de Server Action con authz por mensajero:** `lib/actions/mis-asignaciones.ts` resuelve
  el actor con `resolveActorFromSession()` (`lib/auth/resolve-actor.ts` → `{ usuarioId, rol }`),
  valida en el borde con zod, delega en el service bajo `withErrorHandler`, y devuelve un resultado
  de dominio tipado. El service (`MisAsignacionesService`) chequea `actor.rol !== "mensajero" →
  forbidden` y filtra SIEMPRE por `actor.usuarioId` (nunca datos de otro mensajero;
  `MisAsignacionesService.ts:112`, y propiedad de orden en `.ts:203,374`).
- **Dónde se ve el detalle/card del mensajero:** página server `app/(app)/mis-asignaciones/page.tsx`
  (rol resuelto server-side, `notFound` si no es `mensajero`), módulo cliente
  `MisAsignacionesModule.tsx` (cards en grilla + panel de detalle inline) y componente de detalle
  `AsignacionDetalle.tsx` (secciones Pedido/Entrega/Cobro; la "Notas" de tienda vive ahí).
- **Lectura de "mis asignaciones":** `GestionOrdenRepository.findMisAsignaciones(mensajeroId,
  estados)` filtra por `mensajeroAsignadoId = mensajeroId` y `deletedAt = null`
  (`GestionOrdenRepository.ts:103-115`). La feature 115 ya introduce en esta misma query un JOIN a
  `orden_mensajero_meta` filtrado por `usuario_id = mensajeroId` (para `marcar_luego`); 116 añade
  `nota` a esa misma proyección (design.md §3.4).

---

## A) Crear / editar / persistencia por upsert

- **R1** — CUANDO un mensajero guarde una nota de texto libre sobre una de sus órdenes que aún NO
  tenía nota suya, el sistema DEBE persistir el texto asociado a la clave `(su usuario_id, la
  orden)`, creando la fila `orden_mensajero_meta` si no existía.
  *Testeable:* sin fila previa, `guardar(ordenId, "texto")` → existe una fila `(usuarioId, ordenId)`
  con `nota = "texto"`.

- **R2** — CUANDO un mensajero guarde una nota sobre una orden para la que YA tenía nota, el sistema
  DEBE reemplazar el contenido anterior por el nuevo (edición), SIN crear una segunda fila.
  *Testeable:* con `nota = "a"`, `guardar(ordenId, "b")` → la única fila `(usuarioId, ordenId)`
  queda con `nota = "b"`; el conteo de filas no aumenta.

- **R3** — El sistema DEBE persistir/editar la nota mediante un UPSERT sobre `orden_mensajero_meta`
  con clave única `(usuario_id, orden_id)`, PRESERVANDO el valor de `marcar_luego` (feature 115) de
  esa misma fila.
  *Testeable:* con una fila `marcar_luego = true`, `guardar(ordenId, "x")` deja `nota = "x"` y
  `marcar_luego = true` intacto.

- **R4** — CUANDO un mensajero limpie (borre) su nota de una orden, el sistema DEBE dejar
  `nota = NULL` en su fila SIN eliminar la fila (para no perder `marcar_luego`); SI no existía
  fila, ENTONCES la operación DEBE ser un no-op idempotente (`ok`, sin crear fila).
  *Testeable:* con `nota` presente y `marcar_luego = true`, `limpiar(ordenId)` → `nota = NULL` y
  `marcar_luego = true`; sin fila previa, `limpiar(ordenId)` → `ok` y siguen sin existir filas.

- **R5** — SI el mensajero guarda una nota cuyo contenido queda VACÍO tras recortar espacios en
  blanco, ENTONCES el sistema DEBE tratarlo como limpiar (`nota = NULL`), no como texto vacío.
  *Testeable:* `guardar(ordenId, "   ")` → `nota = NULL` (equivalente a `limpiar`), sin perder
  `marcar_luego`.

## B) Privacidad y separación de `orden.notas` (nota de la tienda)

- **R6** — La nota privada de un mensajero DEBE ser visible ÚNICAMENTE para su autor; ningún otro
  usuario (otro mensajero, admin, maestro, adminTienda, adminSatelite) DEBE poder verla en el
  detalle, la card ni en ninguna otra vista.
  *Testeable:* dos mensajeros con notas distintas sobre la misma orden → cada uno solo recibe/ve la
  suya; una vista de otro rol no incluye el campo de nota privada de ningún mensajero.

- **R7** — El sistema DEBE mantener la nota privada del mensajero SEPARADA de `orden.notas` (nota de
  la tienda): guardar/editar/limpiar la nota privada NUNCA DEBE alterar `orden.notas`, y ambas DEBEN
  presentarse como campos DISTINTOS y claramente etiquetados en el detalle (la de tienda como
  "Notas", la privada con una etiqueta propia p. ej. "Mi nota").
  *Testeable:* tras cualquier operación de nota privada, `orden.notas` queda idéntica; el detalle
  renderiza dos campos distintos con etiquetas distintas.

## C) Autorización por mensajero

- **R8** — El sistema DEBE resolver la nota mostrada a un mensajero filtrando por su propio
  `usuario_id`; NUNCA DEBE devolver la nota de otro mensajero para la misma orden.
  *Testeable:* la lectura de "mis asignaciones" del mensajero A no contiene la `nota` escrita por el
  mensajero B sobre la misma orden.

- **R9** — CUANDO un mensajero guarde o limpie una nota, el sistema DEBE operar EXCLUSIVAMENTE sobre
  la fila `(su usuario_id, orden_id)`; NUNCA DEBE crear ni modificar la fila de otro usuario.
  *Testeable:* `guardar`/`limpiar` del mensajero A jamás altera la fila `(usuarioId_B, ordenId)`
  (permanece con su `nota`/`marcar_luego` originales).

- **R10** — SI el actor NO es rol `mensajero` (o no hay sesión válida), ENTONCES el sistema DEBE
  rechazar guardar/limpiar (`forbidden`/`unauthenticated`) SIN efectos.
  *Testeable:* con actor `adminTienda`/`maestro` → `forbidden` y no se crea/modifica fila; sin
  cookie de sesión → `unauthenticated`.

## D) Visibilidad en detalle y card

- **R11** — DONDE el mensajero vea el DETALLE de una de sus órdenes, el sistema DEBE mostrar su nota
  privada (o un editor/estado vacío para crearla), claramente DIFERENCIADA de la nota de la tienda,
  con controles para crear/editar y para limpiar.
  *Testeable:* componente de detalle con `notaPrivada = "x"` muestra "x" bajo la etiqueta propia y
  ofrece guardar/limpiar; con `notaPrivada = null` muestra el editor vacío (sin texto de tienda
  mezclado).

- **R12** — DONDE el mensajero vea la CARD de una de sus órdenes, el sistema DEBE indicar la
  presencia de su nota privada (p. ej. un indicador/preview), visible solo para él.
  *Testeable:* la card de una orden con `notaPrivada` presente muestra el indicador; sin nota, no lo
  muestra.

- **R14** — CUANDO guardar o limpiar concluya con éxito, el sistema DEBE reflejar el nuevo estado de
  la nota en el detalle/card leyéndolo del servidor (persistente ante recarga), no solo en memoria
  del cliente.
  *Testeable:* tras `guardar`, un re-render/refetch del server component muestra la nota nueva; tras
  `limpiar`, el detalle vuelve al estado vacío.

## E) Borde, no-migración, integridad y seguridad

- **R13** — El sistema DEBE validar en el borde la entrada de guardar/limpiar: `ordenId` presente y
  con formato válido, y `nota` como texto acotado a un máximo (ver P1); DEBE rechazar con
  `validation_error` las entradas inválidas SIN efectos.
  *Testeable:* `ordenId` ausente/mal formado → `validation_error`; `nota` que excede el máximo →
  `validation_error`; en ambos casos no se crea/modifica fila.

- **R15** — Esta feature NO DEBE crear migración de esquema: reutiliza la tabla
  `orden_mensajero_meta` y la columna `nota text NULL` creadas por la feature 115. SI el implementer
  detectara que una migración es imprescindible, DEBE justificarla y aportar su `down.sql`
  reversible (patrón de arquitectura), conservando la RLS de la tabla.
  *Testeable:* la rama de 116 NO añade `db/migrations/*`; `prisma validate` y `pnpm typecheck`
  verdes contra el esquema que 115 dejó.

- **R16** — SI se intenta guardar una nota sobre una orden inexistente, ENTONCES el sistema NO DEBE
  crear una fila huérfana: la integridad referencial (`orden_id` → `orden`, definida por 115) DEBE
  impedirlo y la operación DEBE rechazarse con un resultado de dominio (sin excepción cruda).
  *Testeable:* `guardar(ordenIdInexistente, "x")` → rechazo (`forbidden`/`not_found` según design)
  sin fila creada.

- **R17** — El manejo de errores DEBE seguir las convenciones (sin `catch` vacíos; motivos
  accionables) y NINGÚN borde DEBE filtrar PII ni el contenido de notas de otros usuarios en
  mensajes de error/log.
  *Testeable:* los mensajes de rechazo son textos fijos i18n-ready sin PII; no hay `console.log` del
  contenido de la nota.

---

## Trazabilidad (mapa preliminar R → tipo de test)

| R | Verificación esperada | Zona |
| --- | --- | --- |
| R1 | unit service: sin fila → `guardar` crea fila con `nota` | B |
| R2 | unit service: con nota → `guardar` edita, no duplica fila | B |
| R3 | unit repo/service: upsert preserva `marcar_luego` | B |
| R4 | unit repo/service: `limpiar` deja `nota=NULL` sin borrar fila; no-op idempotente sin fila | B |
| R5 | unit service: `guardar` con texto en blanco → `nota=NULL` | B |
| R6 | unit repo + componente: solo el autor recibe/ve su nota; otro rol no ve el campo | B/F |
| R7 | unit service + componente: `orden.notas` intacta; dos campos etiquetados distintos | B/F |
| R8 | unit repo: la lectura del mensajero A no trae la nota de B | B |
| R9 | unit repo/service: `guardar`/`limpiar` de A no toca la fila de B | B |
| R10 | unit action/service: rol ≠ mensajero → `forbidden`; sin sesión → `unauthenticated` | B |
| R11 | componente: detalle con/ sin `notaPrivada` (editor + limpiar, etiqueta propia) | F |
| R12 | componente: card muestra indicador solo si hay nota privada | F |
| R13 | unit action: `ordenId` inválido / `nota` sobre el máximo → `validation_error` | B |
| R14 | componente: éxito → `router.refresh()`/refetch refleja el nuevo estado | F |
| R15 | CI/typecheck: sin migración nueva; `prisma validate` OK | B |
| R16 | unit action/service: orden inexistente → rechazo sin fila huérfana | B |
| R17 | unit: motivos de rechazo sin PII; sin `console.log` de la nota | B |

---

## Preguntas abiertas

- **P1 — Longitud máxima de la nota.** ¿Cuál es el tope de caracteres para la validación de borde
  (R13)? La columna Postgres `text` es ilimitada, pero zod debe acotar para evitar abuso.
  _Recomendación:_ 2000 caracteres (holgado para notas operativas de reparto). Ajustable sin tocar
  el modelo (solo el schema zod).
- **P2 — ¿Escribir exige que la orden esté ASIGNADA actualmente al mensajero?** La privacidad ya
  está garantizada por la clave `usuario_id` (R6/R8/R9) y la existencia por la FK (R16); requerir
  asignación vigente acoplaría la nota al estado de asignación (que cambia con reasignaciones).
  _Recomendación:_ NO exigir asignación vigente para escribir (una nota sobre una orden no asignada
  es inofensiva e invisible para otros); la UI solo expone el editor sobre las órdenes del mensajero
  igualmente. Si el negocio prefiere restringir, se añade la guarda en el service (candidato a
  follow-up).
- **P3 — Card: ¿preview del texto o solo indicador?** ¿La card (R12) muestra un fragmento truncado
  de la nota o únicamente un badge/ícono de "tiene nota"? _Recomendación:_ badge + preview truncado
  (1 línea), consistente con la densidad de las cards actuales; queda a criterio de UI.
