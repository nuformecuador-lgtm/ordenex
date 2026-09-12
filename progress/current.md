# Estado — sesión del 2026-09-10 / 12

## ⚠️ LO MÁS RECIENTE — tercera release (2026-09-12)

`prod` = **`97fc983e`** (PR #790), READY, alias `ordenex.co`. `dev` = `7684dbb4`.

Entró la **422** — «la app recuerda que quieres avisos y los reactiva sola al volver a entrar».
Nace de que el humano probó el push en producción y vio que cerrar sesión lo apagaba. **No era un
fallo**: era R19 de la 410 protegiendo el dispositivo. Ahora se guarda la DECISIÓN, no el aparato.

**Verificado contra producción después de desplegar, las seis cuadran:**
migración `20260915120000_usuario_preferencia` aplicada · **1 fila** en `usuario_preferencia` ·
**1 intacta** (`updated_at = created_at`, prueba de que nada más la tocó) · **0** preferencias sin
suscripción previa · 1 suscripción sin cambios · **0** migraciones revertidas.
`ordenex.co`, `/login` y `/sw.js` en 200. **Cero errores de runtime.**

**Tres rondas de revisión, tres bloqueantes, todos en las GUARDIAS y ninguno en código que corre.**
Se cerraron atacando la causa: las raíces del censo se derivan del disco en vez de enumerarse; el
censo persigue el módulo importado en vez de la llamada; y la aguja dejó de depender de la extensión
`.ts`, con lo que `public/sw.js` entró al censo. **Once intrusos probados, once cazados**, todos con
el typecheck en verde.

**410/R19 pasó de afirmada a MEDIDA**: el caso que la defiende corre contra Postgres con dos
suscripciones reales. Ese `WHERE` antes solo lo veían dobles.

**Decisión del humano, no reabrir:** el permiso del navegador es POR DISPOSITIVO y así debe seguir.
La preferencia solo recuerda la decisión y **no puede saltarse el permiso** (hay mutación que lo
exige). Apagar el interruptor la borra; cerrar sesión la conserva.

---

## Estado anterior — sesión del 2026-09-10 / 11

## Desplegado en producción y VERIFICADO (segunda release del día)

`prod` = **`09183b22`** (merge del PR #788), READY, alias `ordenex.co`. `dev` = `cff9b27c`.

Entraron **412, 413, 420 y 421**. Comprobado contra producción DESPUÉS de desplegar:

- Las **dos migraciones** aplicadas, **0 revertidas**; la última es
  `20260914120000_notificacion_evento_reparto_manana`.
- `notificacion_evento` **13 → 15**; `notificacion_entidad_tipo` **11 → 13**. `cierre_dia_rechazado`
  y el evento de reparto, presentes.
- **10 crons** en `vercel.json`, incluido `/api/cron/aviso-reparto-manana` a `0 1 * * *` UTC
  (**19:00 CR**, la hora que se midió: a esa hora ya está asignado el 96% del volumen del día).
- `ordenex.co`, `/login` y `/sw.js` en **200**. **Cero errores de runtime.**
- Gate completo verde sobre el SHA desplegado: 1944/1944 archivos, 28.192 tests, 256 de
  `integration/db` ejecutados y **cero saltados**.

La release anterior del día (`09798ed4`, PR #783) llevó **408, 409, 410, 411, 414, 415, 417, 418**.

## Ninguna ficha queda abierta

`in_progress` = 0. Pendiente de empezar: **419** (la bodega central cierra la devolución), registrada
con el diseño del humano y **sin especificar**.

## Lo que sigue abierto y ES DEL HUMANO

1. **Probar el push en un teléfono real.** Sigue sin hacerse. Entrar como **admin** (al maestro solo
   le empujan dos averías que no ocurren); en un teléfono con la PWA ya instalada hay que **tomar el
   relevo del service worker**; y el aviso de represadas gasta su cupo del día a las 07:00 aunque no
   haya suscriptores.
2. **Avisar a Daniel** de `zona`/`costoEstimado`/`costoReal` (deuda T12 de la 415). El mensaje está
   redactado; las otras tres entradas del CHANGELOG ya las tiene.
3. **Nadie ha visto el aviso de cierre rechazado en la campana**, y producción no puede confirmarlo:
   cero cierres rechazados en toda su historia. Su estreno será el primero que rechaces.
4. **El aviso de reparto se estrena esta noche a las 19:00 CR.** Mañana se puede comprobar si los
   mensajeros lo recibieron.

## Decisiones del humano, para no reabrirlas

- **`VAPID_SUBJECT` se queda sin configurar**: `soporte@ordenex.co` no existe y no se creará un buzón
  solo para esto. El push funciona igual; solo se pierden los avisos de los proveedores.
- **El atasco de devoluciones no se resuelve pidiendo a las tiendas que escaneen**: lo hará la bodega
  central, con comprobante y en lote. Ficha **419**.
- **La 420 no lleva `pnpm install` incondicional** aunque la ficha original lo prescribía: repararía
  en silencio y no produce el rojo, que es el entregable.
- Las tres del 2026-09-10 siguen firmes: las 219 en ruta, `en_bodega_central` borrable y los
  duplicados de Gameos.

## Hallazgos abiertos

- **305 órdenes atascadas en devolución** y **cero transiciones a `devuelta_a_tienda` en toda la
  historia**. Cuentan como vivas en la cohorte de la 411 y hunden la efectividad histórica: el número
  es correcto, pero está deprimido por un atasco operativo, no por el reparto. Ficha **419**.
- **La premisa de la 409 sobre `devolviendo_a_tienda` caducó**: se excluyó porque «fluye», pero no es
  joven porque fluya — el estado se empezó a usar el 9 de septiembre y nada ha salido nunca de ahí.
- **`recuperar-contrasena-form.test.tsx` cae por tiempo bajo carga**: pasa en 7,9 s y falla a partir
  de ~10 s. Medido sobre seis suites completas. **Sin ficha todavía.**
- **`ConsoleErrorLogger` pierde la cadena de `cause`** (`lib/errors/logger.ts:15`): un fallo
  best-effort se lee en el servidor sin su motivo. Es de la 146 y afecta a todo el repo.
- **m6 de la 410**: un reintento del job hace vibrar dos veces al dispositivo que ya recibió.

## Lecciones de esta sesión, medidas

- **Leer el código no es medirlo.** Di por buena la guardia del cableado de push; el reviewer escribió
  el mismo productor en OTRO archivo y 213 archivos de guardias quedaron verdes con el push saltado.
  Comprobar que una protección existe no es comprobar su alcance.
- **Un centinela que vigila la señal fácil miente.** Tres veces escribí uno mal: uno esperaba un
  formato de salida que cambia sin terminal, otro habría casado con un despliegue VIEJO en `Ready`.
  Hay que anclarlos al dato estructurado — el commit, no el alias.
- **Una ficha puede prescribir la solución equivocada.** La 420 que registré decía «`pnpm install`
  incondicional»; el implementador lo descartó con medición y tenía razón.
- **`in_progress` sin spec EN DEV rompe el gate de todos.** Marqué dos fichas cuyos specs vivían en
  sus ramas y dejé a todo el mundo en rojo.
- **Un barrido que solo limpia lo que escribe el código SANO es el que falla cuando hace falta.** Dos
  fichas seguidas ensuciaron la base compartida por esto.
- **El `down.sql` de un enum es una foto que caduca.** El spec de la 413 traía la lista anterior al
  merge de la 412; revertir habría borrado dos valores en silencio.
