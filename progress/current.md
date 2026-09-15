# Estado — sesión del 2026-09-10 / 12 / 14

## EN CURSO — sesión del 2026-09-14

### Ya en `dev`

| Ficha | PR | Qué |
| --- | --- | --- |
| **423** | #791 | ordenar las tablas de órdenes por número de remisión (orden natural, columna generada) |
| **426** | #792 | una ruta de api con la sesión vencida responde 401 JSON, no HTML |
| **424** | #793 | el admin vuelve a poder eliminar órdenes (revierte la decisión del 2026-08-27, con rastro) |

### 427 — traspasar a otro mensajero lo que ya lleva encima

Implementada (backend + pantalla). **La primera revisión salió RECHAZADA** (`progress/review_427.md`):
dos bloqueantes, y los dos eran **redes de test que faltaban**, no código roto — con el `loteId` del
aviso cambiado por el id de una orden (el segundo traspaso a la misma persona no avisaría nunca) y con
el autor de las gestiones del lote reescrito (movería pago y cierre), la suite seguía en verde.
Arreglados en `a5e23a1f` (solo `tests/`) y el menor de textos en `526f7dbb`.
**En curso:** gate completo (`progress/gate_427_c.log`) y una revisión acotada en un worktree aislado,
a la vez. Falta T25: un traspaso real en la app, que exige **reiniciar el dev server** (su cliente
Prisma es anterior a las dos migraciones de la ficha).

### 425 — la salida del rechazo de tienda

Spec aprobado con las tres decisiones del humano (`progress/decisiones_425.md`). **Sin implementar.**
Mediciones del bloque M hechas contra producción (solo lectura), pendientes de copiar a
`progress/impl_425.md` al abrir la rama:
- **M6:** la tienda ya pagó el flete de devolución de **24** de esos rechazos (**₡65.088**): meterlos
  al cierre como gestión cobraría dos veces. De los 46 rechazos, **22 no tienen cobro** (anteriores al
  mecanismo): es la decisión que el humano dejó para después.
- **M7:** desglose sin cambios (46 en 6 mensajeros). **Arnel Guillen es el único con un cierre
  abierto** (solicitado 2026-09-11): si su cierre nuevo nace antes de aprobar ese, queda en N=2 y la
  regla 271 lo **bloquea para recibir asignaciones**.
- **M1/M2 antes:** los seis últimos cierres aprobados cumplen `total_pago_mensajero = Σ pago_mensajero`.

**No se puede implementar en paralelo con la 427:** su migración entraría en la base local compartida y
pondría rojo el gate ajeno. Arranca cuando la 427 esté mergeada.

### Hecho A MANO contra producción hoy (y nada más)

- **29 remisiones de Sicommer** renombradas de `REMISIÓN DE VENTA #NN` a `SC-0NN` (su número de
  siempre). Causa: la fila `REM … FECHA …` no cabe en la etiqueta de 100 × 100 con más de 20
  caracteres. 0 colisiones, 0 cierres afectados, `busqueda_texto` recalculada sola.
- **31 órdenes `en_reparto` + sus 31 conversaciones** de Andy Cortés a Carlos Eduardo (Andy se enfermó).
  Las 37 entregadas y las 24 `devolviendo_a_tienda` de Andy **no se tocaron**. Es el caso que originó
  la 427.

### Puertas humanas antes de la release a `prod`

1. **Avisar a Nuform** del cambio de contrato de la 426: su cliente pasa de `200`+HTML a `401`+JSON.
   Y recordarles que usan el canal de **sesión** (caduca cada 24 h) teniendo una API key activa sin usar.
2. **Si sale la 425:** entregar el aviso de desglose a quien aprueba cierres (borrador en el scratchpad
   de la sesión, pendiente de commitear como `progress/aviso_425_desglose.md`) y **aprobar el cierre del
   11/09 de Arnel antes de desplegar**.

### Lo que sigue abierto y es del humano

- Los **25 rechazos sin `ingreso_bodega_rechazo`** (~₡4.000): decidir después de la 425.
- El correo con las **4 funcionalidades nuevas** (cierres de satélite, SINPE por bodega, mensajes el día
  anterior, documentación + asistente con IA): pendiente de aprobación del cliente; no se toca nada
  hasta entonces.

### Del entorno, para no re-diagnosticar

- **Flake:** `ranking-snapshot-migration.test.ts` con `40P01` (deadlock) cambia de bloque entre
  corridas y es verde aislado. No es de ninguna ficha; no va al baseline.
- A media sesión **cambió la cuenta** por límite semanal: la primera revisión de la 427 murió sin
  escribir nada y se verificó el árbol limpio antes de relanzarla.
- El `reviewer` **no puede escribir archivos**: su informe lo escribe el leader.

---

## Estado anterior — tercera release (2026-09-12)

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
