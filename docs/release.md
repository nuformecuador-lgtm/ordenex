# Lista de release

> **Por qué existe este archivo.** Porque sin él, las comprobaciones que **caducan** acaban siendo
> casillas de un solo uso dentro del `tasks.md` de una feature: se escriben, la feature se cierra, y
> nadie las vuelve a mirar. Ya pasó tres veces —el R27 de la 261, la verificación visual de la 264 y
> las tres tareas `C` de la 265—, y las tres veces la respuesta fue «esto debería ser un paso de
> release». Aquí está el paso.
>
> **Cómo se usa:** se recorre entero, en orden, cada vez que se despliega a `prod`. Lo que no
> aplique se marca como no aplicable **diciendo por qué**; no se salta en silencio.

---

## 1 · Antes de abrir la release

- [ ] **El gate COMPLETO, sobre el SHA que se va a desplegar.** `./init.sh` a secas, nunca
      `--rapido`. Escribe `INIT_EXIT` **dentro** del log:
      `{ ./init.sh; echo "INIT_EXIT=$?"; } > gate.log 2>&1`
      Leer el exit code del comando que lo envuelve no vale: un `echo` posterior lo tapa y un gate
      **rojo** llega como «exit code 0». Ya pasó.
- [ ] **Re-comprobar que `dev` no se ha movido** entre el gate y la release. Otra sesión empuja en
      paralelo, y el pre-vuelo caduca: compara el SHA medido con `origin/dev` **justo antes** de
      abrir el PR.
- [ ] **Re-medir lo que caduca.** Toda medición contra producción que una ficha cite como vigente
      es una **foto**. Si la ficha dice «se re-mide antes de desplegar», se re-mide **ahora**, no se
      cita la del día anterior.
- [ ] **Repasar las fichas `in_progress` que entran.** Una ficha abierta suele esconder deuda del
      tipo «repetir antes de desplegar»; se lee su `status_note` entera, no su título.
- [ ] **Variables de entorno**, si la release las necesita: `vercel env ls production` y
      `vercel env ls preview`. **Se fijan por entorno, NUNCA en Production y Preview a la vez** — en
      este repo una variable compartida ya apuntó al proyecto Supabase equivocado en uno de los dos.

## 2 · La release

- [ ] PR de `dev` → `prod`, con el cuerpo diciendo **qué cambia para quien lo usa**, no qué archivos
      se tocaron.
- [ ] Esperar a que el despliegue de producción quede en **READY** — no basta con que el PR esté
      mergeado.

## 3 · Después de desplegar, y esto no es opcional

- [ ] **Errores de runtime**: `get_runtime_errors` con una ventana que cubra el despliegue. Cero es
      la respuesta esperada; cualquier otra cosa se investiga antes de seguir.
- [ ] **Las comprobaciones que sólo existen en producción.** Toda ficha visual o con datos que en
      local no existen deja aquí su comprobación concreta, con el **número esperado**. Un «se ve
      bien» no es una verificación.
- [ ] **Migraciones**: si la release lleva alguna, confirmar contra la base que aplicó y que **no
      tocó filas que no debía** (`updated_at = created_at` es la prueba barata de que nada más se
      escribió).
- [ ] **Cerrar las fichas** que esta release termina de verdad, y **decir en su nota lo que sigue
      vivo** en vez de darlas por limpias.

---

## Release del 2026-08-23 (2.ª) — la 271, recorrida

**`prod` = `37b5944b`** · desplegado y **READY** · PR #484.

Lo verificado, con su evidencia:

- **Gate completo sobre el SHA desplegado** (`82b45e26`, `dev` ya mergeado): `INIT_EXIT=0` leído
  **dentro** del log, 1341 archivos / 18.129 tests.
- **`dev` no se movió** entre el gate y la release: medido y `origin/dev` coincidían al abrir el PR.
- **Re-medido lo que caduca, y aquí no era un trámite:** esta ficha **bloquea gente**, así que se
  contó cuántos mensajeros quedaban bloqueados en el instante del despliegue. **Cero**, los cinco
  libres — incluido el del caso que originó la ficha, que sale libre correctamente por tener un solo
  cierre y estar solicitado.
- **Una sola ficha `in_progress`** (la 271), que es la que se desplegaba: sin deuda escondida.
- **Variables de entorno**: no aplica, la release no añade ninguna.
- **Migración `20260823120000_notificacion_evento_bloqueo_cierre`**, con foto **antes** y **después**:

  | | Antes | Después |
  |---|---|---|
  | Valores en `notificacion_evento` | 6 | **8** |
  | Filas en `notificacion` | 91 | **91** |

  Los 6 previos coincidían exactamente con la lista que el `down.sql` declara como «el enum antes de
  esta migración», así que la cadena estaba donde debía.
- **Errores de runtime: cero** en la ventana que cubre el despliegue.

### Lo que NO se cierra aquí, y por qué

- **El primer efecto real lo produce el cron de esta noche.** A las 00:00 el corte deja de excluir a
  quien ya tiene un cierre abierto. Nada de lo verificado hoy lo cubre: se mira la mañana del 24 que
  los `vencido` creados son los que deben y que **salieron sus avisos** — que es lo primero que este
  cron emite en toda su vida.
- **T3.5** (coste de la corrida del corte) queda declarada sin medir, con su condición de reapertura.

---

## Release del 2026-08-23 — recorrida

**`prod` = `6bc566b8`** · desplegado y **READY** · 55 commits.

Primera release hecha siguiendo esta lista. Lo verificado, con su evidencia:

| paso | resultado |
| --- | --- |
| Gate **completo** sobre el SHA desplegado | `6090fda2` — 1324 archivos, **17.884 tests**, `INIT_EXIT=0` leído dentro del log |
| `dev` no se movió entre gate y release | SHA medido y `origin/dev` idénticos |
| Mediciones re-tomadas (03:14 CR) | `M1 = 0` · `M2 = 35` · **6** jobs `failed` de la familia de la 265, como línea base |
| Fichas `in_progress` | **ninguna** |
| Variables por entorno | `GOOGLE_CLOUD_PROJECT_ID` en Production y Preview por separado; `RUTA_DEBUG_LOG` en **ninguno** |
| Errores de runtime tras desplegar | **cero** |
| Migraciones aplicadas | las dos: el value del enum presente, y `secuencia_fuente` creada **sin tocar ninguna fila existente** (0 con valor) |
| **C7** | **cero** líneas `optimizer***:` con el cron corriendo — ver arriba |

⚠️ **`C3` no se pudo cerrar**: `ruta_optimizada_parada` sigue **vacía** en producción, así que el
umbral `RUTA_ORIGEN_MAX_KM = 200` continúa **declarado sin calibrar**.

⚠️ **`C8` no es concluyente todavía**: cero jobs `failed` de esa familia desde el despliegue, pero
**no ha pasado tiempo suficiente** para que sea evidencia. Se re-mira con un día de tráfico real.

---

## Pendiente para la PRÓXIMA release

> Se rellena cuando una ficha deja una comprobación que **sólo** se puede hacer desplegando. Se
> vacía al ejecutarla. Si esta sección tiene entradas, **la release no está terminada** aunque el
> despliegue esté verde.

### De la 284 — la PWA: el relevo, la purga y el manifiesto

> **Un service worker NO se puede medir en local**: el de producción se autodestruye en
> `localhost`/`127.0.0.1` sin mirar `NODE_ENV` (`public/sw.js:7-9`), así que `pnpm build && pnpm
> start` **tampoco** sirve. Estas seis comprobaciones sólo existen sobre HTTPS real, y por
> decisión del humano (2026-08-25) se hacen **en producción justo después de desplegar**.
> Cada fila se responde con **un número o un nombre**, nunca con «se ve bien».

- [ ] **M8 · LOS TRES ARCHIVOS DE LA PWA, CONTRA EL DESPLIEGUE DE VERDAD.** Es **lo primero** que
      hay que mirar tras desplegar: hasta esta release respondían **307 a `/login`** y por eso la
      PWA **nunca se ha podido instalar**. Se comprueba **sin cookies**:

      ```
      curl -sI https://<dominio>/manifest.json | head -1     # se espera: HTTP/2 200
      curl -sI https://<dominio>/sw.js         | head -1     # se espera: HTTP/2 200
      curl -sI https://<dominio>/offline.html  | head -1     # se espera: HTTP/2 200
      curl -sI https://<dominio>/ordenes       | head -1     # se espera: 307 (sigue protegido)
      ```

      Si alguno vuelve **307**, el arreglo del `matcher` no llegó y **el resto de la 284 no sirve
      de nada**: nada de lo que hace la PWA llega al dispositivo. Y con los tres en 200, en un
      teléfono: que el navegador **ofrezca instalar** (Chrome → menú → «Instalar aplicación»), que
      es la comprobación que ningún `curl` puede hacer.

- [ ] **M1 · El relevo espera.** Con la app abierta, desplegar y recargar: en DevTools →
      Application → Service Workers debe aparecer uno **`waiting`** y el que dice **`activated`**
      debe seguir siendo el anterior. **Se anota qué versión está en cada estado.**
- [ ] **M2 · La página viva no se rompe.** Sin cerrar la app, navegar por tres pantallas:
      **cero** errores de carga de chunk en Console, y `next-static-v1` **sigue existiendo** (nadie
      la borró bajo la página viva). **Se anota el número de errores y el nombre de las cachés.**
- [ ] **M3 · El aviso, y que no recargue solo.** Debe aparecer el aviso «Hay una versión nueva»
      **sólo cuando no hay nada a medias** (probarlo con un formulario empezado: no debe salir).
      Al pulsar **Actualizar ahora**, la pestaña recarga; **una segunda pestaña abierta NO debe
      recargarse sola**. Tras la recarga, en Cache Storage quedan **sólo** `next-static-v2` y
      `pages-cache-v2`: las `v1` **desaparecieron**.
- [ ] **M4 · El tope.** Navegar hasta superar el tope y mirar Cache Storage: el número de entradas
      de `next-static-v2` **no pasa de 200**. Y con el número real a la vista, **re-medir
      `TOPE_ESTATICOS`**, que hoy está **declarado SIN CALIBRAR** (producción se vació el
      2026-08-25 y no se pudo contar el recorrido del mensajero).
- [ ] **M5 · Instalabilidad.** Application → Manifest: **0 errores**; `id` presente; la app **no**
      aparece duplicada en el lanzador de un teléfono que ya la tuviera instalada. Y en un iPhone,
      que el icono de la pantalla de inicio **no** tenga doble redondeo.
- [ ] **M6 · Lighthouse.** Chrome de escritorio, incógnito, sesión de **mensajero**, dispositivo
      **Mobile**. Se exige `html-has-lang` y `html-lang-valid` en **PASS** y **Accesibilidad ≥ 90**.
      Se anotan **URL, fecha, versión de Chrome y de Lighthouse** y el número de cada categoría. Si
      no llega al umbral, **la ficha no está hecha**: se escribe el número y qué auditoría lo baja.
- [ ] **M7 · El camino de rescate, probado UNA vez en un teléfono de verdad.** Abrir
      `https://<dominio>/?rescate=sw`: la app debe volver a cargar y, en DevTools → Application,
      **no debe quedar ningún service worker registrado ni ninguna caché**. Es la salida que
      convierte «un SW roto es irrecuperable sin borrar los datos del sitio» en «se abre una URL».
      **Probarlo cuando no hace falta es la única forma de saber que funciona el día que haga
      falta**; si falla, hay que arreglarlo antes de que exista una base instalada.

### De la 264 — el detalle del cierre

- [ ] **Ver la sección «Órdenes sin gestionar» en pantalla.** Cierre terminado en **`8F88DCD5`**:
      debe listar **4 guías**, y el pie seguir en **₡14.900** general y **₡2.000** de pago al
      mensajero. Los datos ya están verificados contra la base (2026-08-22); **lo que falta es que
      alguien mire los píxeles**, y era una ficha visual sin tarea de «ver la app».

### De la 262 — corregir el día de reparto

Lo que `F6` **no pudo cubrir en local por falta de datos**, y en producción sí existe:

- [ ] **Corregir el día desde `/recepcion-satelite/en-bodega`** con cuenta `adminSatelite`. En local no hay
      ninguna orden de su zona en un estado que esa pantalla ofrezca, y **no hay camino por la UI**:
      el botón exige `por_recoger`, que exige asignar, que exige coordenadas — y sólo 4 órdenes de
      ~70 las tenían.
- [ ] **«Una orden de otra zona no aparece», sobre un listado CON contenido.** En local se comprobó
      sobre un listado **vacío**, así que no discrimina entre «el acotado funciona» y «no había nada
      que mostrar». Es la comprobación de aislamiento entre zonas: merece datos de verdad.
- [ ] **Un caso de `ayuda_tienda`**: en local no hay ninguna orden en ese estado.

### De la 262 — una pregunta de producto, no una comprobación

- [ ] **Decidir si «Del 23 al 24 de agosto» se cambia.** Medido mirando la pantalla: se lee como un
      **rango de dos días** en la mitad de los casos —«del 24 al 23» es inequívoco porque ningún
      rango corre hacia atrás; «del 23 al 24» no—. Lo agrava que la entrada de corrección es **la
      única sin la flecha `A → B`** que llevan las demás, así que toda la carga de indicar el cambio
      cae en la preposición: **falta el verbo**. Es contrato en `design.md` §14.4. Si se cambia, lo
      barato es el encabezado (`ETIQUETA_CORRECCION_DIA`), no el cuerpo que está bajo test.

### De la 265 — el optimizador

- [ ] **C3 · Re-medir M1** con `ruta_optimizada_parada` ya poblada, para saber si el umbral
      `RUTA_ORIGEN_MAX_KM = 200` —hoy **declarado sin calibrar**— se sostiene. El 2026-08-22 la tabla
      estaba **vacía** y por eso el número se fijó a ojo.
- [x] **C7 · Cero líneas `optimizer***:`** — ✅ **VERIFICADO el 2026-08-23 tras la release**, y con
      un cero que significa algo: el cron `procesar-jobs` corrió **cuatro veces** (09:20, 09:21,
      09:22 y 09:23) sobre el despliegue nuevo y **no imprimió ni una** línea `optimizer***:`.
      Con el build anterior, **cada una de esas corridas volcaba un bloque de configuración entero**
      —`projectId`, claves, timeouts—. Un cero sólo vale si lo que lo produciría llegó a correr, y
      corrió. **No pongas `RUTA_DEBUG_LOG=1`** en ningún entorno sin un diagnóstico abierto que lo
      justifique: vuelca coordenadas de destinatarios.
- [ ] **C8 · Cero jobs `optimizacion_ruta` en `failed`** con «respuesta del proveedor con forma
      inesperada» **posteriores al despliegue**. Antes había **6**, todos del 2026-08-22. Es la
      única comprobación de que el arreglo funcionó **donde ocurrió el incidente**: ninguna de las
      17.000 pruebas verdes la sustituye.
      ⚠️ **Re-medido el 2026-08-24 y SIGUE SIN PODER CERRARSE, ahora con el motivo dicho:** no hay
      **ningún** job `optimizacion_ruta` —de ningún estado— posterior al **2026-08-22 16:56 CR**, o
      sea **ninguno después del despliegue**. El último `failed` es del **2026-08-21 23:43 CR**.
      «Cero `failed`» vuelve a ser un cero que no significa nada, exactamente como el de `C7` antes
      de comprobar que el cron sí había corrido. Hace falta **una optimización real** después del
      despliegue para que este cero valga.
- [ ] **`F6` en preview** (265 y 262): la mitad que en local **no tiene poder de resolución** —sin
      llamada al proveedor no se puede distinguir «no se llamó» de «no había credencial»—. Preview
      **sí** tiene la credencial (comprobado el 2026-08-23); lo que hace falta es un despliegue y una
      cuenta que exista en **su** base, que es distinta de la de producción desde julio.

---

## Release NO abierta — 2026-08-24

`dev` = **`7c211f2f`**, gate COMPLETO en verde (`INIT_EXIT=0`, 1375 archivos / 18.707 tests).
`prod` sigue en **`37b5944b`**. Se recorrió el §1 de esta lista y **se paró en el cuarto punto**,
que es justo el que existe para esto: *repasar las fichas `in_progress` que entran*.

**Qué lo paró:** `dev` lleva, además de la 276 y la 277, el cambio de tarifas de otra sesión, y
dentro va **`20260825120000_drop_tarifa_status`** — un **`DROP COLUMN` sobre una tabla de dinero**,
irreversible. Su mitad frontend (**ficha 275**) sigue `pending`.

**Lo que se comprobó antes de decidir**, para que no haya que repetirlo:

- La revisión de esa ficha **existe y aprobó**: «APROBADO CON RESERVAS», **0 bloqueantes de
  código**, 40/40 requisitos. Sus dos bloqueantes eran de bookkeeping.
- **No queda código vivo usando `tarifas.status`**: los únicos aciertos del grep son comentarios que
  explican su retirada.
- El gate está verde sobre ese mismo árbol, con los tests de componentes dentro.

**Decisión del humano:** esperar a que la otra sesión cierre su 275 —o confirme que su parte puede
salir— en vez de arrastrar un borrado irreversible ajeno en una release que no es suya. Separar no
era opción: `dev` es un solo árbol y aislar lo de esta sesión exigiría cherry-picks.

### Cuando se abra, esto ya está medido — pero CADUCA

Las dos condiciones de despliegue de la 276 se ejecutaron el 2026-08-24:

- **R37 limpia**: única orden en el umbral, la guía `28098171`, en `devuelta`; **cero** fuera. La
  condición de parada de Q6 no se cumple.
- **T6 congela CERO órdenes el primer día** (medido por primera vez): 2 `reprogramada` vivas,
  0 liberables hoy, las dos con su cierre ya aprobado.

⚠️ **Son fotos. Se re-miden el día que se abra la release**, no se citan éstas. Cualquier cierre que
la bodega apruebe entre medias puede crear una orden en el umbral que R18 dejaría inasignable.

---

## Release del 2026-08-25 — la 276, la 277, la 279 y la cascada de tarifas

**`prod` = `e4ff7182`** · PR #492 · `dev` = `258b6468`, y **`dev` es ancestro de `prod`** (comprobado:
todo el trabajo llegó, no solo el PR en verde).

### §1 recorrido, con su evidencia

- **Gate COMPLETO sobre el SHA exacto que se despliega**: `./init.sh` → `INIT_EXIT=0`,
  **1386 archivos / 18.868 tests**, con `INIT_EXIT` escrito dentro del log.
- **`dev` no se movió** entre el gate y la release: `258b6468` antes y después. Se re-comprobó **tres
  veces** durante la tanda, y en dos de ellas **sí se había movido** — de ahí la tercera colisión de
  ids del día.
- **Re-medido lo que caduca**, que es lo que este archivo existe para no olvidar:
  - **R37 de la 276**, re-ejecutada **hoy** y no citada de ayer: la única orden viva con
    `intentos >= 3` es la guía `28098171`, en `devuelta`, y **cero** fuera de ese estado. La
    condición de parada de Q6 no se cumple.
  - **T6 congela 0 órdenes el primer día**: 2 `reprogramada` vivas, 0 liberables hoy, las dos con su
    cierre ya aprobado.
- **Fichas `in_progress` que entran, leídas enteras** (ver el riesgo declarado abajo).
- **Variables de entorno**: no aplica — ninguna de las fichas de esta tanda añade ni cambia
  configuración de entorno.

### Lo irreversible, medido ANTES de salir

`20260825120000_drop_tarifa_status` **borra `tarifas.status`** y su tipo `estado_tarifa`. Un
`DROP COLUMN` no se deshace, así que se midió qué se pierde: **`tarifas` tiene 2 filas y las dos son
`activo`**. **Ni una `inactivo`**, así que la pérdida real de información es **cero**. Entran ocho
migraciones en total; ninguna de las de esta sesión mueve filas.

### ⚠️ Riesgo declarado y aceptado por el humano

La ficha **278 (plantilla de carga masiva v3)**, de otra sesión, entró en esta release **sin informe
de revisión ni bitácora en el repo** —no existe `progress/review_278.md` ni ningún archivo suyo— y
con estado `in_progress`. Su código ya estaba mergeado en `dev` cuando se abrió la release.

También entró la **274 (cascada de tarifas)**, que **sí** tiene revisión: «APROBADO CON RESERVAS»,
0 hallazgos bloqueantes de código, 40/40 requisitos. Su mitad frontend, la **275**, sigue `pending`.

El humano decidió el alcance dos veces con estos datos delante. Se deja escrito **aquí** y en el
cuerpo del PR para que sea un riesgo registrado y no uno recordado.

### ✅ La 271, cerrada por fin — verificado en producción anoche

El corte de las **00:01:21 CR del 25** creó el cierre `5efa70b9` (`vencido`, 1 gestión + 2 órdenes
barridas) y **emitió los avisos**: `notificacion` pasa de **0 a 4** filas `cierre_dia_vencido` —
cero en toda la historia de la tabla hasta anoche.

Y el aviso **nombra el día trabajado**: «Tu cierre **del 24 de agosto** venció sin enviarse a
aprobación…». No el 25 de su nacimiento. Ese off-by-one era media ficha 271, y aquí queda medido en
producción, no razonado. Los otros tres avisos van a bodega (maestro, admin, adminSatélite) **sin
datos de nadie**.

### §3 recorrido tras desplegar — todo verificado

- **Despliegue `READY`** (`dpl_3Gfyukq…`), alias `ordenex.vercel.app` apuntando y `aliasError: null`.
  No basta con que el PR esté mergeado, y por eso se espera.
- **Cero errores de runtime** en la ventana que cubre el despliegue.
- **Las ocho migraciones aplicaron, y se comprobó contra la base qué hicieron:**
  - `rechazo_tope_intentos` **existe** en `orden_historial_origen_tipo`.
  - `tarifas.status` **ya no existe**, y su tipo `estado_tarifa` **tampoco**.
  - **`tarifas` conserva sus 2 filas**: el `DROP COLUMN` no se llevó ninguna.
  - **0 órdenes tocadas** por el despliegue, de **163** vivas. Ninguna migración de esta tanda
    escribió una fila que no le tocaba.

### Pendiente para la PRÓXIMA release — lo que sólo se puede ver en producción

- [ ] **Las dos pantallas nuevas del adminSatélite** (279). Sus e2e están **`NOT EXECUTED`**: las
      rutas se corrigieron **por lectura**. Falta entrar como `adminSatelite` y comprobar, con el
      número delante: que el menú «Órdenes» abre como acordeón con **«Por recibir»** y
      **«En bodega»**; que **`/recepcion-satelite` redirige** a «Por recibir» y no da 404; que el
      **escáner está montado en las dos**, incluida «Por recibir» **con la lista vacía**; y que
      **ninguna card ofrece «Aceptar»**.
- [ ] **El tope de intentos, visto por el mensajero** (276). Cuando una orden llegue a 2 intentos,
      comprobar que su panel ofrece **sólo** «Entregada», «Rechazada» e «Incidente» — y que
      «Reportar incidente» **sigue estando**, que fue decisión firmada.
- [ ] **La primera orden que alcance el umbral**: comprobar que queda `rechazada` y que emite su
      `cobroRechazado`. Esta release **acelera dinero** —hasta ahora el sistema erraba a propósito
      hacia no cobrar— y ese primer cobro es el que hay que mirar con lupa.
