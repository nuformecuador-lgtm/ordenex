# Sesión activa

> Estado vivo de lo que se está trabajando **ahora**. El leader lo mantiene al día.
> Al cerrar una feature se limpia de aquí y se resume en `history.md`.
>
> **Dónde está el historial completo:** los PRs de GitHub, `progress/impl_*.md` / `review_*.md`
> por feature, y la narrativa de decisiones dentro de cada entrada de `feature_list.json`.
> La bitácora extensa que vivía en este archivo se puede recuperar con
> `git show <rev>:progress/current.md`.


## 🧾 2026-08-31 — cierre de sesión: seis fichas y un defecto de producción

**Todo lo abierto quedó cerrado.** Ocho fichas `done`: las cuatro de la wallet planificadas el día
anterior (85, 332, 333, 334), las dos de la wallet de la tienda (335, 336) y las dos que nacieron de
un reporte de producción (337, 338).

**Lo que empezó todo.** Una pregunta del humano: «el cierre pendiente de Kendall no concuerda con el
número de paquetes que le asignaron». Era cierto — 30 filas contra 23 asignadas — y detrás había un
**defecto de diseño**: las gestiones que la tienda resuelve desde novedades (`rechazo_tienda`,
`reprogramacion_tienda`) entraban al **próximo cierre del mensajero**. 41 de ellas, en los 6 cierres
pendientes; una formaba un cierre entero sin una sola gestión de su mensajero (Andy Cortés).

No era un descuido: el código lo hacía **a propósito** —su comentario decía «entra al próximo cierre
pero aporta 0,00»—. Una decisión que envejeció mal: un cierre no es una suma, es el documento del que
alguien responde.

**Se corrigió, se desplegó como hotfix y se limpiaron los datos**: 41 filas fuera en una sola
operación atómica, ningún total ni pago alterado (aportaban ₡0), y el cierre vacío borrado —no
rechazado: rechazar **bloquea al mensajero**, y Andy no había hecho nada—. Kendall pasó de 30 a 23.

### Lo que este día enseñó, y conviene que sobreviva

1. **El criterio estaba escrito TRES veces, no dos.** La tercera copia era la que de verdad escribe
   el vínculo. Arreglar sólo la lectura habría quitado las filas de la pantalla **dejándolas entrar
   al documento igual**: el bug entero, invisible.
2. **Un hotfix a `prod` no está terminado hasta que vuelve a `dev`.** Salió por urgencia y `dev` no
   lo tenía; la siguiente release lo habría **revertido en silencio**. Lo detectó el humano antes que
   el leader. Se devolvió con el PR #628.
3. **`git add` incompleto = fallo mudo propio.** Al commitear la primera mitad se escribió
   `git add lib tests …` y se olvidó `app/`: entraron los tests del rótulo y **no el código que
   arreglan**. Se cazó revisando qué archivos llevaba el hotfix de verdad, no fiándose del informe.
4. **El gate encuentra censos que nadie contó.** `ControlDescargaTransversal` llevaba dos números que
   ni el spec ni el agente tenían. Y ahí se ve el valor de una **igualdad** frente a un **suelo**: el
   suelo se ajusta solo, la igualdad obliga a pasar por ahí y explicar.
5. **Una guardia puede fallar por hacer bien su trabajo.** El spec de la 336 escribía el marcador de
   «test desaparecido» como ejemplo, y la guardia lo leyó como anotación viva. Se neutralizó el
   ejemplo **sin debilitar la guardia**: enseñarle a ignorar bloques de código abriría el agujero de
   esconder una anotación real ahí dentro.
6. **Los subagentes declararon sus propios huecos**: una mutación que no podía enrojecer lo que el
   spec decía, un test de render que no mata `Number()`, dos casos que sobreviven a su mutación, y un
   rojo que un agente descubrió **haberse causado él mismo** al solapar dos suites.

### Lo que se midió contra producción, y desmintió suposiciones

- **Las tarifas no se cobraban mal.** Los 4 cobros de flete de retorno salen de rechazos **reales en
  calle**. Lo que asustaba era el rótulo: «Tarifa aplicada» sobre nueve precios, con «se aplicó»
  marcando a la vez entrega y devolución —imposible—. Corregido en la 338.
- **A ningún mensajero se le pagó de más**: ₡0 en las 41 gestiones ajenas.
- **El ingreso de bodega por rechazo está en 0,00 en las 40 rechazadas**: un camino dormido, no un
  cobro detenido.
- **Firefox en Mac: NO REPRODUCIDO, y no se inventó causa.** Se descartaron por medición el área de
  clic del componente, el motor de Safari (WebKit), el ancho de MacBook y Firefox como tal (funciona
  en Windows y en Retina). Queda la combinación Gecko + macOS, que esta máquina no ejecuta.

### Deuda viva, con dueño

- **`LandingPoliticas` dice «Devoluciones tienen costo adicional de flete de retorno»**, y desde la
  ficha 301 **es falso**: una devolución no cobra nada. Texto comercial → decisión de negocio.
- **5 remisiones duplicadas entre Gameos y Nuform** (72973, 72978, 72979, 72983, 73104). No es del
  sistema —dos cuentas distintas cargando el mismo envío, y la regla de remisión única es POR
  TIENDA— pero en la 72973 una copia se **entregó** y la otra se **rechazó**: a Gameos se le cobra el
  retorno de un paquete que sí llegó.
- **`wallet_movimiento` sin `CHECK`**: un monto cero entra. 0 filas afectadas hoy; prevención.
- **En la API se cambiaron descripciones, NO claves** (`devuelto`): renombrar una clave rompe a todo
  integrador y necesita su propia decisión.
- **Sin repaso visual**: el panel de cobros nuevo y la wallet de la tienda no se han visto en pantalla.

## ✅ 2026-08-29 — wallet: LAS CUATRO FICHAS CERRADAS Y EN `dev`

| # | PR | En `dev` | Gate completo |
|---|---|---|---|
| 85 | #609 | `48d40398` | 21.881/21.908 |
| 332 | #610 | `b776d0da` | 21.943/21.970 |
| 334 | #611 | `7305949a` | 22.009/22.036 |
| 333 | #612 | `63a43463` | 22.252/22.279 |

Las cuatro `done`, cada una verificada **sobre el blob remoto**, no sobre el estado del PR. `dev` no
ganó nada ajeno entre medias, así que cada gate cubre su propio contenido.

**Lo que el módulo tiene ahora y no tenía esta mañana.** La periodicidad y el día de cobro se eligen
en pantalla y editar el monto ya **no** reescribe el ciclo en silencio; las plantillas se pueden
**eliminar** de verdad; los gastos fijos marcados «requiere aprobación» **no se cobran solos** —crean
un pendiente que solo el maestro aprueba, con aviso en la campana, recordatorio diario y su cola
dentro de `/wallet`—; y mover dinero se hace desde **un** diálogo en vez de dos, con la **fecha en que
ocurrió**.

**Lo que este día enseñó, más allá de las fichas:**

1. **Un PR «MERGED» no garantiza que tu trabajo esté en `dev`.** El commit del repaso de la 332
   (`3d29842f`) se empujó después del merge y se quedó fuera **sin ninguna señal**; se rescató con
   cherry-pick. Desde entonces cada cierre comprueba los commits uno a uno contra `origin/dev`.
2. **Un gate rojo no prueba nada por sí solo, y uno verde tampoco.** Dos rojos fueron flakes de
   saturación —`CrearTiendaForm` y un deadlock `40P01`—, diagnosticados aislando antes de repetir y
   **sin** meterlos al baseline, que compara por archivo y taparía un rojo real suyo. Y al revés: la
   guardia de superficie ya estaba baselineada, así que un backend mergeado sin su frontend habría
   salido **verde mintiendo**; por eso se miró su CONTENIDO y las fases fueron en el mismo PR.
3. **Los censos de inventario cerrado son el sistema funcionando.** Los cinco que rompió la 333
   existen para que ampliar un enum sea deliberado. Se actualizaron sin relajar ninguno — y
   aparecieron **cuatro nombres de caso que ya mentían desde la 271**.
4. **Ver la app encontró lo que la suite no.** Dos repasos con navegador: uno probó en vivo que editar
   el monto ya no mueve la periodicidad, otro que el `admin` ve la cola con **cero** botones de
   decidir. Ningún test unitario cubría eso de punta a punta.
5. **Los subagentes declararon huecos en su propio trabajo** —una mutación que no podía enrojecer lo
   que decía el spec, un test de render que no mata `Number()`, dos casos que sobreviven a su
   mutación— y esas confesiones se conservaron en las bitácoras.

**Deuda viva, con dueño y medida:**

- **`wallet_movimiento` no tiene ningún `CHECK`**: un monto **cero** entra en la tabla del dinero.
  Medido contra producción el 2026-08-29: **0 filas** con monto cero o negativo (38 movimientos,
  mínimo ₡312) y **0** en `wallet_tienda_movimiento` (40 filas). El borde ya valida `> 0`, así que
  es **prevención**, no corrección. Sin ficha todavía.
- De los tres botones de la fila de plantillas, el más llamativo es **Eliminar** y el menos visible
  **Desactivar**: la acción segura es la que menos se ve. Anotado en la 332, sin arreglar, a decisión
  del humano.
- El `min` del selector de fecha (334) usa una env var no pública, así que el cliente siempre pinta la
  ventana por defecto; el borde valida bien, solo la pista visual quedaría corrida.
- `prisma migrate dev` está **inusable en esta máquina** por un desajuste de checksum **preexistente**
  en `20260827160000_orden_num_remision_unico_parcial`. Se trabajó con `migrate deploy`. Ajeno a estas
  fichas.

---

## 💰 2026-08-29 — repaso del módulo wallet: cuatro fichas (85, 332, 333, 334)

**Estado: las cuatro `pending`, specs EN CURSO (cuatro `spec_author` en paralelo).** El alta viaja en
el **PR #608** (solo `feature_list.json`, gate `--rapido` verde: 2449/2450, único rojo en el baseline
conocido). Las specs van en `chore/specs-wallet`, nacida de `chore/registro-fichas-wallet`
(`05e5e958`), que sale de `origin/dev` en `8061d816`. **Apilado declarado: #608 se mergea ANTES que
el PR de las specs** — el precedente contrario en este repo dejó commits que nunca llegaron a `dev`
con el hijo en verde y «merged».

**Qué pidió el humano** (textual, 2026-08-29): las plantillas de gastos fijos no se pueden eliminar;
los gastos fijos deben ser parametrizables — «poner qué día quieren que se haga el cobro» —; el cobro
no debe ser automático sino **autorizado por un administrador**; eso debe tener **notificaciones y
recordatorios**; y le preocupa **la simplicidad de hacer ajustes o movimientos de dinero** dentro de
la wallet.

**MEDIDO CONTRA PRODUCCIÓN antes de registrar nada** (solo lectura, 2026-08-29). Es lo que da peso a
cada ficha, y sin ello la 333 no se justificaría hoy:

- 2 plantillas de gasto fijo («Alquiler bodega» 10.000, «Alquiler camioneta» 25.000), las **dos
  inactivas** desde el 2026-08-27, con `fecha_cobro` = 2026-08-04 en ambas.
- **0** movimientos `egreso_gasto_fijo` emitidos **jamás**: el mecanismo nunca ha cobrado nada y
  desactivar fue el sucedáneo del borrado que no existe.
- **0** movimientos de ajuste sobre **38** filas del libro: nadie ha usado nunca ese diálogo.

**EL FALLO MUDO que destapó el repaso, verificado leyendo el código.**
`GastoFijoPlantillaDialog` envía solo `{id, concepto, monto}`; los defaults de `periodicidadFields`
en `actualizarGastoFijoPlantillaSchema` rellenan `meses`/`1`/**hoy**, y
`GastoFijoPlantillaRepository.actualizar` los escribe **sin condición**. Resultado: **editar el monto
reescribe la periodicidad a mensual y mueve el ancla del ciclo al día de la edición.** De `semanas` a
`meses` cambia además el formato de la clave de idempotencia (`<id>:2026-09-14` → `<id>:2026-09`),
que es el escenario de **doble cobro** que `GeneracionGastosFijosService` advierte por escrito en su
cabecera. En producción **aún no ha mordido**: las dos ediciones del 2026-08-27 fueron
desactivaciones, que van por `setActiva` y no tocan `fecha_cobro`.

**Las cuatro fichas.**

| # | Ficha | Zona | Tamaño | Depende |
|---|---|---|---|---|
| 85 | periodicidad y día de cobro del gasto fijo en la UI | fullstack | media | 84 |
| 332 | eliminar plantillas de gasto fijo | fullstack | baja | 85 |
| 333 | el gasto fijo se cobra con autorización, aviso y recordatorio | fullstack | alta | 85 |
| 334 | un solo diálogo para mover dinero en la wallet | fullstack | media | — |

La **85 ya existía** en `pending` desde el 2026-07-17 (la mitad de frontend que la 84 dejó sin
entregar): se **amplía**, no se duplica. Pasa de `frontend` a `fullstack` y pierde el «(frontend)»
del nombre, que ya mentía — el arreglo honesto del reset toca el schema, no solo el diálogo.

**PUERTA HUMANA del 2026-08-29: cuatro decisiones CERRADAS antes de escribir los specs.**

- **Borrado (332).** La fila desaparece de la tabla de plantillas. Decisión textual: «lo importante
  es el historial del libro, si el movimiento ya se hizo no hay problema que quede allí ese histórico
  pero cuando ya no se necesite sí es importante poder prescindir y eliminarlo». Es viable sin perder
  nada: `wallet_movimiento` **no tiene FK** a `gasto_fijo_plantilla` (referencia derivada
  `origen_id = '<plantillaId>:<periodo>'`) y la descripción del movimiento ya lleva el concepto.
  Esta ficha **revoca explícitamente** el R25 de la 45 («sin borrado»), con OK humano.
- **Autorización (333).** Se decide **por plantilla** (cobra sola / requiere aprobación), no global.
- **Quién aprueba (333): SOLO EL MAESTRO.** ⚠️ Es la **primera excepción** a la paridad
  admin↔maestro que la ficha 94 dio en wallet, y al resto del CRUD de plantillas, que usa
  `esAccesoTotal` (maestro + admin). El admin **ve** los pendientes y no los aprueba. Está pedido
  como excepción deliberada en el spec para que nadie lo lea como descuido.
- **Recordatorio (333).** Diario mientras siga pendiente; el pendiente **no vence solo**. No hace
  falta cron nuevo: `generar-gastos-fijos` ya corre diario a las 6:00.
- **Borrar con pendientes (332+333).** Se cancelan, y la confirmación lo dice con el número delante.
  La cascada la **posee la 333** (dueña de la tabla de pendientes); la 332 solo la declara, para que
  siga siendo implementable hoy sin la 333.
- **Fecha del movimiento (334).** El movimiento manual **admite fecha, con tope en hoy**.

**Trampas pasadas a los specs por escrito, para que no se redescubran caras.** (a) El notificador hay
que **inyectarlo en el composition root**, no basta con importarlo — precedente: 2 de 7 notificadores
muertos con la suite verde. (b) El recordatorio **diario** choca con `notificacion_dedupe_key` si la
clave no incluye el día: es el mismo error que la 262 documentó, donde el segundo aviso no salía
nunca, en silencio. (c) La guardia del reset de la 85 debe afirmar **valores literales**, no
compararse contra los defaults del propio schema, o está verde por construcción. (d) La 334 borra dos
componentes al fusionarlos: la cobertura de ambos tiene que sobrevivir, con los archivos de test
nombrados — borrar un componente ya se llevó su test por delante y costó una regresión en producción.
(e) La fecha de la 334 **no puede reutilizar `created_at`** sin enumerar antes qué consumidores del
ledger se mueven (analítica y rollup diario incluidos).

**AVANCE del 2026-08-29 (tarde).** Los cuatro specs están escritos y commiteados. El humano **retiró
la puerta de aprobación** de los specs para esta tanda («tan pronto termines con los specs implementá
sin preguntar»), así que se implementa en cuanto cada spec cierra.

- **PR #608 — alta de las cuatro fichas: MERGEADO** en `dev` (`4eaff293`).
- **Ficha 85 — IMPLEMENTADA, `in_progress`, PR #609 abierto y sin mergear.** Rama
  `feature/85-gasto-fijo-periodicidad-ui`. Fase B (`backend_dev`) y fase F (`frontend_dev`),
  secuenciadas. `./init.sh` **completo** en verde: **21.881/21.908**, `INIT_EXIT=0`. El único archivo
  rojo es `superficie-de-uso.guardia.test.ts`, del baseline, y se verificó **su contenido**: el único
  infractor es `lib/actions/tarifas.ts:67 obtenerTarifa`, ajeno a la ficha. Se mira el contenido y no
  solo el nombre porque el baseline compara **por archivo** y no vería un rojo nuevo dentro de uno ya
  listado. Siete mutaciones aplicadas con salida roja real en `progress/impl_85.md`.
  - Una de esas mutaciones **corrigió el enunciado del propio spec**: mutar el borde no puede
    enrojecer el test de servicio, porque ese test vive por debajo de zod. Se mutó también el
    servicio.
  - Los specs de la **332, 333 y 334** viajan en ese mismo PR (solo documentos).
- **BLOQUEO ACTIVO:** el merge de #609 lo rechaza el clasificador de auto mode. Hasta que entre, la 85
  no pasa a `done` y **fullstack sigue en su tope de 2** (321 + 85): la 332 no puede arrancar sin
  romper la regla 1, que el gate valida.

**Decisiones de producto tomadas por el leader** al retirarse la puerta, todas fuera del dinero: presets
de periodicidad + «Personalizada»; fecha de cobro pasada **se avisa, no se bloquea**; «Monto» en vez de
«Monto mensual»; «No se cobra» en inactivas; las dos columnas nuevas **sí** entran al Excel; el
interruptor de la 333 nace en «requiere aprobación»; el aviso llega a maestro y admin y **decide solo el
maestro**; desactivar **no** cancela pendientes; la cola pagina sin tope duro; y la 334 admite fecha
hacia atrás con **ventana de 30 días configurable**.

**Consecuencia declarada de esa última** (no la introduce la ficha, la hace visible): el rollup diario
calcula **el día en curso**, así que un movimiento fechado ayer no entra solo en el agregado de ayer.
Hay script de backfill, pero es un paso manual.

**Orden restante**, serial por conflicto de archivos y por cupo: **332 → 334 → 333**.

**Lo que falta.** Cerrar los cuatro specs, pasarlos por la puerta humana de aprobación y recién ahí
tocar código. El cupo de `in_progress` en fullstack lo ocupa hoy la **321**, así que solo una de las
cuatro puede entrar a `in_progress` a la vez hasta que la 321 cierre.

## 💬 2026-08-28 — ficha 321: histórico de conversaciones (admin y maestro leen el chat de todos)

**Estado: `pending` → spec EN CURSO (`spec_author` lanzado).** Rama
`feature/321-historico-conversaciones` desde `origin/dev` en `156669af`, ya mergeada con `dev`. Zona `fullstack`,
complejidad alta, `sdd: true`. Alta registrada en `feature_list.json`.

**Qué pidió el humano.** Un ítem de sidebar **Histórico** visible solo para `maestro` y `admin`,
con subítem **Conversaciones**: se listan las conversaciones de **todos** los mensajeros y se leen
todos los mensajes enviados y recibidos **por orden**, independientes de la fecha, con separador de
día «jueves 28 de agosto». El hilo **pagina por scroll** (no carga todo de golpe). Filtros por fecha
y por orden, montados sobre la **barra de filtros que ya usan las tablas**, con el mensajero como
control externo y un input libre que alcanza nombre del destinatario, `num_guia`, `num_remision` y
nombre del mensajero. Es **solo lectura**.

**⚠️ DOS colisiones de número esquivadas en la misma sesión, antes de escribir una línea.** Se
descartó el **315** (libre en la lista, pero `origin/fix/315-liberar-al-aprobar-cierre` lo reclama
por nombre) y, al crear la rama desde `origin/dev`, apareció que otra sesión ya había registrado el
**317**: la rama se renombró `317 → 318` en el acto — y al aterrizar hubo que renumerar **otra vez**
(ver abajo). Precedente: la 311 se renumeró **tres** veces y
la 316 una.

**Bajada de `dev`, hecha antes de empezar.** `origin/dev` está en `156669af` y la rama nace de ahí.
El `dev` **local** figura 2 ahead / 7 behind, pero `git diff origin/dev...dev` es **vacío**: sus dos
commits extra (`bca25ded`, el fix del adjunto de la 311) ya entraron a `origin/dev` por PR con otro
sha. **No hay nada que mergear ni conflicto que resolver**; el `dev` local se queda como está para no
tocar historia ajena.

**Cupo.** La **316** se pasa a `done` en este mismo commit: llevaba `in_progress` con el PR #573 ya
mergeado a `origin/dev` (merge `9c5ebec5`). Mismo precedente que la 311, cerrada en el commit del
alta de la 316. Fullstack queda sin ninguna `in_progress`.

**Lo que YA existe (medido, no supuesto), para que el spec no reinvente:** `ChatConversacion`
(`@@unique([ordenId, telefonoE164])` → una orden puede tener más de un hilo) y `ChatMensaje` con el
índice **explícito** `[conversacion_id, ocurrido_at]` puesto para el historial ordenado; las burbujas
del chat en `app/(app)/mis-asignaciones/_components/chat/`; el menú en un único punto,
`SIDEBAR_ITEMS` de `lib/auth/menu-visibility.ts`, que ya soporta `children` y `roles`; y la barra
reusable `components/shared/BuscadorFiltros.tsx` sobre `FilterComponent.tsx`.

**Trampas declaradas antes de empezar.** (a) La autorización del chat es **por mensajero asignado**
—`ChatConversacionRepository` y el proxy `/api/chat/media/[mensajeId]`—, así que hoy un admin que no
es el mensajero del hilo **no ve ni el hilo ni sus adjuntos**: ensancharla tiene que ser explícito y
con test propio. (b) El ítem de menú solo *muestra*; la defensa real es el gate de la ruta, y ambas
capas deben leer la **misma** constante de roles (precedente R10 de la 129). (c) El **guardia de la
229** congela `PUBLIC_ROUTES` posicionalmente: cualquier ruta nueva lo pone rojo. (d) `MediaAdjunto`
dice «del cliente» en textos que aquí pueden quedar falsos. (e) El binario de la media **no se
guarda** (D1/R15 de la 311) y a los 30 días Meta lo da por no disponible: el histórico tiene que
**decirlo**, no romperse.

**PUERTA HUMANA del 2026-08-28: las 9 preguntas, CERRADAS.** El spec v1 (38 requisitos, sin
migración) se revisa con estas respuestas:

- **P1 — el cambio de diseño de verdad.** El hilo es por **orden + mensajero**, no por
  `orden + teléfono`: «el chat del mensajero del día que gestionó esa orden». Como la tabla es
  `@@unique([ordenId, telefonoE164])`, una misma (orden, mensajero) puede tener **más de una fila**
  si el cliente cambió de número — se fusiona **en la consulta**, agrupando por
  `(orden_id, mensajero_id)`, **sin tocar la DB**. Y una orden **reasignada** tiene dos hilos, uno
  por mensajero: eso es correcto, no un duplicado que deduplicar.
- **P2** — la fecha corta por **mensaje**, listado e hilo diferenciados, y **sin añadir nada a la
  DB**: la alternativa A6 (columna materializada `ultima_actividad_at` o índice nuevo) queda
  **descartada por decisión humana**, no aplazada.
- **P3/P4/P5** — se aterriza en lo más reciente paginando hacia atrás; **solo `maestro` y `admin`**;
  el histórico **sí** ve los adjuntos por la vía separada, sin relajar la del mensajero. Y enviados
  y recibidos van en el **mismo** hilo y en el mismo orden cronológico, no en una vista aparte.
- **P6 — corrige lo que el spec recomendaba.** El separador **sí** usa «hoy»/«ayer» y **nunca**
  lleva año, ni siquiera fuera del año en curso. El resto de días se queda en «jueves 28 de agosto».
  El off-by-one vive justo ahí, en la fecha calendario CR.
- **P7** — el filtro «por orden» es el **número exacto**, no coincidencia parcial ni el input libre.
- **P8 — cambio de alcance.** El **listado también se pagina** (N conversaciones a la vez, con
  cursor propio) y los **mensajes no se cargan hasta abrir la conversación**. Son **dos**
  paginaciones y ningún mensaje viaja en la respuesta del listado — lo que además baja el riesgo que
  `T0` iba a medir.
- **P9** — sin límite de antigüedad: **un cron futuro** limpiará el exceso (fuera de alcance), y la
  media de más de 30 días sale como no disponible.

**⚠️ TERCERA COLISIÓN DE NÚMERO, y la lección es nueva: renumerada 318 → 321 AL ATERRIZAR.**
Mientras esta rama trabajaba, otra sesión registró **su propio id 318** en `origin/dev` (PR #575,
`chore/cierre-317-y-ficha-318`) y además el **319** y el **320**. Dos fichas con el mismo id habrían
puesto **rojo el propio `init.sh` de `dev`**, que valida ids duplicados. **Lo cazó el reviewer, no el
gate.** La lección que no estaba escrita: verificar el id **al abrir** la rama no basta —el número se
puede perder *mientras* trabajas—, así que hay que **revalidarlo contra `origin/dev` justo antes del
PR**. El conflicto de `feature_list.json` se resolvió partiendo de la lista de `origin/dev` para no
perder ninguna alta ajena, reaplicando encima el cierre de la 316 y añadiendo la ficha propia ya
renumerada. Verificado: **cero ids duplicados** y ninguna alta de `dev` perdida.

**Y el barrido del renumerado volvió a morder, como en la 311.** Un `sed 318 → 321` sobre los
archivos que "mencionan 318" alcanzó **siete tests de dinero** (`KpiValorAnimado`, `PriceLabel`,
`moneda-formato`, `columnas-sensibles`, `dinero-sin-centimos`, `factura-contraste`,
`monto-cotizacion`), donde `318` era un **importe**, no un número de ficha. Se detectó revisando qué
archivos había tocado el barrido y se restauraron los siete. Mismo error que la 311 documenta: **un
barrido no distingue entre usar el número y que el número aparezca**. En `current.md` el peligro era
un **teléfono** (`3183723487`), por eso ahí se editó a mano y no con `sed`.

**CERRADA LA FASE 2: PR #584 abierto contra `dev`.** Gate **completo** (752 s, el obligatorio aquí:
el DTO vive en `lib/types/`, ruta sensible de `init.sh:134`, así que el rápido **se niega por
diseño**): `typecheck` limpio, `lint` sin errores, **1541/1543 archivos verdes**. Los 2 rojos:
`superficie-de-uso` está en el baseline señalando `lib/actions/tarifas.ts:67`, y **`no-embalaje` es
flake de saturación** — timeout de 20 s bajo carga, **868 ms y verde en aislado**. No se mete al
baseline: eso lo volvería permanente. Comprobado además que **no** es el autoenvenenamiento que
arregló `c4b13288` — el guard ignora el directorio `.vitest`, así que el volcado de 8,7 MB no lo lee;
es tiempo, no contenido.

**Los menores del reviewer, atendidos antes del PR:** el `EXISTS` del filtro de fecha se corrigió **en
el design, no en el código**, y ahora lo fija un test **probado por causación** (con la forma del
design el caso se pone rojo con `expected 1 to be 2`); y la contradicción del gate quedó escrita al
derecho en §7 y T7.4. **Etiqueta duplicada (m4): decisión del humano, se dejan los dos «Histórico»** —
es la palabra que pidió literalmente, y el de Ranking va anidado bajo su padre.

**REVIEWER: APROBADO**, 45/45 requisitos verificados contra el archivo de test real (254 tests nuevos
en 23 archivos), gate completo verde en su propia corrida, **cero hallazgos mayores**. El único
bloqueante era de aterrizaje —la colisión de id—, ya resuelto. Menores anotados: el `EXISTS` del
filtro de fecha del `design.md` §2.4 está **mal escrito** y el código está bien (corregir el design,
no el código); falta el test que fije esa desviación; y la contradicción del gate (§7 / T7.4 dicen
que el rápido basta, pero `init.sh:134` lista `^lib/types/` como ruta sensible y ahí viven los DTOs).

**Estado: `spec_ready`.** Spec v2 tras la puerta: **45 requisitos R1–R45** (la numeración R1–R38 se
conserva; 6 modificados, 7 nuevos), los 45 mapeados a un test con `assert` de comportamiento, y
**sigue sin migración** — `T7.2` gana un assert que vigila que `chat_mensaje` no gane columna de
mensajero.

**⚠️ LÍMITE CONOCIDO que destapó el spec, verificado por el leader en el archivo real (R45 + A10).**
El «una orden reasignada tiene dos hilos, uno por mensajero» se cumple **sólo cuando el dato lo
permite**: `ChatConversacionRepository.upsertParaOrden` hace `update: { mensajeroId }`, o sea que una
reasignación **reescribe** el mensajero de la fila existente, y `chat_mensaje` no guarda quién era el
mensajero de cada mensaje. Si el cliente conserva su número, esa orden tiene **una sola fila** y el
hilo sale atribuido al mensajero **actual**, con los mensajes de los dos. Partirlo de verdad exige
columna nueva en `chat_mensaje` — migración, prohibida por P2. Queda fijado por un test con
«LIMITACIÓN CONOCIDA» en el nombre (mismo patrón que la 311 con `migrarTelefono`); la partición real
sería **su propia feature**.

**Tres cosas que el spec corrigió de la ficha, medidas en el árbol real:** el guardia de la 229 es
más estrecho de lo que se declaró y una ruta `/historico/conversaciones` **no lo toca**; las trampas
(d) y (e) **ya las resolvieron la 311 y la 316** —`chat-format.ts` elige el texto del adjunto por
dirección y `MediaAdjunto` ya pinta el aviso ante el 410—, así que pasan a **tests de no-regresión**;
y **`orden.busqueda_texto` no incluye el nombre del mensajero**, lo que obliga a una segunda mitad
del criterio contra `usuario`, con espejo SQL de `normalizarTerminoBusqueda` y test de paridad.

## 💬 2026-08-28 — ficha 316: el mensajero puede ENVIAR imagen, video, nota de voz y documentos

**Estado: `spec_ready`, spec APROBADO por el humano** (32 requisitos R1-R32, los 32 mapeados a un test
con `assert`; trazabilidad verificada por el leader, ninguno huerfano). Rama
`feature/316-chat-enviar-media` desde `origin/dev` en `7435bdff`. Zona `fullstack`, complejidad alta, `sdd: true`.

**⚠️ RENUMERADA 312 → 316, y esta vez ANTES de escribir una línea de código.** Al bajar `dev` para
empezar apareció que otra sesión ya había tomado el **312** (`corregir los datos del cliente de una
orden ya cargada`), y también el **313** y el **314**. El **315 no se toma aunque esté libre** en
`feature_list.json`: la rama `origin/fix/315-liberar-al-aprobar-cierre` ya lo reclama por nombre, y
registrarlo sería la cuarta colisión seguida. Mismo precedente que la 311, renumerada **tres veces**.

**La trampa del renumerado, esquivada a propósito.** La 311 documenta que su `sed` global se comió el
eslabón intermedio **dos veces**, porque un barrido no distingue entre **usar** un número y
**citarlo**. Aquí las 12 ocurrencias se revisaron una a una antes de tocar nada: las 12 *usaban* el
número y ninguna citaba historia ajena, así que el barrido era seguro. Verificado después: **0
ocurrencias de `312`** en el spec.

**Y esta vez el gate sí lo habría cazado.** El PR #565 (`fix/init-valida-feature-list`) hace que
`init.sh` valide `feature_list.json` **siempre** y detecte **ids duplicados** — exactamente el agujero
(`jq` ausente + `warn` en vez de `fail`) que dejó pasar las tres colisiones de la 311.

**De dónde sale.** La 311 dejó el ENTRANTE completo y declaró el saliente **fuera de alcance por
escrito** (`specs/311-chat-media-reacciones-contactos/requirements.md:18-21`). Hoy el `<form>` de
`ChatConversacion.tsx` tiene exactamente un `<textarea>` y un botón `Send`: el mensajero que quiere
mandar la foto del paquete en la puerta tiene que salirse a su WhatsApp personal.

**Decisiones cerradas por el humano, no reabrir:** (a) cámara, galería, nota de voz y documentos
PDF/Word/Excel; (b) el clip se bloquea con el **mismo** criterio que el texto libre
(`textoLibreHabilitado`) porque Meta no acepta media fuera de la ventana de 24 h; (c) **no se
guarda binario propio** — se mantiene viva la regla D1/R15 de la 311 y se acepta que a los 30 días
el adjunto diga que ya no está disponible; (d) el textarea viaja como `caption` (no en audio, que
Meta no lo admite).

**Medido el 2026-08-28, y es la buena noticia: NO hace falta migración.** El enum
`ChatMensajeTipo` ya tiene `imagen|audio|video|documento|sticker` y `ChatMensaje` ya tiene las
columnas `media*` nullable. Falta solo el camino de **escritura** (`InsertarSalienteInput` no tiene
campos `media*`). Y el proxy `/api/chat/media/[mensajeId]` **sirve un saliente sin un solo cambio**:
autoriza por mensajero asignado y no filtra por dirección.

**Trampas declaradas antes de empezar**, para que no se descubran a mitad:
`whatsapp-cloud.ts::enviar()` siempre serializa JSON y subir media es `multipart` → cliente aparte;
`reintentarEnvio` y `persistirFalloPermanente` están **tipados a `"texto" | "plantilla"`**, así que
un saliente de media rompe el reintento **hoy**; `lib/config/chat-media.ts` es política de *servido*
y no de *subida* → archivo nuevo, para que nadie use `MIMES_INCRUSTABLES` como whitelist de subida;
y `MediaAdjunto.tsx` dice «del cliente» en textos que con salientes pasan a ser falsos.

**⚠️ Riesgo principal — la nota de voz.** Chrome en Android graba `audio/webm;codecs=opus` y Meta
**no lo acepta** como `type: audio` (quiere `ogg/opus`, `mpeg`, `aac` o `amr`). Hay que **medir** el
mimeType real con `MediaRecorder.isTypeSupported`, no suponerlo: es exactamente el tipo de supuesto
que la ficha de la 311 documenta haber pagado caro (R9 estuvo a punto de quedar muerto en silencio
por casar contra un nombre de evento que la v21.0 no usa).

**Cupo.** Se pasó la 311 a `done` en el mismo commit del alta (`1a4a90d7`): estaba mergeada con la
ficha sin actualizar. Fullstack queda sin ninguna `in_progress`. **El gate no lo habría avisado:**
`jq` no está instalado y en `init.sh:35` eso es `warn` y no `fail`, así que todo el bloque de
validación de `feature_list.json` —incluida la regla del cupo— se salta.


## 💬 2026-08-27 — ficha 311: el chat da tratamiento a media, reacciones, contactos y cambio de número

**Estado: `in_progress`, spec APROBADO por el humano.** Rama
`feature/311-chat-media-reacciones-contactos` desde `origin/dev`. Spec en
`specs/311-chat-media-reacciones-contactos/`: **35 requisitos R1–R35, los 35 mapeados** a un test
con ruta y `assert` (trazabilidad verificada por el leader, ninguno huérfano).

**⚠️ RENUMERADA TRES VECES: 294 → 299 → 308 → 311.** Las tres por lo mismo, y **ninguna la
detectó el gate**.

- **294 → 299 (2026-08-27).** Mientras se escribía el spec, otra sesión tomó el **294** en `dev`
  para «una orden borrada bloquea para siempre su número de remisión». Se detectó **antes de crear
  la rama y antes del primer commit**, así que no quedó historia con el número viejo.
- **299 → 311 (2026-08-28), destapada por el REVIEWER, no por el gate.** Mientras se implementaba,
  `dev` llegó a **307** y su 299 pasó a ser «la carga deja entrar montos con decimales» (PR #549).
  Esta vez **sí había historia**: cinco commits `feat(299)` y la rama se llamaba
  `feature/299-…`. Como no estaba pusheada, se renombró también el slug (58 archivos); los
  mensajes de commit ya escritos siguen diciendo 299 y **no se reescriben: son historia**.

- **308 → 311 (2026-08-28), al bajar `dev` para abrir el PR.** En las horas que costó cerrar los
  bloqueantes de la revisión, `dev` llegó a **310** y su 308 pasó a ser «la pantalla de rechazos por
  plazo». La rama seguía sin pushear, así que se renombró el slug otra vez.

`dev` manda en los tres casos, mismo precedente que la 276→278 de la tanda del 24.

**Y una trampa que cayó dos veces:** el `sed` del renumerado escribió «294 → 299 → 311», **comiéndose
el eslabón intermedio**, porque un barrido global no distingue entre **usar** un número y
**citarlo**. La primera vez lo destapó el reviewer; la segunda se corrigió a mano sabiéndolo. Si
alguna vez se automatiza el renumerado, la prosa histórica tiene que quedar fuera del barrido.

**⚠️ LO QUE ESTO DESTAPA, Y ES MÁS GRAVE QUE LA FICHA:** ninguna de las dos colisiones la vio el
gate. `jq` **no está instalado** en esta máquina y en `init.sh:35` eso es un `warn`, no un `fail`,
así que **todo el bloque de validación de `feature_list.json` (línea 52) se salta entero**: ni la
regla de máximo 2 `in_progress` por zona —la regla 1 de `CLAUDE.md`, marcada como no negociable—
ni la correspondencia ficha↔spec. Y los **ids duplicados no se comprueban ni con `jq`**. Las dos
colisiones las cazó una lectura humana. Pendiente de decisión del humano: reescribir esas
validaciones en `node` (que sí está disponible) para que sean incondicionales.

**El bug que la origina.** `tipoDeMeta` (`lib/types/whatsapp-webhook.ts`) solo mapea `text` y
`location`; todo lo demás cae en `otro` con `cuerpo: null`, y `ChatConversacion.tsx` pinta
`<p>{cuerpo ?? ""}</p>`. En producción: **el cliente manda una foto y el mensajero ve un globo
vacío con la hora**. Afecta a `image`, `audio`, `video`, `document`, `sticker`, `reaction` y
`contacts`.

**Decisiones del humano, cerradas antes del spec (no reabrir):**

- **Media por proxy bajo demanda, sin almacenar.** Se guarda el media `id` + metadatos; una ruta
  propia autenticada baja el binario de la Graph API al abrirlo. **No** se usó el bucket de
  Storage a propósito: sin bucket nuevo, sin cron de purga. El token nunca llega al navegador.
- **Meta borra el binario a los 30 días** → cuando la descarga falle por eso, la UI **debe decir
  que el archivo ya no está disponible**. Es requisito, no cortesía.
- **Cambio de número**: se **migra el hilo** al número nuevo y se deja **evidencia persistente del
  anterior y el nuevo** como burbuja de sistema. **No** se toca el teléfono de la orden ni del
  cliente — sigue siendo dato del maestro.
- Reacciones **ancladas a su burbuja** como en WhatsApp; `contacts` con datos **copiables**; y en un
  texto se enlaza **solo el tramo de la URL**.

**Fuera de alcance, confirmado:** `button` e `interactive` (no usan plantillas con botones de
respuesta rápida), `order`, `request_welcome`, `ephemeral` y `message_template_status_update`.

**Corrección aplicada en la puerta, antes de aprobar.** El borrador casaba el cambio de número solo
contra `system.type === "user_changed_number"`, pero el repo apunta a **v21.0**
(`lib/config/whatsapp.ts:10`), donde el evento **no se llama así**. R9 habría quedado **muerto en
silencio y ningún test lo habría delatado**, porque los tests usan el mismo payload supuesto. Ahora
acepta los tres nombres históricos y el test los recorre con `it.each`.

**Pendiente de medición (P1):** no hay un payload real de `system` capturado en el repo. Cuando
llegue uno en producción, confirmar el campo del número nuevo **contra lo medido**, no contra la
cascada tolerante, y anotarlo aquí.

**Riesgos declarados:** la ruta proxy sirve PII y debe exigir la misma autorización que
`listarHilo`; los entrantes ya guardados como `otro` **no se pueden reconstruir** y pasarán a
pintarse como «Mensaje no compatible»; la guardia 229 congela `PUBLIC_ROUTES` posicionalmente.

**Cupo:** se abrió al pasar la **278 a `done`**. Fullstack queda con 288 y esta. ⚠️ **La 288 también
está mergeada en `dev`** (PRs #518 y #533) pero su ficha sigue `in_progress`: no se tocó sin
confirmación del humano.


## 🚀 RELEASE DESPLEGADA — 2026-08-29 madrugada. **EMPIEZA A LEER POR AQUÍ**

**PR #606**, `dev` → `prod`, sobre el SHA `b954569a`. **Sin migraciones.**

**Gate COMPLETO sobre el SHA exacto:** `INIT_EXIT=0`, **21.818 verdes**, un solo archivo rojo y en
el baseline conocido. `dev` re-comprobado justo antes de abrir: no se había movido.

### Lo que entra

| | |
| --- | --- |
| **327** | corregir **dirección y ubicación** de una orden, con **aviso del importe** antes de guardar cuando el cambio mueve la tarifa |
| **314** | elegir y **reordenar** las columnas del Excel; el catálogo pasa de 15 a **22** |
| **325** | buscador y filtros en las dos pestañas de novedades, sobre el conjunto entero y no sobre la página |
| **226** | el anillo de foco pasa de **1,29 a 3,33** — para quien navega con teclado, era no ver dónde está |
| 318, 322, 323, 329 | el gate y sus guardias: el rápido ya juzga contra el baseline, un endpoint no puede nacer sin documentar, el guard de deriva deja de depender del `.env`, y un recorrido que tardaba 38 s ahora tarda 195 ms |
| 326 | primer buscador propio retirado, con el censo de los otros dieciséis |

### Verificación posterior

1. **Errores de runtime: cero nuevos.** El único grupo es un aviso de obsolescencia de `pg` en el
   corte diario, presente desde el 2026-07-27 — anterior a esta release.
2. **Los jobs recurrentes corrieron SOLOS y se re-agendaron.** `liberar_reprogramadas` y
   `analitica_rollup_diario` ejecutaron el 29 a sus horas y tienen ya su fila del 30. **Es la prueba
   de que el arreglo de ayer funciona:** ayer hubo que sembrarlos a mano; hoy la serie se perpetúa
   sola. El incidente de las reprogramadas queda cerrado por comportamiento, no por promesa.

### ⚠️ Lo que sigue sin verse

**El modal de corrección no lo ha mirado nadie.** El repaso de la ficha 330 cubrió el selector de
columnas, el buscador y la navegación por teclado, pero **no consiguió abrirlo** — su disparador no
está en la fila. Quedan sin ver a mano los cinco campos nuevos, los tres selectores encadenados y
**el aviso del importe**, que es justo donde se confirma un cambio de dinero.

Está cubierto por tests y trece mutaciones. Pero en este repo un repaso visual ya encontró siete
textos rotos que doce mil tests daban por buenos.

### Un error de proceso, anotado

**Las fichas 329 y 330 no llegaron a `dev` con su rama:** se registraron y se empujaron, pero **no se
abrió su PR**, y la rama siguiente salió de un `dev` que no las tenía. Se recuperan en este mismo
commit. Empujar no es mergear, y una rama sin PR es trabajo que no existe para nadie más.

---

## 🚀 RELEASE DESPLEGADA — 2026-08-28 noche. **EMPIEZA A LEER POR AQUÍ**

**PR #588**, `dev` → `prod`, sobre el SHA `f2b5b78f`. Despliegue de producción en **READY**
(`dpl_2t8riD1i…`). **Sin migraciones**: la del monto entero (305) ya se había desplegado por la
mañana.

**Gate COMPLETO sobre el SHA exacto:** `INIT_EXIT=0`, 21.558 verdes / 26 skipped, un archivo rojo y
en el baseline conocido. `dev` re-comprobado justo antes de abrir el PR: no se había movido.

⚠️ **La primera corrida del gate murió en el paso 1** —`falta la carpeta de specs de la ficha 314`—
antes de ejecutar un solo test. No era un falso positivo: la ficha estaba `in_progress` en `dev` y su
spec vivía en una rama sin mergear. La validación que trajo el PR #565 esta misma mañana hizo
exactamente su trabajo.

### Lo que entra

| | |
| --- | --- |
| **312** | corregir destinatario, teléfono, producto y notas de una orden ya cargada. Hasta hoy era SQL contra producción |
| **319** | eliminar una orden **vuelve a ser posible**: no era una mejora, la función no alcanzaba a ninguna orden (0 de 429 medido) |
| **320** | `DELETE /api/ordenes/api-key/orden/{id}` — el primer `DELETE` de la API pública |
| **315** | aprobar un cierre libera sus reprogramadas **en el acto** |
| **313** | la siembra de los jobs recurrentes cuelga del despliegue, con guardia |
| 308, 309, 310 | tres textos que mentían a la tienda |
| 311, 316 | el chat con el cliente: media, reacciones, contactos, y el mensajero puede enviar |
| 317, 321 | rojos sin dueño en `dev`; histórico de conversaciones (otra sesión) |

### Verificación posterior — las tres casillas de `docs/release.md` §3

1. **Errores de runtime: CERO** en la ventana del despliegue.
2. **Los jobs recurrentes tienen su primera fila**, una por tipo. Es la casilla que nació hoy del
   incidente, y su primera ejecución real.
3. **La idempotencia de la siembra quedó probada en producción, no en un test:** las filas vivas son
   las que se sembraron A MANO a las 14:09, y el build de esta release corrió su siembra automática
   **sin duplicarlas**.

---

## 🚨 2026-08-28 — INCIDENTE DE PRODUCCIÓN: las reprogramadas nunca volvían a la central

Reportado por el humano en caliente: **«acepté las reprogramadas de ayer para hoy y no aparecen en
el filtro de reasignables»**. No era el cierre ni el filtro.

**La causa, medida antes de tocar nada.** `liberar_reprogramadas` es un job **recurrente**: se
re-agenda solo *después* de cada corrida, así que la serie necesita una **siembra inicial**
(`scripts/seed-jobs-liberar-reprogramadas.ts`). Esa siembra **no está en ningún paso del despliegue
y nunca se corrió contra esta base**. Sin primera fila no hay segunda.

- **0 filas** de ese tipo en `jobs` y **0 transiciones `liberacion_reprogramada`** en toda la
  historia de la base (que arrancó el 2026-08-26).
- **40 órdenes** atrapadas en `reprogramada`, con el mensajero de ayer todavía puesto.
- El filtro REASIGNABLES pide `en_bodega_central` **Y** `mensajero_asignado_id IS NULL`
  (`OrdenRepository.ts:1224`). Esas 40 fallaban las dos condiciones.
- **`analitica_rollup_diario` estaba igual**, también con 0 filas: el rollup diario no se ha
  escrito nunca. Segundo job muerto por la misma causa, y este no lo reportó nadie.

**El descarte que importa:** el endpoint `/api/cron/liberar-reprogramadas` (feature 46) NO está en
`vercel.json`, y eso parecía la causa. No lo es: desde la feature 90 la vía vigente es la COLA, que
`procesar-jobs` drena cada minuto y que funciona — 374 geocodificaciones y 236 optimizaciones
drenadas. Lo que faltaba era la fila, no el cron.

**Arreglo aplicado** (por MCP, decisión humana explícita): dos filas sembradas a las 14:08 UTC,
`liberar_reprogramadas` con `run_after` en el pasado y `analitica_rollup_diario` en su horario
(00:30 CR). El drenador la ejecutó a las **14:10** con el código real de producción — no un `UPDATE`
a mano. Resultado medido:

| | |
| --- | --- |
| **25 liberadas** | a `en_bodega_central`, sin mensajero y con `prioridad = true` |
| **5 congeladas** | cierre de un mensajero en `solicitado` — regla de la 276, correcto |
| **10 intactas** | fechas 31/08 y 01/09, todavía no les toca |

La serie quedó viva sin desplegar nada: hay fila `pending` para `2026-08-29 06:00 UTC`, re-agendada
por la propia corrida.

⚠️ **La deuda es la FICHA 313, y es la lección:** nada garantiza que esa siembra exista. Ningún test
ni guardia comprueba que un tipo con recurrencia registrada tenga fila viva. Si la base se recrea
—como el 2026-08-25— los dos jobs vuelven a morir igual de callados. **La única señal de este fallo
fue un operador que no podía trabajar:** el build llevaba dos días verde.

---

## 🎨 2026-08-27 — ficha 292: las tarjetas del monitoreo toman el color de su segmento

`feature/292-color-cards-monitoreo`. **Sin SDD** por decisión humana. Reportado desde la pantalla y
**medido antes de tocar nada**: `contadores.ts` tenía DOS tablas de color —`COLOR_SEGMENTO` (la
barra) y `VARIANTE_CONTADOR` (las tarjetas)— y discrepaban en **4 de 8**.

**Decisión humana: opción B** (el fondo de la tarjeta toma el color del segmento). Se le ofreció
también el punto de color —más barato y sin tocar contraste— y eligió B a sabiendas del coste.
**Se descartó invertirlo**: que la barra usara las variantes semánticas juntaría `devueltas` con
`reprogramadas` e `incidentes` con `rechazadas`, y la barra existe para distinguir las ocho.

**El coste real:** los `--chart-*` son colores PLANOS y el `Badge` necesita un PAR (`-soft` fondo +
`-strong` texto). Cuatro pares nuevos, replicados en los cinco bloques de tokens.

**Contraste AA medido sobre los hex** —nunca en el navegador— y **re-medido por el leader con
aritmética propia**, con el control WCAG `#767676`/`#ffffff` = 4,54:

| par | claro | oscuro |
| --- | --- | --- |
| chart-6 | **5,98** | 6,91 |
| chart-11 | **6,38** | 7,02 |
| chart-12 | **9,45** | 8,45 |
| chart-13 | **8,49** | 6,48 |

Dos tintas se movieron porque el color del segmento NO llegaba: **chart-6 daba 3,57** y
**chart-12, 4,34**. Ninguna sale de la rampa de su propio color.

- **Guardia nueva:** renderiza el tablero y compara las clases del DOM de cada tarjeta con las de su
  segmento. **No** deriva las dos tablas de una tercera, que sería una tautología. Incluye que la
  barra siga distinguiendo OCHO categorías, porque la otra forma de aprobar la concordancia es
  pintarlo todo igual.
- **Mutación:** devolver `devueltas` a `warning` → 2 rojos; bajar `--chart-6-strong` al color plano →
  la guardia de contraste cae con 3,57 < 4,5.
- **Gate rápido:** typecheck ✅, lint ✅, **2.328 verdes / 2 rojos**, los dos AJENOS y preexistentes
  (`VariablesInsert`, el contrato viejo de plantillas que otra sesión derogó a propósito).
- ⚠️ **Deuda dicha:** el criterio de la 258 «el color codifica gravedad, no identidad» queda
  **retirado** para esos cuatro contadores.

### Lo que sigue vivo, y es la ficha 291

`GraficaDonut` y `GraficaRanking` rotulan con el mismo reparto por resto mayor que la 290, así que
pueden escribir «0 %» junto a un dato real. Ahí el dibujo **no** depende del redondeo, así que es
defecto de etiqueta, no de desaparición. Queda `pending` **a propósito**: el arnés admite dos fichas
en vuelo por zona y `frontend` ya tiene la 289 (ajena) y esta 292.

---

## 🩹 2026-08-27 — ficha 290: la barra de analítica escondía toda categoría bajo el 1 %

`fix/290-barra-reparto-menor-uno-porciento`. **Sin SDD** por decisión humana («es algo tan pequeño,
hazlo sin preguntar»). Reportado desde la pantalla: «Reprogramadas 1 (0 %)» y **sin franja**, junto a
«Entregadas 1 (1 %)» **con** franja — el mismo valor pintado de dos formas.

**Reproducido ejecutando el módulo de producción**, no razonado: con `[1, 0, 0, 1, 0, 231]` sobre 233,
las dos categorías de valor 1 pesan 0,429 %; el reparto por resto mayor solo tiene **un punto**
sobrante y su desempate lo da a la de menor índice, y `GraficaReparto.tsx:93` usaba ESE entero como
anchura de la franja.

**Arreglo (mínimo, sin rediseño):** `pesosDeReparto` devuelve ahora `fraccion`, `ancho` y
`bajoUnPunto`; la leyenda escribe **«<1 %»** cuando la parte existe pero no llega al punto, y toda
franja con valor recibe una **astilla de 0,5 puntos** descontada del segmento mayor. **El método del
resto mayor NO se tocó** y `porcentajesDeReparto` conserva su firma: `GraficaDonut` y `GraficaRanking`
siguen intactos.

Medido tras el cambio: `<1 %` / `<1 %` / `99 %`, anchos 1,00 / 0,50 / 98,50 y **suma exacta 100 %**.

- **Gate rápido:** typecheck ✅, lint sin errores, **2.283 tests verdes y 1 rojo AJENO** —
  `obtenerTarifa` (ficha 275, otra sesión). **Delta 0 medido, no supuesto**: con el árbol en `dev`
  limpio (`git stash`) ese guard falla igual y con **la misma lista de un elemento**.
- **Mutación (la exigí y se ejecutó):** sin la guarda del «<1 %» → 2 rojos; sin la astilla → 5 rojos;
  restaurado → 23 verdes.
- ⚠️ **Deuda señalada y NO tocada:** `GraficaRanking` y `GraficaDonut` siguen pudiendo rotular «0 %»
  en una porción diminuta. Ahí no desaparece nada del dibujo (su ancho sale del valor crudo), así que
  es solo la etiqueta. Sin ficha; decisión humana.

---

## 🧹 2026-08-27 — cuatro órdenes de prueba retiradas de producción (borrado lógico)

Guías **24218485, 17127402, 33809242, 99272742** (REM-0001..0004, tienda Nuform, zona GAM, ₡20.000,
con «PRUEBA» en destinatario, producto, notas y dirección; tres de los cuatro teléfonos, colombianos).
`deleted_at = 2026-08-27 15:17:25 UTC`, por SQL directo vía MCP a pedido del humano.
**Reversible:** `UPDATE orden SET deleted_at = NULL WHERE num_guia IN (...)`.

- **El borrado físico era imposible**, no una preferencia: FK RESTRICT desde `orden_historial_estado`
  (6–8 filas cada una), `chat_conversacion` (1 hilo y 4–8 mensajes cada una) y `cierre_sin_gestion`
  —las cuatro entraron en el cierre `336196b3`, **aprobado** hoy a las 12:39, total ₡0,00—. Forzarlo
  obligaba a tocar contabilidad ya cerrada.
- **El cierre no se rompe:** `cierre_sin_gestion` guarda copia denormalizada (guía, destinatario,
  producto, tienda, zona) y no depende de la orden viva. Verificado DESPUÉS del UPDATE.
- **Los hilos de WhatsApp se van con ellas:** solo se alcanzan desde la orden (no hay bandeja global,
  únicamente `findByOrdenParaMensajero`) y el matcheo de entrantes ya filtra `o.deleted_at IS NULL`
  (`lib/repositories/ChatConversacionRepository.ts:85`).
- **NO se tocaron** las guías **34360188** (Cinthya) y **68425574** (kisha): llevan «PRUEBA 27 08 26»
  en el campo producto, pero destinatario y dirección son reales, están en `ayuda_tienda` y asignadas.
- Producción tras el cambio: **207 vivas / 4 borradas / 211 totales**.

⚠️ **Esto no se puede hacer desde la app.** `orden.deleted_at` existe y TODAS las lecturas lo
respetan, pero **nadie lo escribe**: el `borrarOrden` del andamiaje inicial se retiró (queda su
mención en `lib/actions/ordenes.ts:41`). Mientras siga así, cada limpieza es SQL a mano contra
producción. **Sin ficha todavía** — decisión del humano.

---

## 🚀 RELEASE DESPLEGADA — 2026-08-26 noche. **EMPIEZA A LEER POR AQUÍ**

**PR #516**, `dev` → `prod`. Tres fichas del módulo de usuarios: **285** (buscador + filtro por rol),
**286** (el ojito en los 6 campos de contraseña), **287** (el maestro restablece la contraseña).
**Sin migraciones y sin archivos de dinero.** Gate completo sobre el SHA exacto (`80a2e347`):
**1 fallo | 19.456 en verde**, y el fallo es el ajeno `obtenerTarifa` (ficha 275, otra sesión) con
**un solo elemento** en la lista del guard → delta 0. Tercera release que se salta la regla del gate
en verde, a sabiendas y registrada.

### Lo que hay que hacer EN PRODUCCIÓN, y nadie ha hecho

- [ ] **Restablecer una contraseña de prueba** desde Configuración → Usuarios. Es la función nueva
      más importante: con el SMTP caído, **es la única forma de devolverle el acceso a alguien**.
- [ ] **Que un teléfono ofrezca instalar la PWA** (Chrome → menú → «Instalar aplicación»). Los tres
      archivos ya dan 200 —M8 cerrado hoy—, pero que el navegador la OFREZCA no lo ve ningún `curl`.
- [ ] **M1–M7 de la 284** siguen pendientes y piden un teléfono real. La más importante es **M7**:
      probar `?rescate=sw` **cuando no hace falta** es la única forma de saber que funciona el día
      que haga falta.

### ✅ M8 CERRADO HOY — la PWA ya es instalable

Medido contra `https://ordenex.co` **sin cookies**: `manifest.json`, `sw.js` y `offline.html`
devuelven **200**, y `/ordenes` sigue en **307**. Hasta hoy los tres daban 307 y por eso **la PWA
nunca se pudo instalar desde que existe**. Era la premisa de la que colgaba toda la 284 y llevaba
sin comprobar desde el 25. La receta quedó escrita en `docs/release.md`.

---

## ⚠️ LO QUE SIGUE ABIERTO Y NO ES DE NINGUNA FICHA

### 1. No hay segundo factor, y es permanente

`AUTH_RISK_THRESHOLD = 999` en Production. **Gmail bloqueó la cuenta**, así que la contraseña de
aplicación no se puede regenerar y **el OTP por correo no volverá**. La contraseña es el único
factor; el bloqueo por fuerza bruta (5 fallos en 15 min) SÍ sigue.

**La vía de vuelta es WhatsApp**, no Gmail: la Cloud API ya está integrada y mandando mensajes, y
`lib/clients/whatsapp-cloud.ts` ya declara la categoría **`AUTHENTICATION`**, que es la de Meta para
códigos de un solo uso. **Pero antes hay que arreglar 7 teléfonos**, medido el 2026-08-26 sobre los
19 usuarios activos:

| teléfono | qué pasa |
| --- | --- |
| `0999999999` (**maestro**) y `00000000000` (mensajero) | **relleno**: un OTP no llegaría nunca, y sin error visible |
| `+573043738012`, `3183723487` (Colombia) · `+584246327156` (Venezuela) | **fuera de Costa Rica**: ¿personas reales o datos de prueba? |
| `8312-2625` | sólo el guion |
| `50688688495` | ya correcto |

Normalizar el formato arregla **dos**. Los otros cinco necesitan que alguien mire quién es esa
persona. **Hacerlo ANTES de montar el OTP por WhatsApp**, o el canal nuevo nace dejando gente fuera.

### 2. Hay un hotfix de auth listo y SIN desplegar

Rama `hotfix/desafio-otp-no-bloquea-cuenta` (`4f095e25`), 34 tests verdes y verificado por mutación.
Emitir un desafío OTP contaba como **fallo de credencial**: sumaba 40 puntos de riesgo al intento
siguiente y empujaba al bloqueo duro. Un usuario real llegó a `fallos_recientes:4` sin escribir mal
la contraseña ni una vez. **Con el OTP apagado el defecto no puede dispararse**, así que no corre
prisa — pero vuelve el día que se reactive el segundo factor.

### 3. `Session` no se purga nunca al expirar

Sólo se borra en logout explícito. En una base local había **194 sesiones de un solo usuario, 0
vivas**. En producción sólo crece, y es la tabla que la 287 recorre al revocar.

### 4. Nueve tests escriben en `usuario` sin tomar el bloqueo obligatorio

`tests/integration/tablero-dia-aislamiento.test.ts` y los 8 que usan `_semilla-tablero-dia.ts`
escriben en `public."usuario"` **sin `serializarEscriturasReales`**, que el propio arnés documenta
como obligatorio. Es la causa de los **deadlocks intermitentes** que aparecieron hoy en dos gates
distintos. **No se tocó**: son tests de otras features y el sembrador es compartido.

### 5. El rojo ajeno de siempre

`lib/actions/tarifas.ts:67 obtenerTarifa` es inalcanzable porque la **275** (su pantalla) sigue
`pending`. Es inerte —nadie puede ejecutarla— pero tumba el gate de **todo el mundo**.

---

## 🔴 HOY — 2026-08-26. **EMPIEZA A LEER POR AQUÍ** (lo de abajo es historia)

### 1. Producción entra SIN segundo factor, a propósito y de forma reversible

Gmail dejó de aceptar la credencial SMTP (`535-5.7.8 BadCredentials`, `AUTH PLAIN`) sobre las
**16:04 UTC**. El OTP de riesgo alto se manda por correo, así que **quien no tuviera dispositivo
confiado no podía entrar**. Decisión del humano: desconectar el OTP ya.

**Hecho:** `AUTH_RISK_THRESHOLD = 999` en **Production** (antes no existía la variable; corría con
el default 50). La puntuación máxima posible es 110 → `isHigh` no puede ser cierto → nunca se llega
a la línea del correo. **Verificado con dato**, no razonado: `login_attempt` del 2026-08-26 21:56:32
tiene `risk_score = 110` **con `exitoso = true`**, combinación imposible hasta hoy.

- **Lo que se acepta:** la contraseña es el único factor. El bloqueo por fuerza bruta SIGUE (5
  contraseñas mal en 15 min).
- **Efecto lateral útil:** mientras esté a 999, cada ingreso marca dispositivo e IP como conocidos,
  así que al restaurar el 50 esa gente ya no disparará OTP.
- **PENDIENTE REAL:** la credencial SMTP. Hay que regenerar la contraseña de aplicación de Google
  (cambiar la contraseña de la cuenta las revoca todas) y **volver a poner el umbral en 50**.

### 2. Hotfix listo y SIN desplegar: `hotfix/desafio-otp-no-bloquea-cuenta` (`4f095e25`)

Emitir un desafío OTP se registraba como `exitoso: false` y el contador lo tomaba por **fallo de
credencial**. Doble daño medido en producción: sumaba 40 puntos al intento siguiente (dejando al
usuario clavado en la vía del OTP, donde reintentar aprieta) y empujaba al bloqueo duro. Un usuario
real llegó a **`fallos_recientes:4`** sin escribir mal la contraseña ni una vez.

Arreglo: solo cuentan las filas con motivo `password_incorrecta`; las demás son neutras. **34 tests
verdes y verificado por mutación** (borrando el guard, el test nuevo pasa de 2 a 6). Sale de
`origin/prod`, **sin PR ni gate todavía**. Importa cuando se reactive el OTP.

### 3. Módulo de usuarios: 3 fichas registradas, specs en marcha

| ficha | zona | qué | estado |
| --- | --- | --- | --- |
| **285** | fullstack | filtro por rol + buscador por nombre/correo | spec en curso |
| **286** | frontend | el ojito en los 6 inputs de contraseña | spec en curso |
| **287** | fullstack | el maestro RESTABLECE la contraseña (nunca la fija) | spec en curso |

- La **columna de zona se retiró** por decisión del humano; con ella se fue el efecto colateral
  sobre la descarga y su guardia.
- La **287 revierte la Decision 5** de la feature 25 (`NUNCA passwordHash`) **a sabiendas**. El
  alcance acotado —restablecer, no fijar— preserva el motivo original.
- **Orden obligado:** 285 y 286 en paralelo (no comparten un archivo); la **287 va DESPUÉS** de la
  285: chocan en `lib/actions/usuarios.ts`, `UsuariosModule.tsx` y `UsuarioService.ts`.

### 4. Deuda abierta que NO es de nadie de esta sesión

- **223 de 379 distritos cobrarían ₡0,00 de flete.** Medido ejecutando `resolverFlete` con las 10
  filas reales de `tarifas`. Causa: `esCentral` es un flag único (solo la zona «GAM» lo tiene), así
  que para las otras nueve `valor_flete_gam` es una columna que nadie lee — y es la que está
  rellena. Es dato mal metido, inducido por un formulario que ofrece 4 montos cuando solo 2 aplican.
  **Sin ficha todavía**; falta que el humano dé los precios de devolución de 4 zonas y los dos de
  «GAM San José Abajo».
- **`ZonaRepository.hardDelete` no limpia `tarifas`** (FK RESTRICT llegada el 2026-08-25): 10 zonas
  imposibles de borrar. Lo está resolviendo **otra sesión**; hay una rama local abandonada a
  propósito (`hotfix/zona-borrado-bloqueado-por-tarifa`). **No tocar.**
- El rojo ajeno de `obtenerTarifa` (ficha **275**, otra sesión, `pending`) sigue tumbando el gate.

---

## 🟠 SESIÓN 2026-08-26 — plantillas de WhatsApp. **LEE ESTO PRIMERO**

Rama de trabajo: `feature/80-notificaciones-email-otp` (no se creó rama nueva: el árbol ya venía
con trabajo sin commitear de otra sesión —`app/_landing/*`, `app/page.tsx`, `guia-en-url.ts`— y
un `checkout` se lo habría llevado por delante).

### Hecho y verde, SIN COMMITEAR

1. **Catálogo de campos de plantilla** — `lib/types/plantilla-datos.ts` (nuevo). 44 claves con
   `clave`/`campo`/`nombre`/`descripcion`/`ejemplo`/`sensible?`/`leer`/`transform`. Sustituye al
   objeto literal de 15 entradas que vivía dentro de `lib/utils/whatsapp-envio-valores.ts`.
   El `OrdenEnvioReader` pasó de 7 columnas a la orden entera + el mensajero (sin `passwordHash`).
   - ⚠️ **Cambio de salida:** `{{monto}}`/`{{total}}` ahora emiten `₡25.900`, no `25000`. El crudo
     queda en `{{monto_crudo}}`. Afecta a plantillas YA APROBADAS por Meta.
   - `{{url_guia}}` arma `https://…/?guia=NNNN` importando `PARAM_GUIA` de
     `app/_landing/guia-en-url.ts`, que **es un archivo sin commitear de otra sesión**. Si esa
     rama se descarta, este import se queda huérfano.
2. **Guardar deja de ser enviar** — estado nuevo `saved_not_aprobation` (migración
   `20260826120000_plantilla_estado_saved_not_aprobation`), `crear` ya NO propaga a Meta,
   `enviarAprobacion` es la única salida hacia Meta, y `actualizar` devuelve a `pending` salvo que
   la plantilla sea un borrador que nunca salió de casa. UI: botón «Enviar para aprobación» con
   confirmación irreversible y aviso previo al editar.

**Gate:** `tsc --noEmit` limpio. `vitest --changed origin/dev` = **4983 pasan, 2 timeouts**
(`DetalleMensajeroPanel`, `TableroOperativo`) que **pasan en aislado** → flakes por saturación.
Aparte, sigue el rojo AJENO conocido de `superficie-de-uso.guardia` con
`lib/actions/tarifas.ts:67 obtenerTarifa` (es de la ficha 275, `pending`).

### Feature 288 (era «282», luego «285») — `spec_ready`, esperando la puerta humana

`las variables de una plantilla se eligen de un catálogo, no se escriben a mano`. Zone
`fullstack`, complexity media. Spec **completo y revisado por el humano** el 2026-08-26 en
`specs/288-variables-plantilla-desde-catalogo/` (requirements 24 R + design + 22 tasks).

- **Renumerada 282 → 285 → 288**: el spec nació numerado 282 **sin ficha**, y ese id ya era de las
  etiquetas PDF (`done`), y al mergear `dev` el 285 quedó tomado por el buscador de usuarios
  (285/286/287 ya cerradas). El slug se conservó en cada renumeración; la ficha vive en
  `feature_list.json` con `id: 288` y `status: spec_ready`.
- **La decisión abierta quedó cerrada** en el design (§2, confirmada por el humano): el mapa
  `clave -> nombre` **se persiste** en `plantilla_mensaje.variables_nombres JSONB NOT NULL
  DEFAULT '{}'`, snapshot tomado del catálogo al guardar. Derivar del catálogo al pintar quedó
  como **fallback** para las filas anteriores a la feature (R21). El cuerpo sigue guardando
  `{{clave}}` —es lo único que Meta tiene aprobado— y `variables` sigue derivado del cuerpo,
  porque su posición **es** el número de parámetro de Meta.
- **Rama de trabajo: `feature/285-variables-plantilla-catalogo`**, worktree `C:/w285` (nombres
  anteriores a la renumeración a 288; NO se renombran), nacida de
  `origin/dev` (`3102542b`). `dev` ya absorbió `bugFix` en el **PR #504**, así que el campo
  `variablesNombres` del `schema.prisma` y el fix de `saved_not_aprobation` (`7ad8dede`) YA
  están en la base; no hubo que cherry-pickear nada.
- **Lo que se dejó fuera a propósito**: los archivos de la sesión ajena de landing
  (`app/_landing/LandingNav.tsx`, `RastreoDialog.tsx`, `app/page.tsx` y sus tests). Sí viajó
  `app/_landing/guia-en-url.ts` con su test, porque `{{url_guia}}` importa `PARAM_GUIA` de ahí
  y el módulo es puro. ⚠️ Ese archivo va a chocar cuando aterrice la rama de landing: mismo
  path, y hay que resolverlo conservando una sola copia.
- Paralelismo OK: la zona `fullstack` no tiene otra `in_progress` viva — la 278 (carga masiva
  v3) ya está mergeada en `dev` (PR #487), su rama es ancestro de `dev`.
- ⛔ **T0 es un prerrequisito bloqueante**: exige que `lib/types/plantilla-datos.ts` y su test
  estén **commiteados**. Hoy la base entera (catálogo, `saved_not_aprobation`, sus dos
  migraciones) vive **solo en el árbol sucio de `bugFix`** y no existe en ninguna rama
  (`git log --all` sobre esos archivos: vacío). Sin ese commit, la feature no arranca.

## 🟢 EN `dev`, SIN RELEASE — 2026-08-24. **EMPIEZA A LEER POR AQUÍ**

**`dev` = `7c211f2f`**, gate COMPLETO en verde tras el merge (`INIT_EXIT=0`, **1375 archivos /
18.707 tests**). **`prod` sigue en `37b5944b`.** Cero fichas de esta sesión sin cerrar.

| ficha | estado |
| --- | --- |
| **276** · el tope de 3 intentos se cierra | mergeada en `dev` (**PR #490**) · aprobada tras 3 rondas, 0 bloqueantes |
| **277** · «Por recoger» separa en pestañas | mergeada en `dev` (**PR #489**) · aprobada, 0 bloqueantes |
| **218** | `superseded` por la 276 — su decisión ya está EN CÓDIGO |

### ⛔ LA RELEASE NO SE ABRIÓ, y la razón es de producto, no técnica

Decisión del humano, 2026-08-24. **`dev` no lleva solo lo de esta sesión**: lleva también el cambio
de tarifas de otra, y dentro va **`20260825120000_drop_tarifa_status`, un `DROP COLUMN` sobre una
tabla de dinero que no se deshace**. Su mitad frontend —la ficha **275**— sigue `pending`.

Lo que sí se comprobó antes de decidir, para que nadie lo repita:

- Su revisión **existe y aprobó**: «APROBADO CON RESERVAS», **0 bloqueantes de código**, 40/40
  requisitos. Los dos bloqueantes eran de bookkeeping.
- **No queda código vivo usando `tarifas.status`**: los únicos aciertos son comentarios que explican
  su retirada.
- El gate está **verde** sobre ese mismo árbol, tests de componentes incluidos.

**No se puede separar**: `dev` es un solo árbol y aislar lo de esta sesión exigiría cherry-picks, que
es peor. Así que **la release espera a que la otra sesión cierre su 275** —o confirme que su parte
puede salir—. Nada irreversible ha ocurrido.

### ✅ Lo que YA está medido y no hay que repetir cuando se abra la release

Las dos condiciones de despliegue de la 276 se ejecutaron contra producción el **2026-08-24**:

1. **R37 limpia** — la única orden viva con `intentos >= 3` es la guía **`28098171`**, en `devuelta`,
   y **cero** fuera de ese estado. La condición de parada de Q6 no se cumple.
2. **T6 congela CERO órdenes el primer día** — medido por primera vez. Hay 2 `reprogramada` vivas
   (`31005512`, `47145018`), **0 liberables hoy**, las dos con su cierre ya aprobado.

⚠️ **Las dos son fotos y caducan.** `docs/release.md` exige re-medirlas **el día que se abra la
release**, no citar éstas.

---

## 📦 Plantilla de carga masiva v3 (278) — 2026-08-24

Pedido del humano: «en el cargue masivo la estructura cambia: ahora viene **provincia**,
**canton_distrito** (`nombreCanton (distrito)`), **direccion**». Sucede a la 142, que había
unificado esas columnas en `direccion_destinatario`; ahora se vuelven a separar y el **país
desaparece** (hoy ya se descartaba sin persistirlo, así que no se pierde dato).

| # | Zona | Estado | Qué |
| --- | --- | --- | --- |
| **278** | fullstack | **PR [#487](https://github.com/nuformecuador-lgtm/ordenex/pull/487)** · rama `feature/276-plantilla-carga-masiva-v3` (worktree `C:/w276`) | 8 → 10 columnas, parser de `canton_distrito`, extractor de la vía sesión, corte duro sin compatibilidad |

### Decisiones cerradas con el humano (no reabrir)

1. **Reemplazo total**: la plantilla v2 deja de aceptarse. Un archivo v2 → rechazo en la
   validación de cabecera con el mensaje de «la plantilla cambió», igual que la 142 rechazó a la v1.
2. **La vía API key no cambia**: `/api/ordenes/api-key/carga` sigue con
   `provincia`/`canton`/`distrito`/`direccion` separados (contrato público de la feature 88).
3. **No se parte en backend + frontend** pese a evaluar como `fullstack`: cabecera y plantilla son
   un solo contrato y la carga quedaría ROTA entre los dos merges. Mismo criterio que la 142.
4. **`canton_distrito` sin paréntesis ⇒ distrito = cantón** (pedido durante la implementación,
   R14/R16). `Cartago` ≡ `Cartago (Cartago)`, y unos paréntesis vacíos dicen lo mismo. El atajo
   **no inventa geografía**: `resolveGeo` sigue buscando ese distrito en el catálogo y, si no
   existe, la fila muere con el mensaje de siempre (R27b, con test).

### Por qué salió barata

La 142 dejó la geografía **inyectada por vía**: cada camino aporta su extractor y `resolveGeo` es
común. Se sustituyó **un extractor**, no la resolución. Y el parser no se reescribió:
`separarCantonDistrito` ya existía como privado de `lib/utils/direccion-destinatario.ts` con sus
ramas de error; se promovió a público en `lib/utils/canton-distrito.ts` y el módulo viejo se borró.

### Estado

Implementada (B1-B6, F1-F4) y **rebasada sobre `dev`** (merge, no rebase: la historia no se
reescribe). Renumerada **276 -> 278** al mergear: otra sesion tomo 276 y 277 y las dos ya estaban
en `dev`. El bookkeeping se resolvio partiendo de la copia de `dev`, **+13/-0**: no revierte una
sola linea ajena.

Gate **completo** tras el merge: typecheck limpio, lint 0 errores, **1375 archivos / 18.726 tests**,
**2 rojos, los dos ajenos y medidos**:

- `tests/components/TableroOperativo.test.tsx` -> **pasa en aislado**: flake por saturacion.
- `tests/integration/db/rechazo-tope-intentos-migration.test.ts` -> la Postgres local tiene
  `habilitacion_api` en el enum, un valor que **solo existe en la rama de la 266 (PR 482, abierto)**;
  alguien aplico esa migracion a la base compartida. El test, las migraciones y el seed del enum
  son **byte a byte los de `dev`** en esta rama, y este diff no toca ninguna migracion.

**Delta de la rama: 0.**

---

## 🔀 Merges de `dev` en `ux` — 2026-08-24

**Segundo merge (este).** `dev` traía las fichas **276** (tope de intentos, PR #490), **277**
(«Por recoger» en pestañas, PR #489) y **278** (plantilla de carga masiva v3, PR #487), más el
bloque de tarifas. Solo hubo **dos conflictos, los dos de bookkeeping** — `feature_list.json` y este
archivo—: ni una línea de código, doc o test chocó.

**Renumeración: 276 → 279.** La ficha «la coleccion de Postman no guarda numGuia» (alta local en
`ux`) ocupaba el id **276**, que `dev` ya había dado al tope de intentos. **`dev` manda** (precedente
218): la local pasa a **279** conservando el slug, y las tres de `dev` se quedan como están. Es su
segunda renumeración: había nacido como **258**.

**Primer merge.** `dev` traía las features **256, 257 y 268** ya cerradas, implementadas por una
sesión paralela mientras `ux` tenía su propio trabajo a medias sobre los mismos archivos. En los
conflictos de código, doc y test **mandó `dev`**: su versión es un superconjunto (la 268 mete
`ayuda_tienda` **e** `incidente` en `EVENTOS_PUBLICOS`, donde `ux` solo metía `ayuda_tienda`; la 257
trae los parámetros `desde`/`hasta`/`num_guia`/`num_remision` del OpenAPI, que en `ux` estaban
documentados en prosa pero sin declarar).

---

## 💰 Tarifas ligadas a la zona (273 · 274 · 275) — 2026-08-24

Pedido del humano: «ahora se cobra por **zona y tienda** en lugar de por tienda, con prioridad
tienda+zona → default de la tienda → tarifa de la zona → nada». Se midió el impacto, se dieron de
alta tres fichas y se **aterrizó el trabajo suelto** que ya existía sin registro.

| # | Zona | Estado | Qué |
| --- | --- | --- | --- |
| **273** | fullstack | **`in_progress`** · rama `feature/273-tarifas-por-zona-catalogo-vehiculos` | el **modelo**: `tarifas.zona_id`, `tienda_id` nullable, `is_default`, `tarifa_especial`, borrado físico, `UNIQUE (zona_id, tienda_id) NULLS NOT DISTINCT`, `distrito.zona_especial`, catálogo de vehículos administrable y la UI que ya captura las tres combinaciones. **`sdd: false`**: la ficha se escribió después del código (ver abajo). |
| **274** | backend | `pending` · `depends_on: [273]` | la **cascada de resolución** + drop de `tarifas.status`. Es lo que hace que el modelo de la 273 cobre de verdad. |
| **275** | frontend | `pending` · `depends_on: [274]` | la UI sin `status` y con el nivel de la cascada visible por zona. |

### El hueco que queda abierto tras la 273 (deliberado, no es un olvido)

El modelo y la UI ya soportan tarifas por zona, pero **el resolver no**:
`TarifaVigentePorTiendaRepository.ts` sigue haciendo `where: { tiendaId }`. Consecuencias vivas
mientras la 274 no cierre:

- las tarifas con `tienda_id` NULL **se pueden capturar pero no se cobran nunca**;
- entre las tarifas de una tienda gana **la más reciente, no la más específica**;
- `is_default` no lo lee ninguna aritmética;
- el listado usa **otra regla** que la liquidación (`OrdenRepository`: `status: activo` + `take: 1`)
  → puede **mostrar una fila y facturar otra**.

⚠️ **La 273 no se despliega a `prod` sin la 274 detrás**, o la pantalla promete un cobro por zona
que el motor no aplica.

### Decisiones cerradas con el humano (no reabrir en el spec de la 274)

1. La fila global `(tienda NULL, zona NULL)` se **prohíbe** en el service (`validation_error`).
   No es un cuarto nivel.
2. `tarifas.status` se **dropea entero**, con migración. Eso cierra la deuda **(g)** de la 69,
   colapsa `resolveTarifaCotizablePorTienda` en el resolver único y **absorbe la feature 70**.
3. Sin tarifa: **409 solo donde el 409 ya existía** (cotización y carga masiva por API); pantalla
   y cierre siguen liquidando **0.00**, para no bloquear la operación.

### Dos cosas que esta sesión aprendió por las malas

- **La 273 nació sin ficha, sin spec y sobre `fix/251-alias-project-id`**, una rama de otra cosa.
  Se registró en diferido y con `sdd: false` para que el historial diga lo que pasó y no una
  versión ordenada de lo que pasó. No es un precedente que se conceda a futuro.
- **Los ids 269-272 se los llevó otra sesión** mientras se medía el impacto (la 271 ya está
  mergeada en `dev`). El borrador usaba 269/270/271; se renumeró a 273/274/275 conservando los
  slugs. Antes de reservar un id, mirar `origin/dev`, no el árbol local.

---


## 🔌 Sesión API-key (256 · 257 · 266-268) — 2026-08-22

| # | Estado | Qué |
| --- | --- | --- |
| **257** | **`done`** · PR [#433](https://github.com/nuformecuador-lgtm/ordenex/pull/433) mergeado 18:39 | el listado por API key filtra por **rango de fechas**, `num_guia` y `num_remision`. Gate verde, reviewer APROBADO. |
| **256** | **`done`** · PR [#434](https://github.com/nuformecuador-lgtm/ordenex/pull/434) mergeado 15:46 | el webhook de `devuelta` viaja con el **motivo tipificado**. |
| **268** |  **`in_progress`** · PR [#456](https://github.com/nuformecuador-lgtm/ordenex/pull/456) | el webhook notifica **`ayuda_tienda` e `incidente`**, con causa y con enlace estable a las evidencias. Gate completo corrido (delta 0), reviewer APROBADO, PR abierto. **Falta el aviso a integradores antes de la release a prod.** |
| **266** | `pending` | habilitar pedidos con novedad por API key. Decisiones cerradas: no reusa el camino del botón de la tienda, y la rama sin mensajero deja solo log (sin webhook) mientras se define ese flujo. **Depende de la 268** para que su rama con cambio de estado notifique de verdad. |
| **267** | `pending` | analítica de la propia tienda por API key. Revierte una denegación de diseño: hoy el rol `apiKey` está en `ROLES_SIN_ANALITICA`. |

Las dos salen del cuestionario de integración de **Dropi**. La 256 la especificó otra sesión
(su puerta humana está registrada en el propio spec); esta sesión hizo su fase 2.

**Dos avisos que sobreviven a esta sesión:**

1. ⚠️ **`pnpm db:migrate` dropea la base local.** Es `prisma migrate dev` y la tabla
   `_prisma_migrations` tiene aplicada `20260728120000_orden_historial_origen_deshacer_asignacion`,
   que no existe en `db/migrations` de ninguna rama. Con ese historial divergente, `migrate dev`
   considera la base corrupta y su salida natural es resetearla. Para aplicar pendientes:
   **`pnpm exec prisma migrate deploy`** (usado hoy para las 4 de la 253, sin pérdida). El drift
   sigue sin resolver: o falta el archivo en el repo, o sobra la fila. **Merece ficha propia.**
2. Las guardias que **censan el árbol** (`ayuda-columna-retirada`, `columnas-asercion-de-orden`)
   se caen por **timeout** —no por assert— cuando la máquina está cargada: 27–30 s contra un
   límite de 20 s. Aisladas dan 17/17 verdes. Antes de tratarlas como regresión, re-corré con la
   máquina libre.

---

## 🔵 La sesión del 2026-08-24 (276 y 277), en detalle

Dos fichas nuevas registradas por decisión del humano, **las dos en fase de spec**. `prod` sigue en
`37b5944b`; el estado de la release del 23 y del cron de anoche está en la sección siguiente.

| ficha | zona | estado | qué es |
| --- | --- | --- | --- |
| **276** | fullstack | **completa y APROBADA** (3 rondas, 0 bloqueantes) · en release | el tope de 3 intentos se cierra: al alcanzarlo la orden no vuelve a circulación |
| **277** | frontend | **completa y APROBADA** (0 bloqueantes) · **mergeada en `dev`** (PR #489) | «Por recoger» separa en pestañas las de hoy de las reservadas para otro día |
| **218** | backend | **`superseded` por la 276** · su decisión ya está EN CÓDIGO | el corte sin sumar reintento |

### 276 — dónde está exactamente (2026-08-24)

Rama **`feature/276-tope-de-intentos`**, con `dev` ya mergeado dentro. Bitácora en
`progress/impl_276.md`, informe con las **tres rondas** en `progress/review_276.md`.

- **Completa**: las **cinco** vías hacia la circulación cerradas (las dos superficies que crean
  gestión, la liberación diferida —la raíz—, las dos bodegas y el corte), más la tercera vía de la
  tienda (**Q2**), el cron de SLA, la migración del enum con su `down.sql`, la guardia del
  invariante y la UI de las dos superficies (T11/T12).
- **Gate COMPLETO** `./init.sh` → **`INIT_EXIT=0`**. Corrido **cinco veces** entre implementers y
  reviewer sobre 1358 archivos / 18.302 tests, siempre el mismo número, y de nuevo tras mergear
  `dev`.
- **Aprobada con 0 bloqueantes tras tres rondas.** Las rondas 1 y 2 rechazaron, y **ninguno de esos
  cuatro bloqueantes era del código de la ficha**: los cuatro salieron del `sed` de la renumeración
  273→276 (ver más abajo). El reviewer volvió a inyectar el defecto decisivo sobre el commit final
  —sonda de visita real fuera del `select`— y salieron **los mismos 2 rojos en Postgres y 13 verdes
  en los dobles** que en la ronda 1: la auditoría del tope está en pie entera.

### ✅ T0 CERRADA — las dos medidas de despliegue, ejecutadas el día de la release

Eran lo único que bloqueaba desplegar la 276, y se midieron **hoy**, no se citó la foto de ayer.

1. **R37 re-ejecutada, limpia.** La única orden viva con `intentos >= 3` sigue siendo la guía
   **`28098171`**, en **`devuelta`**, y **cero** fuera de ese estado. **La condición de parada de Q6
   no se cumple**: no hay ninguna orden a la que R18 vaya a dejar inasignable sin que nadie lo haya
   decidido.
2. **El segundo número de T0, medido POR PRIMERA VEZ: T6 congela CERO órdenes el primer día.** Era
   el número sobre el que se había aceptado el riesgo a ciegas, y es el tamaño de la mercadería que
   esta ficha para. Hay **2** órdenes vivas en `reprogramada` (`31005512`, `47145018`), **0
   liberables hoy**, y las dos cuelgan de un cierre **ya aprobado**.

### Lo que se midió antes de registrarlas, y es la razón de que existan

- **La guía `28098171` llevaba 3 intentos vigentes y seguía en `devuelta`.** No es que el cron esté
  roto —corrió a las 09:01 CR y responde 200 cada hora—: su última causa es `wrong_address`, y esa
  rama **escala solo por tiempo (5 días) e ignora el contador**. Llevaba 89,1 h de 120.
- **La raíz del 4.º intento: de los cinco resultados de gestión, solo `devuelta` espera al cierre.**
  `reprogramada` cambia el estado en el acto y `findReprogramadasVencidas` libera la orden por
  `fecha_reprogramacion <= hoy` **sin mirar el cierre**, así que vuelve a circulación con el
  contador en el valor viejo.
- **El contador cuenta cierres aprobados, no visitas** (215/R29). Medido en la guía `53521827`:
  **4 gestiones contables no anuladas y el sistema le cuenta 2** —dos cuelgan del mismo cierre y
  una `reprogramada` no tiene visita real enlazada—.
- **`GuiaAsignacionService` no mira el contador en ningún punto**: hoy se puede asignar una orden
  que ya agotó sus intentos.
- **El contador de «Por recoger» miente**: la cabecera dice «N Órdenes nuevas asignadas» contando
  las que el servidor no deja recoger. Decía **2 con 1 sola recogible**.

### Las decisiones del humano, para no re-abrirlas

1. **Solo se difiere `reprogramada`.** Los terminales se siguen viendo en el acto: diferirlos
   dejaría a la tienda y al rastreo sin ver una entrega hasta **22,1 h** (p90 medido).
2. **La no gestión del corte con el umbral alcanzado termina en `rechazada`** al aprobarse ese
   cierre. Es la 218, y por eso la supersede.
3. **`incidente` sigue disponible** en el intento del umbral: no es un desenlace de entrega, y
   forzar `rechazada` grabaría un hecho falso y cobraría un rechazo que no ocurrió.
4. **En «Por recoger» no se oculta nada**: R23 de la 246 sigue vigente, cambia el sitio.

⚠️ **La 276 acelera dinero y el spec lo lleva escrito**: `rechazada` emite `cobroRechazado` (56), y
hasta hoy el sistema erraba **a propósito** hacia no cobrar (215/Q5). Desde esta ficha, un error de
conteo cobra de más.

### ✅ Colisión de ids con `origin/dev` — RESUELTA renumerando a 276 y 277

> Este párrafo estuvo **falso** unas horas, y conviene saber por qué: el `sed` del propio renumerado
> reemplazó `273`→`276` y `274`→`277` **también dentro del texto que describía la colisión**, con lo
> que acabó afirmando que `origin/dev` usaba 276 y 277 para tarifas —lo contrario de lo ocurrido— y
> contradiciéndose solo. Lo cazó el reviewer, en dos rondas: la copia de la bitácora en la primera y
> **ésta, la segunda copia, en la segunda**.

Medido el 2026-08-24: `origin/dev` pasó de `e93c19e6` a **`821a6afe`** y en ese avance otra sesión
registró **273 = tarifas ligadas a la zona (ya MERGEADA)**, **274 = cobro por zona + tienda** y
**275 = configuración de tarifas**. Los ids que esta sesión había registrado para «el tope de
intentos» (273) y «Por recoger» (274) quedaron ocupados por features distintas.

**Resuelto: 273 → 276 y 274 → 277**, porque `dev` manda y la ficha mergeada es la suya. Precedente
explícito del repo: la 218 se renumeró desde 216 por esto mismo. En `821a6afe` los ids 276 y 277
estaban libres, comprobado.

El merge a `dev` dará conflicto en `feature_list.json` igualmente, pero **por divergencia normal de
ramas, no por la colisión**: `dev` local no es ancestro de `origin/dev`. Se resuelve quedándose con
las entradas de `dev` y añadiendo la 276 y la 277.

### La puerta que viene

⏳ La puerta del spec **ya pasó** (2026-08-24) y las dos fichas están terminadas y aprobadas. Las que
quedan son dos, y **ninguna es de código**:

1. **El remoto.** Nada está empujado. `dev` local **no es ancestro de `origin/dev`** (`821a6afe`):
   el merge dará conflicto en `feature_list.json` por divergencia normal de ramas —no por la
   colisión— y se resuelve quedándose con las entradas de `dev` y añadiendo la 276 y la 277.
2. **El despliegue de la 276**: R37 re-ejecutado contra producción, y el número de `reprogramada`
   congeladas el primer día, que nunca se ha medido.

---

## 🚀 DESPLEGADA — 2026-08-23 (2.ª release del día)

**`prod` = `37b5944b`**, READY. Sale la **271**: el segundo cierre se puede solicitar, y acumular dos
bloquea. Ficha cerrada, **cero `in_progress`**. El recorrido con su evidencia está en
`docs/release.md`; la narrativa, en `progress/history.md`.

### ✅ EL CRON DE LA NOCHE, MEDIDO LA MAÑANA DEL 24 — corrió, y no tenía nada que cerrar

**Corrió**: `GET /api/cron/corte-diario` → **200** a las **00:00:22 CR del 24**, sobre
`dpl_46j8ENJp6qrLbEoizNdxbKcR8yz1`, que es `target: production` y commit **`37b5944b`** — el build
de la 271. No es «no se sabe si corrió»: está en los logs de runtime con su despliegue.

**Creó 0 cierres, y es lo correcto: no tenía candidatos por NINGUNA de las dos ramas** de
`findMensajerosConActividadSinCierre`.

| lo medido contra producción | número |
| --- | --- |
| (a) `gestion_orden` con `cierre_id IS NULL AND anulada_at IS NULL` | **0** |
| gestiones registradas en la jornada del **23** (la que ese corte cerraba) | **0** — la última es del **22** |
| (b) órdenes vivas en `en_reparto` / `ayuda_tienda` con mensajero asignado | **0 filas** |
| `cierre_dia` creados por la corrida | **0** |
| `notificacion` con `evento = 'cierre_dia_vencido'` | **0**, y **0 en toda la historia de la tabla** |
| mensajeros bloqueados por la regla N/V después de la corrida | **0** (uno con `N=1, V=0` → libre) |

El único mensajero con actividad **solicitó su cierre él mismo** a las **20:40 CR del 23**
(`55fa66b7`, 2 gestiones, `solicitado`), así que a medianoche ya no le quedaba nada pendiente.

### ⚠️ LO QUE ESTO **NO** VERIFICA, y sigue vivo

**El aviso `cierre_dia_vencido` sigue sin emitirse ni una vez en producción.** El cero de hoy es
consistente, pero **no es evidencia**: es exactamente la trampa que se documentó con `C7` — un cero
solo vale si lo que lo produciría llegó a correr, y aquí la precondición del emisor (que el corte
cree un `vencido`) **nunca se dio**. El cableado del notificador se verificó en test y en revisión;
**en producción no lo ha ejercido nadie todavía**.

Queda igual que ayer, y hay que volver a mirarlo **la primera noche en que un mensajero deje trabajo
sin cerrar**. Los tres números a repetir son los mismos: cierres creados, su jornada derivada, y
filas nuevas en `notificacion`.

### Lo que además salió al mirar

- **El cierre `…8F88DCD5` (79cb2c0f) se aprobó esta mañana a las 08:16 CR.** Sus **4 filas de
  `cierre_sin_gestion` siguen ahí**, así que la comprobación de píxeles de la 264 que está en la
  lista de release **todavía se puede hacer**.
- **`C8` no se puede cerrar, y hoy se sabe por qué**: **cero jobs `optimizacion_ruta` de cualquier
  estado desde el 2026-08-22 16:56 CR**, o sea **ninguno después del despliegue**. «Cero `failed`»
  vuelve a ser un cero sin significado — el mismo error de lectura que `C7`. Se queda en la lista.
---

## 🚀 RELEASE DESPLEGADA — 2026-08-23 (contexto previo)

**`prod` = `6bc566b8`**, desplegado y **READY**. 55 commits. `dev` y `prod` igualados.
Salen la **262** (corregir el día de reparto) y la **265** (el optimizador lee al proveedor).

**Primera release hecha siguiendo `docs/release.md`**, que se creó ayer justamente para esto. Su
recorrido, con la evidencia de cada paso, queda escrito en ese mismo archivo.

### Verificado después de desplegar

- **Cero errores de runtime.**
- **Las dos migraciones aplicadas**, y `secuencia_fuente` se creó **sin tocar ninguna fila
  existente** (0 filas con valor).
- **`C7`: cero líneas `optimizer***:`**, y es un cero que significa algo — el cron corrió **cuatro
  veces** (09:20–09:23) sobre el despliegue nuevo sin imprimir ninguna, cuando con el build anterior
  **cada corrida volcaba un bloque de configuración entero**. La traza nace apagada en producción,
  comprobado en el comportamiento.

⚠️ **Una lectura que casi se hace mal:** los primeros logs que miré **sí** traían líneas
`optimizer***:`, pero eran del despliegue **anterior** (`dep=dpl_CUyTSnK…`). Concluir «C7 falla» ahí
habría sido culpar al código nuevo por el log del viejo.

### Lo que NO se cerró, y por qué

- **`C3`** — `ruta_optimizada_parada` sigue **vacía** en producción, así que
  `RUTA_ORIGEN_MAX_KM = 200` continúa **declarado sin calibrar**.
- **`C8`** — cero jobs `failed` de esa familia desde el despliegue, pero **no ha pasado tiempo
  suficiente** para que sea evidencia. Se re-mira con un día de tráfico real.
- **Los píxeles del cierre `8F88DCD5`** (264) y **`F6` en preview**: siguen necesitando entrar a la
  app como usuario.
- **El texto «Del 23 al 24 de agosto»**: decisión de producto, sin tocar.

### Lo que queda para mañana, en una línea

Re-mirar **`C8`** con tráfico del día, decidir el **texto**, y las dos comprobaciones que exigen
mirar la app. Todo lo demás de estas dos features está cerrado.

---

## ✅ LAS DOS FICHAS CERRADAS — 2026-08-23 (tanda anterior, cerrada)

**Ninguna ficha `in_progress`.** `dev` con las dos features completas, revisadas y con sus
bloqueantes cerrados.

| | |
| --- | --- |
| **262** · corregir el día de reparto | `done` · 4 tandas · revisión RECHAZADA → **4 bloqueantes cerrados** · `F6` ejecutada |
| **265** · el optimizador lee al proveedor | `done` · revisión RECHAZADA → cerrada → **re-revisión OK, 0 bloqueantes** |

**Lo que queda vivo NO es código: son pasos de release**, y por eso existe `docs/release.md`. Si su
sección «pendiente para la próxima release» tiene entradas, **la release no está terminada aunque el
despliegue esté verde**.

### El hallazgo de la 262, que es el patrón del día entero

**`R32` no tenía ningún test que mordiera**, y el comentario de su test de integración prometía
comprobar «ni gestión, ni historial, **ni ruta**» contando sólo las tres primeras. No se vio
leyendo: se vio **inyectando el defecto exacto** y midiendo que **3.302 tests seguían verdes**.

Es la misma familia que apareció cuatro veces más hoy: la puerta T8 protegiendo a **cero**
integradores; el aviso de la 262 que se perdía la segunda vez por un `dedupe_key` que traga el
conflicto; los `logger.warn` del optimizador **descartados en las dos capas**; y un requisito de la
265 cuyo test montaba el escenario correcto y sólo afirmaba `status: ok`.

**La prosa de este repo miente más que su código, y nada la vigila.** Tres comentarios corregidos hoy
decían lo contrario de lo que hace el código, incluido uno que afirmaba que un `warn` servía «para
que un operador note» algo — siendo un `{ warn: () => {} }`.

### `F6` de la 262: ejecutada, con lo que no cubrió dicho

Se hizo **en local, no en preview** (declarado: la base de preview es distinta desde julio y no
sabemos si tiene cuentas). Pasó el caso central de punta a punta —el mensajero **intenta** recoger y
no puede, se corrige, **se desbloquea solo**—, «Ver historial» entrada por entrada, la campana en
**38,5 s** sin recargar, y `R32` con KPIs y mapa idénticos.

**No cubrió**, y está en la lista de release: corregir desde `/recepcion-satelite`, el aislamiento
entre zonas **sobre un listado con contenido** (se midió sobre uno vacío), y ningún caso de
`ayuda_tienda`.

### Pendiente de decisión humana

- **El texto «Del 23 al 24 de agosto»** se lee como **rango de dos días** en la mitad de los casos.
  Lo agrava que la entrada de corrección es **la única sin la flecha `A → B`**: toda la carga cae en
  la preposición, y **falta el verbo**. Es contrato en `design.md` §14.4; no se tocó.
- **Los píxeles del cierre `8F88DCD5`** (264): requiere entrar a producción como usuario.

### Lo que el paralelismo enseñó hoy

Nueve agentes en worktrees aislados. Funcionan, **pero no aíslan la base local ni `node_modules`**:
la migración de una feature pone rojo el gate de las demás y el de `dev` limpio, y `prisma generate`
se pisa —el último gana y al otro le desaparecen sus tipos a mitad de su gate—. Y **tres informes de
revisión se quedaron sin commitear** en el árbol principal: ninguna herramienta lo señala.

---

## 🌙 CIERRE DE TANDA — 2026-08-22 (tanda anterior, cerrada)

`prod` = `465c5234` (release #458, desplegada y verificada, sin errores de runtime).
`dev` = `651aef2a`, gate **completo** en verde: 1319 archivos, **17.793 tests**, `INIT_EXIT=0`.

La suite pasó de **17.502 a 17.793** en el día — **291 tests nuevos**, y **ni uno borrado ni
encogido**: verificado archivo por archivo en las cuatro ramas antes de mergear.

### Dónde está cada ficha, de verdad

| ficha | en `dev` | lo que falta |
| --- | --- | --- |
| **265** · el optimizador lee al proveedor | backend + frontend + cierre de bloqueantes | **11 menores** de la revisión, y la mitad de `F6` que sólo se puede ver en **preview** |
| **262** · corregir el día de reparto | backend + los dos modales + cierre de B14 | 🔴 **el BLOQUE HISTORIAL: `R37`-`R45` sin un solo test**, `F6`, y **la revisión entera** |

**La 262 está más lejos de cerrar de lo que su estado sugiere.** Su bloque historial —el alcance que
la puerta humana añadió— no se ha empezado, y necesita backend y UI en la **misma** tanda porque su
primera tarea rompe el build a propósito en un componente.

### La revisión de la 265 rechazó, y encontró lo de siempre

**B1 — un requisito que el mapa daba por probado y no lo estaba.** El test de `R8` montaba el
escenario correcto pero **sólo afirmaba `status: ok`**. Cerrado y **medido en las dos direcciones**:
con el test nuevo la mutación muere; con el test que había en `dev`, **sobrevive**. Eso es un hecho,
no una promesa.

**B2 — 43 tareas y ninguna marcada**, con la feature ya mergeada. Ahora **38 `[x]` · 5 `[ ]`**, cada
viva con su motivo. Y al hacerlo apareció **C5**: H1 no tiene ficha, así que se dejó abierta en vez
de marcarla — marcarla habría sido justo el fallo mudo que B2 persigue.

### Pendiente de decisión humana

1. **¿Se lanza el bloque historial de la 262?** Es la última tanda grande de esa ficha.
2. **Ficha para H1** (`geocode_precision` se escribe y no lo lee nadie): **propuesta, no registrada**.
   Sin ella, `C5` de la 265 no se puede cerrar.
3. **`vercel env ls production`** para saber si la **251** ya está resuelta. Medido: el error de
   credencial **no aparece desde el 2026-07-29** y hay 57 jobs `done` sin error, el último de hoy —
   pero eso no distingue «la variable está» de «el código dejó de mirarla».
4. **Ver el cierre `8F88DCD5` en pantalla** (264): los datos están verificados —4 órdenes, ₡14.900,
   ₡2.000— pero **nadie ha mirado los píxeles**, y era una ficha visual.

### Deuda barata que alguien debería tomar

- **`lib/clients/google-route-optimization.ts:208` miente**: dice «se apaga con `RUTA_DEBUG_LOG=0`»,
  caducado desde que el default se invirtió.
- **`design.md` §10.2 de la 265** llama «el único sitio donde el `WHERE` real se mira» a un archivo
  con Prisma **mockeado**.
- Tres tests ajenos usan `getByRole("alert")` **en singular** (`RepartoModule.test.tsx:839, :1152,
  :1463`): un caso futuro con «bloqueado + orden local» dará un *multiple elements* que no dice lo
  que parece. **No es deuda de esta tanda**, ya se rompe hoy con «bloqueado + desactualizada».

### Lo que el paralelismo enseñó, y hay que recordar

Seis agentes en worktrees aislados **funcionaron**. Pero los worktrees **no aíslan la base local ni
`node_modules`**, y eso mordió dos veces:

1. **La migración de la 262 puso rojo el gate de la 265 — y el de `dev` limpio.** Un test que compara
   los valores de un enum **en la base** contra una lista literal empieza a fallar en todas partes.
   Se reprodujo en `dev` sin código de ninguna rama antes de culpar a nadie, y se resolvió mergeando
   primero la rama que traía los censos actualizados.
2. **`prisma generate` se pisa entre worktrees**: el cliente vive en el `node_modules` compartido, así
   que el último gana y al otro le desaparecen sus tipos **a mitad de su propio gate**. Hay que
   regenerar justo antes de cada corrida.

⚠️ **Y un agente corrió `scripts/seed-usuarios-qa.ts` contra la base local** (el hash no cuadraba con
el `QA_PASSWORD` del `.env`). Eso **rota las cuatro cuentas QA a la vez**. Si un login local deja de
funcionar, es esto y no el código.

---

## ✅ PUERTA HUMANA PASADA (262 y 265) — 2026-08-22 (tanda anterior, cerrada)

Las dos fichas pasan a **`spec_ready`**. **Las dos crecieron en la puerta**, y la 265 además cambió
de zona.

### 262 · corregir el día de reparto — las tres respondidas EN CONTRA del spec

| | decisión | lo que arrastra |
| --- | --- | --- |
| **P1** | **Sí**, el rastro se ve en «Ver historial» | Una corrección de día **no tiene «estado destino»**: hay que decidir cómo se pinta una entrada sin transición en un DTO que hoy sólo sabe de transiciones |
| **P2** | **Sí**, se avisa al mensajero | `NotificacionEvento` es un inventario cerrado (146/D1): **migración de enum**, y por tanto **gate `./init.sh` COMPLETO** |
| **P3** | **«hoy / mañana»**, como al asignar | Lo único recomendado que se aceptó, y lo que mantiene que mover al pasado sea **imposible por construcción** |

### 265 · el optimizador lee al proveedor — `backend` → **`fullstack`**

- **P3 = sí** (el mensajero sabe que su ruta se ordenó en local) → **eso mete UI** y cambia la zona.
- **P2**: `RUTA_ORIGEN_MAX_KM = 200`, **declarado sin base documental** como la 92 con
  `RUTA_MAX_PARADAS = 100`, porque **M1 no se pudo medir**.
- **P4**: apagar `RUTA_DEBUG_LOG` **ya**. ⚠️ **Se lleva por delante P1 y P5**: esa traza era la única
  vía a la respuesta cruda del proveedor —los logs de Vercel expiran la consulta— así que el schema
  se queda **defensivo** y **R7 se implementa tolerando que no haya códigos de motivo**.
- **P6**: no hay que re-encolar nada. Son **6** jobs, todos de hoy.

⚠️ **Y una tensión que se deja escrita:** el humano confirmó que **el origen de Medellín es una
prueba suya**. Los ~1.040 km que motivan **R21** son un **artefacto de pruebas**, no evidencia de
campo. R21 se implementa igual —deja de pagar una llamada condenada y da orden local en vez de error
duro— pero **su umbral no está calibrado con producción**.

### Lo que se midió, y las dos trampas que salieron

| # | resultado |
| --- | --- |
| **265/M1** | **No medible hoy**: `ruta_optimizada_parada` **vacía** y **0** órdenes en `en_reparto` |
| **265/M2** | **6** jobs `failed` de «forma inesperada», todos de hoy (04:07–05:26). **0** rutas `desactualizada` |
| **265/M3** | 1 de 2 rutas con origen en Medellín, `origen_at` de hoy 22:56 — y es de un **mensajero real con 38 órdenes**, no de la cuenta QA |
| **262/M1-M2** | 0 y 35, ya medidas a las 04:27 CR. Caducan antes de desplegar |

1. **M3, como el spec la define, no habría visto nada**: filtra `origen_fuente = 'gps'` y las dos
   rutas son `ultima_conocida`.
2. **Un primer M1 devolvió «20.015,1 km» y era basura**: `LEAST`/`GREATEST` **ignoran los NULL**, así
   que `acos(-1)` da la antípoda. Habría fijado el umbral de R21 sobre un fantasma.

### Hallazgo suelto: la 251 parece resuelta y nadie la cerró

«La optimización de ruta NO corre en producción: falta `GOOGLE_ROUTE_OPT_PROJECT_ID`». Ese error
**no aparece desde el 2026-07-29**, y hay **57** jobs en `done` sin error, el último **hoy a las
22:56**. No la cierro: falta comprobar que la variable existe de verdad en producción y no que el
código dejó de mirarla.

### Decidido aparte: no hay aviso que entregarle a Dropi

El humano lo dijo el 2026-08-22: **están sólo haciendo pruebas**. Eso **cierra la pregunta abierta 5
de la 268** (canal y plazo del aviso). La entrada de `docs/api/CHANGELOG.md` se queda como material
de onboarding para cuando la integración sea real.

---

## ✅ RELEASE DESPLEGADA — 2026-08-22 (tanda anterior, cerrada)

**`prod` = `465c5234`, desplegado y verificado READY**, sin errores de runtime. Salió por el PR
**#458** y lleva la **256** (el evento de `devuelta` con su motivo tipificado), la **268** (el
webhook del ciclo de ayuda y del incidente) y el papeleo de cierre de la **264**.

Gate **completo** sobre `969c611c` antes de abrir la release: **1307 archivos, 17.502 tests, 26
saltados, `INIT_EXIT=0`** leído dentro del log. Y se comprobó que `dev` no se había movido entre la
medición y la release.

### La puerta que la bloqueaba, y cómo se descargó

**T8 de la 268 —aviso a integradores— bloqueaba el despliegue, no el código.** Antes de redactar
nada se midió **a quién** hay que avisar, contra producción y en sólo lectura:

| medición | resultado |
| --- | --- |
| `webhook_suscripcion` (suscripciones de webhook) | **0 filas.** Nadie recibe un solo evento hoy |
| `api_key` activas | **1** — `Dropi` (`ordx_H6-YSbM`), creada el 2026-08-20 |
| órdenes creadas por esa key | **0**, `max(created_at) = null` |

No hay a quién romperle nada, y los cuatro cambios son además aditivos. **Decisión humana del
2026-08-22: cerrar T8 por medición y desplegar.** El aviso no se tira: pasa de puerta de despliegue
a **material de onboarding de Dropi**, que debe tenerlo *antes* de conectar.

### Convención nueva: `docs/api/CHANGELOG.md`

El aviso vive ahí, versionado junto al contrato que describe. Existe porque esta misma task
**heredó el agujero de 239/T0.3**: pedía este mismo aviso, nunca se marcó y la feature salió igual —
no había dónde escribirlo ni a qué canal mandarlo. A partir de ahora, todo cambio observable del
canal entra como entrada fechada **antes de la release**.

### Pendiente de decisión humana

1. **Canal y contacto del aviso** (pregunta abierta 5 de la 268, sigue sin respuesta). Alguien tiene
   que entregarle a Dropi la entrada del changelog antes de que conecte.
2. **Puerta humana de la 262 y la 265** — los dos specs escritos y mergeados, sin una línea de
   implementación. La 265 deja 6 preguntas abiertas (las duras: la forma real de `skippedShipments`
   y el umbral en km); la 262 trae su B0.1 medida: **M1 = 0 filas**.
3. **Apagar `RUTA_DEBUG_LOG`** — hoy encendida por defecto, vuelca coordenadas de destinatarios a
   los logs de Vercel. Era un override consciente para diagnosticar justo lo que cierra la 265.
4. **`docs/release.md`** — sigue sin existir. Es la razón de que mediciones que caducan acaben
   siendo casillas de un solo uso.
5. **255** — pedir los dos renglones de qué está mal exactamente en el cotizador de la 248, y
   renumerar el **id 248 duplicado** conservando el slug.

### Verificación pendiente EN PRODUCCIÓN (no se puede en local)

La sección «Órdenes sin gestionar» de la **264**, ya desplegada: cierre `8F88DCD5`, debe listar las
**4 guías** y el pie seguir en **₡14.900 general y ₡2.000 de pago al mensajero**. En local no existe
ni una orden `sin_gestionar` ni un cierre vencido, y por eso la ficha declaró la deuda en vez de
disimularla.

### Deuda declarada sin ficha propia

- **268/M5** — el `where` de `gestiones` del detalle no filtra `anuladaAt`: un `incidente` **anulado**
  puede seguir exponiendo su foto por API key. Merece ficha propia, no un parche.
- **261/R19** — el mapa de `tasks.md` prometía una cláusula de guardia que no existe. El mapa quedó
  corregido; la cláusula sigue debiéndose.

### El registro mentía, y se corrigió

`feature_list.json` daba la **255** y la **257** como `in_progress` con sus PRs mergeados y sus
revisiones aprobadas, la **256** y la **263** como `pending` estando una en `dev` y la otra **en
producción**, y **no tenía ficha de la 268** —otra sesión la numeró así cuando el id más alto aquí
era 265; los 266 y 267 no existen—. Las cinco quedan al día. **Ninguna ficha `in_progress`.**

Sigue pendiente, y es escritura de verdad: **`progress/history.md` no tiene entrada de la 255, la
256, la 257 ni la 268.**

### Y había tres fichas más, varadas fuera de `dev`

El commit **`63dc081a`** —«chore(268): registra las fichas 266, 267 y 268 en la rama»— se empujó a
`feature/268-webhook-ayuda-incidente` **después** de que el PR #456 ya estuviera mergeado, así que
**nunca llegó a `dev`**. Apareció mirando los deployments de Vercel, no el repo.

- **266** · habilitar un pedido con novedad por API key — pedido literal del humano, del bloque
  NOVEDADES del **cuestionario de integración de Dropi**.
- **267** · analítica de la propia tienda por API key — también de Dropi. Revierte a propósito una
  decisión de diseño firmada (`ROLES_SIN_ANALITICA = ['apiKey']`).
- **268** · su versión de la ficha, que chocaba con la registrada aquí.

Las dos primeras se rescataron **tal cual**, sin reescribir el análisis ni el pedido del humano, y
de la 268 varada se injertó lo único que la de aquí no tenía: el pedido que la originó. **Y dos
avisos suyos ya no valen, porque la release de hoy los resolvió:** la dependencia de la 266 con la
268 está satisfecha —`ORIGENES_SIN_EVENTO_PUBLICO` está **vacía** en `dev`, así que la familia del
rescate ya emite— y el «coordinar con la rama `ux`» quedó sin objeto. Queda en pie afirmarlo con un
test de emisión, no asumirlo.

**Dropi no es un integrador dormido: está a mitad de integrarse.** Key creada el 2026-08-20, cero
órdenes, y dos features suyas en la cola. Por eso el changelog tiene que llegarle antes de que
conecte.

---

## 2026-08-22, 04:30 CR — tanda anterior (cerrada)

`dev` está en `d6dd96b4` y **no se ha movido**: hay **seis PRs abiertos** y nada mergeado. Ese es
el único bloqueo real de esta tanda.

### Orden de merge, y por qué ese orden

| # | PR | qué lleva | por qué ahí |
| --- | --- | --- | --- |
| 1 | **#446** | 🔴 el `access_token` OAuth2 fuera de los logs de producción + guardia de carpeta | independiente |
| 2 | **#448** | 263 · el comprobante del cierre y la guía que pisaba al destinatario | **desbloquea el frontend de la 264** |
| 3 | **#450** | 264 · bloque backend (tabla nueva + migración) | no se solapa |
| 4 | **#447** | spec de la 265 + su ficha | **añade** al final de `feature_list.json` |
| 5 | **#451** | spec de la 262, con B0.1 ya medida | añade `specs/` nuevo |
| 6 | **#449** | cierre de la 261 (papeleo + F6 + M1') | **modifica** la ficha 261: va después de los que añaden |

Hay además un **#434** de otra sesión (feature 256) que GitHub no sabe si mergea. No es de esta
tanda y no se ha tocado.

### Bloqueado, y por qué

- **Frontend de la 264** — espera a que **#448** entre: los dos escriben en `cierre-factura.tsx`.
- **Implementación de la 262 y de la 265** — las dos están en **puerta humana**. La 265 deja 6
  preguntas abiertas (las duras: la forma real de `skippedShipments` y el umbral en km); la 262
  deja 3.
- **Release a `prod`** — decidida por el humano: **el hotfix del token sale con ella**, no suelto.
  Cuando los PRs entren, toca gate **completo** sobre el SHA final —el que corrió el reviewer ya no
  vale, `dev` se habrá movido— y abrir la release.

### Decisiones pendientes del humano

1. Mergear los seis PRs.
2. **`docs/release.md`**: el repo no tiene lista de release, y por eso mediciones que caducan
   (R27 de la 261) acaban siendo casillas de un solo uso. Propuesto, no creado: es convención nueva.
3. **Apagar `RUTA_DEBUG_LOG`** cuando aterrice la 265. Hoy vuelca coordenadas de destinatarios a
   los logs de Vercel; era un override consciente «para diagnosticar un problema abierto», y ese
   problema es justo el que la 265 cierra.

### Lo que esta tanda encontró y no estaba buscando

- 🔴 **Un `access_token` OAuth2 imprimiéndose en claro** en los logs de producción desde el
  2026-08-14, dos líneas debajo del `describirToken()` que existe para no revelarlo. Entró en `dev`
  y llegó a `prod` sin que nada lo cazara: no rompía ningún test y `eslint` no lo ve.
- **El optimizador de ruta no leía lo que el proveedor le decía.** Google contestaba en
  `skippedShipments` / `validationErrors` que no podía servir las paradas, y el código lo traducía a
  «forma inesperada»: error duro, mensajero sin ruta, cron reintentando y facturando. Causa medida:
  el origen GPS estaba en Medellín y las paradas en Costa Rica, a ~1.040 km. → ficha **265**.
- **`geocode_precision` se escribe y no lo lee nadie.** La feature 91 dejó dicho que «el umbral de
  calidad lo decidirá el primer consumidor»; el primer consumidor llegó y no decidió nada, así que
  un centroide de distrito entra en la ruta indistinguible de un `ROOFTOP`. → hallazgo H1, sin ficha.
- **Dos guardias que no podían fallar**, encontradas midiendo y no leyendo: la de la 263 comparaba
  cajas en vez de tinta (la caja se queda en su track mientras el texto se desborda), y la de la
  invariante `fecha_reparto`/`asignado_at` **ni siquiera vería** una escritura que sólo toque el día.
- **Una decisión de diseño del spec de la 264 era inimplementable**: habría metido el cliente de
  Prisma en el bundle del navegador del mensajero. La cazó una guardia ajena.
- **Tres sondas mías equivocadas** antes de medir bien el F6 de la 261. Ninguna medía lo que decía
  medir, y las tres habrían pasado por verificación.

### Verificado contra producción (sólo lectura, MCP)

- **R7 y R20 de la 261, en la realidad**: las dos órdenes reservadas (guías 17496963 y 57998428)
  llegaron a su día con el mismo estado y el mismo mensajero. La marca caducó sola, sin escrituras.
- **M1' = 0** y **M1 de la 262 = 0** (esta sin acotar estado). **M2 = 35**, pero ninguna en
  `por_recoger` ni `en_reparto`: todas en estados que R6 excluye. `D3'` no se re-abre.

---

## 2026-08-21 — tanda anterior (cerrada)

**Cuatro releases a producción en esta sesión, todas verificadas contra la base después de
desplegar.** Ninguna ficha `in_progress` al cerrar esa tanda; la **258** entró después (bloque de abajo).

| # | Qué | Release |
| --- | --- | --- |
| **240 + 246** | el rechazo manual deja de ser maqueta · elegir el día de la asignación | #414 |
| **239** | «ver la app» hecha — la tarea que llevaba sin hacer con la ficha ya mergeada | — |
| — | la nav de la landing baja a su sección y respeta el orden de la página | #417 |
| — | botón «Volver al inicio» en login y postulación | #421 |
| **252** | 🔴 **la postulación se perdía con documentos pesados** | #424 |
| **253** | 🔴 **postular vehículo o bodega era una MAQUETA que decía «enviada»** | #430 |

### 🔴 Los dos defectos que perdían datos de usuarios reales

**252 — la postulación moría en silencio.** Medido contra producción mandando cuerpos crecientes:
`4 MB → pasa`, `5 MB → 413`. Los archivos del humano pesaban 2,16 MB × 5 = **10,8 MB**. El
formulario validaba **5 MB por documento** contra un límite de **5 MB para toda la petición**:
admitía 25 MB y el transporte moría a los 5. **Y ese 413 no aparece en ningún log**, porque el
rechazo ocurre antes de que la petición sea una invocación registrada — por eso era invisible por
los dos lados. Arreglado reusando `comprimirImagen`, que **ya existía y usaban otras tres
pantallas**: la postulación era la única superficie de subida que nunca la adoptó.
**Confirmado en producción:** hay un alta de mensajero `pendiente` del 2026-08-21 03:33 UTC.

**253 — la maqueta que mentía.** `PostularRecursoModal` validaba, pintaba «Postulación enviada» y
**no enviaba nada**. Medido con `git log --follow`: **nació el 2026-08-16 y `prod` la contenía —
cinco días en producción**. Quien postulara en esa ventana no recibió nunca una llamada, y **no hay
forma de saber quiénes fueron**: no dejaron fila, ni log, ni correo.

### 🛡️ El arnés cambió: `--rapido` pasa a ser el gate normal

Medido: mover un enlace de la nav costaba **16.346 tests y 5–11 min**; lo relacionado eran **21 +
las guardias, ~33 s**. Ahora:

- **`--rapido` es el gate de un PR** (~80 s en la práctica).
- **`./init.sh` completo** es obligatorio **antes de una release a `prod`** y **después de cada
  merge a `dev`** — ahí es donde se caza un `dev` roto, que es el único agujero que el modo rápido
  no puede ver por diseño (`--changed` compara *contra* `dev`).
- **`--rapido` se niega solo** si el diff toca migraciones, `db/schema.prisma`, `lib/types/`,
  config de build, nombres de dinero **o el propio `init.sh`**. Es un `fail`, no un aviso.

Probado en los dos sentidos, que es donde mueren estos filtros. Y ya se ejerció de verdad: **se
negó ante el backend de la 253** (toca `db/migrations` y `lib/types`).

### 🟡 EN VUELO — 258 · el tablero del día de `/monitoreo`

Alta el 2026-08-21: el humano eligió la **dirección A** del lienzo de diseño de la ruta
([lienzo](https://claude.ai/code/artifact/fcc00a76-16ee-449e-b6c4-cb700bf3289a), cuatro direcciones comparadas).

`fullstack`, `sdd: true`. **Frontend:** los ocho contadores pasan a la primitiva `Badge` —así el
modo oscuro deja de depender de esta feature—, cada estado lleva icono (`EmptyState` / `Alert`), el
detalle deja el `Sheet` y pasa a `Modal` + `DataTable` + `Pagination`, y entran filtro por nombre
(`Input`) y densidad (`SegmentedToggle`). Pedido explícito del humano: **no crear primitivas
nuevas**. **Backend:** la línea de «entregas acumuladas por hora» **no tiene dato** —el servicio
devuelve conteos del día, no una serie— y el humano pidió construirla en esta misma ficha. Eso es
lo que la vuelve `fullstack` y `sdd`.

**Decisiones humanas ya tomadas** (2026-08-21): el detalle **sigue paginado** —el SQL es
`LIMIT/OFFSET` y la guardia de frontera prohíbe traer el día a memoria—, y la línea por hora entra
aquí en vez de en ficha aparte.

**Lo que ya se sabe que va a doler:** toca `lib/types/tablero-dia.ts`, así que **`./init.sh
--rapido` se negará solo** y la corrida completa es obligatoria; y
`tests/unit/tablero-dia/frontera.guardia.test.ts` censa **todo** `app/(app)/monitoreo` (prohíbe
`findMany`, SQL sin `LIMIT`, leer el rol, nombrar `badgeVariants` y declarar etiquetas o colores
por estatus).

**Estado (2026-08-21):** spec escrita y aprobada por el humano (78 requisitos, R1–R78), backend y
frontend implementados, **`./init.sh` completo en verde** (1.269 archivos · 16.803 tests) y
**revisión APROBADA sin bloqueantes** — el reviewer verificó los 78 uno a uno y corrió por su
cuenta 10.028 tests de las suites afectadas más 1.910 de las 127 guardias.

**Lo que encontró VER LA APP y la suite no podía ver.** Con 16.790 tests en verde, la cifra del
contador «Reprogramadas» quedaba **fuera de la caja visible** en la tarjeta: el número estaba en el
DOM —así que `toHaveTextContent` pasaba— pero no se leía. Medido en el navegador
(`scrollWidth > clientWidth`), era el único de los ocho, porque es la etiqueta más larga y la
columna mide 109 px. Y la gráfica medía **371 px**, más alta que cualquier otra cosa de la página,
con las ocho primeras horas planas en cero. Ambos corregidos y **remedidos**: cero recortes y la
gráfica en 209 px. El test que lo fija NO mira `textContent` —ése pasaba con el defecto puesto—,
sino el reparto del espacio.

**Decisiones humanas de la ficha:** detalle paginado (25, lo dice la configuración); la línea por
hora entra en esta ficha y **cuadra con el contador `entregadas` aunque un punto pueda bajar**; la
barra apilada y el avatar entran; el filtro NO va a la URL; y la línea **reusa `GraficaLineas`** de
analítica sin abrir su confinamiento de `recharts` — dos de los tres costes que el leader le
atribuyó a esa reutilización resultaron FALSOS al medirlos, y está escrito en el design para que
nadie rehaga el razonamiento al revés.

**Deuda que deja, dicha y no escondida:** `components/ui/table.tsx` se quedó **sin un solo
consumidor** al migrar el detalle a `DataTable`. Va anotada `@sin-superficie`, y esa anotación es
**la primera excepción de la capa R-B** de `superficie-de-uso.guardia.test.ts`, cuyo propio código
dice que su mensaje vale más precisamente por no tener ninguna. Recomendación del leader: **chore
aparte que haga a `DataTable` apoyarse en la primitiva** — así la primitiva recupera su único
consumidor correcto, `DESIGN.md` («la única tabla de listas») pasa a ser cierto por construcción y
la excepción desaparece. La alternativa honesta es borrarla; lo que no conviene es quedarse con la
excepción.

**Cierre (2026-08-21).** Cuatro defectos encontrados MIRANDO LA PANTALLA, ninguno detectable por la
suite: la cifra de «Reprogramadas» fuera de la caja visible; la gráfica en 371 px con ocho horas
planas; la etiqueta partiéndose dentro de la palabra (pasa el test de recorte, porque no desborda); y
la cabecera de la tarjeta **recortándose en silencio** entre 768 y 830 px —«13» se leía «1»— porque
`SidebarInset` usa `overflow-x-clip` y lo que no cabe no scrollea: desaparece.

**La causa del cuarto no era la aparente.** El `scrollWidth` de la cabecera estaba clavado en 259 px
a cualquier ancho: `CardHeader` es `grid-cols-[1fr_auto]` y ese `1fr` toma como mínimo el min-content
de su hijo, así que con el avatar de ancho fijo y el nombre en `nowrap` **el `truncate` nunca llegaba
a activarse**. Faltaba `min-w-0`.

**La lección, que es la parte reutilizable:** tres mediciones seguidas dieron verde sobre una pantalla
con un número recortado. El criterio era el correcto; fallaba **dónde se aplicaba** — siempre sobre la
pieza recién tocada, nunca sobre la caja que la contiene. La matriz final (2.352 comprobaciones) se
demostró capaz de ponerse **roja** quitando el arreglo, y ahí salió un caso que nadie había listado:
1280 px en densidad compacta.

**Gate final:** `./init.sh` completo, `INIT_EXIT=0`, 1.269 archivos · 16.815 tests · 26 skipped.
**Sin commit, sin push y sin PR**: el árbol de `feat/258-monitoreo-backend` está sucio a propósito,
a la espera de decisión humana.

### 🟡 EN VUELO — 259 y 260 · lo que salió de USAR la pantalla

Las dos nacen del humano usando `/monitoreo` ya desplegada, y las dos **revierten una decisión
anterior con fecha y motivo**.

**259 · el tablero cuenta por día de reparto** (`fullstack`, 26 requisitos, revisión APROBADA sin
bloqueantes). Una orden asignada hoy **para mañana** aparecía hoy y caía en el cubo `sinRecoger`,
cuya ayuda dice «el mensajero todavía no arrancó con ellas»: la pantalla **acusaba a alguien de ir
retrasado por trabajo que aún no era suyo**. Revierte **D10** (firmada el 2026-08-20) con un
apéndice fechado en el spec de la 246, cuya guardia comprueba **las dos direcciones** — que el
puntero está y que el texto original sigue verbatim.

El predicado no se inventó: se copió el de `RankingRepository`. **Y el spec me corrigió en lo
principal:** yo afirmé que la rama de recolección «se queda como está», y sólo vale en el instante
de la transición — si a las 08:00 mandan a Ana a recoger y a las 14:00 la orden se reasigna a Beto
para mañana, reaparece hoy en la tarjeta de **Beto**. La acusación volvía por la otra puerta.

⛔ **T8.1 bloquea la release, no el PR:** quien asigne para mañana verá esas órdenes desaparecer
del tablero de hoy. Sin aviso previo se lee como «se perdieron» — la misma familia de fallos mudos
que esta sesión lleva persiguiendo.

**260 · la orden completa en el modal** (`fullstack`, 46 requisitos, spec aprobado, **sin
empezar**). Reusa `ordenesColumns` con el `DataTable` propio, nunca `OrdenesListado`. **El hallazgo
que la cambió:** yo dije «copiamos la regla por rol de `/ordenes`»; **no existe esa regla** — ese
listado no recorta dinero por rol, recorta por PUERTA, y esa puerta le cierra el paso al
`adminSatelite`, que **sí** entra a `/monitoreo`. Había un rol que vería dinero que la app le niega.

**Van en serie, y no por intuición:** la intersección de sus `tasks.md` da tres archivos de código
comunes, uno de ellos el test que afirma que el total del detalle cuadra con el `asignadas` de la
tarjeta — la costura entre las dos, y cada ficha mueve un lado de esa igualdad.

### ▶️ Qué queda, y una que necesita decisión HUMANA

| # | Qué | Estado |
| --- | --- | --- |
| **251** | ⚠️ **la optimización de ruta NO corre en producción** | falta `GOOGLE_ROUTE_OPT_PROJECT_ID`. Degrada al cálculo local **en silencio**, y uno de los sitios donde salta es la pantalla del mensajero. **¿Debe configurarse o el fallback es lo querido? Es una pregunta para el humano, no un defecto confirmado** |
| **247** | el doble cobro del flete de devolución | medido: `1 de 16`, ₡2.486 a NUFORM |
| **248** | los errores de `/novedades` salen mudos | la feature 100 comparte el hueco |
| **249** | el chequeo del `down.sql` **avisa pero no falla** | tres migraciones llevan sin él desde el 2026-08-14 |
| **250** | el aviso dice «Devuelta» cuando la orden está en «Devolución por confirmar» | |
| **254** | `db:rollback` revierte **por orden alfabético** | no alcanza a la 2.ª migración de una tanda, **y no lo dice** |
| **220** | e2e | su premisa sigue podrida: 13 de 20 specs son `NOT EXECUTED` |

### 🧾 El patrón de la sesión: los fallos MUDOS

**252, 253, 248, 250 y 254 son la misma familia**: el sistema no falla, *aparenta*. Un acuse falso,
un 413 sin log, un botón que no hace nada, un aviso que nombra el estado equivocado, un rollback
que dice que revirtió. **Ninguno rompe un test.** Por eso la 253 no se dio por cerrada hasta que su
guardia se demostró **roja en las dos formas de recaída** — y en una de ellas `eslint` da `0 errors`
y sale con código 0: el linter no la caza.

---

## 🚀 Desplegado a producción — 2026-08-20

**La pila entera de la ayuda a la tienda salió a producción.** Release
[#414](https://github.com/nuformecuador-lgtm/ordenex/pull/414) (`dev` → `prod`, merge commit
`0931e0fa`): **32 commits · 481 archivos · 9 migraciones**, y el despliegue de Vercel terminó en
verde.

**Dentro van 235, 236, 237, 238, 240, 241 y 246**, más el lote `ux` (#401). **La 239 NO iba: ya
estaba en producción** desde el 19 de agosto (PR #400) — verificado en la base, no supuesto.

### Lo que se verificó DESPUÉS de desplegar, contra la base de producción

| comprobación | resultado |
| --- | --- |
| migraciones aplicadas | **128 → 137**, exactamente las 9. **0 revertidas** |
| última | `20260820190000_orden_historial_origen_rechazo_tienda` |
| `orden.ayuda` (la que **se borra**) | **ya no existe** |
| `orden.fecha_reparto` (246) · `order_status.ayuda_tienda` (235) · `gestion_orden.confirmada_fisica_at` (238) | **los tres existen** |
| **órdenes totales** | **163 antes y 163 después** — el `DROP` no perdió una fila |
| errores de runtime nuevos | **ninguno del despliegue nuevo** (los 4 grupos vivos son del anterior) |

### La migración destructiva, re-medida el mismo día

Su cabecera avisaba de que la foto de agosto caducaba. Se re-midió antes de mergear:

| medida | valor |
| --- | --- |
| filas medidas | **163** |
| `ayuda IS TRUE` | **0** |
| `ayuda IS FALSE` | **163** |

**El cero no es de universo vacío:** 163 filas en `false` prueban que la columna se lee y que el
filtro discrimina. Y las 163 órdenes siguen ahí después del `DROP`.

### Y las re-mediciones de despliegue que las fichas exigían

| qué | valor | por qué importaba |
| --- | --- | --- |
| **cierres en cola** | **0** de 16 | la ventana nueva de la **238** no bloqueó a nadie |
| órdenes en el pre-estado · gestiones `devuelta` sin cierre | 0 · 0 | nada a medio anclar |
| asignadas después de las 18:00 CR | 3 de 33 | proxy del denominador de la 246 |
| gestiones deshechas | 8 de 66 (12 %) | coherente con lo medido para la 237 |

⚠️ **Producción se está usando como entorno de PRUEBAS**, así que estos números dicen lo que el
código hace, **no frecuencia operativa**.

### 🔴 Lo que los logs de producción destaparon, y NO es de esta release

**La optimización de ruta no corre en producción.** 23 errores en 24 h por
`GOOGLE_ROUTE_OPT_PROJECT_ID` ausente, en `/api/cron/procesar-jobs` y en
**`/mis-asignaciones/reparto`** — la pantalla del mensajero. El código **degrada solo y lo dice**
(«se usa el local»), así que nadie ve un fallo: el mensajero recibe un orden calculado por la
heurística local en vez de por Google. Las fichas **91 y 97 están en `done`** con la credencial sin
poner. **Ficha 251**, y su pregunta es para el humano: *¿debe estar configurada, o el fallback local
es lo querido?* No hay spec de la 97 que lo diga, así que **no se supone**.

---

## ✅ Cierre de la tanda — 2026-08-20

**Cinco fichas mergeadas en dos días, las cinco con revisión OK. Ninguna `in_progress`.**

| # | Qué | PR |
| --- | --- | --- |
| **235** | la ayuda a la tienda pasa de una bandera a un estatus propio | [#402](https://github.com/nuformecuador-lgtm/ordenex/pull/402) |
| **238** | aprobar el cierre exige tener los paquetes delante | [#404](https://github.com/nuformecuador-lgtm/ordenex/pull/404) |
| **236** | la ayuda tiene pestaña propia, y la tienda por fin lee el motivo | [#406](https://github.com/nuformecuador-lgtm/ordenex/pull/406) |
| **241** | investigación de las guardas de bloqueo retiradas | [#408](https://github.com/nuformecuador-lgtm/ordenex/pull/408) |
| **237** | la gestión que hace la tienda cuenta como del mensajero | [#410](https://github.com/nuformecuador-lgtm/ordenex/pull/410) |
| **240 + 246** | el rechazo manual deja de ser maqueta · elegir el día de la asignación | **#411** |

La **228** queda **superada** por la 236. La **74** se cerró **por auditoría**: ya estaba
implementada y la ficha llevaba semanas mintiendo.

### ▶️ Qué queda por implementar

| # | Qué | Estado |
| --- | --- | --- |
| **239** | la devolución espera al cierre | `done` — **«ver la app» HECHA el 2026-08-20**, ver `progress/recorrido_239.md`. Quedan abiertas T0.3 (avisar a integradores) y T6.4 |
| **247** | **el doble cobro del flete de devolución** | `pending` — **medido**: `1 de 16`, ₡2.486 a NUFORM. Dos cierres aprobados, seis días de diferencia, el mismo paquete |
| **248** | los errores de `/novedades` salen **mudos** | `pending` — la **feature 100 comparte el hueco idéntico** |
| **220** | e2e | `pending`, pero **su premisa está podrida**: 13 de 20 specs son `NOT EXECUTED` |
| **249** |  el chequeo del `down.sql` **existe pero solo avisa** | `pending` — **tres migraciones llevan seis días sin `down.sql` con el gate en verde**, y van cinco en dos semanas |
| **250** | el aviso al mensajero dice «Devuelta» cuando la orden está en «Devolución por confirmar» | `pending` — **salió del recorrido de la 239**: es la coincidencia resultado↔estado que esa ficha vino a romper, viva en un retorno al que no llegó |
| **251** | la **optimización de ruta no corre en producción**: falta `GOOGLE_ROUTE_OPT_PROJECT_ID` | `pending` — **preexistente**, 23 errores en 24 h; degrada al cálculo local **en silencio**. La pregunta (¿debe configurarse?) es **para el humano** |

### ⚠️ Antes de desplegar — acciones HUMANAS que se arrastran

- **238 / T0.3:** avisar a bodega de que **el gesto cambia**: aprobar exige tener los paquetes
  delante y escanear su guía.
- **Re-medir producción** antes de desplegar la **236**, la **237**, la **238** y la **246**. Las
  cuatro mediciones se tomaron con fichas todavía sin desplegar y **caducan al salir**.

### ⚠️ PRODUCCIÓN SE ESTÁ USANDO COMO ENTORNO DE PRUEBAS

Confirmado por el humano el **2026-08-20**, y hay que saberlo para leer cualquier medición de
`progress/medicion_*.md`. Los números **describen fielmente lo que el código hace** —un doble cobro
medido es un doble cobro real del código—, pero **no dicen frecuencia operativa**: un número bajo
puede ser «no pasa» o «nadie lo ha probado aún», y la base no distingue. Los importes cobrados de
más **no son dinero real de una tienda real**, por eso el defecto de la 247 se arregla **hacia
adelante** y no hay devolución que hacer. **El día que producción sea producción de verdad, todo
esto hay que re-medirlo.**

### 🧾 Los dos patrones que se repitieron en las cinco fichas

**Una suite verde no encuentra una maqueta.** La 240 destapó un botón que llevaba **desde el
2026-08-12** sin hacer nada, con **las tres capas de tests de esa superficie en verde** todo ese
tiempo. Una maqueta no rompe nada — por eso «ver la app» ha encontrado, en esta pila, un cierre
imposible de aprobar (238), dos defectos de card (235), un botón que siempre fallaba (237) y siete
textos rotos. Lo que no se mira, no está verificado.

### 📌 Una excepción a la regla 1, escrita para que no se convierta en costumbre

La 240 y la 246 corrieron **las dos `in_progress` en la zona `fullstack` a la vez y compartiendo
cinco archivos**. `CLAUDE.md` admite dos por zona **«siempre sin conflicto de archivos entre
ellas»**, así que esto fue una excepción. Salió limpio —cada edición lleva su ficha citada, ninguna
reescribió un archivo entero, y el gate completo lo confirma— pero **salió limpio porque se vigiló,
no porque la regla lo permitiera**. Si vuelve a hacer falta, que se decida a propósito y con la
misma vigilancia; y **el gate nunca en paralelo con un subagente que muta el árbol**, porque
entonces su veredicto no vale.

**Y marcar tareas por lotes miente.** Pasó en la 236 (T8), volvió a pasar en la 237 (recorrido
marcado hecho **parado en el paso 6 de 9**, y los tres que faltaban eran los de dinero) y la
revisión lo rechazó **con razón** las dos veces. En la 240 y la 246 las tareas quedan marcadas una a
una, con **cinco abiertas a propósito** y el motivo escrito al lado.

---

## ✅ AL DÍA — 2026-08-19, cierre. **EMPIEZA A LEER POR AQUÍ**

**Tres fichas mergeadas hoy, las tres con revisión OK y gate completo verde. Ninguna `in_progress`.**

| # | Qué | PR |
| --- | --- | --- |
| **235** | la ayuda a la tienda pasa de una bandera a un estatus propio | [#402](https://github.com/nuformecuador-lgtm/ordenex/pull/402) |
| **238** | aprobar el cierre exige tener los paquetes delante | [#404](https://github.com/nuformecuador-lgtm/ordenex/pull/404) |
| **236** | la ayuda tiene pestaña propia, y la tienda por fin lee el motivo | [#406](https://github.com/nuformecuador-lgtm/ordenex/pull/406) |

La **228** queda **superada** por la 236.

### ▶️ Qué sigue

1. **237** — la gestión de la tienda que cuenta como del mensajero. Hereda dos avisos escritos: la
   invariante «una orden en ayuda bloquea el cierre» es **falsa en las dos rutas de re-solicitud**, y
   la guardia de las siete listas **vigila pero no descubre** una octava.
2. **240** — el punto 12 del pedido («Habilitar» aparece donde no debía) y «Rechazar».
3. **241**, independiente.

⚠️ **La 237 y la 240 comparten `ACCIONES_POR_GRUPO`, `NovedadesModule` y `HabilitarNovedadResult`.
No en paralelo.**

### ⚠️ Antes de desplegar — dos acciones HUMANAS

- **238 / T0.3:** avisar a bodega de que el gesto cambia: aprobar exige tener los paquetes delante.
- **236 / T0.1 y 238 / T0.1:** **re-medir producción**. Las dos mediciones se tomaron con la 235 aún
  sin desplegar, y **caducan en cuanto salga**.

### 🧾 El patrón que se repitió las tres veces

**Ver la app encontró lo que la suite no**, en dos de las tres: un **cierre que no se podía aprobar
nunca** (238) y **dos defectos de card** (235). Y **la trazabilidad falló en las cuatro fichas
seguidas**: filas del mapa citando tests que no existen, y una bitácora publicando una salida que no
se reproduce. `vitest` **no falla** con un filtro que no casa nada — lo ignora en silencio.

Y **`dev` llegó rojo por tercera vez** con el merge de `ux` (#401). La causa de fondo sigue viva: un
PR en verde aquí **no dice nada de los tests**, porque el único check es un build.

---

## ✅ AL DÍA — 2026-08-19, noche (la 235 y la 238)

**Dos fichas mergeadas hoy, las dos con revisión OK y gate completo verde. No hay ninguna ficha
`in_progress`.**

| # | Qué | PR |
| --- | --- | --- |
| **235** | la ayuda a la tienda pasa de una bandera a un estatus propio | [#402](https://github.com/nuformecuador-lgtm/ordenex/pull/402) |
| **238** | aprobar el cierre exige tener los paquetes delante | [#404](https://github.com/nuformecuador-lgtm/ordenex/pull/404) |

### ▶️ Qué sigue

1. **236** — la pestaña propia de ayuda en `/novedades`. **Marca el reloj**: hasta que entre, la
   tienda ve la solicitud de ayuda bajo la pestaña «En devolución» y **no puede leer el motivo**.
2. **237** → **240**. La 237 hereda dos avisos escritos: la invariante «una orden en ayuda bloquea el
   cierre» es **falsa en las dos rutas de re-solicitud**, y la guardia de las siete listas **vigila
   pero no descubre** una octava.
3. **241**, independiente.

### ⚠️ Antes de desplegar la 238 — acción HUMANA (T0.3)

Avisar a bodega de que **el gesto cambia**: a partir del despliegue, aprobar un cierre exige tener
los paquetes delante y escanear su guía. La medición dice que **no bloquea** —0 cierres en cola el
2026-08-19— pero **esa foto caduca en cuanto un mensajero cierre su día**: re-medir justo antes de
desplegar, no antes de mergear.

### 🔴 `dev` llegó ROJO, y es la TERCERA vez

El merge del branch `ux` ([#401](https://github.com/nuformecuador-lgtm/ordenex/pull/401), 142
archivos) dejó en `dev` **tres tests money-critical de la 69 en rojo** y **dos migraciones sin
`down.sql`**. Los tres arreglos van dentro del PR de la 238, y están explicados ahí.

**La causa de fondo no está arreglada:** en este repo **un PR en verde no dice nada sobre los
tests** —el único check es el build de Vercel, que compila y migra pero no ejecuta la suite—. Antes
de mergear algo que conviva con features recién llegadas, hay que correr el gate **sobre el árbol
mergeado**, no mirar el estado del PR. Y al ramificar, **dar por hecho que `dev` puede estar rojo**:
si el gate sale rojo, comprobar si el rojo es tuyo antes de tocar nada.

---

## ✅ AL DÍA — 2026-08-19 (la 235)

**La 235 («ayuda a la tienda: estatus propio») está MERGEADA en `dev`** — PR
[#402](https://github.com/nuformecuador-lgtm/ordenex/pull/402), commit `32b4064f`, ficha en `done`,
39/39 tareas. La revisión la había **RECHAZADO** con 4 bloqueantes; los cuatro se cerraron:

| | qué era | cómo quedó |
| --- | --- | --- |
| **B1** | el corte de la noche no barría al mensajero que acababa el día en ayuda | cerrado en `db23911b`, censando las **siete** listas de «qué ocupa a un mensajero» y con guardia que las cruza |
| **B2** | la regla de dedicación de la 157 leía «sin carga» a quien lleva el paquete | ídem |
| **B3** | R35 pedía superficie de lectura para los dos roles y la tienda no la tiene | **reconciliado en el spec**: el propio `requirements.md` se contradecía (su «fuera de alcance» ya difería la pantalla de la tienda a la 236) |
| **B4** | `tasks.md` con 0/39 y trabajo abierto dentro | cerrado: **38/39**, con **T8.1 hecho de verdad** (ver abajo). La única sin marcar es T8.3 —gate completo y PR—, que no puede marcarse antes de correrse |

Y el último menor, **m4**: el rescate estaba apagado en pantalla para el mensajero bloqueado, contra
R25 — arreglado, con test que se sabe poner rojo.

### ▶️ Qué sigue, en orden

1. **236** — la pestaña propia de ayuda en `/novedades` y su card. **Es la siguiente y corre prisa**:
   hasta que entre, la tienda ve la solicitud de ayuda bajo la pestaña «En devolución» y **no puede
   leer el motivo**. Ver el aviso de despliegue de abajo.
2. **238** — confirmación física de los paquetes al aprobar el cierre. **No depende de ninguna** y ya
   tiene spec completo y decisiones firmadas: puede arrancar sin esperar a nadie, incluso en paralelo
   con la 236 (zona `fullstack`, y ahora mismo no hay ninguna `in_progress`).
3. **237** → **240**, en ese orden. La **237** hereda dos avisos escritos: la invariante «una orden en
   ayuda bloquea el cierre» es **falsa en las dos rutas de re-solicitud**, y la guardia nueva de las
   siete listas **vigila pero no descubre** una octava.
4. **241** — investigación de las guardas de bloqueo retiradas. Independiente, cuando toque.

### 🔀 ORDEN DE MERGEO Y DE DESPLIEGUE (cierra **T0.3** de la 235)

**235 → 236 → 237 → 240**, en ese orden. La **241** (investigación de las guardas de bloqueo
retiradas) es independiente y puede ir cuando sea. La **238** no depende de ninguna y puede arrancar
en paralelo, ya con spec completo y decisiones firmadas.

⚠️ **La 235 YA ESTÁ EN `dev`, así que la 236 marca el reloj.** Medido en pantalla el 2026-08-19: con
la 235 sola, la tienda ve la orden en `/novedades` con el chip «Ayuda solicitada» **bajo la pestaña
«En devolución»** y **sin ninguna forma de leer el motivo** que el mensajero escribió (su card no
tiene botón de notas). No es peor que hoy —hoy tampoco lo lee—, pero es una solicitud de ayuda cuyo
motivo la tienda no puede abrir. La 236 es la que le da pestaña, card y lectura del hilo.

### ⚠️ Aviso para la 237: la guardia nueva **vigila, pero no descubre**

La guardia de las siete listas de «qué ocupa a un mensajero» cruza los gemelos entre sí —que es donde
vivieron B1 y B2— pero su censo está **cerrado a mano** (`toHaveLength(7)`) y **no recorre el árbol**
buscando una octava. Sabe de las siete que alguien le declaró. Si la 237 abre una lista nueva de esa
familia, **la guardia no la va a encontrar sola**: hay que declararla. La red contra un *estatus*
nuevo sigue siendo el `satisfies Record<OrderStatusValue, …>` de los mapas exhaustivos.

### 👀 T8.1 — la app, vista

Se recorrió entero, con Playwright y los dos roles: el mensajero pide ayuda → la orden sale del
listado y del mapa → baja a su sección con los KPI **quietos** → hilo → «Recuperar»; y la tienda la
ve en `/novedades` y la rescata con «Habilitar». **Encontró dos defectos que la suite no veía** (el
chip de la card decía «En reparto», y la card llevaba «Pendiente de optimizar» contra R15), los dos
arreglados en esta misma tanda. Detalle completo, con el texto leído del navegador, en
`progress/recorrido_235.md`.


## AL DÍA — 2026-08-18, noche

> **Producción sigue sana y sin tocar**: `prod` en la release del 15-ago (PR #388), **cero errores de
> runtime en 3 días**. Todo lo de hoy está en esta rama, pendiente de PR.

**Lo que entró hoy**, en un solo PR (`feature/230-dinero-sin-centimos`):

| # | Qué |
| --- | --- |
| **227** | queda `done`, con el conteo del drop **medido contra producción** |
| **230** | **el dinero se pinta sin céntimos** — implementada, revisada y vista en pantalla |
| **232** | registrada: los céntimos dejan de EXISTIR (toca el dato) |
| **233** | registrada: el gate rápido no corre las guardias si los relacionados fallan |

**Gate completo `./init.sh` EXIT 0** sobre el árbol final: **1116 archivos, 14313 tests, 0 saltados,
282 s** (baseline de `dev`: 1115 / 14276 → +1 archivo, la guardia nueva, y +37 tests).

### 🔎 La 227 y su deuda con fecha de vencimiento

Entró por PR #390 desde otra sesión y su ficha quedó `in_progress` con el PR ya mergeado —**sexta**
vez—. Dentro vivía lo de siempre: la migración del drop de `orden_mensajero_meta.nota` es
**destructiva** y su cabecera dejaba el conteo de producción **PENDIENTE**. Medido: **4 filas en la
tabla, 0 con nota, 0 mensajeros**. El drop no pierde nada, y **no es un cero de universo vacío** — las
4 filas son de `marcar_luego` (feature 115), que la migración no toca.

### ⚠️ La próxima release NO es de cero migraciones

La base de producción va por `20260812120000_gestion_orden_pago` y le faltan **dos**:
`20260815120000_orden_nota` y el drop, **que borra una columna**. Entran solas con el deploy.

### 💰 La 230, y lo que costó de verdad

`₡1.234,56` → `₡1.235`, **redondeando** (no truncando) y **solo el dinero**. El formateador tiene un
**único punto de paso**, así que sus 128 consumidores no cambian: la superficie son **6 archivos de
producción**. El precio estuvo en otro sitio — **234 líneas de aserción reescritas en 36 archivos de
test**, releídas una a una.

**El redondeo va sobre el STRING, con acarreo manual.** No es preciosismo: `Number(`, `parseFloat(` y
`parseInt(` están prohibidos en el camino del dinero por tres guardias vivas, y este repo ya perdió un
céntimo por una conversión. Y va **antes** de agrupar los miles, que es lo que hace que `999,50` dé
`₡1.000` y no `₡1000`.

**Visto en pantalla, no solo en tests** (T6.3): Chromium real, **488 importes en 11 rutas, cero con
decimal**, con el cero **autocomprobado** — el mismo texto en formato viejo da 32 hallazgos. Los cinco
huecos de esa medición están declarados en `progress/impl_230_pantallas.md`, incluido el que importa:
el mensaje del tope **no llegó a renderizarse** porque no hay incidentes pendientes en local.

### ⏭️ Lo siguiente, en este orden

1. **Release `dev` → `prod`**, con gate completo sobre el SHA real y **consciente de las dos
   migraciones**, una destructiva.
2. **La 232** — la otra mitad de la 230, y la que tiene dientes: los céntimos dejan de existir en el
   **dato**. Medido contra producción: `orden.monto_cobrar` **34 de 139** (24 %),
   `wallet_movimiento.monto` 20 de 82, `wallet_tienda_movimiento.monto` 17 de 70, y **cero** en todo
   lo que se teclea a mano. Sus cuatro preguntas abiertas están en la ficha; la primera —qué se hace
   con los datos que ya tienen céntimos— son **saldos que ya se le deben a alguien**.
3. **La 233**, barata y del arnés: `test:rapido` es `test:cambiados && test:guardias` y el `&&`
   cortocircuita. Un gate rápido en rojo **no dice nada** sobre si las guardias pasan. Ojo al
   arreglarlo: cambiar `&&` por `;` taparía el exit code y volvería verde un gate rojo.
4. **La 228, desbloqueada** (dependía de la 227). Hasta que exista, el mensajero **no recibe ninguna
   señal** de que la tienda le escribió en el hilo nuevo.
5. **La 218** y **la 219**; luego **225** y **226**, frontend y baratas.
6. **La 216** sigue esperando una **decisión de marca**. No es técnico.

### ⚡ Dos sesiones en el mismo árbol: lo que costó

Otra sesión trabajó hoy en este mismo directorio (ficha **231**, caja de wallet). De ahí salieron
tres cosas que conviene no repetir:

- **Tomó el id 231 antes que yo**, así que lo que iba a ser la 231 es la **232**. Sexta colisión.
- **Un `reset` de su rama movió la mía por debajo.** Un commit mío quedó apuntando a `dev` sin las
  ediciones que yo daba por commiteadas: `feature_list.json` volvió a la versión de `dev`, con la 227
  otra vez `in_progress`. **Lo detectó comparar el BLOB commiteado, no el árbol** — `git show
  HEAD:fichero`. Verificar contra el árbol de trabajo no distingue «lo commiteé» de «alguien lo
  revirtió».
- **La 230 y la 231 chocan** en cinco archivos de test de wallet. Está escrito en las dos fichas.

### 🧠 Lo que este día enseñó

- **Una aserción que compara un texto contra la función que lo genera no comprueba nada.** Siempre
  está verde. Había **cuatro** así, y son las que dejaron pasar el defecto real de esta feature: un
  tope que anunciaba `₡10.000.000.000` mientras el validador rechazaba esa cifra. **Un máximo nunca
  se redondea al alza**: al alza deja de ser un límite.
- **La pareja invariante + literal es más fuerte que cualquiera de las dos.** El reviewer mutó el tope
  a uno *demasiado bajo* y la invariante **sobrevivió**; los literales cayeron. Cada red tapa el
  agujero de la otra.
- **Un cero hay que autocomprobarlo o no vale.** El detector de céntimos de la primera medición era
  **más estrecho que el requisito** —exigía dos dígitos, y R1 prohíbe cualquiera—, así que `₡1.234,5`
  se le habría escapado. Lo destapó el reviewer, no yo.
- **Ver la app encuentra lo que la suite no**, otra vez: el defecto del tope es un texto de pantalla
  que 14.000 tests dieron por bueno.

---

## ✅ AL DÍA — 2026-08-15, noche

> **La release SALIÓ y no hay nada a medias.** `prod` = `4b438f0c` (PR **#388**, deployment
> **READY**, **cero errores de runtime**), y `dev` no tiene **ningún** commit que le falte a `prod`.
> **0 features `in_progress`.** Sin PRs abiertos.

**Lo que entró a producción hoy** — tres features, 22 commits, **cero migraciones** (verificado, no
estimado: el árbol `db/` de `dev` y el de `prod` son idénticos, 116 en ambos):

| # | Qué |
| --- | --- |
| **215** | el reintento se cuenta en el cierre, con R19 ya ejecutado contra la base real |
| **224** | al imprimir, los tokens también son los claros (`--foreground` 1,19 → 15,70 en papel) |
| **229** | **rastreo público del envío**: el destinatario consulta su paquete **sin sesión**, desde un modal en la landing |

**La 229 llegó de otra sesión mientras se preparaba la release**, y su ficha quedó `in_progress` con
el PR #386 ya mergeado — el mismo patrón de la 213. Cerrada en el PR **#387**, con su entrada de
historia.

### 🔎 La medición que la 229 exigía ANTES de desplegar, y que se hizo

Su propia ficha llevaba escrita la deuda: la comprobación de órdenes **sin segundo factor
utilizable** estaba medida contra la base **local** (0 de 78), y decía «hay que REPETIRLA ANTES DE
DESPLEGAR». Se repitió contra **producción**, y con el criterio que aplica **el código** —no el de la
bitácora, que **omitía el caso «sin historial»**, que también responde `no_encontrado`—:

**141 órdenes vivas · 0 con teléfono de menos de 4 dígitos · 0 sin historial → las 141 son
rastreables** (137 con 8 dígitos, 4 con 12).

**No es un cero de universo vacío** —la lección de ayer, aplicada—: la mutación del umbral lo mueve,
con `< 12` el mismo conteo da **137**. G2 no deja hoy ninguna orden real fuera del rastreo.

### ⏭️ Lo siguiente, en este orden

1. **La 218**, desbloqueada desde ayer y ahora con la 215 **en producción**: el corte automático
   sigue sin sumar reintento en `sin_gestionar`. Comparte predicado con la 215.
2. **La 219** — es la otra mitad del mismo agujero: el 0 de R19 **caduca** en cuanto entre una orden
   en `devuelta`, y **nada lo vigila**. La 218 cierra el conteo; la 219 lo hace visible.
3. **La 225** (19 avisos a mano que repiten el par que arregló la 222) y **la 226** (el anillo de foco
   mide 1,30 contra el 3:1 de 1.4.11). Ambas frontend, ambas baratas.
4. **SIN FICHA, y ahora con un hermano nuevo:**
   - Los **seis tokens que EMPEORAN al imprimir desde oscuro** (`P1`–`P6`, el peor
     `--primary-foreground` 18,33 → 1,00 en 15 usos). Medido, con guardia y declarado en
     `app/globals.css:650`. Es decisión de **paleta**, emparenta con 216 y 210.
   - **Límite de intentos PERSISTIDO para el rastreo público.** Hoy el limitador vive **en memoria
     del proceso** (8 intentos / 10 min por IP): en serverless cada instancia tiene el suyo y cada
     despliegue los resetea, así que **acota al torpe, no al decidido**, y el segundo factor son
     10.000 combinaciones por guía. Es decisión firmada de la 229 (design §5.bis) y **ficha aparte
     desde el principio** — pero ahora está **en producción y de cara a internet**, que es lo que
     cambia su peso.
5. **La 216** sigue esperando una **decisión de marca** (un hex para el primario). No es técnico.

### 🧠 Lo que este cierre enseñó

- **El pre-vuelo de una release caduca en minutos, no en días.** El gate se corrió sobre `a145cab8`
  y, al ir a abrir la release, `origin/dev` ya era `d1039d10`: **5.140 líneas de otra sesión** habían
  entrado por PR #386 mientras corría. Un gate verde nombra **un SHA**, no «dev».
- **Una ficha `in_progress` con su PR mergeado no es un descuido cosmético.** Ocupa cupo de zona y,
  peor, **esconde deuda con fecha de vencimiento**: la medición contra producción de la 229 vivía
  dentro de esa ficha sin cerrar. Si la release sale sin mirarla, sale sin hacerla.
- **La deuda declarada por el implementer es una lista de tareas, no una nota al pie.** El punto (3)
  de la ficha decía literalmente «repetir antes de desplegar»; ejecutarlo costó dos consultas.
- **Al repetir una medición ajena, medir lo que hace el CÓDIGO, no lo que dice la bitácora.** La
  consulta original omitía el caso «sin historial», que devuelve la misma respuesta al cliente.
- **El gate completo se corre antes de cada PR aunque el diff sea prosa y JSON.** Los guards de este
  repo recorren el árbol y leen ficheros de estado: un cambio en `feature_list.json` o en un `.md`
  entra igual en su campo de visión que uno en `lib/`.

---

## ✅ AL DÍA — 2026-08-14, tarde

## 🟡 EN CURSO 2026-08-18 — feature **230**: la descarga de cierres, en general y en detalle

**Fase 1 (spec) lanzada.** `spec_author` escribiendo `specs/230-descarga-cierres-general-y-detallada/`.
No se creó rama: la fase de spec solo escribe en `specs/`, y el árbol está en `ux` con WIP ajeno
sin commitear por todas partes. La rama nace en F2.0, desde `dev`.

**Qué pidió el humano (2026-08-18):** «la descarga de datos de los cierres debe poder hacerse de
2 formas: general (como está) y detallada (por mensajero)».

**Punto de partida medido, no supuesto.** Hoy hay dos descargas de granos distintos y **ninguna
cruza cierres**:

- **General** — `cierres-admin-descarga-columnas.ts`: una fila POR CIERRE, dos declaraciones
  (cola de pendientes / histórico), cableada en `CierresAdminModule.tsx:195`. **Se conserva tal cual.**
- **Detalle** — `cierre-gestiones-descarga-columnas.ts`: una fila POR GESTIÓN, pero **cinco**
  archivos separados y solo alcanzables **abriendo un cierre concreto** (mapa
  `DESCARGA_POR_RESULTADO`, `cierre-detalle-shared.tsx:1018`). Ese es el hueco.

**Decisiones del humano en la gate F1.4 (cerradas, no se re-abren):** (a) grano = una fila por
gestión, no un agregado por mensajero; (b) **un solo archivo** con columna «Resultado»;
(c) el mensajero se elige con **diálogo propio**, no heredando el filtro de pantalla.

**⚠️ La (b) revierte la decisión P2 de la feature 170**, escrita en la cabecera de
`cierre-gestiones-descarga-columnas.ts` («no hay archivo único porque las cinco secciones no
comparten columnas... daría una hoja llena de celdas vacías»). El humano vio el ejemplo con los
huecos y aceptó el coste. La 170 **no se reescribe** y sus cinco descargas **no se retiran**: la
fundida es una salida adicional en otro punto de entrada. Sí hay que corregir esa prosa, que a
partir de ahora sería falsa.

**Lo que hace que esto NO sea pegar columnas — el riesgo real:** no existe camino de lectura que
cruce cierres. `CierreDetalleGestion` (`ICierreDiaService.ts:20`) y `CierreGrupos` (`:192`) son
**por cierre**. Falta ese borde entero, y de ahí sale la complejidad `medium`.

**Tensión que el spec debe resolver explícitamente:** el diálogo propio choca con la «puerta
única» de las features 134/184 (el dataset se construye por el mismo punto de entrada que pinta
la pantalla, nunca reconstruyendo el filtro). Lectura compatible propuesta: el selector recorta
DENTRO del alcance que el servicio resuelve desde la sesión (R44 de la 170, «el alcance NO viaja
en el input»), nunca lo ensancha. Si no se puede sin duplicar filtrado, el spec_author para y
marca sub-decisión.

**Preguntas que quedan ABIERTAS para la gate humana:** (1) la unión exacta de columnas de la hoja
fundida — 7 comunes + Mensajero + Resultado + las específicas de las cinco secciones sale muy
ancha; (2) desde dónde se lanza: ¿segundo botón en cierres-admin? ¿también en cierres de bodega,
que tiene su propio archivo de columnas y monta `DetalleSecciones` una vez POR mensajero?

**Nota de zona:** queda `fullstack` sin partir en backend+frontend. AGENTS.md > F1.0 dice que una
fullstack se parte en dos; la práctica reciente del repo no lo hace (227 y 229 fueron fullstack
enteras). Si se quiere partir, es antes de F2.0. Cupo verificado: `fullstack` tenía **1**
`in_progress` (la 227), y el máximo es 2.


### F2.0 — APROBADO por el humano (2026-08-18) y en implementación

**Worktree aislado `C:/w230`**, rama `feature/230-descarga-cierres-general-y-detallada` desde
`origin/dev` `9b627059`. Ruta corta a propósito (el límite de 260 chars de Windows revienta el
cliente de Prisma en rutas largas). El checkout principal sigue en `ux` con sus 47 archivos de WIP
ajeno **intactos**: no se hizo checkout ahí. `pnpm install` + `db:generate` hechos, y
**`pnpm typecheck` medido en VERDE sobre el worktree limpio** — baseline real, no supuesto.

`complexity` subida de `medium` a **`high`** por el leader: dos bordes, dos servicios, dos repos,
schema nuevo y diálogo con controles propios. Las 25 tasks van en 8 tandas, cortadas para poder
partir en dos PR (tandas 1-6, luego 7).

**Spec v2 aprobado:** R1–R52, 25 tasks, hoja fundida de **26 columnas**.

**El hallazgo del v2 que cambió el alcance —** los dos listados son **particiones DISJUNTAS**, no
dos vistas de lo mismo. `CierresAdminService.resolveAlcance:117-119` da al maestro
`{destinoTipo:"bodega_central"}` y `alcanceWhere` (`CierresAdminRepository.ts:353-358`) filtra
SIEMPRE por `destinoTipo`; enfrente `consolidablesWhere` (`CierreBodegaRepository.ts:150`) exige
`DESTINO_SATELITE`. **Verificado por el leader contra el código**, no aceptado de palabra. Un cierre
con destino central NUNCA entra en un cierre de bodega, y el maestro en `cierres-admin` **solo ve la
GAM**. De ahí los DOS bordes de lectura (design §2.6; el borde único quedó descartado en §9.9), y de
ahí que el «incluida GAM» del pedido fuera literalmente exacto: ningún botón solo cubre todo.
GAM no es un eje aparte: es la zona `esCentral` (renombrada desde `es_gam` por la 54) y entra sola
por el `destinoTipo`, sin ningún `if` (R27, verificado por grep en T7.5b).

**Cesión declarada, no disimulada:** con Q3 = independiente, **R2 de la feature 134** («el archivo es
lo que la pantalla enseña») **NO se cumple**, por decisión del humano. Siguen sin excepción: fuente
única, alcance desde sesión con `AND`, lista blanca `.strict()`.

**Consecuencia forzada de Q3+Q5:** sin heredar fechas, el conjunto por defecto sería todo el
histórico y el tope de 5000 reventaría casi siempre → el diálogo lleva controles PROPIOS de fecha
(R31/R32). Sin ellos la feature sería un botón que solo sabe fallar.

**Orquestación:** directa del leader (`backend_dev` -> `frontend_dev` -> `reviewer`), no el
`implementer` monolítico, que muere por el bug de modelo. Backend lanzado con tandas 1, 2 y 7.1-7.3;
la UI (tandas 3, 4, 5, 7.4) va después, en otro agente.

**Follow-up abierto, no bloqueante:** el diálogo ofrece TODOS los mensajeros en las dos pantallas,
así que elegir uno de la partición equivocada devuelve «no hay datos» sin decir por qué. Acotar cada
diálogo a su partición obliga a ampliar el catálogo, que hoy no distingue `destinoTipo`.

**⚠️ Deriva de bookkeeping detectada (no es de esta feature):** la **227** figura `in_progress` en
`feature_list.json` pero su PR **#390 ya está mergeado en `dev`** (`git branch -r --merged origin/dev`
lo confirma). Debería ser `done`. No lo cambio yo por no pisar el bookkeeping de otra sesión, pero
mientras siga así, `fullstack` aparenta tener 2 `in_progress` cuando de verdad tiene 1.


## ✅ AL DÍA — 2026-08-14, tarde. **EMPIEZA A LEER POR AQUÍ**

> Lo de abajo (el cierre de jornada) **ya no describe el presente en dos puntos**, y se conserva
> entero porque su razonamiento sigue valiendo. Lo que cambió:
>
> - **La release SALIÓ.** PR **#381** (`dev → prod`, 109 commits, cero migraciones), mergeado y
>   **desplegado en producción** (`31c36d61`, deployment `READY`). **Cero errores de runtime en 24 h.**
>   Ya no hay ninguna decisión humana esperando. `dev` va 4 commits por delante de `prod`: sólo el
>   chore #382 de la deuda de la 215.
> - **La 215 está `done`.** Se cerró corriendo **R19** contra la base real de producción — lo único
>   que le faltaba. **R18 y R34 no eran deuda** (el código los cumple, verificado el 14-ago) y **R24
>   se cerró** declarando la deriva con fecha de corte, así que el punto 6 de «Lo siguiente» estaba
>   caducado en sus tres cargos. Detalle en `progress/impl_215_r19.md`.
>   - Resultado: **0 en las nueve columnas**, y **el cero es de universo vacío** — 141 órdenes vivas
>     en la base, pero ninguna en `devuelta` hoy. **Nadie fue cobrado antes de tiempo.** El número
>     **caduca** en cuanto entre una orden, y **nada lo vigila**: eso es la ficha **219**.
>   - **La 218 queda desbloqueada**: su condición era «no arranca hasta que la 215 esté mergeada».
> - **La 224 también está `done` y mergeada** (PR **#384**). Tres rondas de revisión y **33
>   mutaciones** (19 letales rojas, 14 inocuas verdes). **La ficha enunciaba la contradicción AL
>   REVÉS y se corrigió**: detrás de `.dark` también gana; lo que lo prohíbe es el **lector de tokens
>   de los tests**, no la cascada. El problema real era la **especificidad** (`.dark` 0-1-0 empata y
>   pierde por orden; `html .dark` 0-1-1 gana esté donde esté), medido en Chromium sobre **la hoja
>   real compilada**. Y eran **35** declaraciones, no 34.
>   - Compra lo que prometía: `--foreground` en papel **1,19 → 15,70**, y con «gráficos de fondo»
>     marcado las insignias **1,70 → 4,84**, que era el precio que la 221 dejaba pagado.
>   - **Lo que NO compra está declarado y es ejecutable**: `--destructive` 3,76 y `--primary` 3,18
>     siguen bajo AA (paleta, 210/216), y **seis tokens EMPEORAN** al imprimir desde oscuro
>     (`P1`–`P6`; el peor `--primary-foreground` **18,33 → 1,00** en 15 usos). **Sin ficha todavía**
>     — ver «Lo siguiente».
> - **Gate completo verde tres veces** el 14-ago, con el baseline **remedido y no citado**: sobre
>   `dev` limpio (1096/1096 archivos, 14044/14044 tests, 301 s), sobre la rama de la 215
>   (1096/1096, 14044/14044, 349 s) y sobre el árbol de la 224 **ya mergeado con `dev`**
>   (**1097/1097, 14093/14093**, 0 saltados, 283 s). Los tres exit 0.

### 🧠 Lo que la tarde enseñó, y no estaba en el cierre de la mañana

- **Un cero sobre un universo vacío no es un resultado: es una consulta sin sujeto.** R19 salió 0 en
  las nueve columnas, y la mitad del trabajo fue **demostrar por qué**: 141 órdenes vivas, ninguna en
  `devuelta` **ni contando las borradas**, y 11/8/32 de materia en el dominio. Sin esos cuatro
  controles, ese 0 es indistinguible de un `JOIN` que no casa. Y el número **caduca**: se escribió
  con su fecha de caducidad dentro, igual que había caducado el 0 de `160/D7`.
- **Una afirmación falsa puede quedar ATORNILLADA por un test verde.** La guardia F4 exigía
  `toContain("1.19 → 11.39")`: la frase del CSS no se podía corregir **sin poner el test rojo**. Un
  pin de prosa protege de que alguien la borre, y a la vez la fosiliza cuando deja de ser cierta.
  Al pinear una frase, pinear también **lo que la hace verdad**.
- **Los defectos ENCAJADOS sobreviven a los barridos.** F4 escapó a un barrido que sí cazó a sus dos
  hermanas porque tenía **dos**: estaba mal clasificada (como «paleta fija») **y** medida con el
  lector ciego. Cada uno solo se ve; juntos se tapan.
- **Un arreglo puede abrir el agujero que el arreglo anterior cerró.** Al cambiar una lista escrita a
  mano por una **derivada**, el caso central pasó a poder cumplirse **por vacuidad**. La
  anti-vacuidad va **dentro** del caso: uno que necesita que otro se ponga rojo para no mentir,
  miente igual si lo corren solo.
- **La mutación INOCUA volvió a ser la que encontró algo**, dos veces: destapó que la guardia
  rechazaba una implementación igual de correcta, y que una «inocua» mal elegida no lo era.
- **El gate de un worktree recién creado NO es el gate.** `./init.sh` salió rojo con 3 tests y **240
  saltados** en `C:/w224`: faltaba el `.env`, y `prisma migrate diff` no podía derivar el DDL. Con
  `.env`, ese archivo da **62/62**. Lo correcto lo hizo la guardia: **falló en vez de saltarse**.
  Antes de leer un rojo de worktree como regresión, comprobar `.env` y el recuento de saltados.
- **Medir en el CSS fuente no es medir.** La contradicción de la 224 sólo se resolvió mirando **la
  hoja compilada** en el navegador: el fuente no dice quién gana la cascada.

---

## 🏁 CIERRE DE JORNADA 2026-08-14

### 🚦 ~~Lo único que espera decisión humana: **la release a `prod`**~~ — **HECHA, ver arriba**

**95 commits, y CERO migraciones** — no es una estimación: el árbol `db/` de `dev` y el de `prod`
son **idénticos byte a byte** (116 migraciones en ambos), así que mergear **no aplica nada** contra
la base. La última que se desplegó fue la de la 212, en la release #359.

Lleva **206** (anulación agrupada), **209** (un solo quitador de comentarios), **210** (contraste de
insignias), **213** (pago múltiple en pantalla), **215** (el reintento se cuenta en el cierre),
**217** (la factura gira con el tema), **221** (`dark:` no dispara al imprimir), **222** (el botón
destructive cumple AA) y **223** (la factura se imprime entera).

Lo que un usuario nota de inmediato: **puede cobrar una entrega con varios métodos**, y **la factura
del cierre ya no sale recortada ni en blanco sobre negro al imprimirla**.

### ✅ Lo que salió de esta jornada

| | Qué |
| --- | --- |
| **El rojo de `dev`** | cerrado. Y la disyuntiva que la nota planteaba —«¿implementar R24 o cambiar el test?»— **era falsa: era la semilla** |
| **209** | cerrada. 7 quitadores migrados **sin mover un veredicto**, 9 falsos positivos cerrados, y 2 semánticas que el censo no podía ver |
| **217** | la factura gira con el tema, con inventario **cerrado** de 26 pares y la grieta declarada en tres sedes |
| **221** | el variant `dark:` deja de disparar al imprimir; 4 pares de paleta fija mejoran de 1,87 a 3,18-11,39 |
| **222** | el botón `destructive` cumple en los **cuatro** estados — el peor era el **hover**, y no estaba en la ficha |
| **223** | la factura se imprime entera y sólo la factura, **sin una línea de JavaScript** |
| **Bookkeeping** | la **213** llevaba `in_progress` con su PR mergeado: la única tarea sin marcar era **su propio bookkeeping**, y ocupaba un hueco de la regla de zona |
| **Fichas nuevas** | **221**, **222**, **223** (las tres implementadas hoy) y **224**, **225**, **226** registradas con su medición dentro |

### ⏭️ Lo siguiente, en este orden

1. ~~**Decidir la release**~~ — **HECHA**: PR #381, en producción y sin errores de runtime.
2. ~~**La 224**~~ — **CERRADA y mergeada el 14-ago** (PR #384). Ver arriba.
2b. **SIN FICHA TODAVÍA, y es lo primero de la cola:** los **seis tokens que EMPEORAN al imprimir
   desde oscuro** que destapó la 224 (`P1`–`P6`; el peor, `--primary-foreground` **18,33 → 1,00** en
   15 usos: tinta blanca sobre un fondo que la impresora no pone). Está **medido y con guardia
   ejecutable** en `impresion-tokens.guardia.test.ts`, y **declarado** en `app/globals.css`, pero
   **nadie lo reclama**. No se arregla dentro de la 224 por una razón de fondo: el papel **iguala al
   tema claro por construcción** —el bloque espeja los 35 tokens hex a hex—, así que darles un valor
   propio rompería ese espejo y dejaría el papel de «oscuro» **mejor** que el de «claro». La
   decisión de fondo es de **paleta**, y emparenta con la 216 y la 210.
3. **La 225** — 19 avisos hechos a mano en 15 archivos repiten el par que la 222 arregló. Decidir al
   empezar si van a un componente compartido o sólo se les cambia el par; lo segundo reabre la ficha.
4. **La 226** — el anillo de foco mide 1,30 contra el **3:1** que pide 1.4.11. No es estética: es la
   señal de dónde está el teclado.
5. **La 216** sigue esperando una **decisión de marca** (un hex para el primario). No es técnico.
6. ~~**La 215** sigue `in_progress` con R18/R19/R24 abiertos~~ — **CERRADA el 14-ago**: R18/R34 no
   eran deuda, R24 se cerró declarando la deriva, y **R19 se ejecutó** contra producción. Ver arriba.
7. **La 218**, recién desbloqueada: el corte automático sigue sin sumar reintento en `sin_gestionar`.
   Comparte predicado con la 215, que ya está en `prod`.

### 🧠 Lo que esta jornada enseñó, y conviene no re-aprender

- **La misma enfermedad apareció CINCO veces, y una en código escrito el mismo día que se erradicó.**
  Un censo que lee **prosa como si fuera código**: los 9 quitadores de la 209, la guardia de R15 de
  la 217, el docstring que prometía más que su mecanismo, y el parser de CSS que aplicaba el
  quitador de TypeScript. La 209 la cerró por la mañana y por la tarde reapareció en la 217.
- **Un censo mide la forma que sabe buscar, no el fenómeno.** El de la 209 buscaba regex, y las **dos
  peores semánticas del árbol** estaban escritas con `split`/`filter`. El detector ancho dio 12
  falsos positivos de 17 — y encontró las dos que importaban. **Ancho + triaje a mano** es lo único
  que ha funcionado las dos veces que se ha intentado.
- **«Un total que se mueve es un hallazgo» sólo vale si el total es el que la guardia AFIRMA.** Los
  siete quitadores de la tanda B se apartaron por un derivado intermedio que se mueve **por diseño**.
  No había ningún veredicto que dar.
- **Tres mutaciones salieron VERDES y eran las mutaciones las que estaban mal**: la que la bitácora
  de la 217 daba por roja no podía ocurrir, la del spec de la 223 dejaba la página en blanco, y una
  con `querySelector("main")` devolvía `null` y sus veinte verdes no significaban nada. **Una
  mutación inerte reportada en verde es indistinguible de una guardia que no muerde**, y la única
  defensa que funcionó fue **plantarla uno mismo** y exigir su **variante inocua**.
- **Medir antes de especificar volvió a cambiar el encargo, dos veces más.** En la 217 no existía
  **ninguna** vía de impresión en el repo, así que la regla del papel blanco hubo que **crearla**;
  y el medidor que el spec daba por inexistente **sí estaba commiteado**, dentro de una guardia y sin
  exportar.
- **El CSS de un spec aprobado puede estar roto, y sólo lo dice medirlo**: el de la 223 imprimía una
  página **en blanco** —PDF de 652 bytes—. Leerlo no bastaba.
- **Cuando una decisión humana va contra la recomendación, la objeción que la motivaba NO desaparece:
  hay que resolverla.** La hoja compacta imprimible obligó a inventar el mecanismo de candidatura, y
  salió **sin una línea de JavaScript**.
- **Los backticks en un `-m` inline, y dentro de `node -e`, los ejecuta el shell antes de que nadie
  los lea, y se comen el texto EN SILENCIO.** Pasó **dos veces hoy**, y la T18 de la 213 ya lo tenía
  escrito. Usar `-F -` con heredoc citado, siempre.
- **El registro se desincroniza en la dirección que nadie mira**: la 213 estaba mergeada, aprobada y
  desplegada, y su ficha decía `in_progress` porque **su propia tarea de bookkeeping** era la única
  sin marcar. Y con ella ocupaba un hueco de la regla de max-2-por-zona.

### 🧾 Deuda declarada hoy, toda con ficha o con número

- **224**, **225** y **226** (arriba), las tres con su medición dentro.
- El **harness de impresión** de la 223 se borró a propósito → ficha aparte.
- **Gecko y WebKit no están medidos** en la 223; sólo Chromium.
- La **grieta del inventario** de la 217 —recombinar una tinta y un fondo ya declarados— no la caza
  nada, **por decisión**: cerrar por par exige recorrer el JSX y eso aprueba con números falsos.
  Verificada con una mutación de **control que sale verde a propósito**.
- Las **pestañas no visitadas** y el **KPI animado** de la factura llevan su límite escrito.
- La 215 deja **R19** (una consulta de medición a la que le falta una condición, y gobierna dinero),
  **R28** en 3 sitios y **R24-b/c/d + R35** sin guardia que los sostenga.

---

## 🏁 CIERRE DE JORNADA 2026-08-13

### ✅ EL ROJO DE `dev` ESTÁ CERRADO (2026-08-13, tarde) — **medido, no supuesto**

> Este bloque abría diciendo «`dev` está ROJO» y que era la primera decisión humana pendiente.
> **Ya no hace falta decidir nada: cayó en el PR #367** (`7205b2a1`). Dos sesiones lo comprobaron
> por caminos distintos: desde la rama de la 213 al remergear `dev` para el PR #368
> (`analytics-daily-job.test.ts` pasa **29/29**), y con el gate completo que se detalla abajo.
>
> **Se arregló por el lado correcto**, que era la mitad de la pregunta: el assert **sigue esperando
> `[1, 0]`**. No se tapó cambiando la expectativa al criterio nuevo.
>
> ⚠️ **Matiz que conviene fijar, porque la primera redacción decía otra cosa: NO se implementó el
> R24.** Lo que cayó fue **la semilla** (ver abajo). El R24 se cerró **declarando la deriva** con
> fecha de corte (Q10, `e811e7bf`), que es una decisión documental, no el KPI persistido en
> `analytics_daily` — la ficha 215 lo sigue listando entre lo NO implementado, y por eso sigue
> `in_progress`. Que el aviso de la deriva no llegue a la pantalla es la ficha **219**.
>
> Lo que sí sigue en pie es el párrafo del peaje: el rojo vivió **seis merges** sin que nadie lo
> parara, y eso no lo arregla ningún PR.

`tests/integration/db/analytics-daily-job.test.ts > primer intento vs entrega tras una devolucion
previa (R17)` llevaba seis merges rojo en `dev` limpio. Lo cierra el **PR #367** (feature 215),
mergeado en `4f8e5362`.

**Y la disyuntiva que esta nota planteaba —«implementar R24 o actualizar el test»— era falsa: era la
semilla.** El fixture describía el mundo viejo. Con el criterio nuevo una devolución solo cuenta
como intento si su gestión pertenece a un **cierre aprobado**, y la semilla la creaba sin cierre. Se
corrigió ahí (`crearCierreAprobado`, y un `cierreId` opcional con default `null` en `crearGestion`,
que no toca los ~15 call-sites). **Las dos cifras que prueban que el KPI distingue un reintento de
un primer intento siguen literalmente intactas** (`[1,0]` y `[1,1]`): no se relajó ninguna aserción.

**Verificado desde esta sesión, y conviene saber cómo:** el rojo se reprodujo primero sobre `dev`
limpio (`expected [1,1] to deeply equal [1,0]`); luego se reconstruyó el merge real —la rama iba
**11 commits por detrás**— y se corrió `./init.sh` completo sobre ese árbol: **1087/1087 archivos,
13.776/13.776 tests**, cero omitidos, 275 s, exit 0. `dev` se movió mientras corría (la otra sesión
mergeó el #367), así que **se comparó el árbol**: el medido y el de `dev` son el **mismo objeto**
(`e5b8936c`). Por eso el verde certifica el `dev` publicado y no una aproximación suya.

> ⚠️ **Lo que el #367 NO cierra, y estaba solo en el cuerpo del PR:** `R19` (la consulta de medición
> de `design.md §7.6` contra la base real — el reviewer avisa de que **le falta la sexta condición,
> la visita real**, así que hoy sobreestimaría, y gobierna dinero); `R28` incumplido en 3 sitios,
> con el comentario de `GestionOrdenRepository.ts:505` afirmando algo **hoy falso**; y `R24-b/c/d` +
> `R35` **sin dueño ejecutable** — la guardia de prosa que `tasks.md` les asigna no existe, así que
> las tres declaraciones se pueden borrar sin que nada se ponga rojo. La ficha **215** sigue
> `in_progress` justamente por esto; no darla por cerrada.

### ✅ Lo que salió de esta jornada

| | Qué |
| --- | --- |
| **Release #359** | desplegada **y verificada**: la migración `gestion_orden_pago` aplicada en prod a las 15:12:20 con las **16 filas** que predijo el pre-vuelo, `gestion_orden` intacta, 0 errores de runtime |
| **205** | el **diálogo de pago se vio en pantalla** por fin, recorriendo el flujo real (no SQL a mano) |
| **210** | contraste de insignias, **con guardia nueva** que calcula contraste desde los tokens del CSS |
| **206** | anular un reparto entero en un acto, **y visto en pantalla** (`progress/impl_206_visto.md`) |
| **209 tanda B** | 48 de 57 quitadores al helper compartido; **7 no pueden** y ahí está el hallazgo |
| **Auditoría de tema** | 11 rutas nunca medidas + pasada de hover (`progress/impl_210_auditoria-tema.md`) |
| **Bookkeeping** | **212** y **196** estaban mergeadas/desplegadas y seguían abiertas en el registro |
| **Fichas nuevas** | **216** (naranja de marca) y **217** (factura oscura), las dos con su medición dentro |
| **70** | **medida antes de especificar: es PREVENTIVA hoy**, y filtrar `status` no es la opción segura |

### ⏭️ Lo siguiente, en este orden

1. ~~Decidir el rojo de `dev`~~ — **hecho** (arriba). Ya no bloquea la lectura de nada.
2. **Los 7 quitadores** de la tanda B, uno a uno. Media faena hecha: el mecanismo está identificado
   y la lista está en la ficha 209. Cada uno es una pregunta contestable — ¿el conteo nuevo es el
   correcto, o el ancla era legítima? **Empezar en frío**: son siete veredictos de guardias de
   dinero y analítica, y el modo de fallo es cambiarlos sin mirarlos.
3. **La 217** (factura oscura): aprobada por el humano, sin spec. Ojo a la regla que debe honrar:
   **al imprimir, la hoja sigue blanca**.
4. **La 216** espera una **decisión de marca** (un hex para el primario, o pasar el texto a un
   `-strong` propio). No es un arreglo técnico.
5. **El PR #368 (la 213)** está abierto y sin revisar: 34 archivos, del otro programador, y va
   **11 commits por detrás de `dev`**. La **214 sigue bloqueada** hasta que la 213 esté
   **desplegada**, no mergeada.

### 🧠 Lo que esta jornada enseñó, y conviene no re-aprender

- **Un verificador que rellena lo que no sabe no es optimista: es FALSO.** El medidor de contraste
  mintió **tres veces**, siempre igual —ante un dato irresoluble, inventaba uno—: dio un falso
  **1,80 sobre una cifra de dinero** y un falso **1,00 sobre un botón legible**. La causa raíz era
  que Chromium devuelve **`oklab()`** para las opacidades de Tailwind v4. Toda capa que no se pueda
  resolver tiene que degradar a «no lo sé», nunca a un valor plausible.
- **El compilador censa mejor que un grep.** Retirar una variante de `Badge` pareció tocar 2 sitios
  y eran **11**: los otros nueve calculan la variante desde un mapa, y un grep con forma de JSX no
  los ve. El typecheck los dio todos.
- **Los guardias que te frenan suelen tener razón.** Tres de la 172 rechazaron que el `repartoId`
  cruzara la frontera, y el arreglo salió **mejor** que el original: viaja un booleano y el servidor
  deriva el grupo, así que el cliente ya no puede nombrar un reparto ajeno.
- **Cuando una guardia congela lo contrario de lo que vas a hacer, se REEXPRESA, no se relaja.**
  Cinco guardias afirmaban que nada podía deshacer un reparto; anular no es editar ni borrar, y eso
  hay que escribirlo en cada una.
- **No mutes trabajo sin commitear.** `git checkout` revierte tu arreglo, no la mutación. Pasó una
  vez y el arnés de mutaciones ahora **aborta si `git diff` no ve el cambio**.
- **Un PR mergeado deja huérfano lo que empujes después.** Pasó **dos veces**: commit en una rama con
  PR cerrado, fuera de `dev` y sin ninguna señal. Los dos rescatados por cherry-pick. **Comprobar el
  estado del PR antes de empujar.**
- **Medir antes de arreglar volvió a cambiar el resultado**: la 70 es preventiva (0 tarifas
  inactivas) y **filtrar `status` convertiría un cobro equivocado en un cobro CERO**, porque cada
  tienda tiene una sola tarifa.

### 🧪 Estado de la base LOCAL (nada de esto toca producción)

Contraseñas QA —incluida la del **maestro**, que tiene su propio seed— alineadas con el `.env`. Dos
cierres aprobados del 13/08 (pendientes ₡3.400 y ₡1.700, luego repartidos y anulados), un reparto de
₡4.000 anulado entero y otro de ₡1.400. El **maestro no entra por UI**: su OTP lo dispara un
RiskEngine por score y el código se guarda **hasheado**, así que `mi-wallet`, `recepcion-satelite`,
`configuracion/*` y `novedades` quedaron **sin medir** en la auditoría de tema.

---

## 🏁 2026-08-13 (tarde) — release #359 y la 205 vista en pantalla

### 🚦 Lo único que espera decisión humana: **[PR #359](https://github.com/nuformecuador-lgtm/ordenex/pull/359) → `prod`**

14 commits, y **ya NO es «sin migraciones»**: la 212 metió `20260812120000_gestion_orden_pago`,
aditiva y con backfill. La nota de la mañana decía «7 commits, sin migraciones» y **caducó** —
`dev` se movió mientras se leía (otra sesión mergeó la 212, PR #358).

Lleva **208** (modo oscuro correcto), **211** (interruptor de tema), **209 tanda A** y el
**backend de la 212**. Lo único que un usuario nota de inmediato es el tema.

**Pre-vuelo hecho, medido contra la base de producción en solo lectura:** la tabla no existe
allí, el enum `metodo_pago_value` y `gen_random_uuid()` sí, la última migración aplicada es la
de la 205 (**sin drift**), el backfill insertará **16 filas de 57 gestiones**, y hay **0 filas
con `monto_recibido = 0`**. Ese último número acota el riesgo declarado: el cambio a guion de la
entrega «sin cobro» **no reescribe nada ya registrado**; solo afecta a entregas sin cobro nuevas
hasta que entre la 213. Gate completo verde sobre `dev` @ `bb4c3185`: **1086/1086 archivos,
13662/13662 tests**, cero omitidos.

> ⚠️ El typecheck dio un rojo **falso** primero (`gestionOrdenPago` no existe en `PrismaClient`):
> cliente Prisma rancio tras el merge. `pnpm run db:generate` y verde. Tras mergear hay que
> aplicar la migración en local (`prisma migrate deploy`), ya hecho aquí.

### ✅ El diálogo de pago de la 205 **se vio en pantalla**, con datos reales

Era el punto 1 de «lo que falta» y llevaba dos sesiones pendiente. No se fabricó por SQL: se
recorrió **el flujo real completo** — asignar 2 órdenes GAM → recogerlas → entregarlas **cobrando
por SINPE** (para que el efectivo quede en 0) → solicitar cierre → aprobarlo como admin. El
cierre salió con **E = ₡0, P = ₡3.400**, así que `min(P,E) = 0` y la cuenta por pagar nació
positiva. Lo que se vio, citando el texto de la pantalla:

- La fila pasa de «Al día» a **«Pendiente ₡3.400,00»**, y el panel de desglose muestra
  **«Se puede pagar ahora ₡3.400,00 — sale del servidor»** más el libro con **«Ver el cierre»
  por fila** (el enlace que faltaba comprobar).
- El **diálogo**: «Registrar pago a Marco», *Disponible ₡3.400,00*, con el monto **precargado al
  total** y la **previsualización**: «Cierre del 2026-08-13 · Se aplica ₡3.400,00 · Pendiente hoy:
  ₡3.400,00 · Queda pendiente: ₡0,00».
- Con un **pago parcial** de ₡1.400 la previsualización recalcula en vivo y aparece la insignia
  **«Pago parcial»**: «Queda pendiente: ₡2.000,00». Registrado: la tabla queda en 13.600 / 11.600
  / **2.000**, aritmética exacta.
- En la base: `liquidacion_pago` con su `reparto_id`, **`liquidacion_reparto` con monto ₡1.400 y 1
  imputación** —primera vez que la tabla de la migración de la 205 se ejerce desde la pantalla— y
  el libro con un movimiento `pago`/`liquidacion`/`pago_mensajero`, la categoría que el esquema
  tenía **reservada** para esto.

**Lo único que sigue sin verse: el aviso de excluidos.** No es alcanzable con un solo cierre
pendiente: hace falta un cierre que NO se pueda imputar. Queda dicho, no tapado.

**La base local quedó con ese caso vivo a propósito** (Marco con ₡2.000 pendientes): la 213 y la
214 van a necesitar la pantalla alcanzable.

### 🔧 Tres cosas de la receta de conducir la app que costaron y no estaban escritas

1. **La entrega no se envía sin permiso de ubicación.** `handleConfirm` pide la posición
   (feature 193/R16/R19) y si el desenlace es `denegado` **no manda ni un POST**. En Chromium
   headless viene denegado por defecto: el click «no hace nada» y no hay aviso que lo explique.
   Hay que abrir el contexto con `permissions: ["geolocation"]` y una `geolocation` fijada.
2. **La foto de evidencia es obligatoria** en `entregada` (feature 119, una lista vacía dispara
   `min(1)`), y también frena el envío en el cliente. Se generó un PNG válido con zlib+CRC32 en
   vez de pegar un base64 de memoria.
3. **Asignar exige lat/lon** (feature 92/R2) y **aborta el LOTE ENTERO** si una sola orden no las
   tiene (R8). Las 67 órdenes locales tienen `geocode_status` NULL y **no hay proveedor de
   geocodificación en local**, así que solo son asignables las que ya traen coordenadas: de las 3
   candidatas, 990013 no las tenía y tumbaba las otras dos.

**Y un aviso: se rotaron las contraseñas de los 4 usuarios QA en la base LOCAL** con
`scripts/seed-usuarios-qa.ts`, porque el hash guardado no coincidía con `QA_PASSWORD` del `.env`.
Ahora coinciden con lo que el `.env` ya decía. Idempotente, no toca ids ni relaciones.

### 📌 Lo que queda, con el orden actualizado

1. **Mergear la #359** (o decidir esperar a la 213 para no soltar el guion de «sin cobro»).
2. **Ficha 213** — el frontend del desglose. La 212 entregó capacidad sin superficie y la **214
   está bloqueada hasta que la 213 esté desplegada**, no mergeada.
3. **Ficha 210** (contraste de `warning`/`destructive`) · **206** (anular un reparto entero) ·
   **209 tanda B** (50 sitios, sin riesgo).
4. El **aviso de excluidos** de la 205, cuando exista un cierre no imputable.

## 🟡 EN CURSO 2026-08-13 — feature **213** (antes 209): captura y presentación del pago múltiple, fase 2 (implementación)

**PUERTA F1.4 SUPERADA el 2026-08-13.** Spec aprobado: 35 requisitos EARS, 18 tasks en 6 tandas,
trazabilidad `R → test` 35/35. Las seis preguntas del spec se cerraron con la propuesta que traían
—monto crudo en el CSV, etiqueta sola en la fila de un método, guardia `columnas-sensibles`
ampliable midiendo totales, monto pre-cargado, e2e roto como deuda aparte, fila a medias = error
visible— y viven completas en `specs/213-pago-multiple-captura/requirements.md`.

**[Q7], la que abrió el humano en la puerta y conviene no re-descubrir: el total cuadra EXACTO, no
«igual o superior».** La pregunta era si el desglose podía sumar *más* que el valor a cobrar. La
respuesta la da el código, en tres capas: `MisAsignacionesService.ts:349-363` (R22-h) exige
`montoRecibido == montoCobrar` en `Prisma.Decimal`; la 212 exige `SUM(pagos) = montoRecibido`; y el
panel **ni siquiera tiene input de monto recibido** —lo fija a `orden.montoCobrar` (`:341`, `:395`)—.
El mensajero elige **cómo** le pagaron, nunca **cuánto**. Por eso «cuadrar con el monto recibido» y
«cuadrar con el valor a cobrar» son hoy la misma frase, y el spec no necesitaba cambiar. Admitir
sobrepago no es aflojar un `if`: mueve `cierre_dia.total_efectivo`, que es la **E** del `min(P, E)`
del pago al mensajero (44) —**cambiaría lo que cobra una persona**— y obliga a decidir qué es el
excedente (vuelto, propina, abono). Ficha backend aparte el día que se quiera.

**Tres correcciones del spec a la ficha, ya verificadas contra el código:** el util puro reusable es
`lib/utils/pagos-recaudo.ts`, no `lineas-pago.ts` (importa `@prisma/client`); el borde de la 212 ya
acepta desglose puro y cero líneas, así que el panel puede dejar de mandar la forma escalar **sin
tocar backend** —lo que desactiva la trampa de «sin cobro» de `:331`—; y los números de línea de la
presentación habían corrido (`CierreDiaModule:886`, `cierre-detalle-shared:898`,
`cierre-factura:959`).

### Contexto de la fase 1

La mitad **frontend** de la partición. La 212 ya está en `dev` (PR #358, merge `bb4c3185`): el
borde acepta el desglose y `computeTotales` reparte por método real. Pero el mensajero **sigue sin
poder usarlo**: `GestionarOrdenPanel.tsx:717-733` pinta un `<Select>` único y manda un
`metodoPago` escalar (`:342`, `:396`), que el borde normaliza a una sola línea. Esta ficha cierra
esa ventana.

Rama `feature/213-pago-multiple-captura`, nacida de `origin/dev` (`bb4c3185`), en el worktree
`C:/w213b` — `C:/w213` estaba ocupado por `feature/213-reintento-en-cierre`, una rama de la
numeración vieja: **comprobar `worktree list` antes de elegir ruta.** El checkout principal se dejó
intacto porque tiene WIP de novedades sin commitear.

**Bookkeeping que hubo que cerrar antes de arrancar:** la 212 seguía `in_progress` en
`feature_list.json` con el código ya mergeado en `dev`. La 213 tiene `depends_on: 212` y la regla
exige la dependencia en `done`, así que el leader la cerró aquí. El drift de sesiones paralelas de
siempre.

**Alcance, ya fijado por la ficha — no reabrir:** (a) el panel pasa a un editor de líneas
`método+monto` que cuadra contra el monto recibido, con el error visible antes de enviar; (b)
`CierreDiaModule.tsx`, `cierre-detalle-shared.tsx` y `cierre-factura.tsx` pintan el desglose en vez
de `METODO_LABEL[g.metodoPago]`; (c) las dos descargas concatenan los métodos en la celda escalar
según **[D4]** — sin columna nueva ni fila multiplicada.

**Las tres trampas heredadas que el spec debe honrar:** `GestionarOrdenPanel.tsx:331` fuerza
`"efectivo"` cuando la orden es **sin cobro**, y con desglose eso debe ser **cero líneas**, no una
línea de 0. El panel **filtra sus filas vacías** antes de enviar (**[Q2]**): el borde de la 212
rechaza todo monto no positivo. Y esta ficha **no** retira la forma escalar ni `metodo_pago` —
eso es la **214** (**[Q3]**).

---

## 🟡 2026-08-13 — feature **215** (antes 213): el reintento se cuenta en el CIERRE, en PR #363

El contador de reintentos deja de derivarse de las **transiciones** del historial y pasa a
derivarse del **cierre aprobado**: 1 por cada cierre aprobado distinto en el que la orden tuvo un
resultado de gestión vigente `rechazada`/`devuelta`/`reprogramada`, y sólo si esa gestión viene de
una **visita real**. Sin migración: se deriva de `gestion_orden` con los índices que ya existen, así
que `R7` de la 160 se conserva y `db/` queda intacto. 35 requisitos, 35 con dueño; `./init.sh`
completo **verde** (1086 archivos / 13.693 tests). PR **#363** contra `dev`, reviewer en curso.

**Nació de una pregunta, no de un plan:** «¿el cron que hace el cierre automático no suma un
reintento, o el cierre manual al aprobar?». La respuesta medida era **no**, y la lista blanca de la
160 nunca se había planteado el caso.

### Lo que hay que saber antes de tocar esto

1. **NO cierra el agujero que la originó, y está declarado en la página 1 de su
   `requirements.md`.** El corte automático no aporta resultados nuevos —mueve órdenes a
   `sin_gestionar`, que no tienen `resultado`— y el humano decidió dejar `sin_gestionar` fuera. El
   caso «sale, se corta, vuelve a bodega y sale otra vez con el mismo contador» sigue vivo. Ficha
   **216**.
2. **`R12` figuraba cubierto y no lo estaba.** Al pasar a contar por *resultado*, el criterio nuevo
   reabrió en silencio el doble conteo que `R2` de la 160 evitaba: la gestión sintética de la
   reprogramación de la **tienda** entraba al siguiente cierre del mensajero y sumaba +1. El test
   que figuraba como su dueño medía el **mapa de transiciones**, no el predicado. Lección: un
   requisito «cubierto» por un test que mide otra capa no está cubierto.
3. **El discriminador de «visita real» no necesitó esquema nuevo:** cada gestión produce, en su
   misma transacción, una fila de `orden_historial_estado` con `origen_tipo` (`gestion` /
   `escalado_devuelta_sla` / `reprogramacion_tienda`).
4. **Supuesto operativo ACEPTADO (Q5):** el conteo ocurre al **aprobar**. Si un cierre nunca llega a
   `aprobado`, la orden se queda en 0 y el cron la libera en bucle sin escalar jamás. Agravante
   medido: `ESTADOS_RESOLUBLES = ["solicitado"]`, así que un `vencido` **no es aprobable directo**.
   Tres mitigaciones escritas y **no elegidas** en `design.md §7bis`.
5. **`primer_intento_ok` cambia de definición sin re-backfill (Q10).** El corte **no es una fecha de
   la serie sino el instante del despliegue**, y se sostiene sobre `analytics_daily.updated_at`
   porque el job recalcula días pasados: cualquier regla por `fecha` sería falsa a los pocos días.
   El aviso **no llega a la pantalla** → ficha **219**.
6. **Un rojo que no se arregló relajando la aserción.** El de `analytics-daily-job` se cerró dándole
   a la devolución previa su cierre **aprobado** en la semilla; las dos cifras que prueban que el
   KPI distingue un reintento de un primer intento siguen intactas. Y se demostró que ese test
   **corre con datos** (canario + `describe.skip`), porque en este repo varios de integración pasan
   en falso con la tabla vacía.

**Pendiente y NO ejecutable por el agente:** `R19` (la consulta de medición de `design.md §7.6`
contra la base real: cuántas órdenes en vuelo cambian de lado del umbral) y el `EXPLAIN` con volumen
real —el que se corrió fue contra 78 órdenes locales—. Tras el despliegue, anotar su instante real
(T24, documental).

**Renumerada 213 → 215** al traer `dev`, que había renumerado la familia de pago múltiple a
212/213/214 y cuya 213 llegó **mergeada**. Se aplicó el criterio de siempre: conserva el id quien ya
está en `dev`.

---

## 🟢 2026-08-13 — PR **#364**: el mensajero sale de analítica + `/novedades` usa la card compartida

Tres commits sin ficha ni spec (el de analítica salió de una decisión directa del humano). El
mensajero deja de ver el ítem del sidebar **y** de pasar el gate de la ruta —`ROLES_ACCESO_ANALITICA`
pasa a **derivarse restando** de `ROLES_ANALITICA`, no a ser una lista propia—, conservando su
alcance en el catálogo. `/novedades` deja de pintar su fila y usa la card del mensajero, con las
acciones bajando por la prop `acciones`. `./init.sh` verde (1081 archivos / 13.618 tests).

**Ojo al revisar:** los botones «Habilitar» y «Devolver» son **maqueta declarada** —sin transición
detrás— y serían visibles en producción al mergear; y el tercer commit (de otra sesión) **revisa una
decisión escrita** por el anterior: engorda `NovedadDTO` con los campos que el adaptador rellenaba.

---

## 🟢 2026-08-13 — feature **212** (antes 208): pago múltiple por entrega, APROBADA y en PR

Una entrega cobrada mitad en efectivo y mitad por transferencia no se podía registrar sin mentir
en los totales del cierre. Nace `gestion_orden_pago` (0..N líneas `metodo`+`monto`, único por
`(gestion_id, metodo)`); `monto_recibido` sobrevive como TOTAL snapshot con la invariante
`SUM(líneas) = monto_recibido` en el borde y revalidada con `Prisma.Decimal` en el servicio.
33 requisitos EARS, mapa `R → test` 33/33, `./init.sh` completo verde (1081 archivos / 13579
tests, 432 s, cero `unhandled errors`). Partida en **212** (backend, este PR), **213** (frontend:
captura y presentación) y **214** (retirar la forma escalar, no antes de que la 213 esté
desplegada).

**Por qué los tests son de mutación y no de humo:** `cierre_dia.total_efectivo` es la **E** del
`min(P, E)` del pago al mensajero (44). Un desglose mal sumado no da un número feo en pantalla,
**le paga de menos o de más a una persona**. El reviewer añadió una mutación propia —intercambiar
los baldes `SINPE` ↔ `transferencia`, que *no altera el total general* ni la invariante R28— y dio
9 rojos. No hay agujero ahí.

**Rechazada en la primera revisión, con razón:** la migración estaba cubierta solo por regex sobre
el texto del SQL. Ahora el `migration.sql` y el `down.sql` **reales** corren sentencia a sentencia
en un esquema temporal dentro de una transacción revertida (patrón de la 205,
`tests/integration/db/_postgres-real.ts:127`). **Regla para toda migración: no aplicarla no es
excusa para no ejecutarla.**

### Tres cosas que costaron y conviene no re-descubrir

1. **EL ID SE COMPRUEBA CONTRA `dev` JUSTO ANTES DE PUBLICAR, no al dar de alta la ficha.** Esta
   ficha se renumeró **dos veces** (200→208→212). Entre el alta y el PR pasan horas y varias
   sesiones. Se decidió primero renumerar las fichas ajenas, pero al ir a ejecutarlo la 208 de
   `dev` ya estaba `done` y **mergeada**: renumerar una ficha publicada es peor que renumerar una
   que aún no ha salido, así que cedió la nuestra. Coste: 107 ocurrencias en 75 archivos.
2. **Una suite saturada no da veredicto, ni verde ni rojo.** Con otra sesión corriendo su suite en
   el mismo checkout: 928 s en vez de 432, diez `Timeout waiting for worker`, y **siete archivos
   omitidos** (1071 de 1078). Los 3 rojos de esa corrida pasaron en aislado —70 tests en 37 s—.
   Comparar SIEMPRE el total de archivos antes de creerse el conteo.
3. **`init.sh` pipeado se traga su código de salida.** `./init.sh | tail -40` devuelve el exit de
   `tail`: una corrida fallida se reportó como «exit 0». Redirigir a fichero y leer `$?` aparte.

**Convivencia:** otra sesión commiteó su analítica y sus novedades **encima de la rama de esta
feature**. No se perdió nada: el PR sale de una rama limpia con solo los 64 archivos propios. Sin
`jq` instalado, los pasos 3 y 4 de `init.sh` se omiten con `warn` y el `init OK` **no los cubre**.


## 🏁 CIERRE DE JORNADA 2026-08-12/13 — **EMPIEZA A LEER POR AQUÍ**

Todo lo de esta jornada está **mergeado en `dev`**. No queda nada a medias ni ningún PR abierto.

**En producción** (releases #341, #343 y #352): las features **200** (rediseño de `/wallet`), **201**
(un solo formato de dinero), **205** (pagar al mensajero desde su pantalla, con su migración
`liquidacion_reparto` aplicada y verificada en prod) y las deudas **202**, **203**, **204**, **207**.

**En `dev`, sin desplegar — 7 commits**: la tanda A de la **209** (quitadores de comentarios) y el
**modo oscuro completo** (**208** el tema correcto + **211** el interruptor).

### Lo que falta, por orden de valor

1. **El diálogo de pago de la 205 nunca se ha visto en pantalla.** La tabla, el formato, el enlace
   y el estado «nada que pagar» sí. El diálogo exige un cierre con **efectivo recaudado menor que
   lo devengado** (regla `min(P,E)`); el de prueba tenía ₡52.500 en efectivo contra ₡5.100 de
   ganancia, así que saldó entero. Para provocarlo hay que cobrar una jornada por SINPE.
2. **Ficha 210** — dos variantes de `Badge` bajo el umbral (`warning` 4,51, `destructive` 3,30).
   **No es deuda de modo oscuro: fallan igual o peor en claro.** Es paleta de marca y toca cada
   insignia de la app.
3. **Ficha 206** — anular un reparto entero de una vez. Feature pequeña; `reparto_id` ya deja la
   puerta abierta.
4. **Ficha 209, tanda B** — 50 quitadores de la semántica *correcta*, solo duplicada. Sin riesgo.
5. **Desplegar** los 7 commits pendientes cuando convenga. Sin migraciones.

### Lo que esta jornada enseñó, y conviene no re-aprender

- **La herramienta de medir también miente, y en verde.** Pasó cuatro veces: un runner de
  mutaciones que reportó supervivientes **sin ejecutar un solo test**; colores `lab()` parseados
  como `rgb` que dieron una tabla entera de números plausibles e inventados; un barrido de dinero
  con la regex rota que informó «4620 importes revisados, **0 detectados**»; y el dev server
  sirviendo **CSS rancio**, que casi lleva a concluir que un mecanismo no funcionaba. Todo script
  de verificación debe **abortar** si sus controles fallan.
- **Un fixture cuyos dos valores coinciden tapa el defecto.** Apareció ocho veces. El caso grave:
  `imputable === imputableTotal === cuentaPorPagar` hacía sobrevivir una mutación sobre **la cifra
  que la pantalla propone como monto**.
- **Los arreglos de las guardias no los sostienen las guardias.** De las mutaciones sobre los
  parsers de censo, **9 eran invisibles** para las 178 suites: revertirlos no pondría nada en rojo.
- **Medir antes de arreglar cambió el resultado dos veces**: la 204 parecía preventiva y era un bug
  real en pantalla (14 de 66 filas); la 203 culpaba al `testTimeout` y la causa era `maxWorkers`.

## 🔴 EN CURSO 2026-08-11/12 — feature **205**, rechazada por el reviewer y en corrección

Pagar la cuenta por pagar del mensajero **desde `/wallet/mensajeros`**, imputando el importe a
sus cierres pendientes. Rama `feature/205-pago-mensajero-desde-wallet`. Spec aprobado por el
humano: 58 requisitos, 8 tandas. Implementación completa (tandas 0–6), gate completo **verde
13346/13346**, migración `20260811140000_liquidacion_reparto` **aplicada SOLO en local**.

**El reviewer RECHAZÓ, y ningún hallazgo es de código** (`progress/review_205.md`): 57/58
requisitos con test verificado y 11 mutaciones propias del reviewer, 10 muertas. Los dos
bloqueantes eran documentales y **el primero fue error del leader**: al encargar el cambio de
lista→conteo acotó el encargo a «código y tests, no toques nada más» y nunca mandó plegarlo al
spec, así que R36 exigía «identificándolos» mientras el código devolvía un conteo **y dos tests
impedían volver atrás**. Plegado ya (R36, `design §6.4/§7.2/§12`, sección J con la cronología).
Segundo bloqueante: la tanda 7 sin hacer — 29/31 tareas marcadas ahora, mapa consolidado en
`progress/impl_205_mapa.md` (nombra R10–R13 y R17, que no aparecían en ninguna bitácora).

**Pendiente**: rehacer el gate completo tras el plegado, m2/m3 del review, y el PR.

**Hueco declarado**: el diálogo de pago, la previsualización, el aviso de excluidos y el enlace
por fila **no se han visto en pantalla** — la base local no tiene ningún mensajero con cuenta
por pagar, y fabricar ese estado por SQL daría un libro posiblemente inconsistente. Cubiertos
por 44 tests de componente. El reviewer lo considera suficiente para aprobar el código y **no**
para dar la pantalla por vista: recomienda sembrar un cierre aprobado y ejercerlo una vez antes
de desplegar.

## ✅ 2026-08-11 — features **200** y **201** EN PRODUCCIÓN (releases #341 y #343)

**200 — rediseño de presentación de `/wallet`**: las dos cifras de la caja pasan a grilla de
tiles, el dinero de terceros a banda destacada, el libro a una card con filtros en cabecera y
paginación en el pie. `DataTable` gana `align` opcional. Mirar la app encontró dos defectos que
13.000 tests daban por buenos: un icono `inline` de 16×72 px que se salía de su tarjeta, y los
cuatro `Label htmlFor` de los filtros apuntando a ids **inexistentes desde la feature 42**.

**201 — un solo formato de dinero**: la app mostraba la misma moneda de **cuatro maneras
distintas** según la pantalla, con la coma y el punto intercambiados entre unas y otras. Trece
copias del formateo mueren; queda `lib/config/moneda.ts`, que agrupa **por STRING** (nunca
`Number`: medido, `"1500.50"` deja de serlo). Auditoría en la app: 120 importes, 0 fuera de
formato.

**Deuda dada de alta y no tocada**: 202 (`PageHeader` ilegible en oscuro, afecta a TODAS las
páginas), 203 (el `testTimeout` da rojos espurios: el gate miente en las dos direcciones), 204
(aritmética de dinero en el navegador), 206 (anulación agrupada), 207 (el censo de tablas cuenta
prosa como JSX — **segunda ocurrencia**, y el daño real es que entrena a registrar fantasmas).

## 🎨 2026-08-08 — landing pública replicada (rama `ux`): **enmienda de la feature 86**

Pedido humano: replicar el home de <https://ordenex.co/> en la ruta `/`, sin imágenes, solo
maquetado. Hecho en `app/_landing/` (carpeta privada: nav, hero, servicios, banda, cómo
funciona, políticas, postulación, pie + `primitivas.tsx`), con `app/page.tsx` como composición
pura. Commiteado en `ux` (`wip(86)`) el 2026-08-10, junto al WIP de búsqueda-producto, para
poder mergear `dev` sobre un árbol limpio.

**Choque de spec resuelto en el gate humano de hoy.** El R5 original de la feature 86 prohibía
explícitamente toda sección de marketing («servicios, testimonios, precios») porque en julio no
había copy verificable en el repo. Con el sitio publicado como fuente, ese motivo cae. Se
enmendaron **R2–R5** de `specs/86-landing-publica/requirements.md` (R1 y R6–R16 intactos), se
añadió **R5b** (scroll suave respetando `prefers-reduced-motion`) y se reescribió
`tests/components/LandingPage.test.tsx`: 5 tests, verde.

Dos cosas que costaron y conviene no re-descubrir:

1. **El router de Next anula el scroll suave.** Fuerza `scroll-behavior: auto` mientras salta a
   un ancla, así que los enlaces a `#servicios`/`#como-funciona`/`#politicas` van en `<a>`
   nativo, no en `<Link>`. La declaración vive en `app/globals.css` sobre `html`, envuelta en
   `@media (prefers-reduced-motion: no-preference)`.
2. **El guard `no-embalaje` cazó copy de políticas.** «Embalaje inadecuado exime de
   responsabilidad» es castellano ordinario, no el value de `order_status` que el guard
   persigue. Alta de `app/_landing/LandingPoliticas.tsx` en el whitelist **por archivo**, no por
   carpeta, para que el guard siga viendo el resto de `app/_landing/`.

`./init.sh --rapido` en verde (1016 guardias + los 6 tests relacionados). **Falta `./init.sh`
completo antes de cualquier PR.**


## 🔴 EN CURSO 2026-08-08 — feature **192**, fase 1 (spec)

> ⏭️ **SUPERADO — leer con fecha.** Todo lo que sigue en este bloque es el diario de la fase de
> spec (2026-08-08). La feature **ya está implementada y mergeada a `dev`** (PR #323), con el
> `reviewer` en **APROBADO, 73/73 requisitos trazados** (`progress/review_192.md`), y desde el
> merge de hoy 2026-08-10 vive también en `ux`. Dos cosas siguen abiertas y NO son de la spec:
> `feature_list.json` aún la marca `in_progress` con `branch` puesta (bookkeeping pendiente), y
> el review la declara **no liberable** hasta que `./init.sh` completo dé verde (§5 de su
> informe). Lo de abajo se conserva por las decisiones y sus porqués, no como estado.

**Tablero del día: órdenes por mensajero y el resultado de su gestión.** Pedido humano de hoy.
Ficha registrada en `feature_list.json` (`id: 192`, `pending`, `fullstack`, `sdd: true`).
`spec_author` corriendo sobre `specs/192-tablero-dia-mensajeros/`.

**Ojo al retomar:** la rama activa es `ux`, con el trabajo del landing sin commitear
(`app/_landing/`, `app/globals.css`, `app/page.tsx`). La 192 **no nace de aquí**: rama propia
desde `dev`.

Tres decisiones humanas ya cerradas, en el `status_note` de la ficha con sus referencias:

1. **Roles**: `admin`/`maestro` todo, `adminSatelite` solo su zona. Se reutiliza
   `resolverAlcance` (`lib/analytics/alcance.ts:196`), que es la única separación multi-tenant
   porque Prisma va con service role. Satélite sin zona → `denegado`, nunca global.
2. **Conteo = resultado final de la orden, NO gestiones.** `GestionOrden` no tiene
   `@@unique(ordenId)`: contar gestiones haría que los números sumaran más que las asignadas.
3. **30s de refresco con SWR.** Realtime descartado a propósito: esto es una agregación, y
   `postgres_changes` entrega eventos de fila → habría que re-agregar en cada evento. Además no
   hay Supabase Auth (sesión propia, `lib/auth/resolve-actor.ts:16`) ni una sola policy en
   `db/migrations/`. Puerta abierta si 30s se queda corto: Broadcast desde el server.

**Trampa a vigilar en el design:** la ventana del día sale de `lib/utils/fecha-cr.ts`; `startOfDayCR`
da medianoche **UTC** y produce la ventana 18:00–18:00 de la ficha 166 (`rollup-dia.ts:14-17`).

**Puerta 1 pasada (2026-08-08).** El humano respondió las cinco preguntas abiertas; tres AMPLIARON
el alcance, así que `spec_author` está en una segunda vuelta sobre los mismos tres archivos:

- **`pendientes` se desglosa**: hay que separar «sin recoger» de «en reparto». Mete un SEGUNDO eje,
  `orden.estatus_id` (`lib/types/order-status.ts`, 20 values), además de `gestion_resultado`.
- **Drill-down SÍ entra** (revierte el defecto de la pregunta 4): clic en la card del mensajero abre
  el detalle del día reutilizando `app/(app)/ordenes/_components/`, no una segunda tabla.
- **Ítem de sidebar nuevo «Monitoreo»** en `menu-visibility.ts`, roles de R1. Vigilar que no mueva
  el aterrizaje post-login, que sale del PRIMER ítem visible (`dashboard/page.tsx:34`).
- Cards en vez de filas. Sin selector de fecha. Reasignación: solo el mensajero actual.

⚠️ **Asunción SIN confirmar** que va al spec marcada como tal: «sin recoger» = estatus `por_recoger`
+ `recolectando`; «en reparto» = `en_reparto`. El humano dijo «incluyendo sin recoger» pero no
enumeró estados. Se veta en la puerta 2.

🔎 **Hallazgo de la segunda vuelta, VERIFICADO a mano** (`lib/repositories/OrdenRepository.ts:1820-1823`):
`asignarRecoleccionLote` **no estampa `asignado_at` a propósito** —lo dice su docstring: es el
denominador del ranking y estamparlo bajaría el porcentaje del mensajero—. Como «asignada hoy» se
define por `asignado_at`, **las órdenes en `recolectando` no entrarían nunca al tablero**: el bucket
«sin recoger» se llenaría solo con `por_recoger` (flujo bodega). Justo la mitad que el humano pidió
ver. Tercera vía a evaluar: leer el rastro `asignacion_recoleccion` de `orden_historial_estado`
(`db/schema.prisma:1410`), que la 157 SÍ escribe en la misma tx, sin tocar `asignado_at` ni el ranking.

**Resuelto (puerta 2): opción C** — «asignada hoy» tiene DOS caminos en OR: `orden.asignado_at`
(reparto) o una fila de `orden_historial_estado` con `origen_tipo = 'asignacion_recoleccion'`
(recolección, `db/schema.prisma:1410`). ⛔ **`asignado_at` NO se escribe nunca**: mueve el denominador
del ranking y con él la plata de los mensajeros. R59 lo afirma y un guardia lo atornilla.

**Resuelto (puerta 3): opción 2 — SIN índice nuevo, con caché de servidor de ~15 s.** El humano lo
eligió sobre la recomendación contraria del leader; queda registrado qué se compró y qué se pagó:
ninguno de los tres índices de `orden_historial_estado` cubre el predicado del camino 2
(`db/schema.prisma:1445-1456`; los dos primeros empiezan por `orden_id`, el de la 167 por
`actor_usuario_id`), así que `ids_recoleccion` es un seq scan sobre una tabla append-only. El caché
acota su FRECUENCIA, no su costo. La 167 resolvió la consulta gemela con índice, por si se reabre.

⚠️ **Riesgo que introduce el caché y que el spec debe blindar:** la clave va por ALCANCE RESUELTO
(global / zona+zonaId) + fecha CR, nunca por rol ni por usuario. Un caché compartido entre alcances
distintos le sirve a un `adminSatelite` el tablero del país entero — y no falla: responde rápido y
mal. El alcance se resuelve SIEMPRE antes de mirar el caché.

**Siguiente paso: rama.** Bloqueado a la espera del humano: el landing sin commitear vive en `ux`
(5 commits adelante de `dev`) y la 192 debe nacer de `dev`. Sin resolverlo no se mide baseline
(`./init.sh` sobre `ux` da un número contaminado) ni se implementa.

---

## 🏁 CIERRE DE JORNADA 2026-08-07

**Siete PRs. Ninguna feature del backlog: la jornada entera fue saldar deuda**, por encargo humano
explícito («punto por punto hasta no tener ni una deuda»). Y saldarla destapó **un bug de producción
con dinero mal pintado en pantalla**.

### 🚦 LO PRIMERO AL RETOMAR: **tres PRs abiertos**, y uno corre prisa

| PR | Qué | Por qué importa |
| --- | --- | --- |
| **#314 → `prod`** | release, **cero migraciones** | 🔴 **lleva el fix del dinero.** Hasta que se despliegue, el cuadre de conciliación sigue mal en producción |
| **#315 → `dev`** | `@sin-superficie` 12 → 5 | cierra la segunda víctima de `54757be4` |
| **#316 → `dev`** | columnas: **0 de 35** sin aserción de orden | cierra la deuda que dejó la 189 |

Ya mergeados hoy: **#309** (release), **#310** (guardia servicio↔dobles), **#311** (el fix del dinero),
**#312** (borrado de código muerto), **#313** (renombrado de `chat/`).

### 🐛 El bug del día lo encontró la guardia que escribimos esta mañana, en su primer día

`PanelConciliacion` formateaba `totalSnapshot`, `totalLedger` y `diferencia` —**los tres importes de
dinero del cuadre**— con `datos.unidad`, que para `conciliacion_cierres` es `"conteo"`
(`metrics.ts:659`, y hace bien: la métrica cuenta cierres). `formato.ts` traduce `"conteo"` a **0
decimales y sin símbolo de moneda**.

En producción, **en la única pantalla que existe para cuadrar dinero**: `1 561` donde va **₡1 560,50**,
y un descuadre de **₡60,50 anunciado como «61»**.

> ⚠️ **Y por qué ningún test lo veía, que es lo único reutilizable:** `PanelConciliacion.test.tsx`
> declaraba `unidad: "moneda"` en su doble — **un DTO que el servicio no produce**. Es *exactamente* la
> misma familia que el bug de 7 h del 06-ago. **Segunda vez en dos días.**

El arreglo declara la unidad **por cifra y en un solo sitio** (`UNIDAD = { importe, conteo }`), en vez
de añadir un `"moneda"` literal más: el criterio ya estaba escrito en `COLUMNAS_CONCILIACION` tres
líneas más arriba.

### 🛡️ La guardia que lo destapó (#310) — y la deuda que cierra

Era la deuda **sin dueño y sin ficha** que dejó el hotfix #305: *una guardia que ate lo que el servicio
produce con lo que los dobles del tablero declaran*. Las ataduras que había comparaban la fixture
contra constantes publicadas —**el espejo consigo mismo**—.

Ahora **ejecuta el servicio real** y compara. **25 casos, 9 mutaciones, todas rojas** — y **seis de las
nueve son invisibles para `TableroFinanciero.test.tsx`**, que sigue verde 93/93. La peor: intercambiar
las dos vistas de `cod_recaudado` **en el servicio** pondría el donut donde van las barras sin mover
una sola aserción.

**Encontró cinco dobles mintiendo** sobre el DTO real: `fuente` incorrecta en las siete métricas
temporales, un id de vista inexistente, `cuenta_por_pagar_tienda__vista`, y la `unidad` de conciliación
(el bug de arriba).

### 🧹 La limpieza: `@sin-superficie` de **24 a 5**

Y el cambio de forma importa más que el número: **R-B se queda con cero excepciones**. Ya **no hay ni
un componente de UI huérfano** en el repo; las 5 supervivientes son todas Server Actions, y **ninguna
es deuda**: cuatro son testigos declarados por las features 170/184 y la quinta —el modo agregado— es
la **ficha 182**.

**Las historias no eran la misma, y el `git log -S` las separó:**

| | Diagnóstico |
| --- | --- |
| Zonas (`ZonasModule`, `geo.ts`, `arbolZonas`) | **lo mató un borrado** (`19b9cccf`). Y antes se había quitado, **repuesto** (`258bd6ad`) y vuelto a quitar |
| `ChatWhatsappPanel` | **sustitución incompleta**: `6dc18dc2` quitó su montaje y añadió el flotante en el mismo commit |
| WhatsApp Meta, `marcarNotificacionLeida`, `ordenes.ts`×4, `plantillas`, `vehiculos` | **nacieron muertas** — cero commits en `app/` en toda su vida |
| `listarCatalogoEstatus` | **segunda víctima de `54757be4`**, el commit del incidente del botón de rutear |

> **Matiz que corrige el relato que llevábamos:** el mensaje de `54757be4` **sí buscó daños colaterales
> y declaró uno** (`RutearSateliteModal`). Encontró **uno de los dos**. *No fue no mirar; fue una
> búsqueda corta.* Sus dos víctimas quedan reparadas ocho días después.

### 💣 Una mina desactivada: el chat vivo se llamaba `chat-demo/`

El chat **de producción** —única entrada desde que se borró el panel del detalle— vivía en una carpeta
llamada `chat-demo/`, con un archivo `chat-demo-data.ts` y un comentario de montaje que decía
**«MAQUETA»**. **El chore de borrado de este mismo día demuestra que esa mina explota.** Renombrado a
`chat/` + `chat-format.ts` con `git mv` (el `--follow` cruza).

### 📏 Tres reglas que salieron de medir, no de opinar

1. **La unidad es el símbolo, no el fichero.** `GeoRepository` perdió tres métodos y **sigue viva**
   (`filtros-ordenes.ts:33` usa sus proyecciones `*Lite`). Borrar por fichero se habría llevado código
   en uso.
2. **En tests, borrar todo lo que nombre el símbolo es un error.** Se conservaron **nueve** bloques
   reapuntándolos, porque eran el único testigo de propiedades vivas — entre ellos la `dedupeKey` con
   hash, sin la cual una corrección de dirección se descarta en silencio contra una fila `done`.
3. **Una guardia anclada en código real muere con el código que vigila.**
   `superficie-de-uso.guardia.test.ts` anclaba en **dos de los símbolos que había que borrar** y se
   tumbaba sola. *Si una guardia debe anclar, que ancle en código vivo y central, nunca en el caso raro
   que documenta.*

### ⚠️ La lección más incómoda, en TRES iteraciones el mismo día

Verificar «todas las guardias» falló **tres veces seguidas, cada vez con una herramienta distinta**:

- `grep --include=*guard*` filtra por **nombre de fichero** → dejaba fuera **13 de 72**.
- `vitest list guard` filtra por **ruta** → dejaba fuera `orden-historial-cobertura.test.ts`, que vive
  en `tests/unit/repositories/`.
- Se cazó **en rojo**, no antes.

> **Ninguna lista basta. Lo único que basta es correr la suite de la zona que tocas.**

**Y el leader falló TRES mediciones**, las tres cazadas por un subagente, no por él: (a) el censo de
columnas dio «0 de 34 cubiertas» dos veces por una `\b` que el shell des-escapaba a **backspace**;
(b) se dio por vivo `EnvioPlantillaWhatsappService` **contando comentarios en prosa como imports**;
(c) el universo eran **35** constantes y no 34, porque el detector no recorría `components/`.
**El patrón es siempre el mismo: un detector que no cubre lo que uno cree.** Lo único que lo frenó fue
una **autocomprobación con caso conocido-positivo** que aborta si no lo encuentra.

### 🔎 Tres deudas del registro **no existían**

Verificado contra el código, no contra las notas: el **tope de indemnización** ya estaba cerrado por
#291 (técnico + de negocio atado a `orden.monto_cobrar`, en los dos caminos); el **orden determinista
de «Saldos de tiendas»** lo cerró la 188 (el archivo sale por el camino ordenado); y el **drift de la
base local** no era la migración fantasma —solo faltaba aplicar la de la 178—.

### ⏳ LO QUE QUEDA VIVO, con nombre

1. **`«Devengado»` y `«Pagado»`** en el Excel de cuentas por pagar **incluyen los pagos anulados y su
   reverso**, y la hoja va **sin el aviso que la pantalla sí lleva** (`CuentasPorPagarTable.tsx:215-217`).
   **Se dispara HOY**, no a futuro. Decisión de producto; el #316 lo **congela**, así que hay que
   cambiar test y constante a la vez.
2. **`feature_list.json`, ficha 161** (`done`): su `description` cita `chat-demo/chat-demo-data.ts`
   —ruta que ya no existe— **y** afirma que el contador de no leídos es un «DATO QUEMADO» ahí, cuando
   **`sinLeer` no existe en todo `mis-asignaciones/`**. Doblemente caducada, y vive en el archivo de
   estado vivo.
3. **Nada impide que la constante `COLUMNAS_DESCARGA_*` nº 36 nazca desnuda.** `censo-tablas.ts` vigila
   **tablas**, no listados de columnas. Quien escriba la guardia hermana necesita saber que hay que
   recorrer `app/` **y** `components/`, y que un detector textual da falsos positivos con
   `describe.each`.
4. **El flake de jsdom sigue vivo** — hoy tumbó el pre-vuelo de la release (timeout de 20 s en
   `TableroOperativo.test.tsx`, verde en aislado en 5,97 s). **No tiene arreglo por encargo:** acotarlo
   subiendo el `testTimeout` taparía el síntoma sin la causa, y ya van tres mecanismos identificados sin
   dar con ella. Necesita investigación propia.

### 🚦 SIGUE PENDIENTE, SÉPTIMA JORNADA

**VER LA 172 Y LA 173 EN PANTALLA.** No lo sustituye ninguna suite, y hoy hay tres cosas concretas que
mirar: la gráfica de líneas ya en producción, las dos cifras distintas de la caja, y —en cuanto se
despliegue el #314— el cuadre de conciliación con su dinero bien escrito.

---

## 🏁 CIERRE DE JORNADA 2026-08-06

**Registro limpio: cero PRs abiertos, cero features `in_progress`.** `prod` va por detrás de `dev`
en documentación, tests y la 186; **el hotfix del día YA está en producción**.

### 🐛 Lo importante del día no estaba en el plan: **el tablero de dinero llevaba 7 h roto en producción**

La **180** encendió `filas` para las siete métricas financieras. El tablero decidía KPI-vs-tabla con
`filas.length === 0` —esa era su señal de **forma**—, así que las siete cayeron en `PanelTabla`: el
maestro perdió «Dinero en caja», «Ganancia de Ordenex» y las demás, y en su lugar vio **treinta
fechas**. Salió con el release de las 04:09 y **lo destapó escribir un spec**, no un usuario.

Arreglado por hotfix (**PR #305**, desplegado READY): la señal pasa a `granularidad`, preguntando
**por la negativa** (`!== "no_temporal"`) para que un valor futuro del enum no vuelva a caer en el
mismo sitio.

> ⚠️ **Por qué ningún test se enteró, que es lo que hay que recordar:** el fixture se llamaba
> `vistaSinFilas`, con `grano: "fecha"` y `filas: []` — **y lo tocó la propia 180** para añadirle
> `granularidad`, dejando escrito al lado «el tablero NO la lee». Pasó por delante del doble que
> fijaba la premisa vieja, lo editó, y no vio que su cambio la invalidaba.

**La deuda que deja, sin dueño:** una guardia que ate **lo que el servicio produce** con **lo que
los dobles del tablero declaran**. Las ataduras que hay comparan la fixture contra constantes
publicadas, nunca contra la salida real: si `serieDensa` cambiara de grano seguirían verdes
**comparando el espejo consigo mismo**.

### ✅ La 186, cerrada (PR #307)

La gráfica de líneas sobre el KPI restaurado. **18 R, review APROBADO en ronda 2**, gate
`== init OK ==` **985 / 12.355** (+1 archivo, +60 tests), `next build` verde, 2 archivos de
producción. `cuenta_por_pagar_mensajero` **no lleva línea** por decisión humana: es un saldo al
corte y dibujarlo como línea parece una tendencia sin serlo. Detalle en `history.md`.

**Dos requisitos estaban escritos y no los protegía nada** —`R4` sobrevivía a 91 casos, `R2` a
144—, **y son la misma línea partida por la mitad**. Y **«las tres únicas salidas» eran cuatro**: la
cuarta caza en las siete métricas una regresión que antes solo veía en una.

> **La regla que queda:** una exhaustividad afirmada sobre el **propio razonamiento** es más
> peligrosa que una afirmada sobre el código, porque **nada la desmiente al leerla**.

### ⚠️ Y el modo de fallo del worktree, repetido POR MÍ el mismo día que lo documenté

El 05-ago el PR #298 se mergeó con la nota de renumeración **sin commitear** en el working tree. Lo
arreglé por la mañana (PR #302), escribí la lección aquí mismo… **y por la tarde volví a hacerlo**:
el PR #307 se mergeó con `feature_list.json` modificado y sin commitear, así que `dev` decía que la
186 seguía `pending` **después de estar mergeada**.

> **No basta con saberlo: `git status` antes de abrir el PR, no después.** El PR se arma desde la
> **rama**; nada avisa de lo que quedó en el worktree.

### ✅ La 189, cerrada (PR #303)

12 casos, **solo tests**, cero líneas de producción. Gate `== init OK ==` **984 / 12.263** (+7
archivos, +12 tests sobre el baseline). **24 mutaciones, 24 rojas.** Cierra la cláusula «columnas y
orden» del R12 de la 188. Relato completo en `history.md`; censo y hallazgos en `impl_189.md`.

**Lo que deja vivo:** `_RANKING` **parece cubierta y no lo está** (su esperado es la propia
constante: tautología con disfraz de test de integración); **12 de las 35** constantes siguen sin
aserción de orden; y `COLUMNAS_DESCARGA_GASTOS_FIJOS` dice **«Monto mensual»**, hoy cierto por
accidente y **congelado por el test nuevo** — dirigido a la **ficha 85**.

### 🔎 La auditoría del backlog, y lo que encontró

**El registro no está inflado de fichas: está inflado de bloqueos que ya no existen.** Verificado
contra el código, no contra las notas:

| Lo que decía el registro | Lo que dice el código |
| --- | --- |
| 145 → 169 · 147 → 154 · 162 → 161 · 85 → 84 · 182 → 176 · 186/184 → 180 y 183 | **los ocho `done`** |

**Siete fichas arrastran un `depends_on` ya satisfecho** y sus notas siguen leyéndose como un
bloqueo. Nada del backlog espera a nada.

**Dos correcciones a lo que la propia auditoría creyó primero:**

1. **Sospeché de la 189 y la sospecha era falsa.** Existen 8 tests `*-descarga-columnas.test.ts`,
   pero cubren **otras** tablas. Medido: **35** constantes `COLUMNAS_DESCARGA_*` declaradas en el
   árbol, y **13 archivos de test** con la aserción `map(c => c.clave).toEqual(…)` — **ninguno
   sobre las 12** de esta ficha. La ficha es exacta y `impl_188-cierre.md:167` ya lo decía.
   *(«13» son archivos, no constantes: varios cubren dos, y tres de esos archivos ni siquiera son
   de descarga. El censo constante-a-constante lo produce esta feature.)*
2. **La 85 es peor que su ficha.** El DTO ya trae `periodicidadUnidad` y `periodicidadCantidad`
   (feature 84) y **no los muestra ni la pantalla ni el Excel** — `gastos-fijos-descarga-columnas.ts:10-11`
   los excluye a propósito. **Misma familia que el botón huérfano**: capacidad entregada, cero
   superficie. Y la guardia nueva **no lo caza**: vigila acciones, no campos.

---

## 🏁 CIERRE DE JORNADA 2026-08-05

### 🚦 LO ÚNICO ABIERTO: **el PR de release #301** (`dev → prod`, 126 commits) — ✅ **MERGEADO el 06-ago 04:09, deploy READY**

**CERO migraciones** — mergear no aplica nada. Gate `== init OK ==` (977 archivos / 12.251 tests)
corrido sobre `dev` con todo dentro. Sin conflictos.

**Al desplegar, mirar:** el botón de rutear en `/ordenes`, que **los 12 listados sigan sacando el
Excel con las mismas columnas y en el mismo orden** (la 188 cambió de dónde salen las FILAS, no las
columnas — pero es lo que un usuario notaría), y la analítica financiera, que gana serie temporal.

### 🐛 El bug de producción de hoy, y lo que salió de tirar del hilo

**Reportado:** «no se puede asignar guías a bodega satélite, desapareció el botón».
**No era código roto.** `rutearABodegaSatelite` se quedó **sin superficie de UI** cuando el
2026-07-31 se borró la vista legacy `OrdenesRevisionMaestro` (`54757be4`). Backend intacto, **suite
verde, cinco días sin que nadie se enterara** — no había un solo test que afirmara que alguien puede
dispararla. Arreglado y **en producción** (#297), más la mejora que pidió el humano al probarlo:
«Asignar mensajero» solo lleva órdenes GAM (#299).

**Tirando del hilo aparecieron tres cosas que nadie buscaba:**

1. **Un falso éxito.** `ordenIds` sin `.min(1)` + servicios que devuelven `ok` con lista vacía =
   «Mensajero asignado a **0** orden(es)» como éxito. Cerrado **en el schema** en los tres
   (`rutearSatelite`, `asignarBodega`, `generarGuia`); el tercero **era el único sin ninguna guarda
   en la UI**. Había un test afirmando que «`ordenIds` vacío es válido»: **describía el hueco como
   si fuera requisito**.
2. **Los dos hotfixes NUNCA volvieron a `dev`.** Lo detectó el barrido, no una alerta. `dev` seguía
   con el modal sin montar y el comentario de orfandad: **cualquier rama nueva habría nacido con el
   bug otra vez**. Merge-back hecho.
3. **Cuatro huérfanas más**, una peor que la original: **`enviarPlantillaWhatsapp`** —el envío
   server-side por Meta de la feature 107— está **completo y sin botón desde el día 1**. No hay un
   «antes» al que volver, y **nadie lo reporta porque nadie sabe que existe**. Anotada como «DEUDA,
   no diseño». También `listarPlantillasEnviables`, `marcarNotificacionLeida` y
   `listarCatalogoEstatus` (segunda víctima del **mismo** commit `54757be4`).

### 🛡️ La guardia que ataca la causa (#300, ya en `dev`)

`tests/unit/guards/superficie-de-uso.guardia.test.ts` — 18 casos, **1,20 s**.

> **Lo obvio no habría funcionado, y está medido:** marcar toda acción sin llamantes da **5 falsos
> positivos de 20** y **NO habría cazado el incidente** — `rutearABodegaSatelite` tenía llamante (su
> modal); **lo muerto era quien montaba el modal**.

La señal es **alcanzabilidad desde las raíces de ruta**. Tres reglas, y **la tercera apareció al
mutar**: quitar la entrada del menú deja el modal *importado y renderizado*, así que el grafo de
módulos no se entera; lo que queda colgando es la función `abrirRutearSatelite`, sin una sola
referencia — **y `typecheck` la deja pasar, porque este repo no tiene `noUnusedLocals`**.

Verificada con **4 mutaciones**, entre ellas la **réplica literal de `54757be4`**. 24 anotaciones
`@sin-superficie`, y la guardia **rechaza motivos de relleno** y **caduca las que sobreviven a su
motivo**.

> ⚠️ **Lo que NO cubre, y conviene no olvidarlo:** no sabe si el botón **se ve**. Un `if (rol === …)`
> que nadie cumple, un `disabled` permanente o una ruta sin enlace en el menú **pasan verdes**.
> Cubre la desconexión estructural, no la funcional.

### ✅ La 188 (antes 184), en `dev`

**33/33 tareas, review APROBADO en ronda 2.** H.3 —verificar el mapa `R1..R34` **caso a caso**—
encontró dos huecos que ninguna lectura habría visto: **R16**, la propiedad que da nombre a la
feature, **no tenía nada que impidiera su regreso** (bajo mutación, **129 tests de emisión seguían
verdes**), y **R26** no afirmaba que la acción de lote sobrevive a la poda.

**Renumerada de 184 a 188** por colisión con otra sesión. **«184» en un commit, un comentario o
`PENDIENTES_184` significa esta feature** (nota de cabecera en el spec y en el cierre).

> ⚠️ **Rescatado el 2026-08-06 (PR #302): esa nota de cabecera NO estaba.** Se quedó **sin
> commitear** en el working tree del worktree `lote-135` y el **PR #298 se mergeó sin ella** —junto
> con **once rutas `impl_184_*` que apuntaban a ficheros ya renombrados**, punteros rotos entre
> bitácoras—. Este párrafo llevaba un día afirmando algo falso.
>
> **El modo de fallo, que no tiene dueño:** *el PR se abre desde una rama, no desde el worktree*.
> Nada avisa de que quedan cambios sin commitear cuando se mergea, y **`git status` en un worktree
> ajeno no lo mira nadie**. Es la misma familia que los dos hotfixes que nunca volvieron a `dev`:
> lo detecta un barrido, jamás una alerta.

### 🔎 Lo que sobrevive a esta jornada

**El flake de jsdom tumbó el gate TRES veces hoy**, siempre en archivos distintos y siempre verde al
repetir. Sigue obligando a correr la suite dos veces para distinguirlo de una regresión.

**El índice del MCP estaba a más de una semana** y contenía el test de la vista legacy **ya
borrada** — usarlo sin reindexar habría dado un barrido con falsos positivos y negativos. Reindexar
primero, siempre.

**Y `dev` era irreproducible en local** por tres capas de entorno stale a la vez: cliente Prisma
viejo, `node_modules` sin las dependencias de las features nuevas, y caché de `.next` apuntando a
una página borrada hace días.

### ⏳ Fichas abiertas

**189** columnas de los 12 archivos sin test (deuda preexistente) · **190** Q-K6 rama B (la 188 la
desbloqueó) · **191** el `N+1` real de R29 de la 170, hoy **excepción declarada en 11 de 12
listados** — cerrarlo choca con los tests de R15 de la 188, y ese conflicto **es** el trabajo.

**Sin ficha, y sin dueño:** `ZonasModule`/`ZonaForm` son código muerto **duplicado** (la gestión de
zonas vive y funciona en `configuracion/tarifas`) — descartado como bug, ya anotado.

### 🚦 SIGUE PENDIENTE, quinta jornada

**VER LA 172 Y LA 173 EN PANTALLA.** No lo sustituye ninguna suite.

---

## ✅ 2026-08-05 (noche) — TODO FUSIONADO. Lo único que falta: **la release a producción**

**Cero PRs abiertos. Cero features `in_progress`.**

| PR | Qué | Estado |
| --- | --- | --- |
| **#297 → `prod`** | hotfix: vuelve «Rutear a bodega satélite» | ✅ **en producción**, deploy READY, 0 errores |
| **#299 → `prod`** | «Asignar mensajero» solo lleva GAM + el falso éxito del lote vacío | ✅ **en producción**, 0 errores |
| **#298 → `dev`** | la **188** (antes 184): los 12 listados | ✅ mergeado — **pero NO está en producción** |

### 🚦 LO PRIMERO AL RETOMAR: **release `dev → prod`**

**`dev` está 119 commits por delante de `prod`** y arrastra la **188**, la **180** (serie temporal de la
analítica financiera), la **166** (ventana de día del ranking), la **133** (recortes por rol), la **134**
(export CSV) y el chore del lote de deudas (#291).

> ✅ **La release es BARATA: CERO migraciones.** Verificado sobre el diff `origin/prod...origin/dev`:
> ni un archivo bajo `prisma/migrations/`. Mergear a `prod` **no aplica nada** — no hace falta el
> pre-vuelo caro de las releases con `CHECK` y enums.

Aun así, el pre-vuelo que **sí** aplica: correr `./init.sh` completo sobre `dev` **antes** de abrir el
PR de release. Es la lección del #237 y de «un PR verde no dice nada de los tests».

### 🐛 Lo que enseñó el bug de producción de hoy

**«Rutear a bodega satélite» llevaba cinco días sin superficie de UI.** Se retiró de `/ordenes` por
decisión previa y la ofrecía la vista legacy `OrdenesRevisionMaestro`; al borrarse ésta el 2026-07-31
(`54757be4`), la acción quedó **huérfana con el backend intacto**, y la suite **no se puso roja** —no
había un solo test que afirmara que alguien puede dispararla—.

> ⚠️ **PATRÓN SIN DUEÑO:** borrar una vista puede dejar acciones huérfanas, y **nada lo detecta**.
> **Nadie ha barrido el resto de la app buscando el mismo caso.**

Y al arreglarlo apareció un **falso éxito** preexistente: `asignarBodegaSchema.ordenIds` no lleva
`.min(1)` y el servicio devuelve `ok` con lista vacía → «Mensajero asignado a 0 orden(es)». Cerrado en
la UI (#299). **`rutearSateliteSchema` tiene el mismo hueco**, hoy inalcanzable porque su modal lo
tapa por otra vía.

### ⏳ Lo que queda vivo

- **Release `dev → prod`** (arriba).
- **Fichas 189 / 190 / 191**, las tres de la 188: columnas sin test · Q-K6 rama B (desbloqueada) · el
  `N+1` real de R29 de la 170.
- **VER LA 172 Y LA 173 EN PANTALLA.** Cuarta jornada pendiente.
- El **flake de jsdom** sigue vivo: hoy tumbó una corrida entera del gate en
  `recuperar-contrasena-form`, verde aislado y verde al repetir.

---

## 🏁 CIERRE DE JORNADA 2026-08-05 — **EMPIEZA A LEER POR AQUÍ**

### 🔴 LO PRIMERO: dos PRs abiertos esperando tu decisión

| PR | Qué | Estado |
| --- | --- | --- |
| **#297 → `prod`** | **HOTFIX: vuelve el botón «Rutear a bodega satélite»** | gate **VERDE** (927 archivos / 11.533 tests). **Producción no puede rutear guías hasta que esto se despliegue** |
| **la 188 → `dev`** | la deuda de la 170: los 12 listados | review **APROBADO ronda 2**, gate **VERDE**. El PR **#296 quedó obsoleto** al renumerar la rama; hay que reabrirlo |

### 🐛 El bug de producción de hoy, y la lección que deja

**Reportado:** «no se puede asignar guías a una bodega satélite, desapareció el botón».
**No era código roto: la acción se quedó SIN SUPERFICIE DE UI.** Se había retirado de `/ordenes`
por decisión previa, y hasta el **2026-07-31** la seguía ofreciendo la vista legacy
`OrdenesRevisionMaestro`. **Al borrarse esa vista, dejó de existir cualquier forma de invocarla** —
con el backend intacto y probado todo el tiempo.

> ⚠️ **El patrón, que NO tiene dueño:** borrar una vista puede dejar acciones huérfanas —backend
> vivo, cero botones— y **nada lo detecta**. Aquí tardó cinco días en notarse, y solo porque alguien
> intentó usarlo. **Nadie ha barrido el resto de la app buscando el mismo caso.**

El arreglo monta la acción en `en_bodega_central` (origen único desde la 156) filtrando a no-GAM, y
la ofrece a **maestro y admin** —`ROLES_ACCESO_TOTAL` son dos—. Los tests **montan la página real
variando el rol**, no pasan la prop: la mutación que lo prueba es que restringir a `maestro` pone
rojo el caso de `admin`. Es la lección del review de la 172.

### 🔢 LA 184 AHORA ES LA 188, y hay que leerlo antes de tocar nada

Mientras esta rama estaba viva, **otra sesión mergeó en `dev` una ficha 184 distinta** («analítica
financiera: export de la serie») **y también 185, 186 y 187**. Los cuatro ids colisionaron. Por
decisión humana se renumeró **todo lo de esta rama**: **184→188**, y las fichas de su cierre
**185/186/187 → 189/190/191**.

> **Lo que NO se renumeró, a propósito:** los **60 mensajes de commit**, los comentarios de **111
> archivos de código** (`Feature 184 — …`) y la constante **`PENDIENTES_184`**, que es **ancla de
> texto** de una guardia (`adaptador-conjunto.guardia.test.ts:313`) y romperla a medias la pone
> roja. **«184» en un commit, un comentario o esa constante significa la 188.**

Es la **segunda vez** que pasa (la primera fue la 182 el 2026-08-04). **Dos sesiones dando ids del
`feature_list.json` en paralelo colisionan siempre**, y la convención de «la ficha con rama conserva
el id» no se aplicó aquí: se renumeró la que tenía rama, PR y 60 commits.

### ✅ La 188 (antes 184), cerrada por completo

**33/33 tareas. Review APROBADO en ronda 2. Gate `== init OK ==`: 950 archivos / 11.847 tests.**
Cero migraciones.

**H.3 no era un trámite: encontró dos huecos que ninguna lectura habría visto.**

1. **R16** —«no dos declaraciones separadas del mismo criterio», el hallazgo que da nombre a la
   feature— **no tenía nada que impidiera su regreso**. Bajo mutación, deshacer una constante y
   repetir el literal idéntico dejaba **129 tests de emisión en VERDE**. Ahora hay guardia.
2. **R26** no afirmaba que la acción de lote sobrevive a la poda: al hacer que la poda se pase de
   larga, **el caso nuevo falla y el viejo sigue verde**.

**Y tres filas del Anexo B del spec apuntan a casos que no existen donde dicen** (R2, R8, R12). La
cobertura existe, en otro archivo. **Un mapa copiado del spec habría heredado las tres** — por eso
se escribió contra el árbol.

### ⏳ Lo que queda vivo, con ficha

| Ficha | Qué | Por qué no entró |
| --- | --- | --- |
| **189** | columnas y orden de los 12 archivos, sin test | deuda **preexistente**: el diff no toca ninguna `COLUMNAS_DESCARGA_*` |
| **190** | Q-K6 rama B | estaba en el registro pero **nunca bajó al spec**; la 188 la deja desbloqueada |
| **191** | el `N+1` real de **R29 de la 170**, hoy derogado en 11 de 12 listados | el `count` del total exacto **pone rojos los tests de R15** de la 188. Ese conflicto ES el trabajo |

### 🚦 SIGUE PENDIENTE, cuarta jornada

**VER LA 172 Y LA 173 EN PANTALLA.** No lo sustituye ninguna suite, y hoy la app ya está en uso real
en producción.

---

## 🚦 2026-08-05 — **180 en revisión humana: PR #295 abierto**

**180 (`analitica financiera: desglose por fecha`)** implementada, revisada y con el gate completo
verde. **PR [#295](https://github.com/nuformecuador-lgtm/ordenex/pull/295) → `dev`, esperando merge.**
Worktree `C:/wser`, rama `feature/180-analitica-financiera-serie-temporal` (de `dev` @ `805fb253`).

- Review `progress/review_180.md`: **APROBADO-CON-NOTAS, cero bloqueantes**. Bitácora `impl_180.md`.
- **32/32 R** a test nombrado por comportamiento. **19 mutaciones, 18 muertas**; la 19 no es matable
  por comportamiento y está declarada, no escondida.
- Gate: **942 archivos / 11 775 tests, 0 fallos** (baseline `dev` 930 / 11 626 → **+149, cero
  regresiones**), lint 0 errores, `tsc` limpio, `next build` verde.

### Lo que esta feature enseñó, y que sirve para las siguientes

1. **La Q5 de su propia spec preguntaba por una feature que ya había aterrizado.** Era la 183, `done`
   y en producción, y además **no hizo lo que su ficha anunciaba**. Segunda vez en dos días (la otra
   fue M-4 en la 133): **entre que una deuda se anota y se lee, otra feature puede haberla saldado**.
   Comprobar en el código antes de planificar contra una ficha.
2. **`listasDeIdsAMano` no cubre lo que su nombre promete**: solo marca arrays de **dos o más** ids,
   así que una decisión por id suelto pasa verde. Está **medido** (censo propio rojo / guardia
   heredado verde 24/24). Sigue vivo para quien toque el tablero financiero — avisado en la ficha 186.
3. **La API se cayó cuatro veces** (522 de Cloudflare) matando implementer y reviewer. Lo que estaba
   commiteado sobrevivió intacto; lo que vivía en el working tree hubo que reconstruirlo dos veces.
   **Pedir tandas commiteadas pronto y bitácora incremental** cuando la plataforma esté inestable.

### Deudas vivas que deja, con dueño

- **187** (backend): el **R12 es cierto en los tests y NO está garantizado en runtime** — total y
  filas son dos consultas sin transacción. **No arreglarlo sumando las filas**: eso lo convierte en
  tautología.
- **186** (frontend): la gráfica de líneas que la Q4 dejó fuera a propósito. **Debe leer
  `granularidad` del DTO**: un rango largo llega en cubos **semanales**, y etiquetarlos como días
  miente sin poner ningún test en rojo.
- `⟨L4⟩` el `bruto` de `cuenta_por_pagar_mensajero` pasó a `devengo + pago`: hoy idéntico, pero un
  tercer valor del enum se caería en silencio.

> ⚠️ **Ojo, esas dos fichas se renumeraron el 05-ago al traer `dev`:** nacieron como **185** y **186**,
> pero `dev` ya había publicado (PR #292) una ficha 185 —el oráculo de conteo del filtro mensajero,
> cancelada—. Se corrieron en bloque a **186** y **187**. Las citas de arriba ya están corregidas.

### También en el aire

- **PR #292 (feature 133)** ya está **mergeado** (`03b593e7`): conflicto de `feature_list.json`
  resuelto y arnés de sus tests reparado. Queda su bookkeeping post-merge.
- **PR #293 (feature 166)** abierto y mergeable, gate verde, **esperando la franja 00:00–06:00 CR**.
- **134** (export CSV) **ya está en `dev`** (PR #294 mergeado), no en vuelo.
- **176**: su código ya está en `dev` (diff vacío); solo el registro se quedó en `in_progress`.

---

## 2026-08-05 — **166 implementada y aprobada** · ⛔ **PR abierto a la espera de la franja de despliegue**

Rama `feature/166-ranking-ventana-dia`, commit `60eabee6` sobre `origin/dev` @ `64957dca`.
Reviewer **APROBADO**, cero hallazgos bloqueantes (`progress/review_166.md`).

`RankingService` resolvía «hoy» como `[startOfDayCR(now), +24 h)`. `startOfDayCR` devuelve la
**medianoche UTC** de la fecha CR —convención correcta para columnas `@db.Date` de la 46—, pero
esas dos cotas se comparan contra columnas `timestamp` reales (`gestion_orden.created_at`,
`orden.asignado_at`): la ventana efectiva era **18:00→18:00 CR** y una entrega de las 19:00 CR
contaba para el día siguiente. Ahora se compone con `fechaCalendarioCR` +
`inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (convención de la 144): ambos bordes en
`...T06:00:00.000Z`.

**La divergencia D6/R31 de la 135 queda CERRADA.** El bloque `(c)` de `lib/analytics/ranges.ts`
ya no promete dos cifras distintas para «hoy», pero **sigue nombrando la trampa `startOfDayCR`**,
que sigue viva y sigue prohibida en `lib/analytics/**`. El guardia
`ranges-reuso.guardia.test.ts:98-106` se **reexpresó** a (`startOfDayCR`, `/18:00/`, `/166/`),
no se vació: mutación de control ejecutada y revertida.

### ⛔ Lo único que falta, y no es código: la hora del merge

**La ventana de despliegue 00:00–06:00 hora CR es OBLIGATORIA**, no una preferencia. El corte de
ventana es una **discontinuidad declarada** (Q1 = opción C: ni recálculo ni fecha de corte), y lo
que la hace inocua es que a esa hora el podio del día está vacío y no hay premio ya pagado que
desplazar. **Si el merge cae fuera de la franja, hay que volver a preguntar al humano.** Por eso
el PR se dejó **abierto sin mergear**. La ficha sigue en `in_progress` a propósito.

**Q3 sigue pendiente:** avisar a los mensajeros de que el corte del día pasa de las 18:00 a las
00:00 CR. Es tarea de despliegue, no de código; nadie la ha hecho todavía.

### Gate, medido dos veces

`926 files / 11 497 tests` en ambas corridas de `./init.sh` (el baseline de `dev` en `0c9ab8ce`
eran 913: la corrida **no** está degradada, `dev` avanzó). 1ª corrida: 4 rojos. 2ª: 1 rojo,
**conjunto disjunto** del anterior. Todos son timeouts de 20 s, todos pasan en aislado y ninguno
importa `RankingService`, `ranges.ts` ni `fecha-cr.ts`. **Delta atribuible a la rama = 0.**
Salvedad honesta: el cuarto rojo de la 1ª corrida quedó **sin nombrar** (log truncado), así que
lo que sostiene el delta 0 es la disjunción entre corridas, no la inspección de ese fichero.

**Deuda de entorno del worktree:** `C:\w166` nació sin `.env`, así que `pnpm db:generate` no
corría y el typecheck salía rojo por cliente Prisma ausente —**entorno, no contenido**—. Se copió
el `.env` del checkout principal antes de medir nada. Es el mismo tropiezo que en `C:\w180`.

---

## ✅ 2026-08-04 (tarde) — **183 EN PRODUCCIÓN**, y la validó un accidente tuyo — **LO DE PRODUCCIÓN, VIGENTE**

> *Esta sección decía «EMPIEZA A LEER POR AQUÍ» cuando era la más reciente. Sigue vigente entera
> —incluido el «LO PRIMERO AL RETOMAR» del final—, pero ya no es la de arriba: la 180 y la 166 del
> 05-ago la preceden. Se conserva intacta salvo este marcador, que había caducado.*

---

## 🏁 CIERRE DE JORNADA 2026-08-04 (noche) — **EMPIEZA A LEER POR AQUÍ**

### ✅ En producción hoy

| | Qué | Estado |
| --- | --- | --- |
| **release** | `dev → prod` #287 — 186 commits, 23 PRs, **5 migraciones** | ✅ `CHECK` **convalidado** contra las 35 filas reales, deploy READY, 0 errores |
| **173** | backfill de la caja: **5 filas, ₡203.055,90** | ✅ aplicado, idempotente, fechas del origen |
| **183** | el `neto` de las cuatro métricas de caja | ✅ PR #288 → release #289 → **en producción** |
| **fix** | tope de **negocio** de la indemnización, atado al valor de la orden | ✅ #291 mergeado |
| **arnés** | dos guardias ciegas + 3.er mecanismo del flake | ✅ #291 mergeado |

### 🔵 EN RAMA, SIN PR: la feature 184 (`feature/184-deuda-170-listados`)

**Los 12 listados CERRADOS.** `PENDIENTES_184` vacío, **0 llamadas a `filasDelConjuntoCompleto(`** bajo
`app/`, 8 tandas, **52 commits**. Gate completo **VERDE: 949 archivos / 11.824 tests**.

**Lo que falta, y en este orden:**

1. **H.3 — verificar el mapa `R1..R34` caso a caso.** La tanda H lo dejó sin hacer **y lo dijo**: comprobó
   por script que 16 títulos citados existen literalmente, lo que descarta nombres muertos pero **NO**
   que cada test mida su requisito. Es exactamente la verificación que hoy cazó cuatro coberturas falsas.
2. **Review** de la feature · 3. **PR a `dev`** · 4. **Release** (arrastra también el lote de deudas).

### 🚦 LO PRIMERO AL RETOMAR, ADEMÁS DE ESO

**VER LA 172 Y LA 173 EN PANTALLA.** Cuarta jornada pendiente. Hoy se empezó a usar la app en producción
y eso solo ya destapó el caso de los ₡10.000 millones.

### 🔎 Lo que sobrevive a esta jornada

**Cinco veces el spec afirmó una cobertura que no existía, y las cinco las cazó una MEDICIÓN, no una
lectura:**

1. **Una mutación sobrevivió** en la 183: el test que decía «el catálogo manda» medía `ingreso_flete`, no
   `egresos`, que es la definición que la feature cambiaba.
2. **R22 de la 183:** el guardia que el spec le asignaba **no caza** su mutación — `listasDeIdsAMano` solo
   marca arrays con ≥2 ids.
3. **R16 de la 127:** el requisito vivo **más directamente derogado** por la 183 —nombra las tres métricas
   una por una— y **ni el spec, ni ⟨D12⟩, ni las bitácoras lo miraron**. Lo cazó el reviewer.
4. **El `--reporter` inexistente** (tanda F): 7 corridas de mutación **fallaron al arrancar y parecían
   ejecutadas**.
5. **La guardia de la tanda H pasa VERDE con su propio detector roto**: encuentra cero llamadas porque no
   encuentra nada. Solo la salvan sus auto-tests. **Habría sido un adorno permanente.**

> **La regla que queda:** buscar los requisitos vivos afectados **leyendo el spec que cita tu archivo** no
> basta —así se encontraron R18 y R37 de la 127 y por eso se escapó R16, que no habla de `metrics.ts` sino
> del **contrato de salida**—. Hay que buscarlos por el **texto del contrato que cambia**.

**Y el criterio duplicado apareció en las SIETE tandas.** El `orderBy` estaba escrito dos o tres veces en
cada par; varias tandas lo habrían dejado en cinco. Ninguna estaba mal *hoy*, pero dos literales permiten
que el Excel y la pantalla se ordenen distinto **sin que ningún test lo note**, porque cada uno prueba su
copia. En la tanda F apareció la versión cara: **`alcanceWhere` —la guardia que decide si un `adminSatelite`
ve el dinero de otra zona— estaba declarada TRES veces.**

### ⚠️ Defecto de producción destapado, NO arreglado

**El archivo de «Saldos de tiendas» sale hoy sin orden determinista**: `listarSaldosTodasTiendas()` devuelve
orden de planificador y la tabla ordena por nombre, así que **dos descargas seguidas pueden diferir**. La
170 lo declaró desviación consciente cuando ese conjunto no sostenía archivo; ahora lo sostiene. La 184 lo
esquiva sirviendo el listado por el paginado, pero **el defecto de origen sigue ahí**.

### 🧰 Higiene de agentes: tres prohibiciones que costaron incidentes reales

En un worktree compartido: **nada de `git checkout -- .` / `restore .` / `stash`** (borró trabajo ajeno),
**nada de `git commit --amend`** (reescribió el commit de otro agente; recuperado con `reset --soft`), y
**verificar por hash que la restauración tras mutar funcionó** — a un agente le falló un `writeFileSync`
por un lock de Windows y **dejó la mutación aplicada en código de producción**.

---

## ✅ 2026-08-04 (tarde) — **183 EN PRODUCCIÓN**, y la validó un accidente tuyo

**183 `done`.** PR **#288** → `dev`, release **#289** → `prod` (**cero migraciones**), despliegue
**READY**, sin errores de runtime nuevos. `dev` y `prod` a **0 commits**. Review **APROBADO en ronda
2**; los dos bloqueantes de la ronda 1 eran de rastro y se cerraron **sin tocar código**.

### 🎯 La medición post-merge (`T18`) encontró algo que ningún test podía dar

Mientras se implementaba la feature, **alguien usó la app en producción** —lo que llevábamos tres
jornadas pidiendo— y registró, a las 18:12, una **indemnización de ₡9.999.999.999,99**; un minuto
después la revirtió con un ajuste manual («devolcuion»). Sin querer, **eso es exactamente el caso que
la 183 existe para arreglar**:

| Cifra de `egresos` | Valor |
| --- | --- |
| **Lo que mostraría SIN la 183** (solo las ocho `egreso_*`) | **₡10.000.054.062,39** — para siempre, aunque ya esté revertido |
| **Neto, CON la 183** (nueve categorías) | **₡54.062,40** — lo que salió de verdad |
| Bruto (volumen movido, P1 = (a)) | ₡20.000.054.062,38 |

**La reversión existía en el libro desde el minuto siguiente y la cifra la ignoraba.** Es el defecto
que ⟨D12⟩ nombró en abstracto, ocurrido de verdad en producción horas después de decidirlo.

> ⚠️ **Y deja una pregunta abierta que NO es de esta feature:** la app aceptó una indemnización de
> **diez mil millones de colones** (`origen_tipo: orden_incidente`, emitida por el camino automático,
> `registrado_por` nulo). Puede ser un monto de prueba puesto a propósito —es exactamente el máximo de
> `numeric(12,2)`—, pero **si no hay tope superior en el monto de una indemnización, eso es un agujero
> real** y no tiene dueño. Verificar antes de que la app deje de ser una base de pruebas.

**También quedó confirmado que el camino vivo de la 173 funciona en producción:** el cierre aprobado
de las 19:21 emitió **solo** su `ingreso_cod_recaudado` (₡45,90) automáticamente, sin backfill.

---

## 🚀 2026-08-04 — **RELEASE EN PRODUCCIÓN + BACKFILL DE LA 173 SALDADO**

**Lo que llevaba dos jornadas bloqueando todo está hecho y verificado en la base, no deducido del PR.**

### Release `dev → prod` (PR #287) — 186 commits · 23 PRs · 456 archivos · 5 migraciones

Pre-vuelo **rehecho** ese día, no reutilizado (es lo que salvó la release del 01-ago). Verificado
**después** de mergear:

| Comprobación | Resultado |
| --- | --- |
| Las 5 migraciones | ✅ `finished_at` puesto, `rolled_back_at` **nulo**, 1 paso cada una |
| `CHECK` categoría↔tipo de la 173 | ✅ **`convalidated = true`** — recorrió las 35 filas reales y **ninguna la incumplió** |
| Columnas, 3 índices, 2+1 valores de enum | ✅ todos creados |
| Migraciones rotas en toda la tabla | ✅ **0** |
| Despliegue de producción | ✅ **READY** |
| Errores de runtime | ✅ **ninguno** |

> ⚠️ **Un modo de fallo que ninguna bitácora había mirado en tres releases:** `caja_tesoreria` añade
> dos valores de enum y **los usa dentro del `CHECK` en el mismo archivo**, cosa que Postgres puede
> rechazar dentro de una transacción. Se descartó **empíricamente** (esa migración ya estaba aplicada
> en un Postgres real con este mismo runner), no por lectura. **El patrón se repetirá** la próxima vez
> que una migración añada un valor de enum y lo use acto seguido.

### Backfill de la 173 (`T H.4`) — **APLICADO**, 5 filas, ₡203.055,90

Se corrió **por MCP** (decisión del humano), no con el script: `DATABASE_URL` de prod no es
recuperable desde la sesión. Riesgo declarado y aceptado: en SQL **hay que declarar la categoría y el
origen**, que es la segunda declaración que `CajaBackfillTesoreriaService.ts:35-41` existe para
evitar. Quedó acotado porque **de los tres emisores solo había uno con documentos** (0 pagos a
tienda, 0 anulaciones) y porque la cifra **cuadra al céntimo** con la que el script midió en su día
—dos derivaciones independientes al mismo número—.

| Comprobación | Resultado |
| --- | --- |
| Filas insertadas / total | **5** · **₡203.055,90** exacto |
| Reejecutar el mismo INSERT | **0 filas** — idempotente por `wallet_movimiento_origen_categoria_uq` |
| Cierres aprobados sin su movimiento | **0** |
| Filas fechadas después de julio | **0** — la fecha sale del ORIGEN, nunca del reloj (R41) |

**Y las dos cifras de la caja ya difieren en producción, que es para lo que existe la 173:**
**Dinero en caja ₡252.666,45** · **Ganancia de Ordenex ₡49.610,55** · de terceros ₡203.055,90.
La ganancia **no se movió ni un céntimo** con el backfill: el contra-entrega es dinero de las tiendas.

### 🚦 LO PRIMERO AL RETOMAR

**VER LA 172 Y LA 173 EN PANTALLA.** Lleva **tres** jornadas pendiente y no lo sustituye ninguna
suite. Ahora hay algo concreto que mirar: la caja de producción muestra **dos cifras distintas por
primera vez**.


---

## 2026-08-04 — **175 y 178 cerradas** · **alta de la 183** · **EN CURSO: spec de la 180**

### ✅ Cerradas hoy — las dos ya estaban en `dev`, lo que faltaba era el bookkeeping

| | PR | Estado |
|---|---|---|
| **175** analítica: corregir el catálogo de métricas | **#277** (03-ago) | `done` |
| **178** purga diaria de los PDF de cargas | **#284** (`e4cf28ad`) | `done` |

Ninguna de las dos esperaba un PR: ambas estaban **mergeadas** y la bitácora anterior lo decía mal.
El detalle de cada una vive ya en `progress/history.md`; aquí solo queda lo que **condiciona trabajo
futuro**.

**La 175 no cerró su cuarta divergencia: la movió.** Su nota exigía «cerrarla o moverla a una ficha
propia»; se movió, intacta, a la **ficha 183** recién dada de alta (nació como 182 y se renumeró: ver abajo).

> ⛔ **EL PÁRRAFO SIGUIENTE QUEDÓ SUPERADO EL MISMO DÍA. NO LO SIGAS.** Lo sustituye ⟨D12⟩
> (`progress/decision_183.md`): se retira la distinción en **TRES** métricas, y `egresos` **SÍ** gana
> `ingreso_ajuste` y conserva su neto. El motivo que se lee abajo se midió contra producción y es
> **falso**: había **cero** filas `ingreso_ajuste` y cero `egreso_ajuste`, así que el cambio no movía
> ninguna cifra. Se conserva el texto porque explica de dónde venía la ficha.

~~**Decisión humana del 2026-08-04,
ya tomada, que el spec_author de la 183 no debe reabrir:** las cuatro métricas de caja
(`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos`) **retiran la distinción
`neto`/`bruto`** y se quedan solo con el bruto. **NO** se le da `ingreso_ajuste` a `egresos`: eso
movería una cifra de dinero ya publicada, justo lo que la P4 de la 173 quiso evitar.~~
**Ojo al alcance de la 183:** el `neto` **no desaparece del sistema** —en la vista B (ledger de tienda)
y en `derivarBalance` (R20 de la 127) el signo significa algo real y se conserva—. Es «retirar donde es
degenerado», no «retirar el campo». Medido antes de dar el alta: toca el DTO, el servicio (11
ocurrencias), los dos repos, el `TableroFinanciero` de la 132 —que pinta el `neto` como KPI principal
con el bruto de línea secundaria, **R14/R16 de una feature `done`**— y `adaptar.ts`. Más **dos dobles
en memoria que la 173 dejó sin tocar a propósito** esperando esta decisión:
`tests/unit/analytics/financiera-ingresos-repo.test.ts:124` (fila cruzada `egreso_ajuste` + tipo
`ingreso`) y `tests/unit/services/analitica-financiera-derivacion.test.ts:177`, verdes hoy **solo
porque no pasan por el `CHECK`** de la base.

**Lo que la 177 dejó vivo y sigue vigente:** el testigo de «el PDF existe» es la columna
**`download_storage_path`**, NO `download_url` —esta última guarda URLs firmadas ya caducadas de la
136—. La purga de la 178 anula **las dos**; si dejara viva la primera, `/generate` se saltaría la
generación y **firmaría un objeto ya borrado** (200 con URL que da 404).

**⚠️ Deuda de entorno SIN DUEÑO, ajena y preexistente:** el drift de la base local (migración fantasma
`20260728120000_...` presente en la base y ausente del repo, más un checksum modificado en
`20260714123909_...`) hace fallar `pnpm db:migrate`. Por eso el round-trip `migrate`/`rollback` de la
migración de la 178 **quedó sin medir**; se aplica con `prisma migrate deploy`, el mismo comando del
build. **Sigue sin dueño.**

### 🟡 SPEC ESCRITO, PUERTA CERRADA — feature **180**, desglose por fecha de la analítica financiera

`AnaliticaFinancieraService` agrega la ventana **entera** y publica `filas: []` en las vistas de grano
`fecha`: **hoy no existe serie temporal que dibujar** en el tablero financiero.

Spec en `specs/180-analitica-financiera-serie-temporal/` — **32 R, 22 tareas**. Tres hallazgos que
**corrigen la ficha**, todos verificados contra el código, no supuestos:

1. Las métricas de caja son **SEIS**, no cuatro: la 173 añadió `dinero_en_caja` y `ganancia_ordenex`,
   que salen del mismo repositorio y del mismo material.
2. La NOTA de la ficha («comprobar si el rollup de la 123 ya guarda el grano por fecha») queda
   **cerrada en negativo**: `analytics_daily` no tiene **ninguna** columna de dinero *y* la 127 tiene
   **prohibido** leerla por guardia (`financiera-fuente.guardia.test.ts`). Esto es **producir** el
   desglose desde los ledgers, no exponerlo — bastante más caro de lo que la ficha suponía.
3. `cuenta_por_pagar_mensajero` es **saldo al corte** (su repo agrega sin cota inferior), así que su
   serie es un **acumulado corrido** que necesita el saldo anterior al rango, no un `groupBy` por día.

**Puerta humana del 2026-08-04, cuatro bloqueantes respondidos:**

| | Decisión |
|---|---|
| **Q1** alcance | Las **SIETE** métricas sin cubo (las 6 de caja + `cuenta_por_pagar_mensajero`), no las 5 literales de la ficha ni las 9 de tipo `vistas`. |
| **Q3** techo | Por encima de 62 puntos el **servidor agrega en cubos semanales** y lo declara en el DTO. El comentario de `topes.ts` justifica el 62 como «53 semanas ya agregadas + margen»: el número se eligió suponiendo esta agregación. |
| **Q4** frontend | **Solo backend.** El cableado de la gráfica va en ficha aparte; el tablero es propiedad de una feature `done` con guardia de censo. |
| **Q5** orden | **La 183 aterriza primero**, y la 180 nace publicando solo los campos que sobreviven. Evita tocar el mismo DTO dos veces con dos puertas y dos revisiones. |

**Q2** (marcar el cubo en curso como parcial) y **Q6** (SQL crudo acotado en un repositorio de dinero)
siguen **sin responder**: no son bloqueantes, pero Q6 condiciona `design.md` §5 y R23/R25.

### ⚠️ DRIFT DE SESIONES PARALELAS medido hoy — léelo antes de tocar la 180

Mientras esta tanda estaba viva, **otra sesión hizo dos cosas en este mismo checkout**:

1. **Movió el `HEAD`** de `chore/cierre-175-178` de vuelta a `ux` entre mi `switch` y mi `commit`, así
   que el commit de bookkeeping aterrizó en `ux` y el `push` subió la rama chore vacía. Se rescató por
   `cherry-pick` sobre un worktree limpio; **el commit sigue también en `ux`**, sin pushear.
2. **Mergeó la feature 176 a `dev` (PR #285)** — y con ella dio de alta una ficha **182**
   («cablear el modo agregado al tablero operativo»), que colisionó con la 182 que yo acababa de dar de
   alta. Por la convención del repo (la ficha con rama conserva el id) **la mía se renumeró a 183**.

**Consecuencia para la 180 que NO se puede ignorar:** su spec se escribió contra un `dev` **sin la
176**, pidiéndole al spec_author que se alineara con un contrato de cubo temporal entonces hipotético.
Ese contrato **ya existe y está mergeado** (`consultarAgregadoOperativo`, cubos semanales, cubo
`periodo`). Antes de implementar, el design de la 180 tiene que **releerse contra la 176 real** y
declarar si su forma de cubo coincide; si no coinciden, tendremos dos contratos temporales
incompatibles en el mismo módulo, que es exactamente lo que se quiso evitar. **Nadie lo ha hecho aún.**

**Zonas:** `backend` con la 176 aún marcada `in_progress` en `feature_list.json` **pese a estar
mergeada** (bookkeeping de esa sesión, no lo toco). La 180 sigue `pending` a la espera del repaso
contra la 176 y de la 183, que va delante.


## 🏁 CIERRE DE JORNADA 2026-08-03 (tarde) — **EMPIEZA A LEER POR AQUÍ**

**Cero PRs abiertos. `dev` VERDE con los cuatro PRs del lote YA DENTRO** —no por separado, que es el
incidente del #237—: `./init.sh` → `== init OK ==`, **906 archivos / 11.359 tests, 0 fallos**.

### ✅ Entregado esta tarde

| | Qué | PR |
| --- | --- | --- |
| **173** | la caja distingue **«Dinero en caja»** de **«Ganancia de Ordenex»**; la palabra «balance» desaparece | #278 + #279 |
| **arnés** | el flake de jsdom: **eran TRES mecanismos**, y acotar workers no arreglaba ninguno | #280 |
| **170** | la búsqueda de cuentas por pagar **ignora acentos** + el tercer mecanismo del flake | #281 |
| **170** | aviso de **selección en otras páginas** en bodega satélite (Q-K7) | #282 |

### 🚦 LO PRIMERO AL RETOMAR

1. **RELEASE `dev → prod`: son 166 commits y llevan MIGRACIONES** (el `CHECK` categoría↔tipo de la
   173 y sus dos valores de enum, entre otras). **Mergear a `prod` ES aplicar.** Producción se midió
   antes de escribir ese `CHECK` —35 filas, 0 lo violarían— **pero eso fue antes de estas 166**:
   **rehacer el pre-vuelo**, no reutilizarlo. Es lo que salvó la release del 2026-08-01.
2. **Después del release, y solo después: el BACKFILL de la 173** (`T H.4`). Los dos valores nuevos
   del enum **no existen en producción** hasta desplegar. Medido: **5 cierres con ₡203.055,90** de
   contra-entrega esperando; 0 pagos a tienda, 0 anulaciones. Orden: `--simular` → **revisión humana
   del informe** → `--aplicar` → `--comprobar` → lectura por MCP. Sin flag **no escribe nada**.
3. **VER LA 172 Y LA 173 EN PANTALLA.** Lleva dos jornadas pendiente y es lo único que ninguna suite
   sustituye. La 173 volvió a tocar esas mismas pantallas.

### ⏳ Sin dueño, y conviene que lo tengan

- **La 175 sigue `in_progress` A PROPÓSITO, aunque su PR #277 esté mergeado.** Entregó **tres** de sus
  cuatro divergencias; la **cuarta** —el `neto` de las métricas de caja nunca puede diferir del
  `bruto`— sigue abierta, **verificado contra el código el 2026-08-03**. Si alguien la pasa a `done`
  por inercia, el hallazgo se queda huérfano. Detalle en su `status_note`.
- **Los 12 listados de la deuda de la 170 NO son un chore: son una tanda fullstack** del tamaño de la
  I. El «8» de la nota vieja contaba **dominios**, no listados, y **los 12 exigen tocar `app/**`**
  (el adaptador de descarga vive en el componente), así que entregar solo los métodos dejaría **12
  Server Actions muertas**. Inventario listado a listado y prioridad por coste medido en
  `progress/chore_deuda_170.md`. **Borrador de ficha propuesto, NO registrado.**
- **La selección de bodega satélite nunca se poda.** Preexistente e **invisible hasta hoy**; el aviso
  nuevo la hace contable, así que el número puede inflarse si una orden marcada sale del listado
  (p. ej. al reportarle un incidente). Podarla necesita al **servidor**: encaja con la tanda de los 12.

### 🔎 Lo que sobrevive a esta jornada

**El flake de jsdom no era un mecanismo, eran TRES** — y la vía que se daba por buena, acotar los
workers, **no arreglaba ninguno**: medido, **−3%** en el test lento y **+11%** en la suite entera.

| | Mecanismo | Se manifiesta como |
| --- | --- | --- |
| 1 | `await import()` **dentro del test** mete la carga del árbol bajo `testTimeout` | timeout a 20 s |
| 2 | `waitFor` sobre una **ausencia** + aserción **síncrona** de presencia | elemento no encontrado |
| 3 | **snapshot del DOM tomado antes de que la carga asiente** | dos fotos que difieren |

Eso explica por qué subir el `testTimeout` a 20 s lo hizo más raro sin matarlo: trataba el (1) y no
tocaba los otros dos, que **no dependen del tiempo sino del orden**. Y la frase que resume el día:
**un ancla que el estado transitorio también cumple no es un ancla** —durante la carga, `getAllByRole
("row")` daba 2, el mismo número que el estado asentado—.

> ⚠️ **Los tres aparecieron UNO POR SUITE COMPLETA, cada uno cuando el anterior dejó de taparlo.** Una
> corrida verde no cierra esto. El detector escrito cubre el (2), **NO el (3)** —medido: 0 antes y 0
> después—; la mitigación del (3) es una guardia en ejecución, no un barrido. Población en riesgo: 42
> capturas de DOM.

**Y cinco veces más el patrón del año, en la 173:** la guardia de la 172 rota al hacer entrar la caja
(afilada, no vaciada); un test de la 127 que insertaba **una fila que la app no puede producir**;
cuatro filas de trazabilidad falsas, **dos apuntando a archivos que nunca existieron**; **R53 sin
ningún test** —borrar la descripción de `egresos` dejaba la suite entera en verde—; y que **contar
`R\d+` en títulos cruza espacios de nombres**, lo que daba un tranquilizador **falso 68/68**.

---

## 💰 2026-08-03 — **173 `done`: la caja ya distingue el dinero de la ganancia** · PR #278 MERGEADO

**Las 9 tandas hechas, review APROBADO en ronda 2, `./init.sh` completo VERDE con los 61 commits de
`dev` dentro: 904 archivos / 11.337 tests, 0 fallos.** Relato completo en `progress/history.md`.

> ⚠️ **NO está en producción todavía, y el backfill DEPENDE de que llegue** (ver punto 2 de abajo).

**Qué cambia para el maestro:** la caja deja de tener un solo número. Ahora muestra **«Dinero en
caja»** (todo lo que entra y sale, incluido el contra-entrega cobrado a nombre de las tiendas) y
**«Ganancia de Ordenex»** (el número que hasta hoy se llamaba «Balance general»). **La palabra
«balance» desaparece de la pantalla**, porque era la que mentía.

### Las 7 respuestas del humano, todas con su default

P1=(a) … P7=(a). La cara era **P2: el pago al mensajero NO pasa a tesorería**, así que la caja queda
mixta y «Dinero en caja» se queda corto **exactamente** en la cuenta por pagar a mensajeros —cifra
que el sistema ya publica—. Se equivoca **por lo bajo**, nunca dice que hay más dinero del que hay.

### ⏭️ LO PRIMERO AL RETOMAR

1. **RELEASE `dev → prod`, y ya no es barato: `dev` está 153 commits por delante.** Lleva las
   features 126, 127, 128, 131, 132, 173, 175 y 177, y **varias migraciones** —entre ellas el `CHECK`
   categoría↔tipo de la 173 y los dos valores de enum—. **Mergear a `prod` ES aplicar.** Producción se
   midió antes del `CHECK` (35 filas, 0 lo violarían), pero **eso fue antes de estas 153**: conviene
   rehacer el pre-vuelo, como se hizo en la release del 2026-08-01 en vez de reutilizar el del día
   anterior.
2. **`T H.4` es POST-DEPLOY y no es un olvido:** los dos valores nuevos del enum **no existen en
   producción** hasta que la migración se aplique al desplegar, así que el backfill **no se puede
   correr antes**. Medido en producción: **5 cierres con ₡203.055,90** de contra-entrega esperando su
   registro retroactivo; 0 pagos a tienda y 0 anulaciones. El orden es: merge → release → `--simular`
   → revisión humana → `--aplicar` → `--comprobar` → lectura por MCP.
3. **Preview sigue sin ser alcanzable** (quinta vía descartada: `list_branches` falla y
   `get_project_url` devuelve el ref de producción). Riesgo residual **declarado** en
   `progress/medicion_TA0_173.md`, igual que en la 172.

### 🔎 Lo que sobrevive a esta feature

**El `CHECK` categoría↔tipo destapó que el «neto» de las métricas de caja NUNCA puede diferir del
«bruto».** Las cuatro métricas que leen `wallet_movimiento` declaran listas homogéneas de prefijo, así
que cada una solo puede contener un `tipo`. **No lo rompió la 173**: ya era cierto en producción por
las tres barreras de la app; el `CHECK` solo lo hizo visible. **Dirigido a la 175 y AÚN ABIERTO tras
mergear su PR #277** — ver su `status_note`.

**Y cinco veces más apareció el patrón del año: un test verde que no medía lo que decía.**

- la **guardia de la 172** que decía «la caja no entra en la feature», rota al hacerla entrar —afilada,
  no vaciada—;
- un test de la **127** que insertaba una fila **que la aplicación no puede producir** (`egreso_ajuste`
  con tipo `ingreso`);
- **cuatro filas falsas de trazabilidad**, dos apuntando a archivos **que nunca existieron**;
- **R53 sin ningún test**: borrar la descripción de `egresos` dejaba la suite **entera** en verde. Lo
  cazó el reviewer, y el arreglo trae el texto viejo como fixture para que el caso no pueda engañarse;
- **contar `R\d+` en títulos CRUZA espacios de nombres** (el R32 de la 172 y el R35 de la 158 salen en
  este diff): daba un falso 68/68.

### 🧩 Tres cascadas del merge con `dev`, ninguna es defecto de nadie

`dev` trajo 61 commits (128/131/132/175/177). Chocaron: **cliente Prisma stale + 2 migraciones sin
aplicar en local**; el **componente** del tablero financiero (8→10 métricas); y su **cargador**, que
`vitest related` **no puede seleccionar** —es hermano sin arista del anterior—. Además la guardia
`catalogo-produccion` de la 175 asumía **«una métrica, una decisión»**, premisa que `egresos` rompe al
tener dos legítimas: generalizada a «cada fecha respaldada por **alguna** decisión citada», con dos
mutaciones que la prueban.

> ⚠️ **Colisión de nombres de migración entre sesiones:** `20260803120000_caja_tesoreria` (esta rama) y
> `20260803120000_download_storage_path` (de `dev`) comparten timestamp. Hoy da igual —tocan tablas
> distintas y Prisma desempata por nombre—, pero si dos sesiones tocaran la misma tabla el orden
> dejaría de ser indiferente y **nadie lo notaría hasta el despliegue**.

---

## 2026-08-03 — **127 servicios financieros → PR #269, esperando merge**
## 🏁 CIERRE DE JORNADA 2026-08-03 — **EMPIEZA A LEER POR AQUÍ**

**Registro limpio: cero features `in_progress`, cero PRs abiertos, `dev` verde.**
Medido con los dos PRs del día **ya dentro** —no por separado, que es el incidente del PR #237—:
`./init.sh` → `== init OK ==`, **804 archivos / 10.162 tests, 0 fallos**.

### ✅ Entregado hoy

| | Qué | Estado |
| --- | --- | --- |
| **172** | liquidación: registrar y anular pagos a mensajeros y tiendas | `done` · **en producción** (PR #262 → dev, release #263 → prod) |
| **fix** | la fecha de calendario inexistente, en **4 sitios** | PR #266 · en `dev` |
| **arnés** | gate en dos niveles + arranque de tests 5× más barato | PR #267 · en `dev` |

### 🚦 LO PRIMERO AL RETOMAR

1. **Mirar la 172 en pantalla.** Es lo único que no se puede verificar con tests y **sigue sin
   hacerse**. Cambia tres cosas que ve el maestro: la wallet de tiendas gana el botón de pagar y su
   lista de comprobantes, aprobar un cierre **ofrece pagar** justo después, y `/mi-wallet` pasa de
   «Créditos / Débitos» a **tres importes**.
2. **`dev` está 19 commits por delante de `prod`, y esta vez el release es BARATO: cero migraciones
   nuevas.** Solo código. Lleva el arreglo de la fecha y el arnés.

### ⏳ Decisiones tuyas con default ya tomado (cambiarlas más tarde sale caro)

- **N1** — el par pago + anulación deja los importes **brutos** inflados aunque **el saldo queda
  exacto**. Se declaró en pantalla en las 4 superficies con agregado. Netearlo exigiría **2 valores
  de enum nuevos** o reescribir la derivación de la 171.
- **N2** — hoy un pago se puede anular **siempre**, sin ventana temporal.

### ⏭️ Lo siguiente

1. **173 — caja en modo tesorería.** Dependía de la 172; **ya está desbloqueada.**
2. **Chore del flake de jsdom.** Es lo que obliga a re-correr la suite **entera** para distinguir un
   flake de una regresión (en la 172 costó dos corridas, ~8 min). Se dejó sin hacer **a propósito**:
   la vía es acotar los workers de jsdom, pero hay que **medirlo**, no adivinarlo.
3. **Deuda dirigida de la 170:** los 8 `listarXCompleto` que faltan (Q-I5 + Q-K4 + Q-K6) y la
   búsqueda de cuentas por pagar que **no ignora acentos** (Q-L4, defecto preexistente).
4. **Aviso en bodega satélite** (Q-K7 de la 170): lo marcado en otra página se conserva pero **no
   participa** en la acción de lote y nada lo advierte. Chore de frontend pequeño y **ya decidido**.
5. **Higiene:** siguen ~33 worktrees de agentes en `.claude/worktrees/`, todo pusheado y mergeado.

### 🔎 Lo que sobrevive a esta jornada

**Cinco veces apareció el mismo patrón: un test verde que no medía lo que decía.** Es el hallazgo
del día, más que cualquier feature:

- el store de concurrencia que dejaba pasar la ausencia de candado;
- la respuesta P3 del humano afirmada **con una prop en vez del eslabón rol → prop** (poner ese
  predicado en `true` no rompía **ninguno** de los 9.857 tests);
- el parser del test de migración que **moría ante la mutación que existe para cazar** — corrían
  cero casos y el error señalaba a otro sitio;
- el caso «rechaza un día que no existe», verde por la comparación lexicográfica y no por la
  validación;
- el `"2026-13-45"` de `filters.test.ts`, que ya no discrimina lo que su nombre promete.

**Los cinco los cazó una mutación, ninguno un test verde.** La regla que queda: si no has visto el
test **fallar**, no sabes qué mide.

> ⚠️ **Hay otra sesión viva en este repo**: acaba de mergear la **feature 125** (backfill histórico
> de analítica). Antes de tomar una rama, mirar si ya lo está haciendo alguien.

> 📌 **Escrito antes de mergear.** Después de este cierre entraron en `dev` la **127** (PR #269), la
> **126** (PR #270) y un PR de **UX** (#271) de otra sesión — por eso «cero PRs abiertos» y la
> distancia contra `prod` que se leen arriba ya no son la foto de ahora. Ese PR de UX **borró
> `app/(app)/perfil/`**; comprobado que no deja enlaces vivos rotos (solo lo citan specs viejos).

---

## 2026-08-03 — **127 servicios financieros → PR #269, YA MERGEADO en `dev`**

Feature **127 → `done`**, PR **#269** hacia `dev` (rama `feature/127-analitica-financiera-servicios`,
worktree `ordenex-wt-127`). Reviewer **APROBADO, 0 bloqueantes, 7 menores** (1–3 cerrados en el PR;
4–7 en `progress/review_127.md`). Suite post-merge **821 archivos / 10411 tests, 0 rojos**. Cierre
narrado en `progress/history.md`; bitácoras `impl_127.md`, `impl_127_C/D/E.md`.

**Lo único que hay que saber antes de tocar nada relacionado:** esta feature modificó
`lib/analytics/metrics.ts`, que es **el catálogo de la 135 y fuente única de trece features**. El
diff son **exactamente tres cosas**, cada una con autorización humana fechada en
`progress/decision_C2_127.md` — ⟨D8⟩ `egresos.estadoProduccion`, ⟨D10⟩ los tres ledgers en
`conciliacion_cierres.fuente.tablas`, ⟨D11⟩ el comentario que ⟨D8⟩ dejó mintiendo. **Esa autorización
no se hereda:** la siguiente feature que necesite ese archivo necesita la suya.

**Aviso a la 132:** cinco de las ocho métricas sirven `filas: []` con sólo `total` pese a declarar
`granos: ["fecha"]` — no hay serie temporal que pintar ahí (pregunta abierta 5 del spec).

**Deuda que NO es de la 127 y sigue sin dueño:** C7 (`derivarCuentaPorPagar` de la feature 44 puede
devolver monto negativo con `signo: "cero"`) y el defecto de `whereRollup`, dirigido a la **126**.

**Nota de entorno:** la base local tiene aplicada `20260728120000_orden_historial_origen_deshacer_asignacion`,
que **no existe en `prisma/migrations`**. Residuo de otra rama sobre la misma base, ajeno a la 127.

---

## 🛠️ 2026-08-03 — el gate ya no se corre entero en cada tanda

Pedido del humano: *«el proceso del arnés está hecho para mejorar el trabajo, no para alargar las
sesiones eternamente»*. Tenía razón y estaba medido: la 172 corrió la suite completa **9 veces**,
~35 minutos de reloj **solo esperando**.

### Lo que cambia

```bash
./init.sh --rapido   # CERRAR UNA TANDA — ~58 s
./init.sh            # CERRAR LA FEATURE y ANTES DE CADA PR — ~4 min 23 s
```

`--rapido` corre typecheck + lint + **los tests que el grafo de imports relaciona con tu diff**
(`vitest --changed origin/dev`) + **todas las guardias**. Medido en este repo:

| Qué corres | Archivos | Tests | Tiempo |
| --- | --- | --- | --- |
| suite entera | 804 | 10.139 | 235 s |
| relacionados con un servicio | 16 | 437 | 21 s |
| relacionados con un util muy importado | 155 | 2.577 | 103 s |
| **`./init.sh --rapido` entero** | — | — | **58 s** |

> **Las guardias van SIEMPRE y no es un adorno.** No importan lo que vigilan: recorren el **árbol
> de archivos** (censo de tablas, columnas sensibles, módulos puros), así que **ningún grafo de
> imports las selecciona** — serían justo lo que se pierde. Cuestan ~8 s y se eligen por patrón
> (`vitest run guard`), no por lista: una guardia nueva entra sola. Esto no es hipotético: la
> guardia del censo de tablas de la Tanda H de la 172 no la habría seleccionado ningún grafo.

### El arranque costaba 5× más que ejecutar los tests

**617 de los 804 archivos corren en `node`** y ninguno usa los matchers de DOM, pero los 804
importaban `@testing-library/jest-dom/vitest`. Ahora el import es **condicional al entorno**.
Medido sobre 130 archivos de servicio:

```
antes:  14,35 s   (setup 51,19 s de CPU)
ahora:  10,69 s   (setup  4,10 s)        <- mismos 2.270 tests en verde
```

### Los subagentes ya no corren la suite completa (`AGENTS.md`)

**Cinco subagentes murieron por cortes de stream** en la sesión de la 172, y los cinco cayeron en
la fase de verificación larga: 4 minutos sin emitir nada bastan para romper el stream, y
reanudarlos cuesta replicar 250k+ tokens. En cuanto se les dijo «corre solo tus archivos, el gate
lo corro yo», dejaron de caerse. Además **un subagente no tiene contexto para juzgar un rojo
ajeno**: no sabe si `CuentasPorPagarTable` es el flake conocido o una regresión suya.

### ⏭️ Lo que queda de esto, y NO lo hice a propósito

**El flake móvil de jsdom sigue vivo y merece su propio chore con medición.** Hoy obliga a
re-correr la suite **entera** para distinguir flake de regresión: en la 172 costó dos corridas
completas (~8 min) decidir que `CuentasPorPagarTable` no era una regresión de la Tanda C. El
`testTimeout` ya se subió a 20 s por esto — es un síntoma tratado, no la causa. Acotar los workers
de jsdom (`poolOptions`) es la vía, pero hay que **medirlo**, no adivinarlo, y por eso no entra
aquí.

---

## 🚀 2026-08-03 — **172 EN PRODUCCIÓN**

**Ya existe forma de registrar un pago, y está desplegada.** Era el agujero de fondo del sistema:
hasta ayer los saldos solo crecían y a nadie se le podía decir «ya pagué». **172 → `done`.**
PR **#262** a `dev` y release **#263** a `prod`; `dev` y `prod` a **0 commits de diferencia**.

Bitácora en `progress/impl_172-liquidacion.md`, review en `progress/review_172-liquidacion.md`,
entrada de cierre en `progress/history.md`. **Review aprobado en ronda 2**; la ronda 1 rechazó con
dos bloqueantes y **los dos eran huecos de verificación, no de código** —se cerraron sin tocar una
línea de `lib/`, `app/`, `components/` ni `db/`—. Trazabilidad **85 de 85**.

### ✅ Producción verificada EN LA BASE, no deducida del PR

El release llevó **126 commits / 31 PRs** y aplicó **tres** migraciones. Comprobado después:

| Comprobación | Resultado |
| --- | --- |
| Las 3 migraciones en `_prisma_migrations` | ✅ `finished_at` puesto, `rolled_back_at` **nulo**, 1 paso cada una |
| Los 5 CHECK nuevos | ✅ **`convalidated = true`** — recorrieron las filas reales y **ninguna las incumplió** |
| RLS en `liquidacion_pago`, `liquidacion_anulacion`, `analytics_daily` | ✅ activa y **sin políticas** (patrón solo-service-role) |
| `UNIQUE` de `clave_idempotencia` y de `pago_id` | ✅ los dos existen |
| Despliegue de producción | ✅ **READY** |
| Errores de runtime tras desplegar | ✅ **ninguno** |

> **R61 se cerró por la vía empírica, no por medición previa.** No se pudo medir la base de preview
> —el MCP está fijado al `project_ref` de producción—, así que el hueco se cerró al **aplicarse**:
> el build del PR #262 corrió la migración contra preview y el `ADD CONSTRAINT` validó sus filas sin
> rechazar ninguna. El humano aceptó el riesgo a sabiendas, con el dato de que **preview y prod son
> bases de prueba con datos desechables** hasta que la app esté terminada.

### 👀 LO PRIMERO AL RETOMAR: **mirarlo en pantalla**

Nada de esto se ha visto funcionando con una persona delante — la verificación es por suite, que es
el trato aceptado desde la 170. Y la 172 **cambia lo que ve el maestro**: la wallet de tiendas gana
el botón de pagar y la lista de comprobantes, la aprobación de un cierre ahora **ofrece pagar**, y
`/mi-wallet` pasó de «Créditos / Débitos» a **tres importes**. Si algo se ve raro en producción,
empezaría por ahí.

### 🧯 Lo que el review destapó y conviene no olvidar

Los dos bloqueantes fueron del mismo tipo —**tests que no medían lo que decían medir**— y el
segundo es el que más enseña: la respuesta **P3** del humano (`adminSatelite` no paga) se afirmaba
pasando una prop, **no ejercitando el eslabón rol → prop**, que es donde vive la decisión. Poner
ese predicado en `true` **no rompía ninguno de los 9857 tests**. Y el guard correcto sí existía…
en la otra página, donde un `notFound` previo lo hace **inerte**. *El guard estaba donde no puede
fallar y faltaba donde se toma la decisión.*

Al cerrar el primero apareció algo peor todavía: **el parser del propio test de migración se caía
ante la mutación que ese test existe para cazar**. Con `NOT VALID` en el último CHECK, el módulo
reventaba al importarse y corrían **cero casos** (`Tests no tests`) — la aserción nueva nunca
habría llegado a ejecutarse, y el error apuntaba a otro sitio. **Un guard cuyo propio parser muere
ante la mutación es peor que no tenerlo.**

### ✅ T0.9 resuelta (era lo único abierto de la Tanda 0): **la 172 arranca YA, sin esperar**

No hay colisión con la 170 fase 2: **la 170 y la 171 están las dos en `done`** y sus 6 PRs
(#248, #249, #250, #253, #255, #256) están en `dev`, así que nada sigue en vuelo sobre
`app/(app)/wallet/tiendas/**` ni `app/(app)/cierres-admin/**`. Zona `fullstack` en **0
`in_progress`** antes de arrancar. **Tanda 0 cerrada por completo.**

### ✅ T A.0 — producción MEDIDA y limpia; **preview NO, y es lo único que hay que cerrar antes de mergear**

Medido el 2026-08-02 por el MCP de Supabase contra producción (`scfnwxqbsgkzwsdntdvd`):
**39 + 7 = 46 filas** en los dos libros, **CERO incoherentes** con el CHECK heredado. Y —lo que
nadie había comprobado— los CHECK son **exhaustivos** sobre los enums reales: **10/10** categorías
del ledger de tienda y **5/5** del libro del mensajero, ni una de más. La migración puede ir sin
`NOT VALID`, como decía el diseño.

> ⚠️ **PENDIENTE HUMANO, y bloquea el MERGE (no el código):** la base de **preview no se pudo
> verificar**. El MCP está fijado por `.mcp.json` al `project_ref` de **producción** y preview tiene
> base propia desde el 2026-07-27; su ref no es descubrible desde la sesión (el MCP de Supabase no
> expone `list_projects`, `get_project` de Vercel no devuelve env vars, no hay CLI de Vercel, y el
> ref no está escrito en ningún archivo del repo). **Riesgo real y acotado:** producción está a
> salvo; lo que puede pasar es que el build del PR salga rojo y deje una fila fallida en el
> `_prisma_migrations` de preview, que **bloquea los despliegues de preview siguientes** hasta
> repararla a mano. La consulta exacta que hay que correr está en `impl_172-liquidacion.md`.
> **Para cerrarlo hace falta el `project_ref` de preview, o correr esa consulta en su SQL editor.**

### ✅ T H.3 — los constraints ACTÚAN, no solo están escritos

Verificado contra Postgres local, porque los tests de migración de este repo son **estáticos**
(regex sobre el SQL) y un CHECK bien escrito que no se aplica no protege nada. Round-trip
`up → down → up` verde con los enums intactos y cero filas reescritas; y 14 INSERT bajo savepoint:
`pago_tienda`+`credito` → **rechazado 23514**, `liquidacion`+`devengo` → **rechazado 23514**,
segunda anulación del mismo pago → **rechazado 23505** con el pago intacto. Tres contrapruebas
aceptadas, que es la mitad que suele faltar: **el CHECK no rechaza de más**.

### 📦 Las 9 tandas, entregadas

| Tanda | Qué | Commit |
| --- | --- | --- |
| **0** | puerta cerrada (T0.9 resuelta por el leader) | `dd0902ee` |
| **A** | migración: 2 tablas + los 2 CHECK heredados, tipos y derivación pura | `240c4f6b` |
| **B** | registrar un pago: repositorio, candado, servicio, idempotencia, acciones | `bb0b4992` · `23b817c4` |
| **C** | lecturas: pendiente por cierre, comprobantes, filtro por cierre | `0dc79605` |
| **D** | frontend del pago a **tienda** | `b1b57835` |
| **E** | frontend del pago a **mensajero** (toca la aprobación) | `1720d373` |
| **F** | **anulación** por contraasiento, backend y frontend | `a7af2bb7` · `9de22953` |
| **G** | lo que ven los beneficiarios (`/mis-pagos`, `/mi-wallet`) | `c5a62b35` |
| **H** | guardias, censo, verificación real contra Postgres y cierre | `5d9f144` |

**`./init.sh` → `== init OK ==` · 793 archivos / 9857 tests, 0 fallos.** Baseline al arrancar:
772 / 9257 ⇒ **+21 archivos, +600 tests, cero regresiones**. **Review en curso; nada pusheado.**

### 🧪 Lo que de verdad sostiene esta feature: **13 pruebas por mutación**

No es adorno. En este repo ya hubo tests verdes que no medían el requisito, y aquí volvió a pasar
**dentro del propio arnés de test**: el primer store en memoria de la Tanda B tomaba la foto de las
filas **después** de ceder el turno, y con eso **quitar el candado dejaba el test de carrera en
verde**. Corregido a instantánea al inicio de la sentencia (la semántica real de `READ COMMITTED`),
desde ahí discrimina: sin candado caen 8 de 10 y se pagan 120 000 de una tienda con 100 000.

Las que más valen, cada una con su salida pegada en la bitácora:

- **el candado** (B): quitarlo → 8 de 10 caen; no-op → 3; movido tras la lectura → 4;
- **la clave de idempotencia** (D), **las dos direcciones del mismo eje**: renovarla tras un fallo
  tumba 2 tests, conservarla tras un éxito tumba otros 2;
- **el refresco dirigido** (D): hacerlo global tumba 4;
- **el monto de la anulación** (F): tomarlo del input en vez del pago tumba 4 — es la diferencia
  entre anular y poder escribir cualquier cifra en el libro;
- **el `WHERE` del filtro por cierre** (C): probado **en el repositorio, donde vive**, porque los
  dobles del servicio no ven la traducción a SQL. Volver al filtro viejo tumba 7 de 12.

### 🔎 Hallazgos que sobreviven a la feature (ninguno es suyo, ninguno se tapó)

1. **`esFechaFutura` (`lib/types/gestion-orden.ts:102-106`) documenta algo falso.** Dice que
   `new Date("2026-02-31…")` da `Invalid Date`; en V8 **rueda al 3 de marzo** (solo el *mes* fuera
   de rango invalida). O sea que hoy **`31/02` se acepta como fecha de reprogramación y se guarda
   como 3 de marzo**. Es de la 36/73. **No se tocó. Necesita dueño.**
2. **La guardia del censo de tablas solo recorría `app/`.** Una tabla en `components/shared/` **no
   existía para el censo**. Al abrir el recorrido apareció además una tabla **preexistente de la
   130** (`TablaResumen`) que llevaba sin registrar. **`contadores-cabecera.guardia.test.ts` tiene
   el mismo punto ciego y NO se tocó** (es de la 170): deuda ajena, ahora identificada.
3. **Un `as unknown as <Interfaz>` en un test de la 170 esconde el drift al typechecker.**
   `wallet-tienda-descarga.test.ts` pasó el typecheck y aun así **3 tests se pusieron rojos** al
   ampliar la interfaz. El cast convierte un error de compilación en un rojo en tiempo de test.

### 🗣️ Decisiones que tomó el LEADER durante la implementación (revisables, ninguna del spec)

1. **T0.9 — la 172 arranca ya**, sin esperar a la 170. Comprobado, no supuesto.
2. **`referencia` gana tope de 60 caracteres.** El diseño fijaba tope para `nota` y **callaba sobre
   `referencia`**; llevaba tres tandas seguidas reportándose como hueco. El 60 sale de
   `lib/types/api-key.ts:17`, el único campo del repo de la misma familia (identificador corto
   tecleado por una persona contra columna `text`) — no es un número inventado.
3. **El aviso de N1 va donde hay un IMPORTE AGREGADO que incluye lo anulado, no donde solo se
   listan movimientos** (ahí el pago y su reverso se ven los dos y se explican solos). Aplicada la
   regla, resultó que **`/mis-pagos` y `/wallet/mensajeros` también tienen agregados inflados**, así
   que N1 queda declarada en **4 pantallas**, no en una.
4. **La descarga del histórico de cierres NO gana la columna «pendiente de liquidar»**: tocaría el
   archivo que fijó la 170 y sus tests, y ningún R lo pide. Alcance deliberado, no olvido.

### ⏳ Esperando al humano (además del preview, que sí bloquea)

- **N1 quedó cerrada por su default** —no netear y declararlo en pantalla— y ya está el texto en
  las 4 superficies. Si prefiere netear, es ahora: exigiría 2 valores de enum nuevos o reescribir
  la derivación de la 171.
- **N2:** sin ventana temporal para anular (default tomado). Hoy un pago se puede anular siempre.
- **Nadie ha visto estas pantallas en uso.** La feature entera está verificada por suite, no en
  pantalla; el humano ya aceptó ese trato en la 170.

---

## 🏁 CIERRE DE JORNADA 2026-08-02 (mañana) — release, 170 cerrada y spec de la 172

**Registro con CERO features `in_progress`.** Se desplegó producción, se saneó el backlog de PRs, se
cerró la **feature 170 entera** (fases 1 y 2) y se dejó la **172 en `spec_ready` con su puerta
CERRADA**.

### ✅ ~~LO PRIMERO AL RETOMAR: implementar la 172~~ — **EN CURSO desde la tarde del 2026-08-02** (ver el bloque de arriba)

**No hay puerta pendiente. El spec está aprobado y se puede escribir código directamente.**

`specs/172-liquidacion/` — **85 R en EARS, 9 tandas**, rama `feature/172-liquidacion`, PR **#259**.
Todas las decisiones están DENTRO de los archivos, no solo en esta bitácora.

**Empezar por la TANDA A, y con cuidado:** trae la migración con el **CHECK de `categoria`↔`tipo`**
heredado del review de la 171. Ese CHECK **valida las filas existentes al aplicarse** y en Vercel el
build migra antes de compilar, así que **mergear ES aplicar**. La propia task **T A.0** exige
verificar producción y preview por MCP **antes** de escribir la migración. No saltársela.

Las tres respuestas explícitas del humano que más mandan sobre el diseño:

- **P4 — la ANULACIÓN entra en la feature.** Eligió lo contrario al default: entregar un libro de
  dinero que no se puede corregir era el riesgo más caro. Se modela como **contraasiento**, nunca
  borrar ni editar; el pago sigue siendo fila inmutable y «anulado» se **deriva**. Usa categorías ya
  reservadas ⇒ **cero valores de enum nuevos** y ninguna cascada de `down.sql`.
- **P1 — el pago que excede lo debido se RECHAZA**, lo que obliga a un **candado**
  (`SELECT … FOR UPDATE` antes de leer el disponible, **uno por operación**). Su test **exige
  mutación**: si quitar el candado no lo rompe, el test no prueba nada.
- **P3 — pagan `maestro` y `admin`.** `adminSatelite` **no**, aunque sí apruebe cierres.

### 🔧 Deuda con DECISIÓN YA TOMADA — solo falta hacerla

**El humano pidió AÑADIR UN AVISO** en bodega satélite: hoy lo marcado en otra página se conserva
pero **no participa** en la acción de lote y **nada lo advierte** (Q-K7 de la 170). Algo del estilo
«tienes N órdenes marcadas en otras páginas que no entran en esta acción». Es un **chore de frontend
pequeño y ya decidido**.

### ⏳ Esperando al humano (nada bloquea)

1. **N1 (nueva, de la 172):** el par pago+anulación deja los importes **brutos inflados** —«pagado a
   la tienda» sigue contando lo anulado— **aunque el saldo queda exacto**. Netearlo exigiría 2
   valores de enum nuevos o reescribir la derivación de la 171. **Default tomado: no netear y
   declararlo en pantalla.** Si va a cambiar, mejor antes de implementarlo.
2. **N2:** sin ventana temporal para anular (default tomado).
3. **Orden alfabético** en «saldos de tiendas» y «cuentas por pagar» (170, ya en `dev`): **no es
   realmente opcional** —esos listados no tenían orden y sin uno total las páginas se solapan u
   omiten filas—. Queda informado, no a decisión.

### ✅ Entregado

| | Qué | Estado |
| --- | --- | --- |
| **release** | `dev → prod` (PR #246) | **en producción**, migración del buscador aplicada y verificada |
| **123** | rollup diario `analytics_daily` | `done` · PR #237 desatascado y mergeado |
| **170** | Excel en 25 tablas + **paginación server-side de 13 listados** | `done` · fase 2 en 6 PRs (#248, #249, #250, #253, #255, #256) |
| **chore** | 2 guards deterministas que bloqueaban `./init.sh` | PR #257 |

**Suite final: 772 archivos / 9257 tests, 0 fallos.**

### ⚠️ DECISIONES DEL HUMANO PENDIENTES — cambios VISIBLES ya desplegados en `dev`

La 170 fase 2 cambió lo que se ve en pantalla. El humano aceptó **no verificar en pantalla** a cambio
de que los PRs describieran el cambio de uso; están descritos, pero **falta su opinión**:

1. **Orden alfabético nuevo** en «saldos de tiendas» y «cuentas por pagar». Hoy esos listados **no
   tenían orden** —salía de un `groupBy` sin `orderBy`, o sea lo que le conviniera al planificador— y
   sin orden total las páginas se solapan u omiten filas. Es la desviación mínima que hace correcta
   la paginación, pero **cambia lo que el maestro ve**.
2. **Bodega satélite:** «seleccionar todo» es **por página**, los botones de lote **desaparecen** sin
   selección (antes salían en gris) y **lo marcado en otra página se conserva pero NO participa, sin
   que nada avise** (Q-K7). Es lo que más puede confundir en uso real.

### 🔎 El hallazgo que sobrevive a la feature

En **cuatro tandas seguidas** (I, J, K, L) una mutación del `WHERE` **sobrevivió a los tests de
servicio** —usan dobles y **no ven la traducción a SQL**— y solo la cazó el test de repositorio. Son
7+ mutaciones medidas una a una. La respuesta del repo son los cuatro `*-where.test.ts`, y la regla:
**probar el `WHERE` donde vive, no donde se invoca.**

> **Y una lección de proceso que costó un rojo en `dev`:** al mergear el PR #237 se verificó por el
> **estado del PR** en vez de por la suite. **El check de Vercel es un build y NO corre tests**, así
> que un guard cruzado entre la 122 y la 123 entró rojo sin que nadie lo viera. Mismo patrón que el
> incidente del PR #209.

### ⏭️ Lo siguiente

1. **172 — liquidación.** Es la que cierra el agujero de verdad: hoy **no existe forma de registrar
   un pago**. Todas las decisiones están en su ficha. **Arranca por spec y tiene PUERTA DE APROBACIÓN
   HUMANA antes de tocar código.** Condición heredada del review de la 171: **el CHECK de
   `categoria`↔`tipo` debe ir en SU migración**, porque la liquidación será el segundo escritor del ledger.
2. **173 — caja en modo tesorería.** Depende de la 172.
3. **Deuda dirigida de la 170:** una **tanda N de backend** con los 8 `listarXCompleto` que faltan
   (Q-I5+Q-K4+Q-K6), y la búsqueda de cuentas por pagar que **no ignora acentos** (Q-L4, defecto
   **preexistente** que paginar hace más visible).
4. **`dev` tiene la migración `analytics_daily` SIN aplicar en producción** (sí en preview). Ya está
   confirmado que producción soporta `NULLS NOT DISTINCT` (**Postgres 17.6**), pero la próxima
   release **deja de ser trivial**.
5. **PR #254 abierto, de otra sesión.** La mitad ya entró por el #257; lo que sigue aportando en
   exclusiva son **19 identificadores `T1.1None`** corruptos en el spec de la 122 (verificado: siguen
   en `dev`). Comentado allí; la decisión es de su autor.

> ⚠️ **Hay otra sesión viva en este repo** (PRs #251, #252, #254). Antes de tomar una rama o dar por
> tuyo un arreglo, mirar si ya lo está haciendo alguien.

### 🧪 Nota sobre el gate en esta máquina

`pnpm test` tiene un **flake móvil de contención de jsdom**: corridas distintas tumban archivos
distintos (`ControlDescargaTransversal`, `CuentasPorPagarTable`, `OrdenesModuleReuse`), **todos verdes
en aislado**. Un rojo así **no es contenido**. Reejecutar el archivo solo antes de declararlo roto.

---

## 🚀 RELEASE 2026-08-01 — `dev → prod` DESPLEGADA

**Hecho. Producción ya no está por detrás: `dev` y `prod` están al día (0 commits de diferencia).**
PR **#246** (`dev → prod`), precedido del **#245** que cerró el bookkeeping de la jornada anterior.

La release llevó 215 archivos (+30703/−2162): buscador de órdenes (**169**), descarga a Excel de las
25 tablas (**170 fase 1**), desglose del dinero por tienda (**171**) y el borrado de la vista legacy
del listado. Despliegue de producción `dpl_6yAcpx6NvF5otCBk5Xuy1Dzimh44` en **READY**.

### ✅ La migración del buscador está APLICADA en producción — verificado en la base, no deducido

`20260731160000_orden_busqueda_trgm`, `finished_at` **2026-08-01 18:56:26Z**, `applied_steps_count`
1, `rolled_back_at` NULL. **Cero migraciones rotas** en toda la tabla.

| Comprobación | Resultado |
| --- | --- |
| `pg_trgm` en el esquema `extensions` | ✅ instalada ahí, que es donde el índice la cualifica |
| Columna `orden.busqueda_texto` e índice GIN | ✅ ambos existen |
| Columna generada calculada | ✅ **69 de 69 filas** con texto no vacío |
| Búsqueda por fragmento y ruta rápida por guía | ✅ las dos devuelven la fila; un término inexistente devuelve 0 |
| Plan de ejecución | ✅ **`Bitmap Index Scan on orden_busqueda_texto_trgm_idx`** — el planificador USA el índice, no cae a seq scan |
| Errores de runtime en Vercel tras desplegar | ✅ ninguno |

> El pre-vuelo se **rehízo** antes de mergear (no se reutilizó el del día anterior): `pg_trgm` no
> estaba instalada en ningún esquema, así que el único modo de fallo que la migración declara —la
> extensión viviendo en otro esquema— no se materializó.

### ✅ Lo que quedaba tras la release, ya saldado

Los dos PRs del lote de analítica que no entraron en ella: **#241** (renombre de
`ROLES_ACCESO_ANALITICA`) mergeado, y **#237** (`analytics_daily`) desatascado y mergeado — su
conflicto con 38 commits de `dev` era **solo de bitácora**: `schema.prisma` y `feature_list.json`
automezclaron limpios. Ver el bloque de cierre de jornada, arriba.

---

## 🔵 EN VUELO — feature 124 · PR #260 abierto, esperando merge

`feature/124-analitica-job-agregacion-diaria` → `dev`. Worktree en `arc/ordenex-wt-124`.
Estado en `feature_list.json`: **`in_progress`** — pasa a `done` **cuando el PR se mergee**, no antes.

El job que puebla `analytics_daily` a las **00:30 CR** sobre el día cerrado **D−1**. Puerta T0 cerrada
por el humano con **D1=A2** (congela solo el estatus), **D2=B2** (vivas + las que cerraron ese día),
**D3+D8** (solo D−1, nada de intradía) y **D7** (las `deleted_at` se excluyen de todo).

**49 requisitos mapeados** en `progress/impl_124.md` §7, con la honestidad declarada: 36 medidos por
aserción discriminante, 8 por barrido del árbol, **4 solo por regex de texto** (R2, R21, R31, R48).
Exigir el mapa destapó tres defectos que el implementer no había reportado (R31 a medias, R20 mapeado
a un test vacuo, R24 medido por el caso de datos y no por el guardia). Los tres, corregidos.

**Colisiones con la 122 resueltas sin aflojar ningún guardia**: R42 despioja comentarios en vez de
allowlistear un archivo ajeno; R18 exime **nominalmente** al escritor sin tocar su detector ni sus
fixtures. Verificadas por mutación ejecutada.

| Medida | Resultado |
| --- | --- |
| Suite | **778 archivos, 0 rojos reales** |
| typecheck / lint | 0 errores / 0 errores + 27 warnings **de `dev`** → delta 0 |

**Cómo se llegó a ese 0, porque la corrida completa NO dice eso.** Salió **degradada** por saturación:
reportó **769** archivos —ocho menos que la corrida previa— con **9 *unhandled errors*** de workers
que ni arrancaron, y 2 rojos que eran **timeouts a 20 s**, no aserciones. Los **11 archivos** implicados
(los 9 caídos + los 2 expirados) se repitieron con `--maxWorkers=2`: **11/11, 243 tests, 0 rojos**.
767 + 11 = **778**, todos verdes.

Es justo el modo de fallo de «Vitest degradado reporta de menos»: sin comparar el **total de archivos**
contra la corrida anterior, una suite que se saltó ocho archivos enteros parece sana. Y el rojo de
`no-embalaje` había **cambiado de naturaleza** entre corridas —primero determinista por
`specs/122/tasks.md:243`, que `dev` ya arregló en `3d69c910`, luego un simple timeout—, así que era
fácil darlo por el mismo de antes.

### ⚠️ Defecto ajeno confirmado y deliberadamente NO tocado

`whereRollup()` en `lib/analytics/alcance-columnas.ts` (feature **122**, ya mergeada) recorta
`analytics_daily` por **`mensajeroAsignadoId`** — esa es la columna de `orden`; en el rollup se llama
**`mensajeroId`**. El retorno está tipado `Record<string, string>`, así que **el compilador no lo ve**:
el recorte por mensajero fallaría en silencio. Confirmado contra `db/schema.prisma` y **dirigido a la
126** en su `status_note`, que es quien lo estrellaría. No se arregla desde este PR.

---

## 🏁 CIERRE DE JORNADA 2026-07-31

Todo lo trabajado ese día está **mergeado en `dev`** —y desde el 2026-08-01, **en producción**.
Cinco PRs: #239, #240, #242, #243, #244.

### ✅ Entregado hoy

| Feature | Qué | Estado |
| --- | --- | --- |
| **167** | apartado propio de recolección para el mensajero | `done` · **en producción** |
| **169** | buscador de órdenes (guía, remisión, teléfono, destinatario) | `done` · **en producción** |
| **170** | descarga a Excel — **FASE 1**: las 25 tablas | `in_progress` · **en producción** |
| **171** | desglose del dinero por tienda en la wallet | `done` · **en producción** |
| — | escáner QR unificado y plegable + fix del botón desbordado | **en producción** |
| — | saneamiento del arnés (`init.sh` volvió a verde) | **en producción** |
| — | borrado de la vista legacy del listado del maestro | **en producción** |

### ✅ ~~LO PRIMERO AL RETOMAR: desplegar `dev → prod`~~ — HECHO el 2026-08-01 (PR #246)

Producción ya tiene el buscador, el Excel, el desglose por tienda y el borrado de la vista legacy.
La migración del buscador quedó aplicada y verificada; el detalle está en el bloque de la release,
arriba. El procedimiento de recuperación sigue documentado en
`progress/impl_169-buscador-ordenes.md` §22 por si hiciera falta revertir.

> Recordatorio que costó descubrir y que sigue vigente para la próxima migración: **en Vercel el
> build migra antes de compilar, así que mergear a `prod` ES aplicar.**

### 📋 Trabajo especificado y listo para arrancar

1. **170 FASE 2** — paginar en servidor las 16 pantallas que hoy reciben su dataset entero. Spec
   aprobado, 6 tandas, riesgo por pantalla ya inventariado (2 de riesgo alto: bodega satélite y
   cuentas por pagar). El humano decidió que **basta con la suite**, sin verificación en pantalla.
2. **172 — liquidación** (la que cierra el agujero de verdad): hoy **no existe forma de registrar un
   pago**, ni a mensajeros ni a tiendas, así que los saldos solo crecen. Todas las decisiones están
   en su ficha. **Condición técnica heredada del review de la 171: el CHECK de `categoria`↔`tipo`
   debe ir en SU migración**, porque la liquidación será el segundo escritor del ledger.
3. **173 — caja en modo tesorería.** Depende de la 172.

### ⏭️ Decisiones del humano pendientes (ninguna bloquea)

- **«Rutear a bodega satélite» no tiene interfaz.** Su backend está vivo y probado; el modal se
  conservó listo para remontar. ¿Se vuelve a ofrecer en el listado vivo o se retira con su backend?
- **La ficha de la feature 71 se diagnosticó contra código muerto** (`OrdenesApartado`, ya borrado).
  La superficie viva SÍ tiene el bloqueo que la ficha pedía: **reevaluar antes de tomarla**.
- **La cabecera de `/mi-wallet`** (lo que ve la tienda) sigue en «Créditos / Débitos». Cuando la 172
  emita pagos, la tienda verá el pago **sumado dentro de "Débitos"** sin distinguirlo.

### 🧹 Higiene

Quedan **33 worktrees de agentes** en `.claude/worktrees/`. Todo su trabajo está pusheado y mergeado;
se pueden podar. En Windows algunos fallan con «Filename too long»: `rm -rf` + `git worktree prune`.

### 🔎 Deuda viva declarada (no de estas features)

- **`pending list` del GIN**: justo después de una carga masiva el planificador puede abandonar el
  índice del buscador. Medido, sin cruzar umbrales, **sin decidir**; las tres salidas tocan diseño.
- **`exceljs` trunca a 31 caracteres el nombre de la pestaña** (el del archivo sale entero).
- **Drift entre `schema.prisma` y las migraciones**: reconciliado en el chore de hoy con cero DDL,
  pero conviene no volver a generar migraciones sin mirar el SQL propuesto.


---

# Histórico de la sesión

## 🗓️ Sesión 2026-07-31 (cierre) — 169 CERRADA · wallet registrada · 170 desbloqueada — **EMPIEZA A LEER POR AQUÍ**

**Feature 169 (buscador de órdenes) → `done`, PR #239 mergeado.** El relato completo va a
`history.md`. Lo que importa para quien siga:

- **Verificación de producción HECHA por el MCP de Supabase antes de mergear** (el humano autorizó el
  acceso): `pg_trgm` **no instalada** → sin conflicto de esquema, que era lo único que podía tumbar el
  build y dejar `_prisma_migrations` bloqueando despliegues; y **69 filas** en `orden` → la columna
  generada se añade sin ventana de mantenimiento.
- **Se confirmó CUÁL es la base de producción con evidencia**, no por suposición: el proyecto
  `scfnwxqbsgkzwsdntdvd` tiene aplicada la migración del índice de la 167 (que se desplegó a prod hoy)
  y **no** tiene la del buscador (que solo está en `dev`). Todas las migraciones sanas, ninguna
  fallida ni revertida.
- **La migración del buscador NO está en producción todavía**: entra con el próximo `dev → prod`.

### 💰 Wallet: tres fichas registradas (171, 172, 173)

Con todas las decisiones del humano dentro de cada `status_note`, para que quien las especifique no
tenga que reconstruir la conversación. **Dato nuevo, medido en la base de producción:** 35 movimientos
de caja y 6 cierres con **CERO pagos registrados** — el agujero de la liquidación ya es visible en
datos reales, no es una hipótesis.

### 📊 La 170 (Excel + paginación) queda DESBLOQUEADA

Su Tanda 0 tocaba `lib/types/orden.ts` y `OrdenesModule.tsx`, los mismos archivos que la 169 estaba
modificando. Con la 169 en `dev`, la intersección desaparece y puede arrancar.

## 🗓️ Sesión 2026-07-31 (cont. 2) — Excel en todas las tablas + wallet incompleta (histórico)

Dos reportes del humano. **Los dos son ciertos, por motivos distintos de los que parecían.**

### 📊 Excel: la capacidad existe, el rollout no — feature 170 (nueva)

`DataTable` **ya integra** la descarga del dataset completo (feature 151, server-side y sin
paginación), **opt-in por la prop `descarga`**. El problema es que **solo 1 de 25 tablas la
activa** (`OrdenesModule`); las otras 24 nunca recibieron la prop. Medido, no estimado.

Estaba dentro de la **145**, que mezcla búsqueda + filtros + export y desde hoy depende de la 169.
**Decisión del humano: el export se SEPARA a la 170 y se hace YA** — no depende del buscador. La 145
se queda con búsqueda y filtros. Spec en curso, en rama propia.

### 💰 Wallet: un hueco objetivo y un cambio de modelo — feature 171 (por registrar)

**El hueco, confirmado en código:** `egreso_pago_tienda` (caja principal) y `pago_tienda` (ledger de
tienda) están declarados en los enums **desde la feature 43** y **NINGÚN código los emite** — solo
aparecen en tipos, etiquetas y el catálogo de analítica. O sea: **no existe el flujo de pagarle a la
tienda**, así que el saldo a favor de cada tienda crece indefinidamente y nunca se salda en el
sistema. Para mensajeros sí existe el equivalente (feature 44). Para tiendas quedó como follow-up
`F1.4-Q4` de la 43 y **nadie lo registró como ficha**.

**Lo que el humano describía como «falta el ingreso del dinero total de la orden» sí se registra**,
pero en el **ledger por tienda** (`cod_recaudado`, crédito a favor de la tienda), no en la caja
principal. Eso era deliberado: el COD no es ingreso de Ordenex, es dinero de la tienda que se le
debe. La caja principal modela **resultado** (flete, comisión COD, IVAs), no **tesorería**.

> **DECISIÓN DEL HUMANO (2026-07-31): la caja principal pasa a reflejar TESORERÍA COMPLETA.** El COD
> entra como ingreso de caja y sale al pagarle a la tienda, de modo que se vea el flujo entero. Al
> especificar hay que resolver lo que esto rompe: **el balance dejará de ser «lo que gané»**, así que
> «saldo de caja» y «ganancia» tienen que quedar separados y nombrados, o el número se leerá como
> utilidad y no lo será. Afecta a `derivarBalance`, a la vista de wallet y al catálogo de analítica
> (métricas financieras, features 127/135), que hoy suman categorías `ingreso_*` como resultado.

**Prioridad decidida:** el Excel primero; la wallet después.

### 💸 Segundo reporte de wallet (mismo día): no hay forma de PAGAR nada

El humano pregunta cómo salda las cuentas por pagar de mensajeros y el monto a favor de las tiendas,
y si «ya existe o hay que implementarlo». **Auditado: no existe, y no está escondido.** Cero acciones
de pago o liquidación en `lib/actions/`. El detalle:

- **`/wallet/tiendas` NO tiene desglose por tienda.** Mensajeros sí (`DesglosePagosMensajero.tsx`);
  tiendas solo tiene `SaldosTiendasTable.tsx`.
- **Liquidar la cuenta por pagar de un mensajero: no existe.** La categoría `liquidacion` del ledger
  está marcada «RESERVADO para el follow-up de saldar la cuenta por pagar» desde la **feature 44**
  (`F1.4-Qf`) y nadie la emite.
- **Pagar a una tienda: no existe.** `pago_tienda` idéntico, reservado desde la **43** (`F1.4-Q4`).

**Es el mismo agujero en los dos: el sistema sabe cuánto debe y a quién, pero no tiene cómo decir
«ya pagué».** Por eso los montos solo crecen. Los dos follow-ups quedaron en sus specs y ninguno se
convirtió en ficha, así que se perdieron.

### Decisiones del humano (2026-07-31) para la liquidación

1. **Pagos PARCIALES permitidos.** Se registra lo que se pagó de verdad y el saldo baja en esa
   cantidad.
2. **Mensajeros: el pago se pregunta AL APROBAR EL CIERRE y queda ATADO a ese cierre.** Idea del
   humano, mejor que las opciones ofrecidas: no tiene sentido aprobar un cierre que genera una deuda
   que después nadie mira. Encaja con el modelo actual, donde `pago_efectivo = min(deuda, efectivo
   recaudado)` y **la cuenta por pagar es justo el resto**.
3. **PERO aprobar y pagar son DOS PASOS.** El humano eligió primero «bloquear el cierre hasta pagar»
   y se le señaló la consecuencia en cadena: por la **feature 111**, un cierre `solicitado`/`vencido`
   sin resolver **BLOQUEA al mensajero**; un cierre no aprobado por falta de pago lo dejaría sin poder
   trabajar al día siguiente por un motivo administrativo ajeno a él. Decisión final: **el cierre se
   aprueba** (el mensajero queda libre) y la deuda queda **abierta, visible y atada al cierre**, que
   no se considera liquidado hasta registrar el pago.
4. **Tiendas: contra el saldo acumulado**, desde el desglose nuevo. No hay «cierre de tienda» al que
   atar el pago: su saldo se acumula de muchos cierres de muchos mensajeros. Se descartó crear un
   ciclo de corte por tienda (sería una feature en sí misma).
5. **Datos de cada pago:** método (efectivo/SINPE/transferencia), referencia o comprobante, nota
   libre, **fecha real del pago distinta de la de registro**, y —pedido explícito— «todo dato que dé
   trazabilidad»: actor que lo registra e instante de registro.

### Fichas a registrar cuando haya rama libre (borrador acordado, ids provisionales)

| id | Qué | Depende de |
| --- | --- | --- |
| 171 | desglose por tienda en `/wallet/tiendas` (espejo del de mensajeros) | — |
| 172 | liquidación: pagar a mensajeros (atado al cierre) y a tiendas (contra saldo) | 171 |
| 173 | caja principal en modo TESORERÍA (el COD entra y sale) | 172 |

> No se registran todavía porque el checkout principal está ocupado por el backend de la 169 y el
> otro worktree escribiendo el spec de la 170: meter estas fichas ahí mezclaría registro con ramas
> ajenas. **Todo el contenido acordado está aquí arriba**, que es lo que evita perderlo.

## 🗓️ Sesión 2026-07-31 (cont.) — feature 169: buscador de órdenes (histórico)

**Pedido del humano:** un input que encuentre una orden por cualquiera de sus datos importantes, con
aviso EXPRESO de cuidar el rendimiento («no vaya a ser que sea lenta por una mala implementación de
consultas»).

### Auditoría antes de registrar — sí estaba pedido, pero no se construyó

- **144 «DataTable: búsqueda y filtros»** figuraba `pending` con su **PR #180 MERGEADO desde el
  2026-07-29**. Lo que entró son los **filtros** (catálogo + tiempo) y los componentes compartidos;
  su migración `20260728120000_orden_indices_filtros` crea **cuatro btree de catálogo, ninguno de
  texto**. **La búsqueda de texto se quedó fuera** al redefinirse la feature. → ficha a `done`.
- **`ordenFilterSchema` es `.strict()` y no acepta ningún campo de texto**: hoy NO se puede buscar
  una orden por guía, remisión, teléfono ni destinatario en `/ordenes`.
- La única búsqueda existente es la **114** del mensajero: 100% de cliente sobre lo ya cargado.
  Inservible para una tabla paginada en servidor — solo encontraría lo que ya está en pantalla.
- **145** (rollout a todas las tablas) pasa a `depends_on: 169`: no puede adoptar una capacidad que
  todavía no existe.

### Decisiones del humano (2026-07-31)

1. **Campos: guía, remisión, teléfono y destinatario.** Los cuatro viven en la tabla `orden` → sin
   joins y con índice pequeño. Descarta dirección, producto y nombre de tienda.
2. **Se empieza por `/ordenes`**; el rollout al resto queda en la 145.
3. **Volumen:** hoy pocas órdenes, pero espera **muchas decenas de miles pronto**.

### Enfoque técnico que va al spec (y por qué)

- **`pg_trgm` + GIN sobre columna generada STORED**, NO `tsvector`. El FTS no encuentra fragmentos en
  medio de una cadena, y aquí se teclean los últimos 4 dígitos de un teléfono o un trozo de remisión.
- **Ruta rápida**: término numérico → igualdad contra `num_guia` (índice único ya existente). El caso
  más frecuente del día no paga el coste del trigram.
- **Se indexa YA, y el volumen bajo es la razón, no la excusa:** añadir una columna generada reescribe
  la tabla con lock exclusivo. Instantáneo con pocas filas; ventana de mantenimiento con medio millón.
- **Dos riesgos declarados de antemano:** el `count(*)` exacto de la paginación se paga entero en cada
  tecleo (plan B: conteo con tope), y **`unaccent()` NO es `IMMUTABLE`**, así que no puede ir tal cual
  en una columna generada — la trampa que rompe la migración a mitad.
- El término se compone **en AND con el alcance por rol**: un buscador que se lo salte es una fuga de
  datos, no un fallo de UX.

## 🗓️ Sesión 2026-07-31 — feature 167 CERRADA + chore de saneamiento (histórico)

## 🗓️ Sesión 2026-08-01 (tarde) — feature 130: RONDA 2, tres bloqueantes cerrados

**El reviewer RECHAZÓ la primera entrega y tenía razón en los tres.** Todos del mismo tipo: **tests
verdes que no medían el requisito**. Reproducidos uno a uno mutando el código antes de tocar nada,
y cerrados con la salida real pegada en `impl_130.md §4-bis`.

- **B1 (R13)** — se podía reintroducir `₡` hardcodeado y quedaban 42 verdes. **Causa raíz:** con la
  config por defecto (`es-CR`/`CRC`), `formatMonto(3500)` y un `₡` a mano dan el **mismo string byte
  a byte**; ninguna aserción sobre la salida por defecto puede separarlos.
- **B2 (R20)** — igual con `"es-CR"` incrustado. La cláusula «sin literal de idioma» no la medía
  nada, que es literalmente el punto de `CHECKPOINTS.md` sobre no hardcodear país/moneda.
- **B3 (R33-bis)** — el más grave: neutralizar el recorte del donut no rompía ningún test. No era
  cosmético: `paleta.ts` lanza para todo índice `>= 5` en **cualquier** `NODE_ENV`, así que un donut
  de 6+ categorías (`ordenes_por_estado` tiene 19) **reventaría en el navegador también en
  producción**.

**Arreglo:** guard estático de literales sobre `components/private/analytics/**` (el mismo que ya
protegía a `KpiValorAnimado`) + tests que recargan el módulo con `MONEDA_CURRENCY=USD` /
`MONEDA_LOCALE=en-US`, con lo que los strings dejan de ser idénticos; y tests nombrados de las dos
ramas de `NODE_ENV` para el donut.

> **El humano RATIFICÓ la desviación del donut (2026-08-01):** 5 segmentos y conserva los
> **PRIMEROS** (en una serie ordenada por magnitud son los que más pesan; quedarse los últimos
> mostraría las 5 categorías más pequeñas escondiendo las dominantes). **Barras y líneas NO se
> tocan:** siguen con 62 y los últimos. Escrito como **R33-bis** en `requirements.md`.

**Menores atendidos:** m5 (T8.3 estaba marcada `[x]` afirmando que existía `review_130.md`, que **no
existía** — bookkeeping autocumplido, desmarcada), la escala del `porcentaje` promovida a **R20-bis**
y a `tasks.md > T0.1` donde la lee el dueño de la 131, m1 (R28 se cumple **por un default de
recharts** que nadie fijó, con `^3.10.1`: riesgo declarado) y m2 (R25 marcado **⚠ parcial**, es
inverificable hasta que exista la 131).

**Sigue sin push y sin PR.** Commits nuevos: `07d8188b`.

---

## 🗓️ Sesión 2026-08-01 — feature 130 IMPLEMENTADA (pendiente de review) — ~~EMPIEZA A LEER POR AQUÍ~~

**Feature 130 (analítica: componentes de gráficas) → implementada en la rama
`feature/130-analitica-componentes-graficas`, en worktree aislado. SIN push y SIN PR: lo hace el
humano/leader.** Cinco commits: `e6f4201b` (recharts), `6e4f84f2` (el paquete), `557f25af`
(tests + guard), `3f60a21b` (test propio del Kpi), `a02a165b` (arreglo del compartido).

Los 41 requisitos trazados a test en `progress/impl_130.md`, con los **tres que se verifican fuera
de vitest** señalados y con su salida real pegada: R27 (bundle sobre `next build`), R36 (delta 0 de
suite) y R41 (comprobación de mutación del montaje del lienzo).

> **LO QUE NO SE TAPA, y hay que leer antes de la review:**
> - **H1 — la 130 se mergea SIN LLAMADOR.** `AnaliticaShell` (existe) ← `131` (NO existe) ← `130`.
>   No hay ni un `import` de estos componentes en producción hasta que aterrice la 131. Medido, no
>   afirmado: sin sonda, `recharts` está en **0** chunks de cliente.
> - **H2 — el mensajero SÍ entra a `/analitica`.** «Recharts no le llega al móvil» es falso. Lo
>   garantizado y medido es que no le llega en `/mis-asignaciones` ni en el resto de la app, y que
>   dentro de `/analitica` llega **diferido**: chunk propio de 388.810 bytes, fuera de los 46 chunks
>   de entrada de ruta.
> - **H3 — la moneda no configurable en cliente es PREEXISTENTE**, no la abre esta feature: cinco
>   componentes `"use client"` ya consumen `formatMonto`; `KpiValorAnimado` es el sexto. Ficha
>   propia sobre `lib/config/moneda.ts`, con seis consumidores a revisar. **No se abre desde aquí.**

> **DOS DECISIONES PARA EL DUEÑO DE LA 131**, que el spec no fijaba y que ahora son contrato:
> 1. el `porcentaje` viaja como **fracción** (0,842 = 84,2 %), no en puntos — pasa la razón cruda;
> 2. en el **donut** el techo de segmentos es **5**, no 62. Y siguen en pie sus dos deberes de T0.1:
>    agrupar en «otros» por encima de 5 series y agregar por semana/mes por encima de 62 puntos. El
>    paquete no lo hace (R34) y **lanza** en desarrollo.

> **AVISO DE ENTORNO, cuesta horas si se descubre solo.** El worktree está en una ruta de 143
> caracteres y el `package.json` del cliente Prisma queda en **266**, por encima del MAX_PATH de
> Windows. El resolvedor de módulos de Node no lo lee y **303 de 665 archivos de test fallan al
> colectar**, dejando una suite que *parece* casi verde con 4.059 tests en vez de 8.052. Se arregla
> con `pnpm install --force --config.virtual-store-dir-max-length=30`. **NO** muevas el virtual
> store fuera del proyecto: rompe la resolución de tipos (~1.800 errores falsos). Y `recharts` sólo
> se extrae entero con `--config.node-linker=hoisted`. Todo en `impl_130.md §4`.

---

## 🗓️ Sesión 2026-07-31 — feature 167 CERRADA + chore de saneamiento — **EMPIEZA A LEER POR AQUÍ**
## 🗓️ Sesión 2026-07-31 (tanda de analítica) — 122 y 130 con puerta F1.4 CERRADA — ~~EMPIEZA A LEER POR AQUÍ~~

**Pedido del humano:** «arranca la 135» → «arranca con la 130» → «arranca la 122 en paralelo».

### Estado de las tres

- **135 → `done`.** PR #218 mergeado, verificado **por archivos** contra `origin/dev` (la lección
  del #209): `lib/analytics/{types,metrics,ranges,filters}.ts` y las 3 aserciones nuevas de R22 en
  `tests/unit/analytics/filters.test.ts` están en `dev`. Delta medido contra un baseline real
  (segundo worktree sobre `origin/dev`): **cero regresiones**, +9 archivos / +180 tests.
- **122 (backend) → `in_progress`, fase 1 completa.** 41 requisitos, trazabilidad 41/41.
- **130 (frontend) → `in_progress`, fase 1 completa.** 41 requisitos, trazabilidad R1–R41.
- Ambas ramas **sincronizadas con `origin/dev`** (merge limpio) y con commit local, **sin push**.
  Ocupación tras el merge: `backend [122]` 1/2, `frontend [129, 130]` 2/2. Regla 1 respetada.

### ⚠️ Lo que hay que saber antes de tocar nada

- **La base ya NO está roja.** El chore `chore/saneamiento-deudas-arnes` (PR #232) dejó `dev` en
  `== init OK ==`: 665 archivos / 8052 tests, **0 rojos**. Se acabó el argumento de «delta 0 contra
  rojos ajenos» que arrastraba la 135: **estas dos features se miden contra CERO**. Y con eso queda
  sin excusa la **T6.1 de la 135**, que sigue sin marcar.
- **`tests/unit/analytics/frontera.guardia.test.ts` fue RETIRADO** por ese mismo chore (medía el
  diff de la rama actual; uno de sus casos llegaba a prohibir crear páginas). La 122 lo citaba en
  5 sitios, uno de ellos una task que habría pasado **en vacío pareciendo verde**. Corregido.
  `modulo-puro.guardia.test.ts` sigue vivo y censa el **directorio** `lib/analytics` (`:199-207`),
  no una lista fija, así que los módulos nuevos de la 122 quedan vigilados el día que existan.
- **Hueco declarado, NO tapado:** la parte *de rama* del viejo R33 (que el diff no cree
  migraciones, páginas ni componentes) **no la absorbe ningún guardia**. Se decidió no resucitar el
  guardia borrado —un guardia que mide el diff caduca en el siguiente merge y da verdes vacíos, que
  es justo por lo que lo retiraron— y degradar R33 a propiedad **verificada en el cierre a mano**
  por el reviewer. Está escrito así en `requirements.md`, `design.md §8` y `tasks.md T5.5`.

### 🚧 PENDIENTE HUMANO — bloquea el paso a fase 2

1. **Q3 de la 122: se le describió la consecuencia AL REVÉS.** Al elegir
   `orden.mensajero_asignado_id` se le dijo que «A sigue viendo la orden aunque ya no es suya y B no
   la ve hasta gestionarla» — eso es lo que hace la **otra** columna. Con la elegida, al reasignar
   A→B **B pasa a ver la orden entera, incluida la gestión de A, y A deja de verla**. La spec está
   escrita según la **columna** elegida (coherente con el precedente de la 159,
   `db/schema.prisma:478`) y la discrepancia queda como punto de vuelta en `requirements.md > D3` y
   `tasks.md > T0.3`. **Si la eligió por la consecuencia y no por la columna, hay que girarla.**
2. **`adminSatelite` + grano `mensajero`: nadie lo preguntó.** Se decidió que el `adminTienda` ve
   mensajeros **seudonimizados** porque no es su empleador; al `adminSatelite` la spec le asignó
   identidad **real** aplicando la misma razón al revés (sí opera a los mensajeros de su zona). Es
   una **derivación del spec_author, no una decisión humana**, y está marcada como tal.
3. **Aprobación del spec** de ambas para arrancar la fase 2.

### Hallazgos verificados que no se tapan

- **130 · H1:** esta feature **no tiene llamador en producción** hasta que aterrice la 131. El
  propio shell de la 129 lo dice. No venderlo como «ya integrado».
- **130 · H2:** el mensajero **sí** entra a `/analitica` (`ROLES_ANALITICA` lo incluye), luego
  `recharts` **sí** llega a su móvil; R26/R27 solo garantizan que llegue diferido.
- **130 · I11:** el stub de `ResizeObserver` (`tests/setup/jest-dom.ts:45-55`) tiene `observe(){}`
  **vacío**, así que `ResponsiveContainer` renderiza vacío en vez de reventar: un
  `querySelector("svg")` estaría **verde sin medir nada**. Por eso la única aserción sobre el lienzo
  exige **mutación probada** (T4.5).
- **130 · premisa falsa corregida:** se preguntó Q5 diciendo que `KpiValorAnimado` tenía test
  propio. **No lo tiene** (`tests/**/*Kpi*` → 0 archivos); su única red es indirecta vía los tests
  de sus dos consumidores. R37 crea el test que faltaba. Su copia en
  `app/(app)/mis-asignaciones/_components/` es **solo un re-export**, no un duplicado: arreglar el
  compartido cubre a los dos.
- **130 · limitación preexistente (H3):** `loadMonedaConfig` lee `process.env` con clave dinámica,
  así que en el navegador cae al default `es-CR`/`CRC`. **Ya afecta a cinco componentes
  `"use client"` en producción**; la 130 no la introduce, alinea el KPI con sus vecinos.
- **122 · un 403 de esta feature sería MUDO.** `normalizeError` devuelve temprano para cualquier
  `AppError` (`lib/errors/normalize.ts:21`) y solo loguea en la rama del error desconocido, así que
  un `ForbiddenError` bajo `withErrorHandler` no dejaría rastro. Por eso R40 exige llamada explícita
  al logger y **su test espía el logger, no el status**. (`docs/conventions.md:22` no nombra ningún
  canal; el real es `ErrorLogger`, `lib/errors/logger.ts:6-21`.)
- **Método:** un hecho de inventario **solo vale si se reproduce con `git show origin/dev:<ruta>`**.
  La primera redacción de la 130 dedujo un hallazgo falso midiendo respaldos en el scratchpad de
  otra sesión. Que tres copias coincidan entre sí no las hace actuales — solo hermanas.

## 🗓️ Sesión 2026-07-31 — feature 167 CERRADA + chore de saneamiento

**Feature 167 (apartado propio de recolección) → `done`, PR #231 MERGEADO.** Nació de un reporte de
uso —«no veo la forma de recolectar»— que resultó ser dos problemas: la base local del humano tenía 4
migraciones sin aplicar (sin `recolectando` no hay nada que recolectar) y la recolección vivía
escondida dentro de Entregas, donde el escáner desaparecía justo con la lista vacía. **El relato
completo, las decisiones y la deuda están en `progress/history.md`**; el detalle técnico, en
`impl_167-…` y `review_167-…`. Verificación final medida por el leader: `typecheck` verde,
`pnpm test` **8038/8045** (7 rojos, todos de 2 guards ajenos), `lint` sin un problema nuevo.

> **PENDIENTE HUMANO:** nadie ha visto todavía la cámara leer una etiqueta real. La lista de
> verificación en pantalla está en `impl_167-apartado-recoleccion-mensajero.md`.

### 🧹 Chore de saneamiento — rama `chore/saneamiento-deudas-arnes` (2026-07-31)

Pedido del humano: «arregla todo lo que viste». Cuatro deudas que la 167 destapó y que **no eran
suyas**. Estado:

- ✅ **Definiciones de agentes con un modelo inexistente.** Los cinco `.claude/agents/*.md` fijaban
  `model: opus-4.8` y el primer `backend_dev` de la 167 **murió al arrancar**; `spec_author` y
  `reviewer` sobrevivieron por no fijar modelo. **Se retiró la línea `model:` de los cuatro que la
  tenían**: heredar el modelo de la sesión es la única opción que no envejece. Las tablas de
  `AGENTS.md` y `leader.md` —que repetían la misma columna tres veces sin discriminar nada por
  `complexity`— se sustituyen por la regla y el porqué.
- ✅ **Registro saneado.** La **157 → `done`** (su código llevaba días en `dev` con la ficha en
  `spec_ready`; se mergeó en tres PRs: #217, #225 y #227, verificado por archivos contra
  `origin/dev`). El **id 162 duplicado** se resuelve renumerando la ficha de WhatsApp a **168**, con
  el mismo criterio que se aplicó a la 165: la de `ux` conserva el id porque ya tenía rama.
- ✅ **3 errores de lint en `OrdenesModule.tsx`** saldados. La causa no era la memoizacion sino un
  `= {}` INALCANZABLE en el destructuring de props: sin props congeladas, React Compiler descarta la
  optimizacion del componente entero. Se quita el default; sin `eslint-disable`.
- ✅ **Guard de frontera de la 135: RETIRADO.** Medía el diff de la rama actual y uno de sus casos
  prohibía crear páginas. La propiedad permanente ya la cubre `modulo-puro.guardia.test.ts`.
- ✅ **Drift de Prisma: era del `schema.prisma`, no de la base.** Las 10 sentencias son 10 defectos
  del modelo; se reconcilian con 9 líneas declarativas y **cero DDL**. Dos eran peligrosas en
  producción (una FK money-critical a `SET NULL` y un `RENAME` que dejaba mudo un `down.sql`).

> ✅ **`./init.sh` termina en `== init OK ==`: 665 archivos / 8052 tests, 0 rojos, 0 errores de lint.**
> Entregado en el **PR #232**. El último rojo era el guard `no-embalaje` acusando prosa de la 135 que
> nombra el propio guard: llevaba días rojo porque cada feature lo declaraba deuda ajena y seguía.

## 🗓️ Sesión 2026-07-30 (noche, cuarta) — feature 129: fase 1

**Pedido del humano: «comienza con la feature 129»** (analítica: ruta, shell y sidebar).

### ✅ Registro RECONCILIADO — la zona `frontend` estaba falsamente saturada

El registro declaraba **3 features `in_progress` en `frontend`** (161, 163, 164) y la regla 1 admite 2,
así que la 129 —que es `frontend`— parecía bloqueada de entrada. **No lo estaba: las tres ya están en
`dev`.** Se mergearon con el **PR #212** (`ux` → `dev`, MERGED el 2026-07-30 22:23Z); lo que faltaba era
el bookkeeping del F2.5, no el trabajo.

**Verificado POR ARCHIVOS contra `origin/dev`, no por el estado del PR** — que es la lección del #209
escrita más abajo: `hooks/useInstalarPwa.ts`, `components/shared/InstalarPwaButton.tsx`,
`components/shared/CarruselCards.tsx`, `components/shared/carrusel-rango.ts`, `components/ui/carousel.tsx`,
`hooks/useTonoAlIncrementar.ts` y `lib/audio/tono-notificacion.ts` están **todos** en `origin/dev`.

**161, 163 y 164 → `done`.** La zona `frontend` queda en **0 `in_progress`** y el aviso de arné que la
164 dejó anotado («`./init.sh` falla hasta que se cierre alguna») **queda saldado**.

> ⚠️ **`./init.sh` NO detectó la infracción de la regla 1 con las 3 abiertas.** El bloque que la valida
> está entero dentro de un `if command -v jq`, y **`jq` no está instalado en esta máquina** (solo emite
> el `warn` del paso 1). O sea: **el gate del que depende la regla 1 lleva tiempo sin ejecutarse**, y
> con él la comprobación 4 (specs presentes para features en vuelo). Cuarta aparición del patrón de
> este repo: *una herramienta que decide algo mirando lo que tiene a mano en vez de la fuente de verdad*.

### 🔴 `origin/dev` ESTÁ ROJO: 20 tests — y mi primera medición del baseline fue FALSA

**El dato que importa: `dev` tiene 20 tests rojos ahora mismo, y no los puso esta feature.** Viven en
`MisAsignacionesModule` (×16), `MisAsignacionesPage`, `MarcarLuegoToggle`, `ManifiestoFlujos` y
`EscanerRecepcion`. Reproducen en aislado (20/125), ninguno de esos archivos está modificado en la rama
de la 129 y en los cinco el grep de `analitica|menu-visibility|Sidebar|ROLES_ANALITICA` da **0**. Son
los **KPIs animados del rediseño del mensajero** que la bitácora de la rama `ux` ya declaraba como «14
rojas previas» → 18 → 20, y que **el PR #212 metió en `dev` sin que nadie los saldara**.

> ⚠️ **Consecuencia: cualquier feature que arranque desde `dev` hereda 20 rojos y no puede poner
> `./init.sh` en verde.** No es de la 129; es deuda de `dev` y necesita dueño.

**Y el error de método, que conviene que quede escrito.** Al arrancar medí `./init.sh` y leí
**«635 archivos / 7385 tests / 2 rojos»**, concluí que los 2 eran saturación de workers y di el baseline
por **verde**. Era falso. Esa corrida traía **11 `unhandled errors`** de arranque de workers de vitest y
reportó **635 archivos donde en realidad hay 649**: **catorce archivos nunca llegaron a ejecutarse**, y
entre ellos estaban los cinco que fallan. **Medí una suite degradada y la leí como sana.** Lo destapó el
implementer al reportar 20 rojos contra mis 2, y se confirmó corriendo los cinco archivos a mano.

> **LECCIÓN: en vitest, un recuento de archivos más bajo de lo normal y un bloque de `Errors` son parte
> del resultado, no ruido.** Una suite que no arranca del todo **no reporta rojo: reporta de menos.** El
> total de archivos hay que compararlo contra el esperado antes de creerse el número de fallos. Es la
> misma familia que el bug de `run_if` documentado dentro de `init.sh`: un gate que termina en verde
> porque **no llegó a mirar**, no porque estuviera bien.

### ✅ Los 20 rojos SE SALDARON — y el gate ahora corta en LINT, también por deuda de `dev`

`dev` avanzó **16 commits** durante la sesión (PRs #213-#221: la 157, dos hotfix, etiquetas en carga
masiva) y se integró en la rama de la 129 sin un solo conflicto: **`dev` no toca ni los archivos de la
129 ni `app/(app)/ranking/`**, así que el WIP ajeno sobrevivió al merge intacto.

- **Los 20 rojos desaparecieron.** Los saldó `25ab36e0` («restaura el filtro cantón/distrito y pone la
  suite entera en verde»). Re-medido tras el merge, no dado por hecho por el mensaje del commit: los 5
  archivos que fallaban + los 4 de la feature dan **9 archivos / 188 tests / 0 fallos**, y la **suite
  completa `pnpm test` da 652 archivos / 7753 tests / 0 FALLOS** — verde entera, con el WIP de ranking
  de la otra sesión dentro. (El recuento de archivos sube de 649 a 652 y es coherente: +2 de la feature,
  +1 del ranking ajeno. Comprobarlo es justamente la lección del párrafo anterior.)
- **⚠️ Pero `./init.sh` sigue sin poder ponerse verde, y otra vez no es de la 129:** corta en `lint`
  con **3 errores** en `app/(app)/ordenes/_components/OrdenesModule.tsx:340,345`
  (`Compilation Skipped: Existing memoization could not be preserved`, la regla del React Compiler).
  El archivo es **byte-idéntico a `origin/dev`** y lo introdujo `a4eb7813` («fix(ordenes): filtro sin
  estados retirados»). **Es deuda de `dev` y necesita dueño.**
- Efecto colateral: como `lint` corre **antes** que `test` en `init.sh`, mientras eso siga rojo el gate
  **nunca llega a ejecutar la suite**. Los números de tests hay que sacarlos con `pnpm test` aparte.

> **Segunda vez en la misma sesión que la 129 queda bloqueada por deuda ajena heredada de `dev`**:
> primero 20 tests, ahora 3 errores de lint. La feature en sí está limpia — sus 4 archivos dan 59/59.

### ⚠️ HAY OTRA SESIÓN VIVA EN ESTE MISMO CHECKOUT — no se cambió de rama

A mitad de sesión aparecieron cambios sin commitear que **no son de esta sesión**: un rediseño de podio
del ranking (`app/(app)/ranking/_components/RankingPodio.tsx` **untracked**, creado a las 19:59, y
`ranking-labels.ts` modificado a las 19:58 con `iniciales`, `anchoBarra` y `PODIO_LABELS`). Al abrir la
sesión `git status` estaba **limpio**, así que se escribieron **en vivo**.

**Decisión: no se creó la rama `feature/129-...` ni se movió HEAD.** Crear la rama habría arrastrado el
WIP ajeno, y cambiar de rama habría movido HEAD debajo de la otra sesión — que es exactamente el
incidente del `backend_dev` con worktree ya registrado. **La fase 1 solo escribe bajo `specs/`, así que
no necesita rama**; la creación de la rama se difiere a la fase 2. Al implementar hay que **volver a
mirar** si ese WIP sigue suelto.

### ✅ 129 ENTREGADA — **PR #224**, esperando merge humano

`https://github.com/nuformecuador-lgtm/ordenex/pull/224` · rama `feature/129-analitica-ruta-shell-sidebar`
· 7 commits · 15 archivos (+2377/−9) · **`MERGEABLE`** (`UNSTABLE` sólo mientras Vercel despliega).

**Reviewer: APROBADO-CON-NOTAS, 0 bloqueantes**, 7 menores (`progress/review_129.md`). **24/25 R
verificados hasta test no vacuo**; el 25.º («sin dependencias nuevas») se verifica por diff, que está
vacío. **20 mutaciones del reviewer, 17 discriminaron** — ninguna reutilizada de las 9 del implementer.

**Las 3 supervivientes quedaron cerradas antes del PR** (`473317e2`), y una de ellas era un defecto
real de lo entregado, no un hueco de test:

- **La nota de traspaso a la 133 inducía el bug que la feature previene.** Mandaba ampliar «DOS sitios»
  que hoy son **el mismo** (`roles: ROLES_ANALITICA`); seguirla al pie llevaba a desenganchar el ítem
  con un literal, que es exactamente lo que `R10` vigila. Reescrita: ampliar es **editar UNA constante**,
  con apartado de qué NO hacer y aviso de que `R3`, `R9` y las listas de `R17` se pondrán **rojos por
  diseño** —el rol se mueve de una lista a la otra, nunca se relaja el guard—.
- Las otras dos eran **tests que medían forma**: el icono se asertaba por unicidad de la *clave*, así
  que `chartColumn: Home` pasaba; y el encabezado se podía sustituir por un `div`+`h1` perdiendo
  `PageHeader` y `Container` sin que nada lo notara.
- **La cuarta no se tapó con un test frágil.** `"use client"` en la página **pasa los 59 tests** y sólo
  revienta en `next build`, arrastrando `pg`/Prisma al bundle del cliente. Se ejecutó el build de
  verdad: **exit 0** con `/analitica` en el manifiesto, y **exit 1** con la mutación puesta.

> ⚠️ **`init.sh` NO corre `next build`, así que la frontera RSC no la cubre ningún gate automático.**
> Y ojo con el atajo: **`pnpm build` encadena `tsx scripts/migrate-deploy.ts`**, que **aplica
> migraciones contra una base real**. Para sólo compilar, `pnpm exec next build`.

### 📝 Fase 1 de la 129 — spec escrita, puerta CERRADA

`specs/129-analitica-ruta-shell-sidebar/` (requirements EARS + design + tasks). La 129 es **solo el
andamio**: ruta, shell vacío e ítem de menú. **Cero métrica, cero gráficas, cero fetch.**

- **El `prefetch` que pide la ficha se declara FUERA DE ALCANCE con su razón**: la 129 tiene
  `depends_on: null` y las Server Actions de analítica **no existen todavía** (son la 125/126/127). Se
  deja el punto de extensión donde la 131 lo enchufará, en vez de inventar una fuente.
- **7 preguntas de puerta, T0 CERRADA y escrita EN el spec** (no solo aquí): las Q quedan marcadas
  `[x] RESUELTA` con su respuesta textual, y además viven como bloque `D1-D8` en `requirements.md`,
  propagadas a los R y al `design.md`. **Los R crecieron de 23 a 25**, y los dos nuevos salen de las
  propias decisiones: **`R10`** —el gate de la página y la visibilidad del ítem declaran el **mismo**
  conjunto de roles, con test que falla si divergen— y **`R16`**, la posición del ítem. Las respuestas:
  **Q1** el ítem es **solo `maestro`/`admin`** — la 129 **se desvía de su propia ficha a propósito**
  (dice cinco roles) porque hasta la 131 la página está vacía; **ampliar es alcance de la 133**.
  **Q2** etiqueta «Analítica». **Q3** `iconKey` nueva `chartColumn`. **Q4** pila vertical de regiones,
  no pestañas. **Q5** la región financiera la añade la 132. **Q6** (decisión del leader, no había regla
  escrita) el ítem va tras «Inicio» y antes de «Órdenes», porque comparte sus dos roles exactos.
- **Q7 — desfase de numeración confirmado, no cambio de alcance:** las fichas de la 130/131/132 citan
  «gráficas de 129» y «ruta 128» por una renumeración previa; mismo desfase en 124/125/126. Anotado en
  el `design.md` para que no confunda a quien implemente la 131. **`feature_list.json` no se tocó.**

### 🔎 Dos hallazgos de la verificación del spec

1. El mapa `iconKey -> componente lucide` vive en **`app/(app)/_components/Sidebar.tsx:138-151`** y su
   tipo es `Record<IconKey, SidebarIcon>` → añadir la clave a la union **rompe el build** hasta mapearla.
   Exhaustividad garantizada por el compilador; no hace falta un test que la vigile.
2. **`ROLES_SEED` es `Object.values(RolValue)` e incluye `apiKey`: son 6 valores, no 5.** El ítem
   «Perfil» lo usa como «cualquier rol autenticado», así que **hoy «Perfil» es visible también para
   `apiKey`** — preexistente, ajeno a la 129 y no se toca aquí, pero es una trampa para quien copie ese
   patrón creyendo que `ROLES_SEED` son los roles humanos. Queda escrito en el `design.md` §5.
3. **`ChartColumn` existe con ese nombre exacto** en el `lucide-react` instalado (`^1.23.0`,
   `lucide-react.d.ts:4138` lo declara y `:24763` lo exporta). Comprobado contra el paquete, no supuesto.

**Estado del registro:** **129 → `spec_ready`** con sus decisiones en el `status_note`. `in_progress` = **0**.

---

## 🏁 CIERRE 2026-07-30 (noche) — ~~EMPIEZA A LEER POR AQUÍ~~

> *(Ya no es el punto de entrada: lo es la «Sesión 2026-07-30 (noche, cuarta)» de arriba. Sigue válido
> en todo su detalle técnico; lo de arriba lo corrige en el estado del registro y en el baseline.)*
## 🗓️ Sesión 2026-07-30 (quater) — arranca el LOTE DE ANALÍTICA — **EMPIEZA A LEER POR AQUÍ**

> **Corrige el «CIERRE (noche)» de más abajo en un punto:** ese bloque dice «registro con CERO
> `in_progress`» y ya no es cierto — la **135 está `in_progress`** desde esta sesión. Todo lo demás
> de aquel cierre sigue en pie.

**Feature 135 → implementada y revisada.** Rama `feature/135-analitica-catalogo-kpis-rangos`,
nacida de `dev` @ `664840f3` y **sincronizada después con `dev` @ `72b75954`** (45 commits: los
PRs #208/#210/#211/#212). Spec: **36 R en EARS** (26 + 10 tras la puerta), 6 alternativas
descartadas, 12 hechos de inventario **leídos en el código**.

**Implementación:** `lib/analytics/{types,metrics,ranges,filters}.ts` + 9 suites propias.
Delta medido en árbol limpio: **617 archivos / 6973 tests → 626 / 7150**, cero regresiones.
**Reviewer APROBADO-CON-NOTAS: 35 de 36 R verificados POR MUTACIÓN** (38 mutaciones, 35 muertas,
3 supervivientes, todas el mismo punto de R22 — dos redes redundantes, sin agujero de
comportamiento). El R36 no es mutable: es la puerta ejecutable.

### ⚠️ El incidente de esta sesión, para que no se repita

**Otra sesión movió este checkout de `feature/135-…` a `ux` a mitad de la implementación**
(`git reflog`: `checkout: moving from feature/135-… to ux`, más un `reset`). El implementer se
quedó sin `specs/135-…/` en disco y perdió las casillas ya marcadas, el parche del guard y el
bookkeeping. **Hizo lo correcto: paró y no ejecutó nada destructivo.** El código sobrevivió por ser
untracked. Se recuperó montando un **worktree aparte** sobre la rama y moviendo allí los archivos,
**sin tocar el árbol compartido** ni sus ~100 archivos staged.

> **LECCIÓN: en un repo con varias sesiones vivas, la rama es un recurso compartido.** Antes de
> `checkout`, mirar si hay trabajo ajeno en vuelo; y si hay que recuperar una rama secuestrada,
> `git worktree` en vez de arrebatar el árbol de vuelta.

**El `typecheck` rojo NO era «cliente Prisma contaminado».** Ese fue el diagnóstico inicial —
plausible, y con delta 0 verificado dos veces— pero la causa real era otra: **`dev` había avanzado
45 commits** y la rama se había quedado atrás, sin el `orden_incidente` de la 158 que el cliente
generado ya conocía. Se resolvió sincronizando con `dev`, no regenerando nada.

> **Confirmado por segunda vez y por otra vía el 2026-07-30 (cierre):** `git diff origin/dev
> feature/135-… -- db/schema.prisma` sale **vacío** (los schemas son byte-idénticos) y
> `npx tsc --noEmit` da **exit 0**. **Regla que conviene fijar: antes de dar por bueno un
> «cliente Prisma contaminado», comparar los dos `db/schema.prisma`.** Si son iguales, la causa es
> otra. Se perdió tiempo dos veces con este diagnóstico.

### ✅ Cierre de la 135 — 2026-07-30, en worktree aparte (el checkout de `ux` no se movió)

**R22 cerrado por mutación.** Era el único hueco del review: 3 mutaciones vivas porque el
comportamiento estaba protegido por **dos redes redundantes** (el regex de ancho fijo y el
`.refine` del tope, que trata `NaN` como rechazo) y ningún test discriminaba una sola. Tres
aserciones nuevas, elegidas **midiendo**: `"2026-13-45"` (pasa el regex, `Date.parse` da `NaN`) y
`"+002026-07-15"` (año expandido ISO: el regex lo rechaza, `Date.parse` lo acepta). Las tres
mutaciones ahora **mueren por separado**. Suite de analítica 177 → **180 tests**.

> **Descartado sobre la marcha:** `"2026-02-30"` parecía el caso obvio de «fecha que no existe» y
> **no sirve** — V8 la desborda a marzo y `Date.parse` devuelve finito. Se vio corriéndolo.

**Delta contra `dev` MEDIDO con baseline propio**, no deducido de «esos rojos no son míos»:

| | archivos | tests | rojos |
|---|---|---|---|
| `dev` @ `72b75954` | 646 | 7627 | **22** |
| rama 135 | 655 | 7807 | **20** |

Los 20 son **subconjunto estricto** de los 22, test a test → **cero regresiones**, +9 archivos /
+180 tests.

**⚠️ `dev` ESTÁ ROJO con 20 tests, y no es de la 135.** Todos del rediseño de `ux` que entró por el
**PR #212**: filtros cantón/distrito de la 117 (`MisAsignacionesModule`) y las cards en reparto.
Es lo que mantiene `pnpm test` en rojo para cualquiera que ramifique de `dev` hoy.

**T0.3, T6.3 y T6.5 cerradas.** T6.5 avisó a **ocho** features (122, 123, 124, 125, 126, 127, 132,
133), no a las cinco que nombraba la task: `design.md §6.1` también dirige avisos a la 122 y a la
124/125. **T6.1 sigue sin marcar a propósito** — `./init.sh` no está verde y marcarla sería fingir.

**🆕 Ficha 166 registrada** (T0.3): saneamiento de la ventana de día de `RankingService`
(18:00–18:00 CR → día natural CR).

### ⚠️ DEFECTO DE REGISTRO SIN RESOLVER — el id 162 está DUPLICADO

`feature_list.json` tiene **dos features distintas con `id: 162`**: «notificación del sistema con la
app abierta (Notification API)» y «no enviar mensajes de whatsapp sobre órdenes en estado no
elegible». Es la **misma colisión** que obligó a renumerar la 161 → 165 al mergear `dev` en `ux`,
pero aquella renumeración **arregló un id de los cuatro**. Por eso la ficha nueva tomó el **166**.

**No se renumera desde la sesión:** las dos fichas están citadas por escrito fuera del registro (la
158 y este mismo archivo), así que cuál cede el id es **decisión del humano**. Mientras tanto,
cualquier búsqueda por id 162 devuelve dos cosas.

**Es la raíz del lote.** El orden lo dicta `depends_on`, no es elegible:
`135` → `122` (alcance por rol) → `127` → `128`/`132`/`134`, y `135` → `123` (rollup) → `124` →
`125` → `126` → `131` → `133`. `129` (ruta/shell) y `130` (gráficas) son frontend y no dependen de
nadie. **Ninguna de las 14 tenía spec en disco.**

**⏸️ PUERTA F1.4 ABIERTA — 10 preguntas bloqueantes** en `requirements.md > Preguntas abiertas`,
espejadas en el bloque `T0` de `tasks.md`. Las que más arrastran: **Q1** (la ficha no enumera ni una
métrica; el design propone 13 operativas + 6 financieras y cada una que entre obliga a la 126/127),
**Q6** (cuál es el «día operativo» canónico) y **Q5**/**Q9**/**Q10** (granos y atribución, que fijan
la PK del rollup de la 123).

### Tres correcciones a la ficha, verificadas en código

1. **`order_status` tiene 19 values vigentes, no 20.** La 154 apendió dos (18→20) y **la 155 retiró
   `en_fulfillment`** (20→19). Peor: su migración solo borra la fila del catálogo si nadie la
   referencia, así que en una base con historial **`en_fulfillment` sobrevive huérfana** e
   inalcanzable desde el código. Un embudo debe citar los 19 del seed, no lo que haya en la tabla.
2. **«La lógica de fecha del corte diario» que pide la ficha NO EXISTE.** `CorteDiarioService`
   no usa fecha alguna: opera sobre «mensajeros con actividad sin cierre». La lógica de día en hora
   CR vive en `lib/utils/fecha-cr.ts` y es reutilizable tal cual, sin extracción.
3. **`orden.zona_id` y `orden.tienda_id` son NOT NULL** → «órdenes sin zona/tienda» no puede
   ocurrir. Lo nullable es `mensajero_asignado_id` (y `distrito_id`) — de ahí sale Q5.

**🔎 Hallazgo que hay que resolver antes de implementar (Q6): hay dos convenciones de «día» vivas y
no coinciden.** `RankingService.ts:60-61` compara columnas `timestamp` contra `startOfDayCR` + 24 h,
o sea una ventana **18:00–18:00 hora CR**; los filtros de `/ordenes` (feature 144) usan
`inicioDelDiaCREnUtc`, o sea **00:00–24:00 CR**. Analítica no puede adoptar las dos, y elegir la
correcta hará que ranking y analítica reporten cifras distintas para «hoy» hasta que se sanee.

## 🏁 CIERRE 2026-07-30 (noche)

**Todo mergeado a `dev`. Registro con CERO `in_progress`.**

| PR | Qué | |
|---|---|---|
| **#208** | 158 · camino del mensajero (R1-R36) | ✅ mergeado |
| **#210** | 158 · camino del admin (R37-R64) | ✅ mergeado |
| **#168** | 141 · tabla `carga` + `carga_id` | ✅ mergeado, tras 3 días abierto |

**Gate final con todo conviviendo: 636 archivos / 7493 tests / 0 fallos.**

### ⚠️ LA TRAMPA DE ESTA SESIÓN, para que no se repita

**El PR #209 se mergeó contra `feature/158-incidente-indemnizacion` cuando esa rama YA se había
consumido** con el merge del #208 a `dev` tres horas antes. GitHub lo marcó **MERGED** y no avisó de
nada: el camino del admin —tabla `orden_incidente`, su migración, la página `/incidentes` y el segundo
emisor de wallet— **se quedó varado fuera de `dev`**. Se detectó verificando `origin/dev` **por
archivos** (cero coincidencias de `IncidenteAdmin`, `incidentes/` y `orden_incidente`) y se corrigió
con el **#210**.

> **LECCIÓN: en PRs apilados, si la base se mergea antes que el hijo, el hijo queda huérfano y su
> estado sigue diciendo MERGED.** Verificar SIEMPRE que el contenido llegó a `dev` **por archivos**,
> nunca por el estado del PR. De no haberse mirado, producción se habría llevado media feature 158 y
> una migración de menos.

### 🚀 Despliegue `dev → prod` — pre-vuelo COMPLETO

- **✅ `T24.1`: CERO órdenes**, re-corrida contra producción justo antes.
- **✅ El retiro de `en_fulfillment` es NO-OP en producción**: su `DELETE` es condicional y hay 8 filas
  de historial apuntando al value → la fila sobrevive inalcanzable, **sin violación de FK**.
- **🔎 Producción tiene un value `pendiente` vestigial** (0 órdenes, 0 historial). Explica el desfase
  «18 estados» de las specs frente a los 19 de la base.
- **⚠️ Cosmético tras desplegar:** el desplegable de filtro leerá `en_fulfillment` y `pendiente`, que
  no están en `ORDER_STATUS_SEED` → se muestran como **slug crudo** (fallback documentado, `R17` de la
  feature 29). No rompe.

### 📋 Decisiones que el humano delegó y quedaron aplicadas

- **`R56` DECLARADO** en la spec de la 141, antes de mergear el #168. Es el invariante que destapó la
  mutación superviviente: una orden revertida conserva `carga_id` y `download_url`. Redactado **más
  ancho que el mutante** a propósito.
- **Feature 162 REGISTRADA** — `OrdenEnvioReader.findParaEnvio` no filtra por estado, así que un
  mensajero puede seguir mandando plantillas de WhatsApp **al destinatario de un paquete robado**.
  Preexistente, agravado por Q-J + Q-K.

### 🧰 Deuda de arnés nueva, registrada y SIN tocar (no es de ninguna feature)

1. **`scripts/db-rollback.ts` elige la migración por NOMBRE de carpeta**, no por la última aplicada
   (`readdirSync` + `sort`, sin consultar `_prisma_migrations`). Correrlo dos veces revierte la misma
   migración dos veces.
2. **El orden obligatorio de los `down.sql` no lo impone ningún gate**: revertir la migración del PR 1
   de la 158 con la del admin aplicada **aborta**.
   > **Tercera y cuarta vez que una herramienta de este repo decide algo mirando el árbol de archivos
   > en vez de la fuente de verdad.** Las otras dos: los guards con `fs.readdir` en vez de
   > `git ls-files`, y la denylist de migraciones (muerta en el #207).
3. **E2E: decisión del humano el 2026-07-30 — «no más e2e, pruebas básicas nada más».** No se
   construye harness ni se escriben specs. Cuando `CHECKPOINTS.md` lo exija: declararlo **inaplicable
   con su razón** y **cubrir el riesgo concreto por otra vía**, como hizo el reviewer del PR 2
   probando la idempotencia contra el índice real de Postgres.

---

## 🗓️ Sesión 2026-07-30 (tarde)

> Lo de más abajo sigue válido en su detalle técnico; esto lo corrige donde se contradiga.

### Tres correcciones al «cierre del día» de esta misma mañana

1. **✅ El pendiente #1 ya estaba saldado.** `prisma migrate status` contra `localhost:5432`:
   **95/95, «Database schema is up to date!»**. Las dos migraciones que el cierre daba por pendientes
   (`chat_mensaje_error_meta` y `orden_historial_origen_deshacer_asignacion`) ya están aplicadas.
2. **PR #207 está listo:** `MERGEABLE` / `mergeStateStatus: CLEAN`, Vercel **SUCCESS**, 10 archivos
   (+176/−177). Sólo falta el merge (humano). **Conviene mergearlo ANTES de implementar la 158:** la
   158 trae migración, y sin el #207 paga el peaje de la denylist.
3. **⚠️ PR #168 (feature 141) YA NO es mergeable:** pasó a `CONFLICTING` / `DIRTY` (43 archivos). El
   cierre lo daba por «MERGEABLE con gate verde» — cierto antes de los merges de ayer. Ahora necesita
   **rebase** además del re-review que ya se sabía pendiente. Sigue siendo la `in_progress` más vieja
   (27/07) y la única de la zona backend.

### 🚪 Puerta F1.4 de la feature 158 — **CERRADA hoy**, 10 decisiones

> Se escriben aquí Y en el spec. Es la lección de la «CORRECCIÓN 1» de más abajo: gate aprobado en la
> bitácora no es lo mismo que preguntas del spec respondidas por escrito.

- **Q-A = LOS DOS reportan.** Textual del humano: «los dos ya que los dos manipulan paquetes».
  Mensajero al gestionar desde `en_reparto` (arista #44, ya declarada por la 154) **+ admin desde
  bodega y tránsitos internos**: `en_bodega_central`, `en_bodega_satelite`, `en_ruta_bodega_central`,
  `en_ruta_bodega_satelite`, `por_recoger`. **Son 5 aristas nuevas** al mapa de la guardia central.
  ⚠️ **Es alcance nuevo:** la spec estaba escrita de punta a punta (R1-R36) para el mensajero solo. El
  humano eligió **ampliar la 158 ahora** en vez de partirla en dos features.
- **Q-B (alcance) = causa tipada + evidencia OBLIGATORIA SIEMPRE**, en las tres causas. Enum cerrado
  de 3 valores, sin «Otro»; `motivo` en texto libre obligatorio siempre. **Se le planteó la objeción**
  (en `perdido`/`robado` no hay paquete que fotografiar y bloquea al mensajero en la calle) y eligió
  esta opción de todas formas. Queda **declarado como consecuencia aceptada**, no disimulado.
- **Q-B (idioma) = ESPAÑOL** (`danado`, `perdido`, `robado`). Rompe **a propósito** la coherencia con
  `causa_devolucion`, que está en INGLÉS (`not_found`, `wrong_number`, `wrong_address`) por decisión
  consciente del humano en la feature 73, a favor de la coherencia con `gestion_resultado` y
  `order_status`. **Que nadie lo «arregle» después.**
- **Q-C = columna nueva `gestion_orden.indemnizacion`.** `cierre_detail` descartado **por evidencia**:
  es snapshot inmutable escrito al *solicitar* el cierre, y el monto se captura al *aprobar*.
- **Q-D = SÍ se puede deshacer**, en ventana controlada. Textual: «como es una app usada por seres
  humanos y nosotros solemos cometer errores, lo ideal es que cada acción se pueda deshacer,
  obviamente dentro de un ambiente controlado». ⚠️ **Revierte parcialmente la decisión de la 154 ya
  mergeada** (`incidente: []`, `order-status-transiciones.ts:206`, «a diferencia de `entregada` NO
  conserva ninguna salida — decisión del humano del 2026-07-29»). Compatible con dejarlo terminal:
  `ESTADOS_TERMINALES` **exime de tener salida pero no la prohíbe** (`:236-237`) y `entregada` es el
  precedente exacto.
  - **Problema técnico duro que abre:** hoy el destino del deshacer está **hardcodeado a `en_reparto`**
    (`CierreDiaService.ts:65,388`) y **repone la asignación al autor de la gestión** (`:399`). Con
    orígenes múltiples eso es incorrecto dos veces: un incidente reportado por un admin sobre un
    paquete en `en_bodega_central`, al deshacerse, mandaría la orden a `en_reparto` **asignada al
    admin**. El destino tiene que ser **el estado de origen**.
  - Red de seguridad: `ESTADOS_ESPERADOS` es un `Record<GestionResultado, …>` exhaustivo → añadir
    `incidente` al enum **rompe el build** hasta declararlo.
- **Q-E = fuera de alcance**, con follow-up explícito: «crédito de indemnización en el ledger por
  tienda» (feature 43). **Falta registrar la ficha** — tarea del leader.
- **Q-F = no se reescriben los `down.sql` previos.** `20260713140000_wallet_egreso_gasto_fijo_variable/down.sql`
  es punto-en-el-tiempo y su test asserta exactamente 12 valores. Sí se corre `tests/integration/db`
  completo en la fase backend.
- **Q-G = el append escribe `origen_tipo = incidente`** + se alinea el `via` de la arista #44. La 154
  dejó esa familia «declarada SIN PRODUCTOR hasta la 158» (`orden-historial.ts:35`).
- **NUEVA — aprobación del camino del admin.** Textual: «la idea es que sea aprobado, y para esto
  podemos usar los cierres ya existentes, verás que tenemos ya dos tablas en cierres, podemos usar el
  mismo modelo». Se reusa el **PATRÓN, no la tabla**: `CierreEstado` (`solicitado → aprobado/rechazado`),
  cola «Pendientes de decisión» + «Histórico» (`CierresAdminModule.tsx:270,291`), motivo obligatorio
  sólo al rechazar. Es la **tercera** aplicación: la feature 40 ya fue la segunda y se declara «espejo
  de CierresAdminService (38)».
  - **`cierre_bodega` NO puede alojarlos** — verificado: agrupa `CierreDia[]`, es por `zonaId` y sólo
    satélite, sin detalle por orden (`schema.prisma:732-758`).
  - **El egreso a la wallet se dispara AL APROBAR.** Requisito explícito del humano: **quien reporta
    no aprueba**. Consecuencia: la feature queda con **dos puntos de entrada al egreso** (mensajero vía
    cierre del día, admin vía aprobación del incidente) y la idempotencia de la wallet tiene que
    cubrir los dos para que una orden no se pague dos veces.

### 🚪 Puerta F1.4-bis de la 158 — spec ampliada y **4 decisiones más**

Spec ampliada a **64 R** (28 nuevos `R37-R64`; **7 reescritos en su sitio** con su nota: `R6` por Q-A,
`R9`/`R10` por Q-B, `R13`/`R14`/`R15` por Q-D, y `R29`, que pasa de «un solo emisor de dinero» a
**«exactamente dos, uno por camino, y ningún tercero»** con guard estructural).

**🔎 Hallazgo que mató el diseño barato — verificado, no supuesto.** El incidente del admin **no puede
ser una fila de `gestion_orden`**: `CorteDiarioRepository.findMensajerosConActividadSinCierre` (`:38-44`)
hace `where: { cierreId: null, anuladaAt: null }` con `distinct: ["mensajeroId"]` **sin filtrar rol ni
resultado** → le habría creado al admin un `cierre_dia` **vencido y bloqueante que no puede resolver**,
porque `CierreDiaService` está acotado al rol `mensajero`. De ahí sale **tabla propia `orden_incidente`**
+ su espejo de evidencias.

**El destino del deshacer NO necesita columna nueva.** Dos cosas verificadas: (1) para el camino del
mensajero el hardcode a `en_reparto` **no es un bug** — una gestión sólo nace desde `en_reparto` y su
autor es siempre mensajero; (2) para el admin el lector ya existe y está mergeado:
`findOrigenesReversion` de la **149** (`OrdenHistorialRepository:212-230`) lee el `estatus_origen_id`
de la fila de historial más reciente. `estado_origen_id` queda como plan B declarado.

**§14 del design lista 10 tests de OTRAS features que esta feature rompe garantizado**, con archivo,
línea y qué deben afirmar — incluidos los que hoy asertan `TRANSICIONES.incidente === []`. Consecuencia
directa de Q-D, declarada por adelantado en vez de descubrirse en el gate.

**Decisiones del humano del 2026-07-30 (segunda ronda):**
- **Q-H = modal por orden en el módulo de órdenes**, desde la acción de fila. Precedentes exactos:
  `RecuperarABodegaModal` (100) y `DeshacerAsignacionModal` (149) — las dos acciones administrativas por
  orden CON MOTIVO que ya viven ahí. **No puede ser acción de lote:** pide causa, motivo y fotos por orden.
- **Q-I = página propia `/incidentes`**, espejo de `cierres-admin`. Precedente: `cierres-bodega-admin` ya
  es página propia para el espejo de la 38. Coste: entrada nueva en `menu-visibility.ts` con rol.
- **Q-E → ficha 161 REGISTRADA** con el OK del humano: «credito de indemnizacion en el ledger por
  tienda», `pending` / backend / medium / `depends_on: 158`.
- **Q-J y Q-K se toman por la recomendación** (no objetadas, con su consecuencia declarada): **Q-J** el
  aviso al mensajero cuya orden pasa a `incidente` queda **fuera de alcance con follow-up escrito** — hoy
  la orden desaparece de «Mis asignaciones» sin aviso, y es el tipo de hueco que se descubre con una
  llamada del mensajero; **Q-K** **no se toca `mensajero_asignado_id`** al reportar desde `por_recoger`,
  así la reversión es trivialmente correcta y la asignación colgando es inocua (`findMisAsignaciones`
  filtra por estados e `incidente` no está entre ellos).

**⏸️ Q-L SIGUE ABIERTA — es la única que bloquea el arranque.** ¿Un PR o dos? El diseño **recomienda
dos** (§15.2) y demuestra que la línea no deja **nada funcional roto** en el intermedio: ninguna arista
ni familia sin productor (las 10 del admin no se declaran hasta que llega su productor — la lección de
la 154 aplicada al revés), ciclo económico completo en el primero, y el único efecto visible es que el
admin no puede reportar desde bodega, **que es el estado de hoy**. La pregunta se hizo primero con la
palabra «entrega» y **se malentendió**: en este dominio «entrega» es lo que hace un mensajero con un
paquete. Reformulada como «un PR o dos PRs».

### ✅ PR 1 de la 158 ENTREGADO — **PR #208**, camino del mensajero (R1-R36)

`https://github.com/nuformecuador-lgtm/ordenex/pull/208` · rama `feature/158-incidente-indemnizacion`
· 21 commits · `./init.sh` **617 archivos / 6973 tests / 0 fallos** (baseline de partida 599/6634 →
**+339 tests**) · `tests/integration/db` 72/715 · `next build` exit 0.

**Reviewer: OK — 0 bloqueantes, 10 menores** (`progress/review_158.md`). **36/36 R verificados hasta
un test concreto y NO VACUO**, sin fiarse del mapa de las bitácoras; **17 mutaciones propias del
reviewer, las 17 discriminan, 0 supervivientes**. El reviewer además **cerró la limitación que se le
declaró** en vez de aceptarla: insertó una fila real de la categoría nueva y comprobó que el DOWN
aborta en el `ALTER COLUMN` — el `USING` cast que no se había podido ejercer con la tabla vacía.

**m5 y m6 saldados antes de abrir el PR**, por decisión del humano:
- **m5 (el monto sin tope frente al `DECIMAL(12,2)`)**: el tope se puso **en el borde de la 158**, NO
  en `montoPositivoSchema` — el defecto es preexistente (feature 45 lo tiene igual) y tocar el schema
  compartido cambiaría otras features sin su puerta. La frontera **se midió contra Postgres**, no se
  dedujo: `9999999999.99` cabe, `10000000000.00` desborda. En cliente se comparó **por texto**, porque
  11 dígitos no caben exactos en un `number` de JS.
- **m6 (media compensación vacua en el censo)**: **reforzado, no retirado**. Las dos mutaciones que
  ahora lo matan (degradar el `case` a comentario, degradar la guardia de evidencias) **antes dejaban
  el test verde**.

**⚠️ `R29` queda a medias en el PR 1 A PROPÓSITO**: pide «exactamente DOS» emisores de
`egreso_indemnizacion` y allí hay uno. El guard lo fija con un assert que obliga a que pase a 2 en el
PR 2. **El PR 2 lo cumplió** (ver abajo).

**⚠️ La dispensa de E2E del PR 1 es explícita y NO EXTENSIBLE al PR 2.** La deuda de fondo —que no
haya harness de E2E en el repo— sigue viva y sin dueño.

### ✅ PR 2 de la 158 ENTREGADO — **PR #209** · y **PR #168 RESCATADO**

**PR #209** (`feature/158b-incidente-admin`) — ⚠️ **apilado sobre el #208, no sobre `dev`. Mergear el
#208 primero.** `./init.sh` **630 archivos / 7354 tests / 0 fallos** · `next build` exit 0 con
`/incidentes` en el manifiesto · **Reviewer OK, 0 bloqueantes**, 7 menores, **28/28 R verificados**,
**32 mutaciones, 31 discriminan**.

- **`R29` cumplido y verificado EN LAS DOS DIRECCIONES**: son exactamente dos emisores — un tercero
  pone el guard rojo **y quitar uno también**. Es igualdad, no `some()`.
- **Contra Postgres real**: el `USING` del down aborta con filas en las tres tablas; los 6 índices
  vuelven byte-idénticos; y **la idempotencia del egreso contra el índice real de la 42**, que hasta
  ahora sólo estaba simulada en memoria.
- **E2E declarado INAPLICABLE con razón verificada** (no por inercia): `./init.sh` no corre
  `test:e2e` y los 20+ specs existentes declaran *«WRITTEN but NOT EXECUTED»*. **No se dispensó
  gratis**: el reviewer cubrió por otra vía el riesgo concreto. **La deuda del harness sigue viva
  desde la 148.**
- **Alcance añadido a media fase por el humano**: el `adminSatelite` reporta desde
  `/recepcion-satelite`. El modal se **reusó, no se duplicó**. `en_ruta_bodega_satelite` queda fuera
  con razón escrita y el reviewer lo juzgó: **ningún requisito incumplido**.

**PR #168 (feature 141) RESCATADO** — de `CONFLICTING` a **`MERGEABLE`/`CLEAN`**. Un solo conflicto y
era `zonas-migration.test.ts`: la rama traía la denylist a mano de 107 líneas, `dev` el baseline
pinneado del #207. **Re-review OK, 0 bloqueantes, el veredicto del 27/07 sigue válido** y queda
**saldada su nota menor 2** (round-trip, hecho ahora con la 141 aplicada DESPUÉS de las del 28/29/30,
`DOWN` con datos vivos y RE-UP con esquema idéntico). 27 mutaciones, 26 muertas.

> **El mutante superviviente, cerrado:** añadir `carga_id = NULL, download_url = NULL` al `SET` de
> `deshacerAsignacionLote` dejaba **7110/7110 tests verdes**. El comportamiento era correcto, pero
> **nada lo protegía**. Test nuevo colocado a propósito LEJOS de los unitarios que afirman la *forma*
> del SQL. `./init.sh` 623 / 7112 / 0.

### 🚀 Pre-vuelo del despliegue `dev → prod` — HECHO el 2026-07-30

- **✅ `T24.1` PASA: CERO órdenes.** Consulta de retroactividad contra producción (solo lectura).
  Contexto comparable: órdenes en `devuelta` **2 → 0**, filas de historial **167 → 169**,
  `reprogramada`+`gestion` **10**, `reprogramada`+`reprogramacion_tienda` **0**.
- **✅ Verificado lo único que podía romper: no rompe.** La 155 retira `en_fulfillment` y producción
  tiene **8 filas de historial** apuntando a ese value. Su `DELETE` es **CONDICIONAL** y su comentario
  ya anticipaba este caso: en base con historial real es **NO-OP** y la fila del catálogo sobrevive,
  inalcanzable desde la app. **Sin violación de FK.**
- **🔎 Encontrado el desfase que las specs arrastraban:** producción tiene un value **`pendiente`** con
  **0 órdenes y 0 filas de historial** — vestigial. Por eso las specs decían «18 estados de hoy»
  mientras la base tiene 19.
- **⚠️ Consecuencia cosmética tras desplegar:** el desplegable de filtro leerá 21 filas, incluidas
  `en_fulfillment` y `pendiente`, que **no están en `ORDER_STATUS_SEED`**. El fallback está
  documentado (`R17` de la feature 29): **se muestran como slug crudo**. No rompe.

### ⏭️ Decisiones humanas pendientes al cerrar

1. **Desplegar `dev → prod`** (140 commits, tren 154+155+156). **No queda nada técnico por comprobar.**
2. **Mergear #208 → luego #209** (están apilados) y **#168**.
3. **¿Se añade el `R56` a la spec de la 141?** («al deshacer la asignación el sistema DEBE conservar
   `carga_id` y `download_url`»). Redactado más ancho que el mutante a propósito. **No se aplicó: es
   decisión humana.**
4. **⚠️ Candidata a ficha propia — `OrdenEnvioReader.findParaEnvio` NO filtra por estado**, sólo por
   `mensajeroAsignadoId`: un mensajero podría seguir mandando plantillas de WhatsApp **al destinatario
   de un paquete robado**. Patrón **preexistente** (pasa igual con `entregada`/`devuelta`), pero Q-J y
   Q-K juntas lo agravan.

### 🔨 PR 2 de la 158 — camino del admin (R37-R64) · detalle de implementación

Rama `feature/158b-incidente-admin`, apilada sobre el #208 (su migración es aditiva sobre la del PR 1).

**Fase 1B (backend) COMPLETA**: 14/14 tasks · `./init.sh` **624 archivos / 7228 tests / 0 fallos** ·
`tests/integration/db` **73/742** · 97 migraciones sin drift · **18 mutaciones, 18 discriminan**.
**`R29` queda en DOS emisores** — el caso del PR 1 se **invirtió, no se borró**, y cada emisor declara
su `origen_tipo` en su código. Fase 2B (frontend) en implementación.

**Dos mutaciones revelaron guardias que sólo medían FORMA** (el shape del `where`, 1 rojo cada una):
el `estado: "aprobado"` del feed y el `estado: "solicitado"` de `resolver`. Con dobles que honran el
`where`, ahora ponen 3 rojos cada una, **dos sobre el dinero**.

### 🔎 Dos hallazgos operativos del PR 2 que NO son de la feature

1. **⚠️ EL ORDEN DE LOS DOS `down.sql` IMPORTA, y el spec no lo decía.** Revertir la migración del PR 1
   con la del admin aplicada **ABORTA**: `orden_incidente.causa` depende de `gestion_causa_incidente`.
   En orden inverso las dos corren completas. **Quien revierta en producción tiene que ir del más
   nuevo al más viejo**, que es lo natural pero nadie lo había verificado.
2. **🐛 `scripts/db-rollback.ts` elige la migración por NOMBRE, no por la última APLICADA.** Verificado:
   `readdirSync` + `sort` por nombre + coger la última (`:9-18`); **nunca consulta
   `_prisma_migrations`**, sólo borra el registro por nombre después. **Correrlo dos veces revierte la
   misma migración dos veces**, y una carpeta con timestamp fuera de orden le hace elegir la
   equivocada. Hoy los nombres coinciden con el orden real, así que no ha mordido.
   > **Es la TERCERA vez que una herramienta de este repo lee el sistema de archivos en vez de la
   > fuente de verdad**: los guards con `fs.readdir` en vez de `git ls-files`, la denylist de
   > migraciones que se mantenía a mano (ya arreglada en el #207 pinneando el baseline), y ahora esto.
   > El patrón tiene nombre y conviene usarlo al revisar: **si un script decide algo mirando el árbol
   > de archivos, la fuente de verdad casi siempre está en otro sitio.**

**Q-J ya no es teórica:** un admin puede reportar un incidente sobre una orden `por_recoger` **ya
asignada**, y esa orden desaparece de «Mis asignaciones» del mensajero **sin aviso**. Sigue siendo
follow-up declarado, no lo cierra el PR 2.

**Estado del registro:** ficha **158 `in_progress`** con las 14 decisiones en su `status_note`; ficha
**161** registrada (follow-up de Q-E). Regla 1 respetada: backend 1 (la 141), fullstack 1 (la 158).

---

> ### Reconciliado el 2026-07-28 contra `origin/dev` @ `0bcc360`
>
> Verificado PR por PR con `gh pr list` y contra el código, no supuesto. **`feature_list.json`
> declaraba 5 features `in_progress`; solo 1 lo estaba de verdad.** Reconciliadas a `done`:
> **143** (PR #177), **146** (PR #176), **148** (PR #178), **150** (PR #179) — las cuatro mergeadas
> a `dev`. Sus bitácoras se movieron a `history.md` y se podaron ~600 líneas de bloques ya cerrados
> (lote 137–140, 121, 136, 109, 107, 103–106) que seguían aquí pese a estar en `history.md`.

## ⏭️ PENDIENTES — retomar por aquí (cierre del 2026-07-28)

> Inventario COMPLETO de lo que queda abierto, **incluido lo que no depende del agente**. Cada línea
> dice quién la puede cerrar. Verificado contra `gh pr list` y `git rev-list` el 2026-07-28, no supuesto.

### 1. Lo primero que hay que hacer mañana (agente)

> **⚠️ ESTE APARTADO ESTÁ EJECUTADO — sesión del 2026-07-29.** Ver «Sesión 2026-07-29» más abajo
> para el estado real. Se conserva el texto original porque dos de sus afirmaciones resultaron
> FALSAS y conviene que quede el rastro de por qué.

**Arrancar 154 (backend) + 160 (fullstack) en paralelo.** Distinta zona, sin conflicto de archivos, y
su única dependencia —la 153— ya está mergeada. Las dos tienen spec completa y gate aprobado: **no
queda ninguna decisión humana pendiente para implementarlas**. Después 155 y 156; al final 157, 158
y 159. Orden completo y specs en la sección del lote, más abajo.

> **CORRECCIÓN 1 (2026-07-29): «no queda ninguna decisión humana pendiente» era FALSO.** Las dos
> features tenían un bloque `T0` de puerta en su `tasks.md` sin cerrar. Las tres Q bloqueantes de la
> 154 sí estaban respondidas de facto en su ficha y en este archivo, pero **nadie lo había escrito en
> el spec**; y el `ABIERTO` de la 160 estaba **intacto**. Lección: «gate aprobado» en la bitácora no
> es lo mismo que las preguntas del spec respondidas por escrito — al cerrar una fase 1, las
> respuestas se escriben EN el spec, no solo aquí.

⚠️ **154 + 155 + 156 suben a producción JUNTAS o no suben.** Por separado dejan el flujo roto en el
intermedio: ~~la 154 sola deja `generar guía` lanzando `TransicionIlegalError`~~.

> **CORRECCIÓN 2 (2026-07-29): la parte tachada quedó obsoleta con la decisión Q2.** La 154 se
> reestructuró a **SOLO ADITIVA**: no retira ninguna arista, así que **la 154 sola es inofensiva** y
> `generar guía` sigue funcionando con ella mergeada. **El tren sigue siendo obligatorio, pero por la
> 156, no por la 154**: es la 156 la que retira `#4`/`#6`/`#7c`, y sin la 155 detrás el flujo queda
> roto en el intermedio.

### 2. PRs abiertos que NO son de este lote (los cierra el humano)

| PR | Rama | Qué es | Antigüedad |
|---|---|---|---|
| **#168** | `feature/141-tabla-cargas-orden` | Tabla `carga` + `carga_id`. Reviewer APROBADO, 0 bloqueantes. **Es la feature `in_progress` más vieja del tablero.** | abierto desde el 27/07 |
| **#180** | `feature/144-filtros-ordenes` | Componente de filtros parametrizable. **Trae su propia reconciliación** del registro y una migración de índices. 64 archivos. | 28/07 |
| ~~**#183**~~ | ~~`feature/log-fallos-whatsapp`~~ | **CERRADO SIN MERGEAR** el 2026-07-29. Lo REEMPLAZA el **PR #205** (`fix/portar-hotfix-whatsapp`), que sí porta el hotfix y salda las dos deudas del punto 3. | cerrado 29/07 |

### 3. Infra y despliegue (humano)

- ⚠️ **`dev` y `prod` DIVERGEN EN AMBOS SENTIDOS.** Medido: `origin/dev...origin/prod` → **16 / 18**.
  `prod` tiene 18 commits del hotfix de WhatsApp que `dev` no tiene, y `dev` tiene los 16 de hoy que
  `prod` no tiene. Ya no es «`dev` va atrasado»: son dos ramas separadas y hay que reunirlas.
- ✅ **SALDADO en el PR #205** (2026-07-29). Lo que sigue era la lista de lo que el #183 arrastraba;
  se conserva porque explica por qué ese PR no se podía mergear tal cual, y las dos cosas **ya están
  hechas** en el #205: las Server Actions `_tmp-*` retiradas tras verificar que nadie las importa, y
  el `down.sql` escrito **y ejecutado** en round-trip contra Postgres, no revisado por lectura.
- **Lo que el PR #183 arrastraba** (histórico):
  1. `lib/actions/_tmp-probar-jobs.ts` y `lib/actions/_tmp-sincronizar-plantillas.ts` — dos Server
     Actions de depuración que **hoy están en PRODUCCIÓN** y también en la rama del PR. El commit
     `f950f14` decía haberlas sacado; **no las sacó** (verificado con `git ls-tree` sobre
     `origin/prod` y sobre la rama).
  2. La migración `20260728230000_chat_mensaje_error_meta` **no tiene `down.sql`**, contra la regla
     del repo.
- **Migración `20260727120000_notificacion` (feature 146):** está en `dev`, **no aplicada a
  producción**. Con `scripts/migrate-deploy.ts` se aplica sola en el próximo deploy a `prod`;
  verificar que corrió.
- **La base LOCAL quedó al día** con las migraciones de la 146 y la 153 (`prisma migrate deploy`
  contra `localhost` el 28/07). **Producción no se tocó en ningún momento.**

### 4. Decisiones de producto sin dueño (humano)

- **Retirar la página `/qr`.** Trabajo declarado por el humano al cancelar la feature 66 («las
  lecturas de QR se hacen desde un botón»). **No está registrado como feature todavía** — candidato
  al próximo lote. Toca `app/(app)/qr/`, `lib/auth/menu-visibility.ts` y lo que dependa de
  `useQrNavigate`; verificar antes que `QrScanner`/`useQrNavigate` no queden huérfanos (el botón de
  recepción los reusa).
- **Quién entrega la búsqueda global.** Al redefinirse la 144, la búsqueda global **quedó huérfana**:
  la ficha de la **145** la da por hecha y ninguna feature la entrega. Hay que decidirlo **antes** de
  especificar la 145.
- **Revalidar la feature 149** («deshacer asignación antes de la recogida») contra el flujo v2:
  deshacer devuelve la orden a su bodega, no a `en_preparacion`.

### 5. Deuda que dejó el lote de hoy — declarada, no disfrazada

- **T6.3 de la 153 quedó en `[ ]` a propósito.** Playwright no se ejecutó porque **no hay harness de
  E2E** en el repo. En `e2e/` el cambio fue solo de comentarios; marcar la casilla habría sido fingir
  una verificación que nadie hizo.
- **Mutante superviviente:** `ESTATUS_EN_REPARTO` en `OrdenRepository` — desalinearlo pasa la suite
  completa porque su único consumidor (`findParadasEnReparto`) está siempre mockeado. Hueco
  **preexistente en `dev`**, no introducido por la 153.
- **Menores del review de la 153, sin cerrar:** la `ALLOWLIST` del guard de censo **no está asertada**
  (inflarla con archivos de producción deja el guard verde), y el spec dice 7 basenames cuando son 8.
- **`db/schema.prisma:353`** sigue diciendo «8 valores» dos líneas encima del «18» que sí se corrigió.
  El gate autorizó solo la línea 356 y el implementador no amplió por su cuenta. Correcto, pero queda.
- **Follow-ups que las specs dejaron explícitos:** la **158** no acredita la indemnización al ledger
  por tienda (feature 43), fuera de alcance a propósito; y la **159** deja `OrdenesCargaResumenPaso.tsx`
  huérfano sin borrar, porque de ese contenedor cuelga el botón de manifiesto de la 148.
- **Contrato externo roto SIN aviso dos veces en una semana** (feature 135 el 24/07 y feature 153 el
  28/07): `api-key-openapi.yaml` sigue en `info.version: 1.0.0` y no hay changelog. Fue **decisión
  explícita del humano** las dos veces, pero si algún integrador compara contra el value, ya se le
  rompió dos veces.

### 6. Deudas de arnés vivas (ya estaban antes de hoy)

Detalle en la sección «Deudas de arnés vivas». Las que más cuestan hoy:

- **Los guards que recorren el árbol usan `fs.readdir`, no `git ls-files`** → se disparan con
  documentación y con basura local. Rompieron el gate **dos veces hoy**: con los restos sin trackear
  y con los archivos de spec que citan el guard por su nombre.
- **No hay harness de E2E.** Los `e2e/*.spec.ts` usan emails placeholder y no corren en ningún gate.
  Ya dejó pasar 3 specs rotas en la feature 148 y bloquea T6.3 de todo este lote.
- Sin regla `no-console` (el OTP sigue en logs, feature 80) · `zonas-migration.test.ts` con denylist a
  mano · fakes de repositorio duplicados · `ordenes-columns.tsx` como imán de drift.

### 7. Backlog no tocado

**24 features `pending` sueltas + 15 de analítica**, ninguna empezada. Tabla auditada contra el código
en la sección «Backlog pendiente».

---

## 🗓️ Sesión 2026-07-30 (ter) — feature 164: botón de instalar la PWA + screenshots

Salió de una pregunta del humano: *¿la PWA es instalable?* Respuesta comprobada archivo a
archivo: **sí en producción** (manifest, `display: standalone`, iconos 192/512 que son PNG
reales de esas dimensiones, SW con `fetch` que cae a `/offline.html`, HTTPS por Vercel, metas
de iOS). Faltaban el gesto propio y las capturas; pidió añadir ambos.

- **164 (frontend, `in_progress`)** — IMPLEMENTADA. `hooks/useInstalarPwa.ts` +
  `components/shared/InstalarPwaButton.tsx`, montado en `PageHeader`. Tres screenshots
  **reales** capturadas con Playwright contra la app corriendo (ocultando el indicador de dev
  de Next, que no puede acabar en una imagen publicada) y declaradas en el manifest.
  **27 tests propios verdes + 6 mutaciones, las 6 muertas.** Suite completa: 18 rojas, **las
  mismas que antes** → cero regresiones. Spec en `specs/164-instalar-pwa/`.
- **Guardia nueva**: `tests/unit/pwa/manifest.test.ts`. No existía NINGÚN test del manifest, y
  es un fallo silencioso de manual: si declara un archivo que no está, o dimensiones que no
  son, el navegador degrada el diálogo o deja de ofrecer la instalación **sin decir nada**.

**Hallazgo que conviene no olvidar: la instalabilidad NO se puede probar en local.** En dev el
registro des-registra los SW y limpia caches (`app/layout.tsx`), y además `sw.js` se
**autodestruye** con hostname `localhost`/`127.0.0.1` sin mirar `NODE_ENV` (`public/sw.js:7-9`)
— así que **`pnpm build && pnpm start` tampoco sirve**. Hace falta despliegue, túnel o un
hostname que no sea localhost.

**Límite del estándar, no de la implementación:** `beforeinstallprompt` es de Chromium. Safari
(iOS incluido) y Firefox no lo disparan nunca, así que ahí el botón **no aparece** y la
instalación sigue siendo manual. Guiar al mensajero de iPhone exige una ayuda aparte, **no
hecha**.

**⚠️ AVISO DE ARNÉS — decisión humana pendiente.** Con esta alta la zona `frontend` queda con
**TRES** features `in_progress` (161, 163, 164) y la regla 1 admite **dos**: `./init.sh` falla
en esa comprobación hasta que se cierre alguna. Se registró igual y se avisó, en vez de dejar
la feature sin registrar o de marcar otra como `done` sin haberla mergeado. Las tres están
implementadas y verificadas; ninguna está commiteada.

## 🗓️ Sesión 2026-07-30 (bis) — feature 163: carrusel de "En reparto" (vista mosaico)

Pedido directo del humano, en tres mensajes sucesivos: carrusel de shadcn de 3 en 3 por
breakpoints con etiqueta debajo ("orden 5 de 5" / "1-3 de 5") sobre las cards en reparto;
**solo en la vista mosaico**; y **el carrusel debe ser un componente shared**.

- **163 (frontend, `in_progress`)** — IMPLEMENTADA. Spec en `specs/163-carrusel-en-reparto/`.
  Dependencia NUEVA: `embla-carousel-react`. Piezas: `components/ui/carousel.tsx` (primitiva
  shadcn adaptada), `components/shared/CarruselCards.tsx` (compuesto genérico, D3) y
  `components/shared/carrusel-rango.ts` (la aritmética de la etiqueta, aparte para poder
  probarla sin layout). 23 tests propios verdes + **4 mutaciones, las 4 muertas**.
- **Dos desviaciones del shadcn original**, ambas forzadas y documentadas en el archivo: el
  estado de "se puede avanzar" se lee de embla con `useSyncExternalStore` porque aquí
  `react-hooks/set-state-in-effect` es **error**; y las flechas van debajo, no flotando fuera
  del contenedor (`-left-12` se sale del viewport en móvil, que es donde trabaja el mensajero).
- **`tests/setup/jest-dom.ts` gana un stub de `IntersectionObserver`**: embla lo EXIGE y sin él
  montar el carrusel LANZA. Medido: no empeora nada (en `Modal` + `MarcarLuegoToggle` pasa de
  3 fallos a 1).

**⚠️ El baseline de tests se movió DURANTE la sesión, y no por estas features.** A las 07:23
eran 14 rojas; ahora son 18. El delta se explica entero por cambios sin commitear que
entraron a las 08:02–08:04 en `AsignacionDetalle.tsx` y `GestionarOrdenPanel.tsx`: este último
ahora pinta `Parada ${orden.secuenciaRuta} de ${count}` —línea que **no existe en HEAD**— y eso
DUPLICA el texto que las cards ya mostraban, tumbando 4 tests por "Found multiple elements"
(`R28`, `R17`, `R1` de `MisAsignacionesModule` y `R19` de `MarcarLuegoToggle`). Comprobado
aislando: con la grilla en vez del carrusel y sin el stub, salen los mismos fallos. La 18.ª
(`Modal` R30) es flakiness bajo carga: aislada pasa.

**Sin verificar:** no se levantó la app. El arrastre táctil, el momentum y los cortes reales de
breakpoint (redimensionar de 1 a 2 a 3) NO los cubren los tests, porque jsdom no mide anchos.

## 🗓️ Sesión 2026-07-30 — feature 161 (tono de notificaciones) implementada

Arrancó como pregunta, no como feature: *«¿cómo agrego un tono breve para notificaciones, o
Google trae algo por defecto?»*. La respuesta define el alcance: **no hay API para invocar el
tono del sistema desde JS**; el tono nativo solo existe con la Notification API. Así que el
aviso in-app hay que generarlo.

- **161 (frontend, `in_progress`)** — IMPLEMENTADA y verificada por tests. Tono sintetizado con
  `AudioContext` (cero assets), en la **campana** y en el **chat del mensajero**. Spec completa
  en `specs/161-tono-notificacion/`, bitácora en `progress/impl_161-tono-notificacion.md`.
  R1–R24 mapeados uno a uno; 72 tests propios; **7 mutaciones, las 7 muertas**.
- **162 (frontend, `pending`)** — Notification API con la app abierta. **Registrada a pedido
  del humano, sin implementar.** Es la única vía al tono del SO. Web Push con la app cerrada
  sigue siendo otra feature, mayor.

**Requisito descubierto implementando (R24):** el diseño decía «el primer render no suena» y
estaba mal — el primer render ocurre antes de que resuelva el fetch, así que la primera carga
se leía como salto de 0 a N y sonaba al abrir un hilo con mensajes previos. **Lo cazó el test
de R23, no el diseño.** Y la mutación que quita esa guarda **sobrevivió** en su primera
versión (`null <= n` coacciona a 0); el test se reescribió para atacar lo que la guarda
protege de verdad y entonces murió.

**⚠️ `./init.sh` está ROJO, y no por esta feature.** Corta en `typecheck` por
`_TmpSincronizarPlantillasButton.tsx` y `_TmpProbarJobsButton.tsx` (untracked, WIP de otra
sesión), que importan `@/lib/actions/_tmp-sincronizar-plantillas` y `@/lib/actions/_tmp-probar-jobs`,
**módulos que no existen**. Hasta que se creen o se borren esos dos botones, el gate no puede
ponerse verde. Además la suite trae **14 rojas previas** (`MisAsignacionesModule` 13 +
`MisAsignacionesPage` 1) por los KPIs animados y los filtros cantón/distrito de la 117, ambos
en obra en esta rama `ux`. Medido retirando el enganche del chat: **mismas 14**.

**Sin verificar (no lo tapo):** la app no se levantó — los tests prueban CUÁNDO se pide el
tono, no que se oiga; falta **móvil real**, en particular iOS Safari (exige gesto y suspende el
contexto al ir a background), que es la prueba que vale.

## 🗓️ Sesión 2026-07-29 — estado en vivo

> Reemplaza al apartado «PENDIENTES» de arriba en todo lo que se contradiga. Lo verificado hoy va
> con su número; lo no verificado se dice.

> ## 🏁 Cierre de la MAÑANA del 2026-07-30
>
> *(Ya no es el punto de entrada: lo es la «Sesión 2026-07-30 (tarde)» del principio del archivo, que
> corrige tres cosas de aquí. Este bloque sigue válido en todo lo demás.)*
>
> Lo de abajo (el «Cierre de la sesión del 2026-07-29») sigue siendo válido en su detalle técnico;
> esto lo actualiza en lo que cambió al mergear.
>
> ### 🎉 `dev` y `prod` dejaron de divergir en la dirección peligrosa: **136 / 0**
>
> El **PR #205** portó el hotfix de WhatsApp y `dev` ya contiene TODO lo que tiene `prod`. Era el
> problema que llevaba tres días sangrando en silencio: el #183 se había **cerrado sin mergear**, así
> que `dev` arrastraba el bug de reintentos infinitos y no quedaba PR que lo arreglara. De paso se
> retiraron las dos Server Actions `_tmp-*` (que **estaban en producción**) y la migración
> `20260728230000_chat_mensaje_error_meta` ganó el `down.sql` que le faltaba, **ejecutado** en
> round-trip, no revisado por lectura.
>
> ### Mergeado hoy
>
> **#202** (149 · deshacer asignación) · **#203** (155) · **#204** (cierre 159) · **#205** (hotfix
> WhatsApp) · **#206** (decisiones de la 155 + registro).
>
> El lote 153–160 queda: **153, 154, 155, 156, 159, 160 → `done`**. Solo faltan **157 y 158**.
>
> ### ⏭️ Lo que queda, en orden
>
> 1. **`prisma migrate deploy` en LOCAL** — quedan 2 migraciones sin aplicar:
>    `20260728230000_chat_mensaje_error_meta` y `20260729140000_orden_historial_origen_deshacer_asignacion`.
> 2. **PR #207** (este) — reconcilia la 159 a `done` + mata la denylist de migraciones.
> 3. **PR #168** (141) — MERGEABLE y con gate verde (603 archivos / 6754 tests), pero ⚠️ **NECESITA
>    RE-REVIEW**: su veredicto es del 2026-07-27 y la base cambió **222 commits** desde entonces,
>    incluida la reescritura de `BulkOrdenService` / `OrdenRepository` / el borde de la API key, que
>    son los módulos que toca. Ahora además convive con la 149 en `OrdenRepository`. Lo que SÍ está
>    verificado: `lote` y `deshacerAsignacionLote` **no se pisan** (transacciones distintas, y el
>    `SET` de la 149 no toca `carga_id` ni `download_url`), con la consecuencia correcta — una orden
>    revertida **conserva su lote**.
> 4. **Desplegar `dev → prod`**: 136 commits, incluye el tren 154+155+156. **Antes**, la task
>    **T24.1 de la 160**: re-correr la consulta de retroactividad y **DETENER el deploy si da > 0**.
>
> ### Al retomar el lote: la 157 está DESBLOQUEADA pero su puerta NO está cerrada
>
> Su `depends_on` (155) ya está en `dev`, y hereda del review de la 155 los **R41/R42/R43** del
> manifiesto por la vía sesión (Bloque E de su `requirements.md`). Pero arrastra **6 preguntas
> abiertas** sin responder. **Cerrar la puerta F1.4 ANTES de implementar** — es la lección que este
> mismo archivo dejó escrita: «gate aprobado en la bitácora no es lo mismo que las preguntas del spec
> respondidas por escrito». La **158** no tiene dependencias bloqueadas.
>
> ### Hallazgo del día que conviene no olvidar
>
> **La denylist del invariante de orden de migraciones se AUTO-REFORZABA.** Rompió **cinco veces** en
> un día. Cada migración nueva no solo sumaba una entrada a la lista de `zonas` —que llegó a **quince
> entradas y ~100 líneas**— sino **un meta-test en su propio archivo exigiendo esa entrada**; había
> **cinco** de esos. El coste real de apendar una migración era editar los tests de otras features en
> dos sitios. Arreglado en el #207 pinneando el baseline a su hecho histórico, verificado por
> mutación. **Lección general: un test que se mantiene con una lista a mano no protege un invariante,
> lo convierte en peaje.**

> ### ✅ Cierre de la sesión del 2026-07-29 — retomar por aquí
>
> **Dos PRs abiertos, los dos con gate verde sobre `dev` ya integrado:**
>
> | PR | Rama | Qué es | Veredicto |
> |---|---|---|---|
> | **#203** | `feature/155-creacion-bifurcada` | Creación bifurcada por bodega + retiro de `en_fulfillment`. 582 archivos / 6386 tests | **APROBADO-CON-NOTAS**, 0 bloqueantes, 9 menores, **69 mutaciones** (62 muertas, 7 supervivientes, todas huecos de cobertura) |
> | **#204** | `fix/159-cierre` | Cierre de la 159: cobertura recuperada, R10 reconciliado, registro desatascado. 584 archivos / 6343 tests | **APROBADO-CON-NOTAS**, 21/22 R, 23 mutaciones |
>
> **🎉 La deuda del round-trip de migraciones QUEDA SALDADA para el tren.** Era la que decía
> *«el round-trip real contra Postgres NO EXISTE (…) se salda antes de que el tren suba a `prod`»*.
> La migración de la 155 —la única del tren que **mueve datos**— se ejecutó de verdad contra
> `localhost:5432` sobre una base con **47 órdenes reales** en el estado retirado:
> `migrate deploy` → `db:rollback` → `migrate deploy`, con el **mismo checksum** de `orden` menos
> `estatus_id` a la ida y a la vuelta, y verificado **por mutación**. Números, mutaciones y las
> cuatro limitaciones declaradas en `progress/roundtrip_155_migracion.md`. **Ya no es un estreno en
> producción.** Las migraciones de la 154 son aditivas y no mueven datos.
>
> **✅ LAS TRES DECISIONES HUMANAS QUEDARON RESUELTAS** el 2026-07-29 (constan en
> `progress/review_155.md` §8, que es la fuente):
> 1. **Dispensa del E2E — CONCEDIDA y explícita.** `CHECKPOINTS.md` lo exige para «ingesta de
>    órdenes» y «webhooks»; leído literal, la casilla no se marca y el veredicto sería RECHAZADO. Se
>    dispensa porque **no existe ni un E2E de ingesta en todo el repo**, la 155 no altera la
>    **mecánica** de la ingesta sino su **resultado**, y el borde HTTP sí tiene integración real.
>    ⚠️ **El precedente NO es extensible** a cualquier feature que toque ingesta, y **la deuda de
>    fondo —que no haya harness de E2E— sigue viva y sin dueño**: es lo que hace este checkpoint
>    inaplicable en la práctica.
> 2. **Aviso a integradores — NO NECESARIO.** Se cierra sin traspaso a nadie.
> 3. **El manifiesto de la rama (b) por la vía sesión — PASA A LA 157**, escrito como **R41/R42/R43**
>    en el Bloque E de `specs/157-recoleccion-tienda-qr/requirements.md`. La causa no fue la 155 sino
>    `b2181e7` de la **159**, que dejó `OrdenesCargaResumenPaso.tsx` huérfano.
>
> **Registro reconciliado** (verificado con `gh pr view`, no por la ficha): **151 → `done`**
> (PR #201), **160 → `done`** (PR #197 — la rama de la 155 ya lo había corregido, pero esa corrección
> nunca llegó a `dev`) y **155 → `done`** (PR #203). Sin esto `./init.sh` quedaba **rojo** por la
> regla 1: la zona fullstack llegó a tener 3 `in_progress`.
>
> **Lo siguiente del lote:** **157** (ya DESBLOQUEADA: su `depends_on` 155 está mergeado) y **158**.
> Las dos `spec_ready`, pero ⚠️ **ninguna tiene su puerta F1.4 cerrada**: la 157 arrastra **6
> preguntas abiertas** sin responder en su `requirements.md`. Cerrar la puerta ANTES de implementar,
> que es la lección de la CORRECCIÓN 1 de más arriba.
>
> ### ⚠️ Hallazgos de esta sesión que NO son del lote y siguen abiertos
>
> - **El hotfix de WhatsApp NO estaba en `dev` y no quedaba PR que lo portara → RESUELTO en el
>   PR #205** (`fix/portar-hotfix-whatsapp`, abierto el 2026-07-29). Reúne las dos ramas
>   (`git merge origin/prod`, **sin conflictos**), retira las dos Server Actions `_tmp-*` tras
>   verificar que nadie las importa, y le escribe a `20260728230000_chat_mensaje_error_meta` el
>   `down.sql` que le faltaba, **verificado por ejecución** (round-trip UP → DOWN → DOWN → UP en una
>   transacción revertida, con las 3 columnas y el índice parcial apareciendo y desapareciendo).
>   Revisado además que el volcado de la petición a la Graph API **no filtra secretos**: redacta por
>   defecto y el modo crudo es opt-in por `WHATSAPP_DEBUG_LOG`, que llega vacía. El diagnóstico
>   original queda escrito abajo. El **#183 se CERRÓ SIN
>   MERGEAR** (2026-07-29 13:03). Verificado por archivos: `lib/services/whatsapp/errores-meta.ts` y
>   `chat-logger.ts` existen en `prod` y **no** en `dev`. `dev` arrastra el bug de reintentos
>   infinitos, y las dos Server Actions `_tmp-probar-jobs.ts` / `_tmp-sincronizar-plantillas.ts`
>   **siguen en producción**. El texto de la sección «`dev` vs `prod`» de más abajo daba el #183 por
>   abierto y mergeable: **era falso en las tres partes**.
> - **La denylist a mano de las migraciones costó trabajo TRES veces en un día** (159, 149 y el propio
>   assert de la 159). El arreglo existe y está aplicado como precedente en
>   `tests/integration/db/drop-mensajero-sugerido-migration.test.ts`: **pinnear el baseline** en vez
>   de mantener la lista, porque el invariante es histórico y las migraciones posteriores son
>   irrelevantes por definición. Extenderlo al resto (`zonas`, `notificacion`,
>   `orden-indices-filtros`, `order-status-en-reparto`) es un **chore propio**, no se colgó del PR de
>   ninguna feature.
> - **Las decisiones D1–D9 de las puertas de la 160 viven SOLO en su `status_note`** de
>   `feature_list.json`; `progress/` documenta D3 y D6, no el resto. Iba a recortar esa nota por
>   longitud y se conservó al comprobarlo. Moverlas a `progress/impl_160_*.md` es trabajo pendiente:
>   hasta entonces, **no recortar esa nota**.

**Arranque:** `./init.sh` **verde** sobre `dev` @ `0ed3125` (543 archivos / 5655 tests, lint 0
errores). El `typecheck` rojo que aparece al estrenar un worktree es **cliente Prisma stale**, no
`dev`: se salda con `pnpm db:generate`. Vale la pena recordarlo antes de diagnosticar nada.

| # | Zona | Estado al momento de escribir | Rama |
|---|------|-------------------------------|------|
| 154 | backend | ✅ **reviewer APROBADO-CON-NOTAS, 0 bloqueantes** | `feature/154-catalogo-estados-v2` |
| 156 | fullstack | ✅ **reviewer APROBADO-CON-NOTAS, 0 bloqueantes; los 2 menores SALDADOS** | `feature/156-guia-sin-mensajero` |
| 160 | fullstack | backend hecho; frontend en implementación | `feature/160-columna-intentos` |

**156 — generar guía sin asignar mensajero.** `./init.sh` verde: **547 archivos / 5751 tests / 0
fallos**. Retira `#4`, `#6` y `#7c`; **`#5` sobrevive** (destino único de generar guía); 45→42
aristas. `GenerarGuiaModal` pasa a confirmación de lote y envía `{ ordenIds }`. Sin migración, cero
`ordenes-columns.tsx`. `AsignacionSateliteService.ts` y `OrdenRepository.ts` **byte-idénticos**.

- **El reviewer no se fió del mapa: verificó R1–R30 con 7 mutaciones propias**, todas rojas donde
  debían. Los tests de la 154 puestos para romper aquí **se movieron e invirtieron**, ninguno
  borrado. Cerró además el hueco de límites cliente/servidor corriendo `next build` (exit 0).
- **La trampa del choke point se confirmó:** 7 tests rompieron en `orden-repository.guia.test.ts` y
  `orden-historial-atomicidad.test.ts`, los dos archivos cuyos dobles de `tx` ejecutan la guardia
  REAL. Contradice `tasks.md` T A.3.6 y `design.md` §7, que daban por hecho que no rompería nada.
- **Menor 1 saldado:** el `validation_error` de `guia-decision-error-messages.ts` decía «revisa la
  selección de mensajero», instrucción imposible desde que la 156 quitó esa selección. Quedó en
  **«Datos inválidos.»**, el literal que ya usan los tres mappers vecinos. Se descartó «revisa la
  información enviada» porque el caso realmente alcanzable es un **seed de catálogo incompleto**: no
  es culpa del usuario y pedirle que revise lo que envió seguiría siendo falso.
  `asignacion-satelite-error-messages.ts` **no se tocó**: ahí sí hay selección de mensajero.
- **Menor 2 saldado, pero NO como decía el review:** su arreglo (que el `findMany` devolviera solo
  `o1`) pone el caso **rojo**, no verde — el origen del segundo cae a `null` y la guardia de la 140
  lo rechaza antes de escribir. Ese rechazo se convirtió en un caso nuevo que sí discrimina,
  verificado por mutación.
- `tasks.md` **24/27**. Sin marcar con su razón: **T A.3.6** (criterio literal imposible de
  cumplir), **T C.2** (nadie verificó contra Postgres real: no hay `.env` ni base) y **T C.3**.

⚠️ **`en_fulfillment` sigue ofreciendo «Generar guía» hacia un `conflict` garantizado hasta que
llegue la 155.** El reviewer lo dice con todas las letras: **el tren 154+155+156 es condición de
correctitud, no una preferencia.**

**154 — catálogo v2.** `./init.sh` verde: **547 archivos / 5735 tests**, `tests/integration/db`
67 archivos / 614 tests. Catálogo 18→20, enum de familias 22→24, `incidente` TERMINAL sin salidas,
2 migraciones con su `down.sql`, cero services/actions/repos tocados, único `.tsx` de producción
`EstatusBadge.tsx`. **El reviewer verificó los 33 R por MUTACIÓN** (28 mutaciones: 26 muertas, 2
supervivientes que eran los controles) en vez de fiarse del mapa, y confirmó que la guardia sigue
fallando **CERRADO** matando las dos formas de reabrir el hueco de la feature 140. Detalle en
`progress/impl_154.md` y `progress/review_154.md`.

**Nota de release del tren (T5.6, copiada de `impl_154.md` §7):** 154 + 155 + 156 viajan **juntas**
a `prod`. El riesgo hoy es bajo porque **la 154 es solo aditiva y por sí sola no abre ninguna
ventana de rotura**; el acoplamiento lo aportan la 155/156, que sí retiran aristas y tienen que
llegar junto al recableado de `GuiaAsignacionService`. **Efecto visible aceptado:** la Server Action
`listarOrderStatus` pasa a devolver **20** filas en vez de 18, así que los dos estados nuevos
aparecen en el desplegable de filtro **sin resultados** hasta la 155/157.

**⚠️ Deuda del tren, sin saldar: el round-trip real de migraciones contra Postgres NO EXISTE.** Ni
el implementador ni el reviewer lo hicieron; los cuatro `.sql` están leídos y asertados por regex,
nunca ejecutados. Es la misma deuda de 137/138/139. **Se salda antes de que el tren suba a `prod`.**

**⚠️ `catalogoCache` nunca se invalida** y la 154 es la primera que hace **crecer** `order_status`
en caliente → el orden migrar-antes-de-desplegar importa, y volverá a importar en la 157/158.

**Decisiones del humano cerradas hoy (además de las de cada ficha):**
- **`incidente` queda TERMINAL.** En chat se planteó un estado `indemnizada` que lo desterminara y
  **se descartó**: no existe, no se declara, no se deja preparado.
- **Feature 160 — el intento cuenta `devuelta` Y `reprogramada`**, y el criterio **gobierna también
  el escalado automático** del cron SLA y, por esa vía, `cobroRechazado`. Se le planteó la
  consecuencia (se rechaza y se cobra antes) y la reafirmó: su lectura es que el cron **ya debía**
  contar así. Matiz verificado contra el mapa que el spec no había visto: solo cuenta la
  reprogramación **del mensajero** (`#13`, vía `gestion`); la **de la tienda** (`#22`, vía
  `reprogramacion_tienda`) se excluye porque la fila `devuelta` de esa orden ya contó el intento.
- **La retroactividad se resolvió MIDIENDO, no suponiendo.** Consulta de solo lectura contra
  **producción** el 2026-07-29: **0 órdenes** saltarían el umbral con el criterio nuevo (2 en
  `devuelta`, 8 con conteo distinto sin cruzar umbral, 10 filas `reprogramada`+`gestion`, **167
  filas de historial en toda la base**). Va sin mitigación. **La consulta se re-corre justo antes
  del despliegue y lo DETIENE si da > 0** (task T24.1 del spec).
- **El dato de intentos NO es un chip: es una columna** propia tras `estatus` en las tablas, y
  **dato etiquetado «Intentos: N»** fuera de ellas. El **0 siempre se muestra**.
- **Derogados R2/R11 de la feature 148** («exactamente 11 columnas» del manifiesto). Corrección del
  humano: esos requisitos no significan un número fijo sino que **el manifiesto lleva los datos de
  su tabla**, y el conjunto **crece** cuando la orden gana un dato. Reescritos como conjunto
  ABIERTO; ni código ni tests pueden volver a afirmar «exactamente N columnas».

**🔎 Hallazgo del día — la feature 159 se mergeó SIN REGISTRO.** El **PR #193** entró a `dev` el
2026-07-29 a las 07:00 (`refactor(159): retira el flujo del mensajero sugerido`) con código,
migración `20260728120000_drop_orden_mensajero_sugerido` (con su `down.sql`) y un guard nuevo. Pero
**su ficha sigue `spec_ready`, sin `branch`, con las 29 tareas de `tasks.md` sin marcar y sin
`impl_159` ni `review_159`**. Nadie ha verificado si cubre sus R1–R22. Además entró **fuera de
orden**: su `depends_on` es la 156, que aún no existe. **Pendiente: pasarle el `reviewer` antes de
darla por `done`.**

**Límite nuevo declarado (160):** la columna de intentos es un dato derivado y **no es ordenable ni
filtrable server-side** — el `ORDER BY` usa lista blanca de columnas reales. Queda elevado a las
features 144/151, no resuelto a escondidas.

## Features en curso

**Tabla `carga` + `carga_id` en orden — feature 141 → `in_progress`, `PR #168` ABIERTO.** Backend,
`medium`, `depends_on: null`. Rama `origin/feature/141-tabla-cargas-orden`. Su **spec sí está en `dev`**
(`specs/141-tabla-cargas-orden/`, R1–R30), pero **su código y su migración NO**:
`20260727120000_carga_orden_carga_id` vive solo en la rama. Reviewer APROBADO-CON-NOTAS, 0 bloqueantes.
Es la feature `in_progress` más vieja del tablero — el PR lleva abierto desde el 2026-07-27.

**Componente de filtros parametrizable + su cableado en órdenes — feature 144 → `PR #180` ABIERTO.**
⚠️ **En `dev` la ficha figura `pending` A PROPÓSITO.** El humano **redefinió** la feature el 2026-07-28
(antes era «DataTable: búsqueda y filtros», frontend/low; ahora es un componente de filtros genérico +
su implementación en órdenes, fullstack/high) y esa redefinición, su `spec_path`, su `branch`, su
estado `in_progress` y su spec (`specs/144-filtros-ordenes/`, R1–R51) **viajan dentro del PR #180**, no
están en `dev`. Marcarla `in_progress` aquí pondría `./init.sh` en rojo por la regla 4 (toda feature en
vuelo necesita spec en disco). Se reconcilia sola al mergear el PR. El PR trae además una migración de
índices (`20260728120000_orden_indices_filtros`) y toca 64 archivos.

> **Nadie debe tomar el id 144 ni su alcance viejo sin leer el PR #180.** La ficha de `dev` lleva la
> advertencia escrita en su `description`.

## ⚠️ `dev` y `prod` DIVERGEN 87 / 18 (medido el 2026-07-29)

> **Actualizado el 2026-07-29:** `git rev-list --left-right --count origin/dev...origin/prod` →
> **`87  18`**. El 28/07 era `16  18`; el titular viejo («`dev` está 18 commits DETRÁS») ya no
> describe la situación: **`dev` va 87 commits POR DELANTE** y sigue sin recibir los 18 del hotfix.
> **El PR #205 reúne las dos ramas** (`git merge origin/prod` sin conflictos): al mergearlo, los 18
> commits del hotfix entran en `dev` y esa mitad de la divergencia desaparece. Queda la otra: los 87
> que `dev` tiene y `prod` no, que se cierran con el despliegue `dev → prod` del tren 154+155+156.
> **Ese despliegue sigue siendo tarea humana.**

`git rev-list --left-right --count origin/dev...origin/prod` → `0  18` *(medición del 28/07, ver
aviso de arriba)*. Los arreglos del **log de
fallos de WhatsApp** (fin de los reintentos infinitos) se mergearon **directo a `prod`** en los PRs
**#182, #184 y #185**, y el PR que los porta a `dev` (**#183**, misma rama
`feature/log-fallos-whatsapp`, MERGEABLE) **sigue abierto**.

Es **la misma trampa registrada el 2026-07-27** con el fix del pooler: un hotfix ramificado desde
`origin/prod` que no se porta a `dev` el mismo día deja `prod` sano mientras todo lo que sale de `dev`
arrastra el bug.

**Registrado retroactivamente como feature 152 (`done`, `sdd: false`)** — no como bookkeeping vacío:
trae migración (`20260728230000_chat_mensaje_error_meta`), un desenlace nuevo (`permanente`) y una
**lista blanca de códigos reintentables** en `lib/services/whatsapp/errores-meta.ts`. Sin eso en el
registro, el próximo que toque WhatsApp la duplica. Detalle y deudas en `history.md`.

> ### ✅ Las dos cosas que había que revisar antes de portarlo — HECHAS en el PR #205
>
> Se conservan enunciadas porque son el diagnóstico que explica por qué el #183 no se podía mergear
> tal cual, y porque el patrón se va a repetir con el próximo hotfix.
>
> 1. **La migración `20260728230000_chat_mensaje_error_meta` no tenía `down.sql`** — contra la regla
>    del repo (`./init.sh` avisa de migraciones sin `down.sql`). **Escrito en el #205 y verificado
>    por EJECUCIÓN**, no por lectura: round-trip UP → DOWN → DOWN otra vez → UP contra Postgres
>    local en una transacción revertida. La pérdida de datos del DOWN (el motivo de los salientes ya
>    fallidos, que es dato de diagnóstico) queda declarada en su cabecera.
> 2. **`prod` y la rama del PR llevan dos Server Actions de depuración en producción:**
>    `lib/actions/_tmp-probar-jobs.ts` y `lib/actions/_tmp-sincronizar-plantillas.ts`. El commit
>    `f950f14` decía sacarlas de la rama, pero **siguen ahí** (verificado con `git ls-tree` sobre
>    `origin/prod` y sobre `origin/feature/log-fallos-whatsapp`). Mergear el #183 tal cual las mete
>    también en `dev`.

## Lote 153–160 — flujo de estados v2 · **EN CURSO (1/8 mergeada)**

> ### Estado al cerrar el 2026-07-28
>
> **Fase 1 COMPLETA para las 8** (7314 líneas de spec, PR #189) con el **gate F1.4 APROBADO** y sus
> decisiones escritas en cada ficha. **153 `done`** (PR #190). Las otras 7 quedan en `spec_ready`,
> listas para implementar sin ninguna decisión pendiente.
>
> **Retomar por aquí:** **154 (backend) + 160 (fullstack) en paralelo** — distinta zona, sin
> conflicto de archivos, y ninguna depende de nada más que de la 153, ya mergeada. Después 155 y
> 156; al final 157, 158 y 159.
>
> ⚠️ **154 + 155 + 156 tienen que ir a producción en la MISMA entrega.** Por separado cada una deja
> el flujo roto en el intermedio: la 154 sola dejaría `generar guía` lanzando `TransicionIlegalError`.

Ocho features pedidas por el humano a partir de un diagrama del flujo nuevo + cuatro pedidos sueltos.
Boceto aprobado en chat antes de escribir.

**Lo que realmente cambia del catálogo:** de los 18 estados de hoy, **14 se mantienen tal cual**.
Entran `por_recolectar_en_tienda` e `incidente`, `en_ruta` se renombra a `en_reparto` y
`en_fulfillment` se retira. **El cambio de fondo no son los estados sino las aristas:** hoy
`en_preparacion`/`en_fulfillment` pueden ir directo a `por_recoger` y a `en_ruta_bodega_satelite` al
generar la guía (aristas #1–#6 del mapa de la feature 140); en el flujo v2 esas se retiran — generar
guía solo lleva a `en_bodega_central`, y **las asignaciones salen siempre de una bodega**.

| # | Feature | Zona | Cplx | Depende | Estado | Spec |
|---|---------|------|------|---------|--------|------|
| 153 | `en_ruta` → `en_reparto` (rename mecánico, 94 archivos) | backend | medium | — | ✅ **`done`** (PR #190) | R1–R21 |
| 154 | catálogo v2: `por_recolectar_en_tienda` + `incidente` + grafo nuevo | backend | high | 153 ✔ | `spec_ready` | R1–R31 |
| 155 | creación bifurcada por bodega + retiro de `en_fulfillment` | backend | high | 154 | `spec_ready` | R1–R43 |
| 156 | generar guía sin asignar mensajero | fullstack | medium | 154 | `spec_ready` | R1–R30 |
| 157 | recolección en tienda por el mensajero (QR) | fullstack | high | 155 | `spec_ready` | R1–R40 |
| 158 | estado `incidente` + indemnización desde la wallet | fullstack | high | 154 | `spec_ready` | R1–R36 |
| 159 | quitar la sugerencia de mensajeros de la carga masiva | fullstack | medium | 156 | `spec_ready` | R1–R22 |
| 160 | badge de intentos de entrega | fullstack | low | — | `spec_ready` | R1–R16 |

**Restructuración del corte, decidida al revisar las specs y ya escrita en las fichas:** la **154 es
SOLO ADITIVA**. Retirar aristas ahí haría que generar guía lanzara `TransicionIlegalError` entre su
merge y el de la 156, y dejaría `en_fulfillment` sin salidas siendo aún estado de nacimiento —
órdenes vivas atrapadas con el guard fallando cerrado. Cada retiro se muda a la feature que cambia el
servicio que lo ejecuta: `#4/#6/#7c` → **156**, `#1/#2/#3/#7b` → **155**. Y `#5`
(`en_preparacion → en_bodega_central`) **sobrevive**: es el destino único de generar guía.

**Decisiones del humano ya cerradas (valen como parte de la gate F1.4 de cada spec):** `en_fulfillment`
**se retira** (no aparece en el flujo nuevo; las órdenes que ya están en bodega nacen en
`en_preparacion`); **`en_ruta` → `en_reparto` es el ÚNICO rename** — «En ruta a bodega satélite» no
pasa a «Por recibir en satélite» pese a que el diagrama lo dibuje así, y los participios femeninos
(Entregada/Devuelta/Reprogramada/Rechazada/Sin gestionar) se conservan.

**Los tres `ABIERTO` que bloqueaban el diseño se CERRARON el 2026-07-28**, antes de especificar, para
no escribir tres specs sobre supuestos:

- **155 — «¿ya está en bodega?» sale del interruptor de fulfillment de la TIENDA**, no de la orden ni
  de la vía de carga. **Y ese flag ya existe:** `Usuario.fulfillment` (`db/schema.prisma:97`, feature
  27) con su switch ya montado en `UsuarioForm.tsx:55,70`. → **sin migración y sin UI nueva**; la
  feature se reduce a recablear a qué estado mapea (`true` → `en_preparacion` sin guía; `false` →
  guía + manifiesto en el acto y nace en `por_recolectar_en_tienda`). ⚠️ No confundir con el **otro**
  `fulfillment` del repo: el de `tarifas` (`schema.prisma:760`) es un **monto**, no este flag.
- **157 — las órdenes por recolectar SE LE ASIGNAN** al mensajero con el mecanismo que ya existe
  (`mensajero_asignado_id` + `mis-asignaciones`): sin bolsa libre y sin modelo de lote nuevo. **Pero el
  humano añadió la condición que es el corazón de la feature: «el módulo de gestión debe cambiar cuando
  es este caso».** Una recolección no es una entrega — no hay cobro, ni resultado de gestión, ni causa
  de devolución, ni evidencia: la acción es **una sola**, escanear y confirmar. Eso obliga a un panel
  propio de recolección en vez de `GestionarOrdenPanel`.
- **158 — el monto de la indemnización lo captura el admin a mano** al aprobar el cierre. Descartados
  `monto_cobrar` (una orden ya pagada lo tiene en 0 y quedaría sin indemnizar) y la columna de valor
  declarado (habría obligado a tocar la plantilla de carga masiva v2 recién hecha y el contrato público
  de la API).

**Peajes conocidos:** la 154 y la 158 tocan **enums de Postgres** (`orden_historial_origen_tipo`,
`WalletMovimientoCategoria`), así que además del `ALTER TYPE ADD VALUE` hay que **actualizar los
`down.sql` previos** que recrean el tipo — no existe `DROP VALUE` — y correr `tests/integration/db`.
La 159 toca el **contrato público de integradores** (`mensajero_sugerido_id` viaja en el payload de la
carga por API key y está documentado en `openapi-spec.ts`).

**Lo que NO se duplicó:** el pedido «que las bodegas puedan filtrar solo las órdenes asignables» ya
estaba registrado como **feature 147**. Se actualizó en vez de crear una novena: su `ABIERTO` sobre qué
estados cuentan como asignable **queda cerrado** por este flujo (`en_bodega_central` y
`en_bodega_satelite`, y solo esos), y pasa a `depends_on: 154`.

**Pendiente de revisar:** la **149** («deshacer asignación antes de la recogida») queda tocada por el
flujo v2 — deshacer devuelve la orden a su bodega, no a `en_preparacion`. Se actualiza cuando le toque,
no ahora.

## Backlog pendiente

> **Auditado contra el código de `dev` el 2026-07-28** (la auditoría previa es del 2026-07-26). Cada
> fila se verificó abriendo el archivo, no por la ficha. **24 pendientes sueltas + 15 de analítica +
> las 8 del lote 153–160** (arriba, con su propia tabla).

| # | Feature | Zona | Estado real verificado |
|---|---------|------|------------------------|
| 70 | regla de selección de tarifa vigente | backend | Sin empezar. El `TODO:` sigue vivo en `TarifaVigentePorTiendaRepository.ts:50-62` y el `WHERE` **no filtra `status`** (líneas 70 y 89 lo dicen explícito). ⚠️ Requiere gate humano: es dinero. |
| 71 | bloquear checkbox de órdenes con cierre sin resolver | fullstack | ⚠️ **Reevaluar: el diagnóstico previo apuntaba a código ya borrado.** Decía «`OrdenesApartado.tsx` no tiene `disabled` en el checkbox de fila», pero ese archivo se eliminó el 2026-07-31 con la vista legacy `OrdenesRevisionMaestro` (chore `borrar-vista-legacy-ordenes`). La superficie viva es `OrdenesListado`/`OrdenesModule`, que **sí** tiene `bloqueoSeleccion` (checkbox `disabled` + motivo en tooltip + aviso de página bloqueada). Falta comprobar qué queda por hacer contra ESA superficie —y si el `cierre` concreto de esta feature ya está cubierto por el bloqueo por zona existente— antes de darla por «sin empezar». La ficha de `feature_list.json` conserva el texto original a propósito: re-alcanzarla es decisión humana, no de este chore. |
| 74 | explotar la causa de devolución | fullstack | **Alcance reducido: la mitad ya está.** El módulo de novedades **ya muestra** la causa (`NovedadesModule.tsx` con `CAUSA_DEVOLUCION_LABEL` y `null` → «Sin causa registrada»). Falta la causa en la línea de tiempo de `HistorialOrdenSheet.tsx` (no la menciona) y el **agregado** «devoluciones por causa». |
| 80 | proveedor de correo real + sacar el OTP de los logs | backend | Sin empezar. `console.log("Codigo OTP generado:", code)` sigue en `OtpChallengeIssuer.ts:39` y **no hay ningún proveedor de correo en `package.json`** → ningún email sale hoy en producción. |
| 85 | wallet - periodicidad de gastos fijos (frontend) | frontend | **Backend hecho** (feature 84: enum `PeriodicidadUnidad` + `periodicidadCantidad`, `lib/utils/periodicidad.ts`). El **hueco (A) del sidebar ya está cerrado** (`menu-visibility.ts` lista `/wallet` con sus 3 subitems). Falta **solo la UI de periodicidad**: `GastoFijoPlantillaDialog.tsx`, `GastosFijosPlantillasPanel.tsx` y `wallet-labels.ts` no la mencionan en ninguna línea. |
| 144 | componente de filtros parametrizable | fullstack | **En vuelo fuera de `dev`** — ver «Features en curso». Cuenta como pendiente solo en el registro de `dev`. |
| 145 | rollout de filtros a todas las tablas | fullstack | Sin empezar. ⚠️ **Revalidar tras la redefinición de la 144:** la búsqueda global salió del alcance de la 144 y **no tiene feature dueña**; el export vive en la 151. |
| 147 | filtro por bodega de las órdenes asignables | fullstack | Sin empezar, sin rama. |
| 149 | deshacer asignación antes de la recogida | fullstack | Sin empezar, sin rama. ⚠️ Debe **declarar las aristas inversas** en el mapa de la guardia central (feature 140) o `appendCambioEstado` lanza `TransicionIlegalError`. |
| 151 | export a Excel server-side del dataset filtrado | backend | Sin empezar, sin rama. `depends_on: 144`. |
| 135 + 122–134 | **analítica** (15 encadenadas) | backend/frontend | Sin empezar, confirmado: **no existe `lib/analytics/` ni `app/(app)/analitica/`**, ni migración `analytics_daily`, ni servicios. Cadena de `depends_on` coherente (135 es el catálogo; 122/123 cuelgan de él). |

**Canceladas (5):** 35 (estados en tiempo real), 60 (campana — la reemplazó la 146), 62 (orden flete),
68 (bug de tarifa por zona) y **66 (`qr - detalle`, cancelada el 2026-07-28)**.

## Deudas de arnés vivas

- **✅ RESUELTO el 2026-07-28 (esta reconciliación): el lint recorría los worktrees de agentes.**
  `pnpm lint` entraba en `.claude/worktrees/` — **25 copias completas del repo** — y un
  `no-explicit-any` de la rama `fe-116` (`agent-a3bc914c5303a4e32/lib/clients/whatsapp-cloud.ts:359`)
  ponía el lint en rojo en `dev` **sin que `dev` tuviera nada mal**. Además inflaba la corrida a ~3.500
  warnings y >7 minutos. Arreglado con `".claude/**"` en `globalIgnores` de `eslint.config.mjs` y
  `/.claude/worktrees/` en `.gitignore` (estaban **untracked pero no ignorados**: un `git add -A`
  habría commiteado los 25 árboles). Precedente: el guard `no-embalaje.test.ts` ya ignoraba `.claude`
  por esta misma razón — el lint se quedó atrás.
- **Los guards que recorren el árbol fallan por archivos SIN TRACKEAR.** Medido el 2026-07-28: `pnpm
  test` daba **2 fallos de 5681** y **ninguno era de `dev`** — los dos los provocaban restos locales sin
  commitear. (1) `no-embalaje.test.ts` caía por `specs/135-order-status-rename-nomenclatura/`, copia
  pre-renumerado de la que sí está trackeada como `specs/137-*` (la whitelist del guard apunta a la
  137). (2) `censo-order-status-rename.test.ts` caía por `scripts/seed-ordenes-qa.ts`, que usa los
  values viejos de `order_status` (`en_bodega`, `en_preparacion`…). **Los 5 restos se borraron el
  2026-07-28 con el visto bueno del humano** y la suite volvió a verde. **La deuda de fondo sigue:**
  estos guards no distinguen archivo trackeado de basura local, así que cualquier borrador en el árbol
  pone el gate en rojo y ese rojo se lee como «`dev` está roto». Arreglo natural: que recorran
  `git ls-files` en vez de `fs.readdir`.
- **Los E2E no corren en `pnpm test` ni en `./init.sh`.** Lo demostró la 148: el diferimiento de
  `onSuccess()` rompió 3 specs de Playwright y **no salió en rojo en ningún gate**; el reviewer solo vio
  1 de los 3 por lectura. Sigue sin haber harness de E2E (seed + login por rol) y los `e2e/*.spec.ts`
  usan emails placeholder. Candidato a feature propia.
- **No hay regla `no-console` en el lint** → hay `console.*` en producción. El de `OtpChallengeIssuer`
  es un **secreto en logs**; lo cubre la feature 80. Instalar `no-console` con allowlist.
- **`zonas-migration.test.ts` usa una denylist de migraciones apendida a mano** → se pone rojo con cada
  migración nueva (ya rompió ≥3 veces). Patrón frágil: un test que lista archivos del repo en vez de
  leer código.
- **Fakes de repositorio a mano y duplicados** (`IUserRepository` triplicado, `IOrdenRepository` con
  ~30 métodos listados a mano) → cada método nuevo del contrato rompe N archivos de test. La 146 pagó
  ese peaje tocando **5 suites ajenas** solo para agregar stubs. Un builder en `tests/helpers/` lo
  mataría de raíz.
- **`app/(app)/ordenes/_components/ordenes-columns.tsx` es un imán de drift** (ya lo revirtieron 2
  veces) → mirarlo con lupa en todo PR que lo toque.
- **Migraciones sin round-trip real:** los `down.sql` de las features **141 y 146** siguen revisados
  solo **por lectura**. ✅ **Ya NO es así para todas:** el 2026-07-29 se ejecutó el round-trip real
  contra Postgres de la migración de la **155** (`progress/roundtrip_155_migracion.md`, sobre 47
  órdenes reales y verificado por mutación) y de la del chat de WhatsApp (**PR #205**). El método
  está escrito y es repetible: ensayo en transacción revertida → mutaciones para probar que el arnés
  discrimina → tramo persistido por la herramienta del repo.
- **La denylist a mano de las migraciones costó trabajo CUATRO veces el 2026-07-29** (159, el propio
  assert de la 159, 149 y el porte del hotfix). El arreglo existe y está aplicado como precedente en
  `tests/integration/db/drop-mensajero-sugerido-migration.test.ts`: **pinnear el baseline**, porque
  el invariante es histórico y las migraciones posteriores son irrelevantes por definición.
  Extenderlo a `zonas`, `notificacion`, `orden-indices-filtros` y `order-status-en-reparto` es un
  **chore propio** — deliberadamente NO se colgó del PR de ninguna feature ni del porte del hotfix,
  que tiene que ser fácil de revisar y de revertir.

## Tareas humanas pendientes

- **Portar el hotfix de WhatsApp a `dev`** → ✅ **listo para mergear: PR #205**. El #183 se cerró sin
  mergear y el trabajo se rehízo: las dos `lib/actions/_tmp-*.ts` fuera, el `down.sql` escrito y
  ejecutado en round-trip, y `./init.sh` verde (583 archivos / 6403 tests). **Lo único que queda es
  darle merge.** Nota: al entrar, `dev` recibe los 18 commits de `prod` y hay que correr
  `prisma migrate deploy` en local (la migración del chat no está aplicada ahí).
- **La base local ya tiene la migración de la 153 aplicada** (`20260728120000_order_status_en_reparto`),
  incluida la de la 146 que estaba pendiente. Se aplicaron con `prisma migrate deploy` contra
  `localhost` el 2026-07-28 al cerrar el round-trip. **No se tocó producción.**
- **Retirar la página `/qr`** — trabajo declarado por el humano al cancelar la 66 (las lecturas de QR se
  hacen desde un botón en el punto de uso). Toca `app/(app)/qr/`, `lib/auth/menu-visibility.ts` y lo que
  dependa de `useQrNavigate`; hay que verificar primero que `QrScanner`/`useQrNavigate` no queden
  huérfanos (el botón de recepción los reusa). **Sin registrar todavía como feature** — candidata al
  próximo lote.
- **Decidir quién entrega la búsqueda global** antes de especificar la 145 (quedó huérfana al
  redefinirse la 144).
- **Proveedor de correo real** — hoy `StubEmailProvider` solo hace `console.info`; **ningún email sale**
  y el OTP se lee de los logs del servidor. Lo salda la feature 80 (`pending`).
- **Migración `20260727120000_notificacion` (feature 146)** — está en `dev` pero **no se aplicó a
  producción desde el agente**. Con el build actual (`scripts/migrate-deploy.ts`, PR #173) se aplica
  sola en el deploy a `prod`; verificar que corrió tras el próximo `dev → prod`.

> **Buckets de Storage:** `gestion-evidencias`, `mensajero-docs` y `etiquetas-guia` **existen y son
> privados** en el proyecto `ordenex-db` (los dos primeros verificados vía MCP el 2026-07-25; el
> tercero creado y cerrado en el PR #166). No queda bloqueo de infra de Storage.

> **Migraciones y entornos (registro del 2026-07-27):** el `build` ya no corre `prisma migrate deploy`
> en todos los entornos — pasa por `scripts/migrate-deploy.ts`, que **solo migra en producción**, y en
> preview únicamente con `MIGRATE_ON_PREVIEW=true`. Preview tiene **base Supabase propia**, así que
> abrir un PR ya no migra producción. Al tocar env vars en Vercel: separar por entorno, nunca una misma
> variable en Production **y** Preview a la vez.

## Notas de proceso (vigentes)

- Todos los subagentes corren con `model: opus` (decisión del humano 2026-07-09), ignorando la
  gradación por complexity.
- **Workaround del bug opus-4.8[1m]:** orquestar directo (`spec_author` → `backend_dev`/`frontend_dev`
  → `reviewer`) en vez del `implementer` monolítico, pasando `model: opus` explícito; el `implementer`
  muere en el 1er intento.
- Ramas desde `origin/dev`, PRs hacia `dev`. Cuando el árbol de trabajo arrastra WIP ajeno se usa un
  worktree aislado desde `origin/dev` para evitar el drift de sesiones paralelas.
- **Producción sale de `prod`, no de `dev`.** Los hotfixes se ramifican desde `origin/prod` y hay que
  portarlos a `dev` **el mismo día**, o `prod` se ve sano mientras todo lo demás arde (ya pasó dos veces:
  pooler el 2026-07-27, log de WhatsApp el 2026-07-28).
