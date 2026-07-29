# Feature 156 (Generar guía SIN asignar mensajero)

> Zona: fullstack · Complejidad: medium · SDD · `depends_on: 154`
> Asume APLICADAS las features **153** (`en_ruta` → `en_reparto`) y **154** (catálogo v2 +
> grafo de transiciones nuevo). **NO** asume la 155 (`en_fulfillment` sigue existiendo como
> `value` del catálogo, pero la 154 ya le retiró sus aristas de `generacion_guia`).
> **Sin migración.**

## Contexto y alcance

Hoy "Generar guía" hace TRES cosas a la vez: numera la orden (`num_guia`), decide su
mensajero y, si la orden es de zona no-GAM, la rutea a la bodega satélite. El flujo v2
separa numerar de asignar:

- **Generar guía** pasa a ser SOLO: numerar y mover de `en_preparacion` a
  `en_bodega_central`.
- **Las asignaciones ocurren SIEMPRE desde una bodega**, por caminos que YA EXISTEN y que
  esta feature **no toca**: `asignarDesdeBodega` (central → mensajero),
  `rutearABodegaSatelite` (central → bodega satélite) y `AsignacionSateliteService`
  (satélite → su mensajero).

Frontera explícita de esta feature:

| Superficie | Esta feature |
| --- | --- |
| `GuiaAsignacionService.generarGuia` | **Cambia** (pierde asignación y ruteo) |
| `GuiaAsignacionService.rutearABodegaSatelite` (orígenes admitidos) | **Cambia** (solo `en_bodega_central`) |
| `GuiaAsignacionService.asignarDesdeBodega` | **No cambia** (no-regresión verificada) |
| `AsignacionSateliteService` | **No cambia** (no-regresión verificada) |
| `GenerarGuiaModal` | **Cambia** (pierde el selector; queda confirmación de lote) |
| Encadenado "Imprimir etiquetas" (feature 95) | **No cambia de comportamiento** (no-regresión) |
| Fase "resultado" + manifiesto (feature 148) | **No cambia de comportamiento** (no-regresión) |
| Catálogo `order_status`, migraciones, RLS | **No se tocan** |

## Diagrama (después de esta feature)

```
en_preparacion
   │  "Generar guía" (maestro/admin) — SOLO numera + mueve
   ▼
en_bodega_central ──"Asignar mensajero"──────────────► por_recoger
   │                (asignarDesdeBodega, sin cambios)
   │
   └──"Rutear a bodega satélite"──► en_ruta_bodega_satelite ──► en_bodega_satelite
      (rutearABodegaSatelite)          (recepción satélite)         │
                                                                    │ AsignacionSateliteService
                                                                    ▼
                                                              por_recoger
```

## Requisitos (EARS)

### Backend — "Generar guía" (`GuiaAsignacionService.generarGuia`)

- **R1** — CUANDO un actor con acceso total genera guía para un lote de órdenes en
  `en_preparacion`, el sistema DEBE, para cada orden del lote: asignarle `num_guia` si
  no lo tiene y transicionarla a `en_bodega_central`.
- **R2** — CUANDO el sistema genera guía, NO DEBE escribir `mensajero_asignado_id` ni
  `asignado_at` en ninguna orden del lote: ambas columnas quedan exactamente como estaban
  antes de la operación.
- **R3** — El sistema DEBE producir `en_bodega_central` como ÚNICO estado destino de
  generar guía; ninguna orden del lote puede terminar en `por_recoger` ni en
  `en_ruta_bodega_satelite` por efecto de esta operación.
- **R4** — SI una orden del lote NO está en `en_preparacion`, ENTONCES el sistema DEBE
  rechazar el lote con un conflicto que incluya esa orden y el motivo
  `estado de origen no permitido: <value>`, sin numerar ni transicionar ninguna orden.
  Esto aplica en particular a `en_fulfillment`, que deja de ser un origen válido.
- **R5** — El sistema DEBE conservar la idempotencia de `num_guia`: una orden del lote que
  ya tenga `num_guia` DEBE conservar el mismo valor y no consumir un número nuevo, y el
  resultado DEBE devolver ese mismo `num_guia`.
- **R6** — El sistema DEBE ejecutar el lote como todo-o-nada: SI alguna orden falla
  cualquier guarda, ENTONCES ninguna orden del lote queda numerada ni transicionada.
- **R7** — SI una orden del lote no existe, está borrada (`deleted_at != null`) o está en
  `reprogramada`, ENTONCES el sistema DEBE rechazar el lote con un conflicto que incluya el
  motivo por orden, sin efectos en datos.
- **R8** — CUANDO el sistema genera guía, DEBE registrar por cada orden una entrada en
  `orden_historial_estado` con `origen_tipo = generacion_guia`, estatus de origen
  `en_preparacion`, estatus de destino `en_bodega_central` y `actor_usuario_id` = el actor
  que ejecutó la operación.
- **R9** — El sistema DEBE autorizar generar guía ÚNICAMENTE a roles de acceso total
  (`maestro`/`admin`); cualquier otro rol DEBE recibir `forbidden` sin efecto en datos, y
  una petición sin sesión válida DEBE resolverse como `unauthenticated` antes de llamar al
  servicio.

### Backend — guardas que DEJAN de aplicar al numerar

- **R10** — MIENTRAS un mensajero tenga un cierre abierto, el sistema DEBE permitir generar
  guía con normalidad: la guarda de mensajero bloqueado ya no participa de esta operación
  (no hay mensajero que asignar).
- **R11** — MIENTRAS la zona de una orden tenga al menos un mensajero con cierre abierto,
  el sistema DEBE permitir generar guía para esa orden: la guarda de "bodega satélite
  bloqueada" ya no participa de esta operación (no hay ruteo que hacer).
- **R12** — SI una orden del lote no tiene coordenadas utilizables (dirección no
  geocodificable, geocodificación en curso o agotada), ENTONCES el sistema DEBE generar su
  guía y moverla a `en_bodega_central` igualmente: el gate de asignabilidad por coordenadas
  ya no participa de esta operación.
- **R13** — SI la zona GAM no está configurada, ENTONCES el sistema DEBE generar guía con
  normalidad: la clasificación GAM/no-GAM ya no participa de esta operación.
- **R14** — El sistema NO DEBE aceptar en la entrada de generar guía ninguna decisión de
  mensajero: una entrada que no se ajuste al contrato (lista de identificadores de orden)
  DEBE resolverse como error de validación en el borde, sin llamar al servicio.

### Backend — ruteo a bodega satélite

- **R15** — El sistema DEBE admitir `en_bodega_central` como ÚNICO estado de origen de
  "rutear a bodega satélite".
- **R16** — SI una orden en `en_preparacion` o en `en_fulfillment` se envía a "rutear a
  bodega satélite", ENTONCES el sistema DEBE rechazar el lote con el motivo
  `estado de origen no permitido: <value>`, sin efectos en datos.

### Backend — caminos de asignación que NO cambian (no-regresión)

- **R17** — El sistema DEBE conservar sin cambios el comportamiento de `asignarDesdeBodega`:
  origen único `en_bodega_central`, destino `por_recoger`, mensajero validado contra la
  zona GAM, guarda de mensajero bloqueado por cierre, gate de asignabilidad por coordenadas,
  `num_guia` intacto y todo-o-nada por lote.
- **R18** — El sistema DEBE conservar sin cambios el comportamiento de la asignación desde
  bodega satélite (`AsignacionSateliteService`): origen `en_bodega_satelite`, destino
  `por_recoger`, guarda de zona propia y gate de asignabilidad por coordenadas.
- **R19** — MIENTRAS exista al menos un escritor de `mensajero_asignado_id` en el sistema,
  cada uno de ellos DEBE seguir aplicando el gate de asignabilidad por coordenadas antes de
  escribir: tras esta feature esos escritores son exactamente `asignarDesdeBodega` y
  `AsignacionSateliteService`.

### Frontend — modal "Generar guía"

- **R20** — MIENTRAS el modal "Generar guía" está en su fase de edición, el sistema DEBE
  listar las órdenes seleccionadas identificándolas al menos por número de remisión y
  destinatario, y NO DEBE ofrecer ningún control de selección de mensajero para ninguna
  orden.
- **R21** — MIENTRAS el modal "Generar guía" está en su fase de edición, el sistema NO DEBE
  agrupar las órdenes por "con mensajero sugerido" / "sin mensajero sugerido" ni por bodega
  satélite de destino, y su texto DEBE anunciar que las órdenes quedarán numeradas y en la
  bodega central.
- **R22** — CUANDO el maestro confirma el modal, el sistema DEBE hacer UNA sola llamada a la
  acción de generar guía con el lote completo de órdenes seleccionadas y sin ningún dato de
  mensajero.
- **R23** — CUANDO la llamada de R22 responde éxito, el sistema DEBE mostrar un aviso de
  éxito que informe la cantidad de órdenes numeradas y su destino único (bodega central), sin
  mencionar espera de aceptación ni bodega satélite.
- **R24** — CUANDO la llamada de R22 responde éxito, el modal DEBE pasar a su fase
  "resultado" ofreciendo la descarga del manifiesto del lote (flujo `generacion_guia`, con
  los identificadores de las órdenes del resultado), y DEBE diferir el aviso de éxito al
  padre (`onSuccess`) hasta que esa fase se cierre por cualquier vía.
- **R25** — SI la descarga del manifiesto falla, ENTONCES el sistema NO DEBE repetir ni
  revertir la generación de guía: la operación permanece cometida, su aviso de éxito intacto
  y la fase "resultado" sigue cerrable con normalidad.
- **R26** — SI la llamada de R22 responde un estado distinto de éxito, ENTONCES el modal NO
  DEBE pasar a la fase "resultado" ni avisar al padre, DEBE permanecer abierto y DEBE mostrar
  el mensaje de error correspondiente al motivo devuelto.
- **R27** — CUANDO se cierra la fase "resultado" del modal "Generar guía", el sistema DEBE
  encadenar la apertura de "Imprimir etiquetas" con EXACTAMENTE el mismo lote de órdenes
  (comportamiento vigente de la feature 95, sin cambios).

### Frontend — listado de órdenes

- **R28** — MIENTRAS el listado muestre órdenes en `en_preparacion` (o en `en_fulfillment`),
  el sistema NO DEBE bloquear su casilla de selección por el motivo "la bodega de esta zona
  tiene un cierre de mensajero abierto": ese bloqueo DEBE conservarse únicamente para las
  órdenes en `en_bodega_central`.
- **R29** — El sistema NO DEBE ofrecer la acción "Rutear a bodega satélite" sobre órdenes en
  `en_preparacion` ni en `en_fulfillment` en ninguna superficie de UI; DEBE conservarla sobre
  `en_bodega_central`.
- **R30** — Ninguna superficie de UI DEBE requerir la lista de mensajeros para ofrecer
  "Generar guía": la carga de mensajeros solo puede condicionar las acciones de asignación
  desde bodega.

## Fuera de alcance (explícito)

- Retirar `en_fulfillment` del catálogo y hacer backfill de sus órdenes vivas → **feature 155**.
- Retirar `mensajero_sugerido_id`, `AsignacionMensajeroService`, la columna "Mensajero
  sugerido" del listado y el paso "Sugerir asignación" de la carga masiva → **feature 159**.
  Esta feature solo deja de USAR el sugerido en el modal; no borra el dato ni su columna.
- Cualquier migración de base de datos.

## Preguntas abiertas

1. **Ventana `en_fulfillment` entre la 154/156 y la 155.** La 154 ya retira las aristas
   `en_fulfillment → *` de `generacion_guia`, y esta feature retira ese origen del servicio
   (R4). Hasta que la 155 haga el backfill a `en_preparacion`, las órdenes vivas en
   `en_fulfillment` quedan sin acción de guía. ¿Se acepta esa ventana (con las tres features
   en la misma entrega a producción) o la 156 debe esperar a la 155 para desplegarse?
2. **Campo muerto en el repositorio.** `OrdenRepository.generarGuiaLote` recibe
   `mensajeroAsignadoId` por decisión. Tras esta feature el servicio siempre pasaría `null`.
   ¿Se limpia el parámetro aquí (toca `orden-repository.guia.test.ts` y el contrato del repo)
   o se deja documentado como muerto hasta la 159?
3. **Vista legacy `OrdenesRevisionMaestro`.** No la monta ninguna página (solo su test la
   renderiza) pero sí consume `GenerarGuiaModal` y ofrece "Rutear a bodega satélite" desde
   `en_fulfillment`/`en_preparacion` (R29). ¿Se ajusta al flujo nuevo, o se elimina la vista
   y su test por muerta? Esta feature asume "se ajusta" (lo mínimo).
4. **Texto exacto del aviso de éxito (R23).** Propuesta: *"Guía generada para N orden(es):
   quedan en bodega central."* ¿Se aprueba ese texto o hay uno preferido por operación?
5. **Manifiesto del lote (R24).** El flujo del manifiesto sigue llamándose `generacion_guia`
   y ahora todas sus filas tienen el mismo destino (bodega central). ¿Las columnas
   "responsable"/"destino" del manifiesto deben decir algo distinto ahora que no hay
   mensajero, o se dejan como están?
