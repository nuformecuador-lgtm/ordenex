# 409 — Tasks

> **Orden obligatorio: backend → frontend.** `[P]` = paralelizable con las tareas marcadas igual
> dentro de la misma fase.
> El criterio de «hecho» de cada tarea es **un aserto que se pone ROJO si el código está mal**.
> Nunca un `grep` sobre un comentario, y nunca un texto comparado contra la función que lo genera.
> **Sin preguntas abiertas**: las nueve las cerró el humano el 2026-09-10 (`requirements.md` §13).

---

## Fase 0 — Antes de escribir una línea

- [ ] **T0.1** — Leer el contrato visual entero: `design-notificaciones/Main.dc.html`,
      `Campana.dc.html`, `PorRol.dc.html`, **con las tres correcciones del humano delante**: sin
      botón en el aviso de mapas caídos, «le cambiaron el día de reparto» es accionable, y **sin**
      el pie «Ver todas las notificaciones».
      **Hecho:** en `progress/impl_409_backend.md` está la lista de literales que se van a fijar
      como contrato de test, copiados del `.dc.html`, no reescritos.
- [ ] **T0.2** — Confirmar en el **archivo real** (no en el grafo): que `marcarNotificacionLeida` no
      tiene punto de entrada; que `notificacion_dedupe_key` es el que describe
      `20260727120000_notificacion/migration.sql`; y que `EnvioDevolucionCentralService` sigue
      declarando `ROL_AUTORIZADO = "adminSatelite"` (de eso depende que el atajo del adminSatelite
      sea `/recepcion-satelite/en-bodega` y el de maestro/admin sea `/ordenes` — dos destinos para
      el mismo evento, design §2.1bis).
      **Hecho:** las tres comprobaciones anotadas con número de línea en el impl.

---

## Fase 1 — Cimientos puros (sin DB, sin React)

- [ ] **T1.1 [P]** — `lib/utils/tiempo-relativo.ts`: `tiempoRelativo(desde, ahora)`.
      **Hecho:** `tests/unit/utils/tiempo-relativo.test.ts` con reloj fijo cubre «hace 40 min»,
      «hace 2 h», «ayer» a las 23:59 CR y a las 00:01 CR, «hace 3 d», y una fecha futura
      (no produce negativos). Literales escritos a mano. **(R33)**
- [ ] **T1.2 [P]** — `lib/config/devolucion-sla.ts` con `DIAS_RECHAZO_AUTOMATICO: 5` y
      `HORAS_REINTENTO: 24`, y `lib/services/DevolucionSlaService.ts` derivando de ahí sus dos
      ventanas (hoy son constantes privadas).
      **Hecho:** `tests/unit/services/devolucion-sla-plazo-unica-fuente.test.ts` afirma (a) que la
      configuración vale 5, y (b) por **comportamiento del cron** que una `wrong_address` de
      4 d 23 h no escala y una de 5 d 00 h sí. Las suites vigentes de la 99/239/276 siguen verdes
      **sin editarlas**. **(R39)**
- [ ] **T1.3 [P]** — `lib/config/avisos-diarios.ts` con `DIAS_REPRESAMIENTO: 3`.
      ⚠️ **La medición va escrita al lado del valor**, no en un commit: producción 2026-09-10,
      `por_devolver` = 27 órdenes, media 2,4 d, máx. 8,2 d, **7 por encima de 3 d**;
      `devolviendo_a_tienda` = 247 órdenes, media 1,0 d, máx. 1,3 d, **0 por encima de 3 d** — ése
      fluye y **no se vigila**. Con 3 días el aviso habla de 7 órdenes; con 7 días, de 2 y tarde.
      **Hecho:** el umbral no aparece como literal en ningún servicio; el test de T4.2 lo inyecta.
      **(R53)**
- [ ] **T1.4** — `lib/notificaciones/catalogo-avisos.ts`: tipos, `CATALOGO_AVISOS` como
      `Record<NotificacionEvento, EntradaCatalogo>` **exhaustivo** (los 13 eventos) y
      `accionDeAviso(evento, rol)`. La tabla de `design.md` §2.1 es el contenido, incluidas las
      **tres** excepciones por rol y el **único** accionable sin atajo. Leer §2.1bis antes de
      rellenar la columna del atajo: el criterio es «¿le acerca esta pantalla a resolverlo?», no
      «¿puede ejecutar la transición?».
      **Hecho:** `tests/unit/notificaciones/catalogo-avisos.test.ts` verde con: exhaustividad contra
      el enum de Prisma; `cierre_dia_vencido` accionable para mensajero e informativo para bodega;
      `devoluciones_represadas` con **dos destinos distintos** —`/recepcion-satelite/en-bodega` para
      adminSatelite y `/ordenes` para maestro/admin—; `geocodificacion_caida` como **el único** sin
      atajo; `dia_reparto_corregido` **accionable** con `/mis-asignaciones`. Quitar una clave del
      `Record` **no compila**. **(R1, R2, R3, R4)**
      *Depende de: T2.1 para que el enum tenga los dos valores nuevos.*
- [ ] **T1.5** — Guardia `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts`: cada destino
      declarado existe en `SIDEBAR_ITEMS` y es visible para ese rol; y si lleva `?`, la página de
      destino **lee** ese parámetro.
      **Hecho:** el guard se pone rojo si se cambia el destino del mensajero a `/wallet`, y rojo si
      se añade un `?estado=x` que la página no lea. **(R5, R6)**
      *Depende de: T1.4, T6.5.*

---

## Fase 2 — Esquema y migración

- [ ] **T2.1** — `db/schema.prisma`: +`novedades_sin_gestionar` y +`devoluciones_represadas` en
      `NotificacionEvento`; +`novedades_sin_gestionar_dia` y +`devoluciones_represadas_dia` en
      `NotificacionEntidadTipo`. Con el comentario que explica **por qué el ámbito va dentro del
      `entidad_id`** (design §4.2). Espejar los cuatro en `lib/types/notificacion.ts`.
      **Hecho:** `pnpm run typecheck` verde y `prisma generate` produce los cuatro valores.
- [ ] **T2.2** — `.../20260911120000_notificacion_evento_avisos_agregados/migration.sql` con los
      cuatro `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.
      **Hecho:** `pnpm run db:migrate` aplica sin error contra la base local.
      *Depende de: T2.1.*
- [ ] **T2.3** — `down.sql` que recrea los **dos** tipos con la lista PREVIA (11 eventos, 9
      entidades), con la precondición ruidosa escrita y **sin un solo `DELETE`**.
      ⚠️ **Comprobar antes los siete `down.sql` anteriores de estos enums y NO tocar ninguno**: son
      fotos de su momento y todas siguen siendo ciertas.
      **Hecho:** `pnpm run db:rollback` revierte y `pnpm run db:migrate` vuelve a aplicar, sin error
      las dos veces.
      *Depende de: T2.2.*
- [ ] **T2.4** — `tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts`
      contra Postgres real: los cuatro valores existen; tras el down quedan exactamente los 11 y los
      9 previos; y `notificacion_dedupe_key` **conserva** su `NULLS NOT DISTINCT` y su
      `WHERE entidad_id IS NOT NULL` tras la reconstrucción del tipo.
      **Hecho:** el test corre (no `skipped`) y pasa. **(R63)**
      *Depende de: T2.3.*
- [ ] **T2.5** — ⚠️ **Justo antes de abrir el PR**: reescribir las dos listas de `down.sql` contra
      `db/schema.prisma` de `origin/dev` **en ese momento**. Si otra ficha metió un valor en estos
      enums mientras tanto, revertir con la lista vieja lo **borraría en silencio** (le pasó a la
      401 con la 403).
      **Hecho:** el SHA de `origin/dev` contra el que se comprobó, escrito en el `down.sql` y en el
      impl.
      *Depende de: todo lo demás. Es la última tarea de backend antes del PR.*

---

## Fase 3 — Los dos emisores

- [ ] **T3.1** — `lib/notificaciones/emitir.ts`: los **tres** textos de detalle de novedades
      (homogéneo 5 d / homogéneo 24 h / plazos mezclados) y
      `emitirNovedadesSinGestionar(repo, ctx, tx?)`. `tipo: "alert"`, destinatario
      `{ rol: adminTienda, tiendaId }`, `entidadTipo: "novedades_sin_gestionar_dia"`,
      **`entidadId = `${tiendaId}:${diaCR}``** (el día CR sale de `fechaCalendarioCR`, nunca de
      `toISOString().slice(0,10)`), sin anexo.
      **Hecho:** `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` afirma con
      literales **escritos a mano**: singular y plural del título; los **tres** detalles; el
      `entidadId` exacto; y que el texto no contiene guía, remisión, dirección, teléfono ni `₡`.
      40 novedades ⇒ **una** llamada a `crear`. **(R35, R36, R37, R39, R40, R44)**
      *Depende de: T1.2, T2.1.*
- [ ] **T3.2** — `lib/notificaciones/emitir.ts`: textos y
      `emitirDevolucionesRepresadas(repo, ctx, tx?)`. `tipo: "warning"`,
      `entidadTipo: "devoluciones_represadas_dia"`, **`entidadId = `${ambito}:${diaCR}``**, destinos
      según el ámbito: `maestro` + `admin` con `ambito = "global"`, o
      `{ rol: adminSatelite, zonaId }` con `ambito = zonaId`. Sin anexo.
      **Hecho:** `tests/unit/notificaciones/devoluciones-represadas-aviso.test.ts` con literales a
      mano, singular/plural, **dos** filas en el ámbito global y **una** por zona, el `entidadId`
      exacto de cada forma, y ausencia de PII (incluida la zona). **(R47, R48, R49, R50, R54)**
      *Depende de: T2.1.*
- [ ] **T3.3** — `lib/notificaciones/notificadores.ts`: dos firmas nuevas, dos `notificar*Con`, dos
      `notificar*Real`, y ampliar la intersección de `notificadorNoOp`.
      **Hecho:** `tests/unit/services/notificacion-notificadores-reales.test.ts` ejercita el camino
      REAL de los dos con un repositorio doble y comprueba que emiten; y que un fallo del emisor
      queda **registrado** (no absorbido en silencio) y no se propaga. **(R60)**
      *Depende de: T3.1, T3.2.*

---

## Fase 4 — Repositorio, servicio diario y cron

- [ ] **T4.1** — `lib/interfaces/repositories/IAvisoAgregadoRepository.ts` +
      `lib/repositories/AvisoAgregadoRepository.ts` (sólo Prisma). Los cinco métodos de
      `design.md` §4.4. El predicado de novedades **reutiliza** el método vigente del repositorio de
      órdenes; no se copia el `where`. El ancla es la última transición `anclaje_devolucion`, con
      caída a la gestión `devuelta` vigente. El de represadas filtra por `por_devolver`.
      **Hecho:** `tests/integration/db/aviso-agregado-repository.test.ts` contra Postgres real:
      (a) el conteo de novedades de una tienda **coincide con el del listado de `/novedades`** para
      esa tienda; (b) una orden de otra tienda no entra; (c) una orden borrada no entra;
      (d) `masAntiguaAt` es el `anclaje_devolucion` y **no** el `created_at` ni el `updated_at`;
      (e) con umbral 3, una `por_devolver` de 2 d no entra y una de 4 d sí; (f) **una orden en
      `devolviendo_a_tienda` con 9 días NO entra**. **Matar el test antes de creerlo**: sembrar 0
      filas debe hacerlo fallar, no pasar por vacío. **(R37, R38, R45, R46)**
      *Depende de: T2.2.*
- [ ] **T4.2** — `lib/services/AvisosDiariosService.ts` + su interfaz. Agrupa novedades por tienda y
      represadas por zona **y** global, aplica el umbral inyectado, decide la **homogeneidad de
      plazos** reutilizando `contarIntentosEnLote` y `alcanzaElTope`, resuelve el día CR con
      `fechaCalendarioCR(now)` y emite **envolviendo cada emisión en `emitirBestEffort`**.
      **Hecho:** `tests/unit/services/avisos-diarios-service.test.ts`: tienda con 0 novedades ⇒ no
      emite; tres tiendas y la segunda lanza ⇒ 2 emisiones + 1 fallo registrado + la corrida
      termina; dos zonas con 4 y 3 represadas ⇒ dos avisos de satélite con **su** número y su zona
      en el alcance, más los dos de administración con el total; zona con 0 ⇒ no recibe; umbral 3
      ⇒ 2 d fuera, 4 d dentro. **Mutación:** usar el total global en el aviso de una zona ⇒ rojo.
      **(R43, R48, R49, R52, R53, R60)**
      *Depende de: T3.3, T4.1, T1.3.*
- [ ] **T4.3** — `app/api/cron/avisos-diarios/route.ts`, patrón literal de `generar-gastos-fijos`:
      auth por `CRON_SECRET` **antes de construir el service**, `withErrorHandler`, respuesta con
      conteos enumerados campo a campo.
      **Hecho:** `tests/unit/api/avisos-diarios-route.test.ts`: sin cabecera ⇒ 401 y el service **no
      se construye**; secreto no configurado ⇒ 401; 200 con exactamente las claves declaradas y
      ninguna con un identificador de orden, tienda, zona o persona. **(R59, R61)**
      *Depende de: T4.2.*
- [ ] **T4.4** — `vercel.json`: `{ "path": "/api/cron/avisos-diarios", "schedule": "0 13 * * *" }`.
      ⚠️ **`0 13 * * *` es correcto y no se «corrige».** El fichero va en **UTC**; Costa Rica es
      **UTC−6 fijo**; 07:00 CR = **13:00 UTC**. Los crons vecinos usan `0 6 * * *`, que es
      **medianoche CR**, no las seis. Escribir `0 7 * * *` pondría el aviso a la 1:00 de la
      madrugada CR.
      **Hecho:** el JSON valida y el comentario de la conversión queda en el impl.
      *Depende de: T4.3.*
- [ ] **T4.5** — **Composition root**: pasar `notificarNovedadesSinGestionarReal` y
      `notificarDevolucionesRepresadasReal` **como argumento** en el `buildService()` del route
      handler. El default del service sigue siendo `notificadorNoOp`.
      **Hecho:** ampliar `tests/unit/services/notificacion-notificadores-reales.test.ts` para que
      afirme sobre el **uso efectivo** (fuente sin imports ni comentarios) que los dos se PASAN.
      **Mutación obligatoria:** borrar el argumento dejando el import ⇒ rojo. **(R62)**
      *Depende de: T4.3.*

---

## Fase 5 — El listado: catálogo, vigencia, `porHacer` y `cuando`

- [ ] **T5.1** — `lib/types/notificacion.ts`: los seis campos nuevos del DTO y `porHacer` en los
      dos resultados. Todo **aditivo**.
      **Hecho:** `tests/unit/types/notificacion-dto-aditivo.test.ts` construye un DTO con sólo los
      campos vigentes y sigue tipando; `pnpm run typecheck` verde sin tocar ningún consumidor.
      **(R34)**
- [ ] **T5.2** — `lib/interfaces/services/IVigenciaAvisoAgregado.ts` +
      `lib/services/VigenciaAvisoAgregadoService.ts`: resuelve la cifra viva por (evento, actor),
      **acotada al ámbito del actor** (tienda / zona / global), **sólo** para los eventos agregados.
      **Hecho:** `tests/unit/services/vigencia-aviso-agregado.test.ts`: para un evento no agregado
      **no consulta nada**; para `novedades_sin_gestionar` consulta con `actor.usuarioId`; para
      `devoluciones_represadas` con `actor.zonaId` si el rol es `adminSatelite` y con `null` si es
      `maestro`/`admin`. **Mutación:** ignorar `actor.zonaId` ⇒ rojo. **(R57)**
      *Depende de: T4.1, T1.4.*
- [ ] **T5.3** — `lib/services/NotificacionService.ts`: `listar` resuelve `accionable`, `atajo`,
      `titulo`, `detalle`, `cuando` y `porHacer`; oculta los agregados con cifra 0; recompone el
      título con la cifra viva; ante fallo del resolutor **muestra** y registra. El resolutor entra
      **por constructor y es obligatorio** (sin default no-op).
      **Hecho:** `tests/unit/services/notificacion-service.test.ts` amplía con los casos de R8, R9,
      R31, R55, R56, R57 y R58. **Mutaciones obligatorias:** (a) contar no leídas ⇒ R8/R9 rojos;
      (b) resolutor que devuelve siempre 1 ⇒ R55 rojo. **(R8, R9, R31, R55, R56, R57, R58)**
      *Depende de: T5.1, T5.2, T1.1, T1.4.*
- [ ] **T5.4** — `lib/actions/notificaciones.ts`: `buildService()` inyecta el resolutor real.
      **Hecho:** un test afirma que **alguien lo pasa** (familia «el composition root que no
      inyecta»), no sólo que se importa. Y `tests/integration/actions/notificaciones-action.test.ts`
      sigue verde **sin editarla**. **(R65)**
      *Depende de: T5.3.*
- [ ] **T5.5** — Los tests de dedupe contra Postgres real:
      `tests/integration/db/novedades-sin-gestionar-aviso-dedupe.test.ts` y
      `…/devoluciones-represadas-aviso-dedupe.test.ts`.
      **Hecho:** dos corridas el mismo día CR ⇒ una fila por tienda / por (ámbito, rol); día
      siguiente ⇒ el doble; **dos tiendas el mismo día ⇒ dos filas**; **dos zonas el mismo día ⇒ dos
      filas de satélite**. **Mutaciones obligatorias, las tres:** quitar el `tiendaId` del
      `entidadId` ⇒ 1 fila y rojo; quitar el ámbito del `entidadId` de represadas ⇒ las zonas se
      pisan y rojo; poner el id de la orden como entidad ⇒ el aviso del día 2 desaparece y rojo.
      **(R41, R42, R51)**
      *Depende de: T3.1, T3.2.*

---

## Fase 6 — Frontend (no arranca hasta que la Fase 5 esté verde)

- [ ] **T6.1** — `hooks/useNotificaciones.ts`: `NotificacionesData` gana `porHacer`; el degradado a
      vacío ante error lo deja en 0.
      **Hecho:** el hook devuelve `porHacer: 0` ante error, y las suites vigentes pasan sin
      editarse. **(R28)**
      *Depende de: T5.3.*
- [ ] **T6.2** — `components/shared/NotificationsBell.tsx`: disparador con píldora «N por hacer»,
      apagado a cero; panel de 400 px; fila de filtro de dos píldoras; los dos bloques con sus
      encabezados literales; accionables con título, detalle, tiempo y botón; accionables **sin**
      atajo sin botón; informativas sin botón; sin «Anexo:»; **sin pie**; X en ambos bloques;
      cabecera y sonido intactos; y **`useTonoAlIncrementar` recibe `porHacer`**.
      **Hecho:** `tests/components/NotificationsBell.test.tsx` cubre R10–R30 con los literales
      escritos a mano (`"2 por hacer"`, `"Requieren tu acción"`, `"Para tu información"`,
      `"Notificaciones, 2 por hacer"`, `"Gestionar novedades"`), `queryByText(/Ver todas las
      notificaciones/)` a `null`, y el orden de los dos bloques afirmado por posición en el DOM.
      **Mutación:** devolverle `noLeidas` al hook del tono ⇒ R30 rojo. **(R10–R30)**
      *Depende de: T6.1.*
- [ ] **T6.3 [P]** — Guardia `tests/unit/guards/notifications-bell-sin-reloj.guardia.test.ts`: el
      fuente del componente no contiene `Date.now(` ni `new Date(`.
      **Hecho:** reintroducir cualquiera de los dos pone el guard rojo. **(R32)**
      *Depende de: T6.2.*
- [ ] **T6.4 [P]** — Guardias `…-tokens.guardia.test.ts` (ningún `#rrggbb` ni `rgb(`, y
      `focus-visible:ring-3` en cada control enfocable) y `…-ancho.guardia.test.ts` (400 px, ya no
      `w-80`).
      **Hecho:** pegar un hex del `.dc.html` pone el guard rojo. **(R22, R27)**
      *Depende de: T6.2.*
- [ ] **T6.5** — La pestaña de `/novedades` por URL (design §7.2, ~9 líneas en dos archivos):
      `NovedadesTabs` acepta `superficieInicial` y lo reenvía al `defaultValue` que `TabsGroup`
      **ya soporta**; `app/(app)/novedades/page.tsx` lee `searchParams`, valida con zod contra
      `GRUPOS_NOVEDAD` (lista blanca, nunca un `as`) y lo pasa.
      **Hecho:** `tests/integration/actions/novedades-pestana-por-url.test.ts` y
      `tests/components/NovedadesTabs.test.tsx`: con `?superficie=devolucion` la pestaña activa es
      «En devolución»; sin parámetro, «Ayuda»; con `?superficie=chorizo`, «Ayuda» y 200.
      **(R7, R66)**
      *Depende de: nada del panel — puede ir en paralelo con T6.2. Bloquea T1.5.*

---

## Fase 7 — Verificación y cierre

- [ ] **T7.1** — Correr las **nueve mutaciones obligatorias** de `design.md` §9, una a una, y anotar
      **cuántos tests se ponen rojos con cada una**. Un arnés de mutaciones que reporta sin haber
      ejecutado un test ya mintió en este repo: se pega la salida.
      **Hecho:** las nueve matadas, con su conteo, en `progress/impl_409_backend.md`.
- [ ] **T7.2** — `./init.sh` **completo** (el rápido se va a negar: el diff toca `lib/types/**` y
      `db/schema.prisma`).
      ⚠️ **Mirar los `skipped`, no sólo el `INIT_EXIT`.** Sin `DATABASE_URL`, los tests de dedupe,
      los de predicado y el de migración **se saltan** y la ficha quedaría sin verificar donde más
      importa.
      **Hecho:** salida pegada en el impl, con `INIT_EXIT` escrito **dentro** del log, y la línea
      que confirma que los archivos de `integration/db` de esta ficha **corrieron**.
- [ ] **T7.3** — Mapa `R1…R66 → test` completo en `progress/impl_409_backend.md` y
      `progress/impl_409_frontend.md`. Un requisito sin test es hallazgo bloqueante del reviewer.
- [ ] **T7.4** — **Ver la pantalla en un navegador**, en los dos temas, con un lote largo (≥ 20
      avisos: accionables con atajo, **accionables sin atajo**, informativas y un texto largo).
      La suite en jsdom no mide contraste ni desbordes, y ver la app ya encontró siete textos rotos
      que 12.000 tests daban por buenos.
      **Hecho:** capturas y hallazgos en el impl; si no se pudo, se declara como límite, con nombre.
- [ ] **T7.5** — Antes de desplegar, **en solo lectura** contra producción: (a) confirmar que
      `por_devolver` sigue en el orden de magnitud medido (27 órdenes, 7 por encima de 3 d) y decir
      el número; (b) **medir `por_devolver_a_tienda`**, que no está medido — si estuviera represado,
      es un ámbito más del mismo emisor y se registra como ficha aparte, no se cuela aquí.
      Recordar que producción se vació a propósito el 2026-08-25: un cero significa «aún no ha
      pasado», no «está roto».
      **Hecho:** los tres números anotados en el impl, con la fecha.
- [ ] **T7.6** — Commitear el informe. El informe describe el disco, no un commit: verificar el blob
      commiteado en la rama antes de dar la ficha por entregada.

---

## Grafo de dependencias, en corto

```
T2.1 ─► T2.2 ─► T2.3 ─► T2.4 ───────────────────────────────► T2.5 (última, contra origin/dev)
T2.1 ─► T1.4 ─┐
T6.5 ─────────┴─► T1.5
T1.2 ─┐
T2.1 ─┴─► T3.1 ─┐
        T3.2 ───┴─► T3.3 ─┐
T1.3 ──────────────────────┼─► T4.2 ─► T4.3 ─┬─► T4.4
T2.2 ─► T4.1 ─────────────┘                  └─► T4.5
T4.1 ─┐
T1.4 ─┼─► T5.2 ─┐
T1.1 ─┤         ├─► T5.3 ─► T5.4
T5.1 ─┘         │
T3.1,T3.2 ──────┴────────────► T5.5
T5.3 ─► T6.1 ─► T6.2 ─┬─► T6.3 [P]
                      └─► T6.4 [P]
T6.5 [P, independiente del panel]
todo ─► T7.1 ─► T7.2 ─► T7.3 ─► T7.4 ─► T7.5 ─► T7.6
```
