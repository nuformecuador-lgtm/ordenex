# Auditoría de «ayuda a la tienda» ya mergeado en `dev`

> **2026-08-18/19.** El pedido humano del 2026-08-18 se planificó en
> `progress/design_pila_ayuda_tienda.md` sin saber que **otra sesión ya había implementado y
> mergeado parte de esa pila** en `dev` (merge #396 desde la rama `ux`), con un diseño distinto
> y **sin ficha ni spec**. Esta auditoría compara lo mergeado contra el pedido original, punto
> por punto, y mide dos riesgos de diseño.
>
> **Base auditada: `origin/dev` = 9095d4e5. NO está en producción** (`prod` = 448d5169).

## Lo que se mergeó, y con qué diseño

| Commit | Qué trae |
|---|---|
| `8df27285` | Tres columnas en `orden`: `ayuda`, `gestion_aprobada`, `intentos_contacto`, con 4 migraciones |
| `8f4c82ab` | Solicitud de ayuda del mensajero: modal, action, `SolicitudAyudaService`, tipos y tests |
| `55723c83` | «Habilitar» desde novedades + intentos de contacto; **retira el botón «Notas»** |
| `114388cc` | Enciende `gestion_aprobada` al aprobar el cierre (23 líneas, **sin un solo test**) |
| `c6fe6fc1` | La ventana de escritura del hilo se abre con una solicitud de ayuda viva |
| `6a0e6d36` | Fuera de alcance — ver §5 |

La diferencia de fondo con lo planificado: **`ayuda` es un BOOLEANO, no un estatus**, así que la
orden nunca sale de `en_reparto`; y **`gestion_aprobada` es una columna persistida**, el enfoque
que el diseño aprobado descartó explícitamente por sus sitios de limpieza.

---

## 1. EL FALLO QUE COBRA DINERO

**Se implementó la mitad que quita la visibilidad, sin la mitad que mueve el reloj.**

- `lib/repositories/OrdenRepository.ts:2942` — `novedadWhere` **exige** `gestionAprobada: true`
  para que una devuelta se liste.
- `lib/repositories/DevolucionSlaRepository.ts:38-55` — `findDevueltasSla` filtra **solo**
  `deletedAt` + `estatus = devuelta`, y ancla el reloj en `gestion.createdAt` (`:67`).
  `lib/services/DevolucionSlaService.ts` menciona `gestionAprobada` **cero veces** (verificado
  por conteo, no por lectura).

Con el retraso gestión→aprobación medido contra producción el 2026-08-18 (**mediana 8,2 h ·
p90 22,1 h · máx 48,2 h**) y la ventana `not_found` de **24 h**:

> El mensajero devuelve a las 10:00 → la tienda **no la ve** (cierre sin aprobar) → a las 24 h el
> cron la escala a `rechazada`, crea la gestión sintética y **se cobra como ingreso de bodega por
> rechazo**. La tienda nunca pudo reprogramarla.

**Antes del cambio la veía.** El saldo neto de la mitad implementada es **peor que no haber hecho
nada**. Era exactamente el punto 15 del pedido, y no se hizo.

---

## 2. Los otros dos fallos, del mismo origen

**2.1 · Fuga permanente en `/novedades`.** La rama `{ ayuda: true }` de `novedadWhere`
(`OrdenRepository.ts:2946`) **no acota estatus**. Una orden con el flag encendido se queda en
`/novedades` para siempre —`sin_gestionar`, bodega, incluso entregada— hasta que alguien pulse
«Habilitar» a mano. El corte nocturno (`CierreDiaRepository.ts:447-476`) la barre a
`sin_gestionar` y **no apaga el flag**.

**2.2 · «Habilitar» esconde la fila pero no detiene el reloj.** `habilitarNovedad` apaga el flag
**sin tocar el estatus** (`lib/types/novedad-habilitar.ts:13-17`). La orden sigue `devuelta`,
sigue siendo candidata del cron, y a los 5 días **se escala y se cobra**. Sin aviso.

**2.3 · La raíz común.** `gestion_aprobada` hay que apagarla a mano, y de las **7 salidas de
`devuelta`** (`lib/types/order-status-transiciones.ts:221-230`) **solo 2 la apagan**:

| Salida | ¿Apaga? |
|---|---|
| `→ en_bodega_*` por SLA (#19/#20) | **Sí** (`DevolucionSlaRepository.ts:104`) |
| `→ rechazada` por escalado (#21) | **No** |
| `→ reprogramada` por la tienda (#22) | **No** |
| `→ en_bodega_*` por recuperación manual (#23/#24) | **No** |
| `→ en_reparto` por deshacer gestión (#36) | **No** |

Y el **encendedor** (`CierresAdminRepository.ts:1017-1021`) **no acota el estatus actual**: puede
encender el flag sobre una orden que ya está en bodega, y entonces una devolución futura aparece
en `/novedades` sin que se haya aprobado su cierre nuevo.

---

## 3. Problema de proceso: aserciones enseñadas a no mirar

Se añadió una escritura a la transacción del dinero y **las dos aserciones que la habrían visto se
filtraron para ignorarla**:

- `tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts:115-120` —
  `updateManyDeDevolucion()` con `.filter(c => c.where.id !== undefined)`, que excluye
  precisamente el `updateMany` nuevo. Las aserciones de `:228` y `:239` cuentan sobre la lista ya
  filtrada.
- `tests/unit/repositories/cierres-admin-repository.test.ts:1143-1146` — lo mismo.

Y un comentario (`cierres-admin-repository.test.ts:138-141`) afirma que la escritura «se mide en su
propio archivo». **Ese archivo no existe**: ningún test cubre que `gestion_aprobada` se encienda.

Además, la retirada del botón «Notas» **no dejó guardia**: se borraron dos tests de
`NovedadesModuleHilo.test.tsx` y el mensaje de commit afirma que la cobertura se conservó. No se
conservó. Nada falla si alguien repone el botón.

---

## 4. El pedido original, punto por punto

**Cumplen (2):** el botón de pedir ayuda; el rescate del mensajero.

**Parciales (5):** el apartado aparte existe pero el corte es **solo de cliente** y la orden sigue
gestionable; la nota se escribe y **nadie la lee** (se retiró la lectura del hilo de la tienda); la
card oculta «Reprogramar» y «Devolver» en órdenes con ayuda; «Notas» sí se retiró pero «Devolver»
sigue siendo maqueta; el bloqueo del cierre funciona **por accidente** (la orden sigue
`en_reparto`) y tiene dos rutas exentas (`vencido → solicitado` y `rechazado → solicitado`).

**No están (9):** que la orden salga de la ruta (sigue siendo parada del optimizador y del mapa);
la pestaña nueva; la gestión de la tienda que cuenta como del mensajero; «Habilitar» = rescate; el
desenlace de las no gestionadas; el escaneo al aprobar; el re-anclaje del reloj; la evidencia y el
motivo obligatorios.

> ✅ **AL DÍA — 2026-08-20.** Cae también **«la gestión de la tienda que cuenta como del
> mensajero»**, entregada por la **237**: la tienda reprograma o rechaza desde su pestaña, con foto y
> motivo **obligatorios**, y la gestión entra en el cierre del mensajero con **su** `mensajero_id` —
> verificado contra Postgres, no contra la pantalla. En la fila de su cierre el mensajero ve el badge
> **«La tienda»** con el motivo y la evidencia, y **no puede deshacerla**: el botón queda apagado con
> la razón en el `aria-label`.
> **De la lista original sólo queda abierto el desenlace de las no gestionadas.** El punto 12 y
> «Rechazar» son de la **240**.
>
> ✅ **AL DÍA — 2026-08-19.** De esta lista **caen dos parciales y una ausencia**, entregadas por la
> ficha **236**: «la nota se escribe y **nadie la lee**» (la tienda la lee desde su card, y responde
> sin rescatar) y «**la pestaña nueva**» (existe, se llama «Ayuda solicitada» y va primera). Las
> ausencias de «que la orden salga de la ruta», «el bloqueo del cierre explícito» y ««Habilitar» =
> rescate» las cerró la **235**; «el escaneo al aprobar», la **238**. Siguen abiertas: la gestión de
> la tienda que cuenta como del mensajero (**237**) y el desenlace de las no gestionadas.

> ✅ **CAE UNA MÁS — 2026-08-20, ficha 237: «la gestión de la tienda que cuenta como del
> mensajero».** Desde la pestaña «Ayuda solicitada» la tienda puede **reprogramar** y **rechazar**
> (esos dos desenlaces y ninguno más), con **motivo y foto obligatorios en los dos** (D2, firmada
> por el humano), y la fila que produce es —para todo lo que mira `gestion_orden`— una fila más del
> mensajero: entra en **su** cierre, suma **un** intento de entrega y mueve el **mismo** dinero.
> Con ella cae también la ausencia de «la evidencia y el motivo obligatorios» **en esta vía**.
>
> Dos cosas que la auditoría no había visto y que la 237 tuvo que decidir:
> - el mensajero **podía deshacer** la gestión de la tienda (pasaba las ocho guardias) y borrar en
>   silencio hasta ₡1.000 que ella había decidido. Ya no puede (D3, R38).
> - el bloqueo del cierre tiene **dos rutas exentas**, así que una gestión posterior de la tienda
>   cae en el cierre **siguiente**. Se acepta y se prueba (D1, R32), no se descubre en producción.
>
> De las nueve ausencias de §4 queda **una**: el desenlace de las no gestionadas.

**Hace lo contrario (1):** el punto 12. `NovedadAcciones.tsx:116` —
`puedeHabilitar = esDevuelta || novedad.ayuda === true` — así que «Habilitar» aparece justo en las
cards que vienen de un cierre, que es donde el pedido decía que **no** debía estar.

---

## 5. Fuera de alcance detectado — `6a0e6d36`

Va mucho más allá de su título. Además de subir el umbral de cierres abiertos tolerados:

- **Retira la guarda de mensajero bloqueado en la asignación de guías**
  (`lib/services/GuiaAsignacionService.ts:339-350`, antes un `conflict`).
- **Retira una causa del bloqueo de bodega satélite** (`OrdenRepository.ts:2885-2905`).
- El umbral viejo sigue aplicándose en otras superficies, así que **la lectura y la escritura ya no
  coinciden**: un mensajero con un cierre abierto recibe asignaciones pero conserva o pierde otras
  restricciones según por dónde se lo mire.

Nadie pidió esto. Se investiga en ficha aparte antes de tocarlo: puede ser deliberado.

---

## 6. Lo que no se pudo determinar

- Si existe **backfill** de `gestion_aprobada`. No hay migración de datos ni script. Hoy es
  teórico —0 órdenes en `devuelta` en producción al 2026-08-18— pero el día que se despliegue con
  volumen, **todas las devueltas históricas caen de `/novedades`** por el `DEFAULT false`.
- El coste del `updateMany` con `some: { cierreId }` dentro de la transacción larga (no se
  revisaron los índices de `gestion_orden`).
- Si `deshacerGestion` alcanza en la práctica la gestión sintética de `reprogramarDesdeDevuelta`.
- Los e2e no se inspeccionaron ni se ejecutaron.

---

## CERRADO EL FALLO DE §1 — 2026-08-19 (feature 239)

El fallo que cobraba dinero **está arreglado en la rama `feature/239-devolucion-espera-cierre`**, y
no por parche: la mitad que quitaba la visibilidad y la que mueve el reloj **quedan del mismo lado
por construcción**. La orden entra en `devolucion_por_confirmar` y la aprobación del cierre es la
transición a `devuelta`, así que ya no son dos condiciones que alguien deba mantener sincronizadas.

También quedan cerrados los otros dos de §2:

- **La fuga permanente** (§2.1): la rama `{ ayuda: true }` exige además `en_reparto`. Es un **tapón
  con dueño** —la ficha 235 retira el booleano y la rama entera sobra— y está escrito así en el
  código, con dos tests que lo matan.
- **«Habilitar» que escondía sin detener el reloj** (§2.2): cerrado **por construcción**. Al volver
  la visibilidad a una igualdad de estado, la palanca dejó de existir; no hizo falta comprobación
  nueva.

Y el problema de proceso de §3: la escritura que **nadie vigilaba** ahora tiene su aserción, con una
orden testigo de otro cierre, matada por mutación.

**Lo que NO cierra esta ficha** y sigue en pie: §4 (la mayoría de los 17 puntos del pedido, que son
las fichas 235-238 y 240) y §5 (las guardas retiradas, ficha 241).


---

## CERRADO TAMBIÉN §2.1 Y §2.3 — 2026-08-19 (feature 235)

La 235 migró la solicitud de ayuda de un **booleano** a un **estatus propio** y retiró la columna.
Con eso:

- **§2.1, la fuga permanente**: deja de existir su causa. Ya no hay una marca que sobreviva a que la
  orden cambie de estado, así que no hay nada que se quede en `/novedades` para siempre. El tapón
  que la 239 puso como parche se retiró en el mismo movimiento.
- **§2.3, la raíz común** («una columna que hay que apagar a mano»): resuelta. Los dos apagadores
  colapsaron en **un solo punto de escritura**, y el resto de las salidas ya no tienen nada que
  apagar.
- **§4**: la orden ahora **sí sale de la ruta**, del mapa y de la gestión del mensajero, y el
  bloqueo del cierre pasó de accidental a **explícito**. El corte de «sección aparte», que era solo
  de cliente, subió al servidor.

Queda en pie de esta auditoría: el resto de §4 (fichas 236, 237, 238 y 240) y §5 (ficha 241).

> ⏳ 2026-08-20: la **237** ya aterrizó (ver la nota de §4). De §4 quedan la ficha **240** y el
> desenlace de las no gestionadas; §5 sigue siendo la **241**.
