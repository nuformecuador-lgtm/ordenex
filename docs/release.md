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

## Pendiente para la PRÓXIMA release

> Se rellena cuando una ficha deja una comprobación que **sólo** se puede hacer desplegando. Se
> vacía al ejecutarla. Si esta sección tiene entradas, **la release no está terminada** aunque el
> despliegue esté verde.

### De la 264 — el detalle del cierre

- [ ] **Ver la sección «Órdenes sin gestionar» en pantalla.** Cierre terminado en **`8F88DCD5`**:
      debe listar **4 guías**, y el pie seguir en **₡14.900** general y **₡2.000** de pago al
      mensajero. Los datos ya están verificados contra la base (2026-08-22); **lo que falta es que
      alguien mire los píxeles**, y era una ficha visual sin tarea de «ver la app».

### De la 262 — corregir el día de reparto

Lo que `F6` **no pudo cubrir en local por falta de datos**, y en producción sí existe:

- [ ] **Corregir el día desde `/recepcion-satelite`** con cuenta `adminSatelite`. En local no hay
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
- [ ] **C7 · Cero líneas `optimizer***:`** en los logs de runtime tras el despliegue. La variable
      `RUTA_DEBUG_LOG` **no está puesta en ningún entorno** (comprobado el 2026-08-23) y el default
      del código ya nace apagado, así que lo esperado es cero. **No la pongas a `1`** en ningún
      entorno sin un diagnóstico abierto que lo justifique: vuelca coordenadas de destinatarios.
- [ ] **C8 · Cero jobs `optimizacion_ruta` en `failed`** con «respuesta del proveedor con forma
      inesperada» **posteriores al despliegue**. Antes había **6**, todos del 2026-08-22. Es la
      única comprobación de que el arreglo funcionó **donde ocurrió el incidente**: ninguna de las
      17.000 pruebas verdes la sustituye.
- [ ] **`F6` en preview** (265 y 262): la mitad que en local **no tiene poder de resolución** —sin
      llamada al proveedor no se puede distinguir «no se llamó» de «no había credencial»—. Preview
      **sí** tiene la credencial (comprobado el 2026-08-23); lo que hace falta es un despliegue y una
      cuenta que exista en **su** base, que es distinta de la de producción desde julio.
