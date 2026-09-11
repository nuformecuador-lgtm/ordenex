# Estado — sesión del 2026-09-10 / 11

## Desplegado en producción y VERIFICADO

`prod` = **`09798ed4`** (merge del PR #783), READY desde las **07:20:36 UTC** del 2026-09-11,
aliado a `ordenex.co`. `dev` = `b4ee8412`.

Fichas que entraron: **408, 409, 410, 411, 414, 415, 417, 418**. Ninguna quedó abierta.

Lo que se comprobó contra producción después de desplegar, con su número:

- Las **tres migraciones** aplicadas y sin revertir; la última es `20260912120100_job_tipo_push_web`.
- `notificacion_evento` **11 → 13** valores. `job_tipo` **9 → 10**, con `push_web`. Las dos tablas
  de push creadas.
- **El cron de las 07:00 CR emitió 6 avisos: 2 globales + 4 por zona**, el número exacto previsto.
  Cada uno con su `entidad_id` de alcance (`global:2026-09-11`, `<zonaId>:2026-09-11`). **Es la
  primera vez que producción ejerce el camino multi-alcance de la 409**: sin ese arreglo, solo la
  primera zona habría recibido el suyo y las otras tres se habrían perdido sin error ni log.
- El canal de push encoló **6 jobs, 0 con error**. **0 suscripciones**: nadie lo ha activado aún.
- **Cero grupos de error de runtime nuevos** contra la línea base medida antes de desplegar.
- `ordenex.co`, `/login` y `/sw.js` responden 200.

## En curso

- **412** (`in_progress`, backend) — implementándose. Añade un valor al enum `notificacion_evento`.
- **413** (`spec_ready`, backend) — **va DESPUÉS de la 412, en serie obligada**: comparten el enum
  y su migración.

## Registradas y sin empezar

- **419** (fullstack) — la bodega central cierra la devolución con su comprobante. Alcance fijado
  por el humano el 2026-09-11.
- **420** (backend) — el gate canta «dependencias presentes» mirando solo si existe la carpeta.
- **421** (backend) — el test de migración que consulta el enum sin fijar el esquema.

## Lo que sigue abierto y ES DEL HUMANO

1. **Probar el push en un teléfono real.** T6.5 de la 410 quedó sin marcar a propósito, y con ella
   el checkpoint 9. **Nadie ha visto todavía un push en un dispositivo.** Todo lo verificado es
   base de datos y arnés.
   - Entrar como **admin**, no como maestro: al maestro solo le empujan dos averías que hoy no
     ocurren.
   - En un teléfono con la PWA ya instalada hay que **tomar el relevo del service worker**
     (pulsar «actualizar» o cerrar todas las instancias). Si no, el aviso llega al worker viejo,
     que no tiene handler, y el navegador pinta su mensaje genérico: parece roto y no lo está.
   - **El aviso de represadas ya gastó su cupo del día** a las 07:00 con cero suscriptores —el
     cupo se reclama por persona aunque no tenga dispositivo (`notificacion-repo-con-push.ts:130`)—.
     Para probar hoy: que un mensajero solicite un cierre (`cierre_dia_por_aprobar`).
   - En iPhone sin instalar en pantalla de inicio el control **no se ofrece**, a propósito (R45).
2. **Avisar a Daniel** de la entrada del CHANGELOG de `zona`/`costoEstimado`/`costoReal` (deuda
   T12 de la 415). Las otras tres entradas ya las tiene desde la release anterior.

## Decisiones del humano, para no reabrirlas

- **`VAPID_SUBJECT` se queda sin configurar.** `soporte@ordenex.co` no existe y no se va a crear un
  buzón solo para esto. El push funciona igual: solo se pierden los avisos de los proveedores.
- **Las claves VAPID sí están dadas de alta**, par distinto en Production y en Preview, ninguna en
  Development.
- **El atasco de devoluciones no se resuelve pidiendo a las tiendas que escaneen**: no hay forma de
  obligarlas. Lo hará la bodega central, con comprobante y en lote. Es la ficha **419**.
- Las tres del 2026-09-10 siguen firmes: las 219 en ruta, `en_bodega_central` borrable y los
  duplicados de Gameos.

## Hallazgos abiertos

- **305 órdenes atascadas en el flujo de devolución** (247 `devolviendo_a_tienda`, 31 `rechazada`,
  27 `por_devolver`) y **cero transiciones a `devuelta_a_tienda` en toda la historia**. Cuentan
  como **vivas** en la cohorte de la 411 y hunden la efectividad histórica de cada día: el número
  es correcto, pero está deprimido por un atasco operativo, no por el reparto. Ficha **419**.
- **La premisa de la 409 sobre `devolviendo_a_tienda` caducó**: se excluyó de la vigilancia porque
  «fluye» (ninguna orden pasaba de día y medio), pero no es joven porque fluya — el estado se
  empezó a usar el 9 de septiembre y **nada ha salido nunca de ahí**. Cuando esas 247 envejezcan,
  nadie las estará mirando.
- **m6 de la 410**: un reintento del job hace **vibrar dos veces** al dispositivo que ya recibió.
  La etiqueta colapsa la tarjeta, así que se ve una notificación y suenan dos.

## Lecciones de esta sesión, medidas

- **Leer el código no es medirlo.** Verifiqué que alguien inyectaba el canal de push y di por buena
  la guardia que lo protege. El reviewer escribió el mismo productor en OTRO archivo y **213
  archivos de guardias quedaron en verde con el push saltado en silencio**. La guardia leía un solo
  archivo. Comprobar que existe una protección no es comprobar su alcance.
- **Usar la prueba correcta.** Declaré «ascendencia rota» entre `prod` y `dev` porque `prod` no era
  ancestro de `dev`. Eso es lo NORMAL: cada release deja allí un merge commit que `dev` nunca ve, y
  hay 92. La prueba buena es el merge de prueba y comparar el árbol resultante.
- **Un gate rojo se diagnostica, no se baselinea.** El rojo del gate de release era un test que
  consulta el enum sin fijar el esquema mientras el harness aísla en esquemas temporales. Meterlo en
  `baseline-rojos.json` habría comprado el verde. Quedó como ficha 421.
- **Un centinela que solo busca la buena noticia se queda mudo ante un fallo.** El que escribí para
  esperar el despliegue habría casado con un `Ready` VIEJO y cantado éxito. Hay que anclarlo a la
  fila más reciente y aceptar también los estados de error.
- **Comparar horas de la misma zona.** Casi reporto un hueco en el push por comparar timestamps UTC
  de la base contra la hora local que devuelve `vercel inspect`. No había hueco: los eventos sin
  cupo ocurrieron ANTES de que el despliegue estuviera vivo.
