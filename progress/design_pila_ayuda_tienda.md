# Ayuda a la tienda + novedades ancladas al cierre

## Contexto

Hoy el mensajero solo tiene cinco salidas para una orden de su ruta, y las cinco son
desenlaces: entregar, reprogramar, devolver, rechazar o reportar incidente. No existe una
sexta que diga «no puedo con esta, que la resuelva la tienda». Cuando se topa con una, la
única jugada es devolverla — y devolverla es un desenlace con consecuencias: cuenta como
intento, mueve dinero en el cierre y arranca el plazo de SLA.

A la vez, las órdenes devueltas entran a `/novedades` **en el instante en que el mensajero
las gestiona**, antes de que nadie haya comprobado que el paquete volvió físicamente a la
bodega. La tienda puede estar gestionando la devolución de un paquete que sigue en la moto.

Este trabajo abre el canal de ayuda mensajero→tienda con vuelta atrás, y mueve el momento en
que una novedad se vuelve visible al punto en que bodega confirma que tiene el paquete.

---

## Lo que YA existe y no hay que construir

- **El plazo de 24 h / 5 días ya está implementado y funciona como lo describiste.**
  `lib/services/DevolucionSlaService.ts`, movido cada hora por
  `app/api/cron/procesar-devueltas-sla/route.ts`: `not_found` → 24 h; `wrong_number` /
  `wrong_address` → 5 días. Vencida la ventana, `not_found` con menos de 3 intentos
  **libera a bodega con `prioridad = true`**, y en cualquier otro caso **escala a `rechazada`**.
  No hay que escribirlo: hay que **re-anclar su reloj**.
- **Los intentos ya se cuentan solo con el cierre aprobado**
  (`OrdenHistorialRepository.whereIntentosVigentes`), así que «vuelve a asignarse con un
  intento ya subido» ya ocurre.
- **El escáner de guías ya existe**: `components/shared/QrScanner.tsx`, `EscanerGuiaCard.tsx`,
  `EscanerModal.tsx` y `lib/utils/paquete-url.ts → extractNumGuiaFromScan`. Seis pantallas lo usan.
- **«Devolver a gestión» ya existe** (`CierreDiaService.deshacerGestion`, ventana `cierre_id IS NULL`).
- **La guardia de transiciones es exhaustiva**: un estatus nuevo **rompe el build** hasta que
  se declaren sus aristas. Es la red principal de este trabajo.

### Corrección: sobre el riesgo Q5

En una versión anterior de este plan escribí que gatear novedades por cierre aprobado
**cerraba un agujero abierto**. Es incorrecto y conviene decirlo antes de que alguien lo cite:
**Q5 está CERRADA con riesgo ACEPTADO** (`specs/215-reintento-en-cierre/design.md §7bis`,
decisión D14 del 2026-08-13, medida el 2026-08-14: 12 cierres, 12 aprobados, cero abiertos).
Lo que sigue diciendo «ABIERTA» es prosa caducada en el JSDoc de `DevolucionSlaService.ts:122`,
y actualizarla es parte de este trabajo.

Lo que este cambio hace con Q5 es **cambiarle la forma**, con saldo mixto:

- **Mejor**: se acaba el bucle (el cron no puede liberar lo que no ve), deja de encenderse
  `prioridad` falso, y la población atascada pasa a ser **contable**.
- **Peor, y es real**: hoy la mercadería sigue circulando y puede terminar entregándose; después
  **se congela**, y la tienda no se entera porque no la ve. Por eso la alerta de población
  atascada (M3 del §7bis) deja de ser opcional.

---

## Las dos vidas de una novedad

| | **Ayuda a gestionar** (nueva) | **Devuelta** (la de hoy, re-anclada) |
|---|---|---|
| Nace | El mensajero pide ayuda desde su ruta | El mensajero gestiona `devuelta` |
| Aparece en novedades | **Al instante** | **Al aprobar bodega el cierre** |
| El paquete está | Con el mensajero, en la calle | En bodega, ya escaneado |
| Botones | Reprogramar · Rechazar · Habilitar · WhatsApp · Llamar · hilo | Reprogramar · Rechazar · WhatsApp · Llamar |
| «Habilitar» | Devuelve la orden a la ruta | **No aparece** |
| Hilo de notas | Sí; la nota del mensajero lo abre | No |
| Quién gestiona | Cuenta **como el mensajero**: entra a su cierre | La tienda, con su propio efecto |
| Si nadie la gestiona | El corte de la noche la deja `sin_gestionar` | Vence el plazo: reintento o rechazo |

---

## Decisiones ya firmadas

1. El hilo de la 227 **vive dentro de la card de ayuda**; la nota con la que el mensajero pide
   ayuda es su primer mensaje. Las novedades de cierre no llevan hilo; el botón «Notas» se retira.
2. Lo que queda pidiendo ayuda al final del día lo barre **el corte de la noche**.
3. El escaneo al aprobar **bloquea**, y **los incidentes no cuentan** para ese bloqueo.
4. **No se permite solicitar cierre con órdenes en ayuda.**
5. La gestión de la tienda desde ayuda **cuenta como intento y mueve el dinero igual que la del
   mensajero**, y exige **los mismos requisitos: evidencia en imagen y motivo en texto**.
6. Desde ayuda la tienda solo puede **Reprogramar** y **Rechazar**.
7. El reloj de 24 h / 5 días **arranca cuando bodega aprueba**.
8. **La regla de intentos no se toca**: `rechazada`, `devuelta` y `reprogramada` siguen contando.
9. La **ficha 228** queda absorbida y se cierra como superada.

---

## La pila

### F1 · El estado «ayuda a la tienda» y el viaje de ida y vuelta

- **Estatus nuevo** `ayuda_tienda` (`lib/types/order-status.ts` + catálogo). Aristas en
  `lib/types/order-status-transiciones.ts`: `en_reparto → ayuda_tienda` y `ayuda_tienda → en_reparto`.
- **`origen_tipo` nuevos**: `solicitud_ayuda_tienda`, `rescate_ayuda_tienda`, `gestion_tienda_ayuda`.
  Migración de enum + `down.sql` que **recrea el tipo**. `gestion_tienda_ayuda` entra en
  `ORIGEN_TIPOS_VISITA_REAL` para que la gestión de la tienda cuente como intento.
- **`solicitarAyudaTienda({ ordenId, nota })`**: nota obligatoria (tope 200 **revalidado en el
  borde**, no solo en la UI). En una transacción: publica la nota **antes** del cambio de estatus
  —después la ventana ya no la admitiría— y transiciona. **No toca `mensajero_asignado_id`**.
- **`rescatarOrdenAyuda({ ordenId })`**: `ayuda_tienda → en_reparto`. Se escribe **una vez** y la
  llaman los dos lados (rescate del mensajero y «Habilitar» de la tienda), con guarda de estado.
- **Bloqueo del cierre**: `ayuda_tienda` cuenta como pendiente en `CierreDiaService.solicitarCierre`.
- **Corte de la noche**: `CorteDiarioService` barre también `ayuda_tienda → sin_gestionar`.
- **Ventana del hilo**: `lib/types/ventana-hilo-notas.ts` suma `ayuda_tienda` para **los dos roles**
  — si el mensajero no puede escribir, la tienda le habla a un hilo mudo.
- **UI mensajero**: botón en `GestionarOrdenPanel.tsx` con su modal de nota; apartado propio en
  `RepartoModule.tsx`; `MisAsignacionesService` pasa de dos estados a tres grupos.

### F2 · La pestaña «Ayuda a gestionar» en novedades

> ✏️ **EL ROTULO CAMBIA, firmado por el humano el 2026-08-19 (ficha 236, D6): la pestaña se llama
> «Ayuda solicitada», no «Ayuda a gestionar».** La razón: **«gestionar» es el verbo del MENSAJERO**
> en este repo —«por gestionar», «Gestionar más tarde», «Gestionar esta orden»— así que ponerlo en la
> pantalla de la tienda le atribuye un gesto que no es suyo; y menos ahora, que **gestionar desde
> ayuda es la ficha 237** y todavía no existe. Va **primera** de las tres pestañas, y el chip de la
> card pasa a «Esperando tu respuesta».

- Tercera pestaña en `NovedadesTabs.tsx`; predicado hermano de `novedadWhere`.
- «Habilitar» llama a `rescatarOrdenAyuda` de F1. El hilo se monta **dentro de la card**.
- El juego de botones se decide **según el origen de la orden, en un solo sitio**.

### F3 · La gestión de la tienda que cuenta como del mensajero

- **`gestionarDesdeAyuda({ ordenId, resultado, motivo, evidencias })`**, `resultado ∈ {reprogramada, rechazada}`.
  Fila de `gestion_orden` con `mensajero_id = el mensajero` y `cierre_id = NULL`; historial con
  `actor_usuario_id = la tienda` y `origen_tipo = gestion_tienda_ayuda`.
- **Reutiliza la maquinaria de evidencias** de `MisAsignacionesService.gestionar` (subida
  compensada 1..N), no una segunda.
- El dinero sale solo: los feeds leen `gestion_orden` y esta fila es una más.
- `deshacerGestion` sigue funcionando sin tocarlo, **porque una orden en ayuda bloquea el cierre**.
  Es la invariante que sostiene F3 y hay que probarla explícitamente.

### F4 · Confirmación física al aprobar el cierre

- Tercera rama en `pedirAprobacion()` (`CierresAdminModule.tsx`), junto a la de indemnizaciones.
- Modal con las guías esperadas, marcadas por escaneo o tecleo, reusando las piezas ya citadas.
  **Incidentes fuera de la lista.** **Bloquea** hasta completarla.
- `aprobarCierre` gana un parámetro con el patrón de `indemnizaciones` (cobertura exacta validada
  en el servicio antes de tocar el repo); se persiste **dentro de la transacción** de `resolverCierre`.

> ✅ **ATERRIZÓ el 2026-08-19** — ficha **238**, rama `feature/238-confirmacion-fisica-cierre`.
> Se implementó como estaba diseñado: tercera rama, modal con las guías esperadas, incidentes fuera,
> bloqueo hasta completar, y la marca (`gestion_orden.confirmada_fisica_at`) escrita **dentro de la
> transacción**, entre el disparo de devoluciones de la 139 y el anclaje de la 239.
>
> **Cuatro cosas que el diseño de esta pila no había previsto**, todas medidas:
> 1. **«Sin retornables» es 3 de cada 12 cierres.** No es un caso raro: en uno de cada cuatro la
>    ventana no debe aparecer y aprobar sigue siendo el gesto de hoy.
> 2. **El techo de un cierre son 14 paquetes** (media 2,7). La ventana se diseñó para eso: contador y
>    motivo del bloqueo fijos arriba, la lista desplazándose debajo.
> 3. 🔴 **Una orden puede tener DOS gestiones vivas en el MISMO cierre** —existe en producción, 1 par
>    de 48— y resolver `guía → gestión` con un `find` dejaba la segunda fila inalcanzable: **el
>    cierre no se podía aprobar nunca**. Una lectura confirma ahora **todas** las filas de esa guía.
>    Quien vuelva sobre esta pantalla, que no lo deshaga.
> 4. **D2 no tiene escapatoria**, por decisión humana: un solo paquete perdido devuelve el cierre
>    entero. La salida es rechazar con motivo.

### F5 · El limbo: la devolución espera al cierre  ⚠️ la más grande

**Enfoque elegido: partir el estado.** La orden **no entra en `devuelta` al gestionar**: entra en
un pre-estado, y **la aprobación del cierre ES la transición** a `devuelta`. `resolverCierre` gana
un tercer bloque, copia literal de los dos que ya tiene (`liberacion_sin_gestionar` y
`devolucion_rechazada`): `updateMany` guardado por el pre-estado + append por el choke point.

Se eligió sobre las dos alternativas por lo que **no** hay que tocar:

- `novedadWhere` **no cambia** — sigue siendo una igualdad de estatus, y `count`/`find` comparten
  `where` por construcción (invariante aseverada en `orden-repository.novedades.test.ts`).
- **Tres guardas quedan correctas solas**: `ReprogramacionTiendaService`, `RecuperacionBodegaService`
  y la ventana del hilo ya validan `= devuelta`, que ahora significa «anclada». Derivar el ancla en
  la consulta habría dejado abierto que la tienda reprograme por Server Action una orden que aún no
  debería ver.
- **Sin columna mutable que invalidar.** Una columna de ancla tendría cinco sitios de limpieza, y su
  dirección de fallo es **cobrar antes de tiempo** — justo lo que `specs/215` declara prohibido.
- El cron escanea **menos**, no más, y la población atascada se vuelve contable.

**Correcciones al diseño que hay que respetar:**

- **`cierre_dia.resuelto_at` NO significa «aprobado»**: se escribe igual al rechazar, y
  `forzarSolicitudVencido` reabre sin limpiarla. Cualquier uso lleva `estado = 'aprobado'` pegado.
- **El destino de una gestión se deriva por identidad de nombre**
  (`MisAsignacionesService.ts:377`, `findEstatusIdByValue(input.resultado)`). Hay que **crear** el
  mapa `resultado → estatus`. Es la bisagra de todo F5.
- **`ESTADOS_ESPERADOS` (`CierreDiaService.ts:86`)**: si no se le suma el pre-estado, **el mensajero
  deja de poder deshacer su propia devolución del día**. Es regresión, no aserción a actualizar.

**Mapas parciales que NO rompen el build y hay que revisar a mano** — la lista de olvidos probables:
`app/(app)/ordenes/exclude-por-rol.ts` (un estado no listado auto-aparece como filtro para todos),
`lib/types/webhook-eventos.ts` (**cambio de contrato con integradores externos**: dejan de recibir
`devuelta` al gestionar y lo reciben al aprobar), `lib/utils/estados-bodega-satelite.ts` (el satélite
dejaría de ver sus devoluciones) y `lib/types/tablero-dia.ts`.

**Tandas** (no hay punto de despliegue intermedio seguro: sin flag, y si el productor sale sin el
consumidor, `/novedades` queda vacía con el árbol verde):

- **T0 — medir, sin código.** Cuatro consultas de solo lectura, y una decide si la feature es
  aceptable: el **lag mediano gestión → aprobación**. Hoy una devolución se ve en segundos; después
  se verá cuando el corte de las 06:00 cree el cierre y alguien lo apruebe. Puerta humana con los
  números delante.
- **T1 + T2, un solo PR**: catálogo, aristas, mapa `resultado → estatus`, `ESTADOS_ESPERADOS` y las
  seis superficies de estatus; y el tercer bloque de `resolverCierre` que cierra el circuito.
- **T3** — cron y servicio: el ancla entra por `findDevueltasSla` con **rama legada nombrada** para
  las filas viejas; se reescribe el bloque de Q5 con fecha.
- **T4** — los tests legítimamente invertidos: los tres emuladores de
  `tests/integration/db/resolver-novedad-*` y el e2e de escalado. Es la tanda más cara y la más
  subestimada.
- **T5** — la alerta de población atascada (M3).
- **T6** — spec, y marcar como **superadas** con fecha las decisiones §1.1 y §3.5 de
  `specs/99-devolucion-diferida-sla/design.md`, más actualizar §7bis de la 215.

### F6 · El rechazo manual de la tienda y la limpieza de la card

- Hoy `devuelta → rechazada` **solo la dispara el cron**. Se añade la arista para `adminTienda` con
  su `origen_tipo`; «Devolver» pasa a llamarse **«Rechazar»** y a hacer algo.
- Se retiran «Habilitar» y «Notas» de la card de las novedades de cierre.
- Se cierra la **ficha 228** como superada.

---

## La carrera que puede costar dinero

**Dos cierres de la misma orden.** Gestión g1 en el cierre C1 (pendiente) → un admin recupera a
bodega → reasignación → g2 en C2. Si **C1 se aprueba mientras la orden está en el pre-estado por
g2**, el bloque la ancla con una aprobación *anterior* al hecho real: el reloj arranca antes, el
escalado ocurre antes y **se cobra el rechazo antes de tiempo**.

Mitigación obligatoria: el bloque no puede tomar las gestiones `devuelta` del cierre a secas; debe
verificar **dentro de la transacción** que la gestión sea la `devuelta` vigente más reciente de esa
orden — el mismo `findFirst` que `GestionOrdenRepository.reprogramarDesdeDevuelta` ya hace.

Las otras cuatro carreras (cron ↔ aprobación, re-aprobación, reprogramación manual, deshacer) están
cerradas por las guardas de estado que el repo ya usa; bajo este enfoque la tercera es **imposible
por construcción**.

---

## Decisiones abiertas para el spec

1. **Nombre y etiqueta del pre-estado**, y qué ve el destinatario en el rastreo público durante el limbo.
2. **Si el pre-estado es evento público de webhook** — cambio de contrato con integradores externos.
3. **Qué ve la tienda durante el limbo**: nada, una fila deshabilitada, o una pestaña propia.
4. **Si el adminSatélite conserva `recuperarABodega`** sobre devoluciones no aprobadas (el paquete
   está físicamente en su bodega).
5. **Granularidad de la ventana**: rolling en milisegundos como hoy, o desde el inicio del día CR.
6. **Las órdenes en vuelo el día del despliegue**: recomendación *grandfather* — moverlas hacia atrás
   exigiría escribir estado desde SQL sin pasar por el choke point, que la convención prohíbe.
7. **Si un cierre rechazado y luego re-aprobado re-ancla** con la aprobación final.

---

## Verificación

- **Gate completo** (`./init.sh`) al cerrar cada feature, con el árbol quieto.
- **Guardias que deben quedar verdes**: transiciones exhaustivas, `hilo-ventana-alcanzable`,
  frontera de `orden_nota`, money-safe, y **los criterios de intento**
  (`intentos-entrega-criterio-unico`, `criterio-intento-entrega`): el ancla de la novedad y el
  conteo de intentos miran ambos «cierre aprobado» y **fusionarlos es tentador y está mal**. Si esos
  se ponen rojos, alguien los unificó.
- **Rojos que son regresión, no aserción a cambiar**: los cinco feeds de dinero de `resolverCierre`
  y sus suites de idempotencia, y `cierres-admin-caja-cod.test.ts`, que **mide el orden de las
  llamadas** dentro de la transacción — un rojo ahí significa que el bloque nuevo aterrizó mal.
- **Mutación obligatoria** en tres puntos: que la gestión de la tienda entra al cierre correcto, que
  el escaneo bloquea de verdad cuando falta una guía, y que el reloj arranca en la aprobación.
- **Ver la app**, no solo la suite: pedir ayuda → verla en el tab → rescatarla → volver a pedirla →
  gestionarla desde la tienda → verla en el cierre → aprobar con escaneo → verla llegar a novedades.
- **La migración de enums** contra `tests/integration/db`, con su `down.sql` probado.


---

## ADVERTENCIA HEREDADA PARA LA FICHA 237 — 2026-08-19

Medido al implementar la 235, y hay que **probarlo, no asumirlo**:

La invariante que sostiene la F3 —«una orden en ayuda **bloquea** la solicitud de cierre, así que la
gestión de la tienda siempre cae antes del snapshot de totales»— es **cierta al CREAR un cierre** y
**FALSA en las dos rutas de re-solicitud** (`vencido → solicitado` y `rechazado → solicitado`), que
siguen exentas de esa precondición **por diseño anti-deadlock** (feature 111/R9).

En esas dos rutas, una gestión hecha por la tienda nace con `cierre_id = NULL` y **cae en el cierre
siguiente**. No rompe el dinero —el snapshot ya se congeló sin ella y la gestión se vincula al
próximo—, pero **cambia en qué cierre aparece**, y eso es exactamente lo que la 237 promete al decir
«entra en el cierre del mensajero».

**La 237 tiene que escribir un requisito para ese caso y un test que lo ejerza.** Si se da por
sentado el caso feliz, el defecto aparece en producción como una gestión que sale en el cierre de
otro día.
