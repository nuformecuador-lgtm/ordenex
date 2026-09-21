# Estado — sesión del 2026-09-21

## Dónde está todo

`prod` = **`9d3d67b5`** (PR #816, la 449 — el fulfillment en el dinero de Analítica).
`dev` = `prod` **+ SF-001 entero** (429–436) con sus 6 migraciones, sin desplegar y a la espera de
que lo pida el humano. **`in_progress` = 0**, 44 fichas `pending`.

Cuatro días sin commits: el último es del 2026-09-17.

## DOS de las cuatro comprobaciones previas a la release de SF-001, CERRADAS POR MEDIDA

### 1. `DIRECT_URL` de producción FUNCIONA — y la premisa que la ponía en duda era falsa

Lo anotado decía que esa credencial «lleva sin ejercitarse desde vaya a saber cuándo» porque la
última release no llevó migraciones. **No es así: cada build de producción la usa, haya migraciones
pendientes o no.** Leído en el log de build del despliegue de `9d3d67b5` (2026-09-17):

```
[migrate] aplicando migraciones (URL de DIRECT_URL)…
Datasource "db": PostgreSQL database "postgres" at "aws-1-us-east-2.pooler.supabase.com:5432"
199 migrations found in prisma/migrations
```

Conectó, autenticó y leyó el historial completo. Y el host es el pooler en modo **SESIÓN (5432)**,
que es justo el que `migrate deploy` necesita por el advisory lock.

**Lo que esto NO prueba**: el permiso de DDL para crear tablas. Es el mismo usuario que aplicó las
199 anteriores, así que el riesgo es bajo, pero no está medido.

### 2. La `DATABASE_URL` de producción NO es el pooler de sesión

`get_runtime_errors` a 7 días: el `EMAXCONNSESSION` aparece **3 veces, todas sobre
`dpl_5jNe4aYgAdW9tHvKBHMpF6JYRn9a`**, que se comprobó que es un **PREVIEW** de la rama `dev`
(`target: null`, alias `ordenex-git-dev-…`) — el incidente del 17-sep, ya resuelto.
**Cero sobre un despliegue de producción.**

> La lección que deja: `get_runtime_errors` agrupa **todo el proyecto**, preview incluido. Un error
> con pinta de producción puede ser de un preview; hay que mirar el `lastDeployment` y resolver su
> `target` antes de atribuirlo.

### 3. `ANTHROPIC_API_KEY`: NO EXISTE en ninguno de los dos entornos

Medido en Vercel (proyecto `ordenex`, `prj_Bv8QDM5HfGPZH8LJYSxeaUWCj6XU`). La pone el humano, como
**dos entradas separadas** (una Production, otra Preview), tipo Sensitive. La de Production no hará
nada hasta que SF-001 salga; **la de Preview sirve ya** para cerrar T25/T26/T27 de la 436 sobre un
preview redesplegado.

### 4. Sigue pendiente: recapturar los números de la 431

`max(updated_at)` y el conteo de `aprobado` en `cierre_bodega`. Caduca sola: se hace justo antes de
abrir la release, no antes.

## La 440: el parche funciona, la causa raíz sigue viva y CRECIÓ

- **El parche, medido:** desde que salió (2026-09-17, 10:14 UTC) hay **cero** apariciones del 25P02
  y del 500 mudo en `/mis-asignaciones/reparto`. Las 27+27 registradas son todas anteriores
  (03:26–04:34 UTC del 17). El taponamiento hizo su trabajo.
- **La causa raíz, medida:** el warning que es su pista —`Calling client.query() when the client is
  already executing a query`— va por **32 ocurrencias y 22 usuarios**, en `/cierre-dia` y
  `/api/cron/corte-diario`, y el último es del **2026-09-20**. Consultas concurrentes sobre la misma
  conexión: el mecanismo que deja una transacción a medias y devuelve la conexión envenenada al pool.

### EL CULPABLE, LOCALIZADO EL 2026-09-21 — dos consultas concurrentes sobre la MISMA conexión

Son **dos sitios, y son los únicos del repo**:

| Archivo | Línea | Qué hace |
| --- | --- | --- |
| `lib/services/WalletFeedService.ts` | 39 | `Promise.all([leerDetallePorOrden(cierreId, tx), tx.gestionOrden.findMany(…)])` |
| `lib/services/WalletTiendaFeedService.ts` | 75 | el mismo `Promise.all`, con `montoRecibido` |

Los dos reciben un **cliente de transacción** (`tx`) y le lanzan **dos consultas a la vez**.
`leerDetallePorOrden` (`lib/utils/cierre-detalle.ts:137`) hace su propio `tx.cierreDetail.findMany`,
así que son dos `client.query()` simultáneos sobre la conexión dedicada de la transacción — que es
**literalmente** lo que el warning de `pg` describe.

Y no es una transacción cualquiera: los llama `CierresAdminRepository.resolverCierre`
(líneas 1823 y 1827) **dentro del `$transaction` abierto en la 1780** — la aprobación del cierre,
la que mueve el dinero de los dos ledgers y la caja.

**Por qué nadie los vio leyendo el código:** el `Promise.all` no está escrito dentro del
`$transaction`, sino en otro archivo que recibe el `tx` por parámetro. Un detector textual que
busque `Promise.all` dentro del cuerpo de un `$transaction` devuelve **cero**; hay que perseguir el
TIPO del parámetro (`*TxClient`). Los dos barridos están en el historial de esta sesión.

**LO QUE SÍ ESTÁ MEDIDO:** que esos dos sitios existen, que son los únicos, y que corren dentro de
la transacción de la aprobación.

**LO QUE ES HIPÓTESIS Y HAY QUE MEDIR:** que sean la fuente del warning que se OBSERVA en
`/cierre-dia` y `/api/cron/corte-diario`, que son rutas de OTRO camino (`CorteDiarioRepository` y
`CierreDiaRepository`, no `CierresAdminRepository`). La explicación candidata es que un
`DeprecationWarning` de Node se emite al stderr del PROCESO, no del request, y con instancias
reutilizadas queda atribuido a la petición que estuviera activa. **No confundir la ruta donde se
LEE un warning con la ruta que lo PRODUCE.** Es lo primero que tiene que resolver el spec.

### La 450: REGISTRADA, IMPLEMENTADA Y REVISADA el mismo día — y la premisa original cayó

Rama `fix/450-tx-una-consulta-a-la-vez`, 7 commits, **sin push y sin PR**. `dev` intacto.

**Lo primero que hay que saber es que la premisa de la ficha se cayó, y eso es un buen resultado.**
El `Promise.all` de los dos feeds **no** ponía dos consultas en vuelo: Prisma 7.8 serializa las
peticiones de una transacción interactiva. Medido: **1 → 1 consultas simultáneas, 0 → 0 avisos**.
El arreglo se aplicó igual por forma (`pg@9` convertirá el aviso en error) y su prueba pasó a ser un
doble vigilado que sí se mueve: revertido el arreglo, 2 en vuelo y 1 solape.

> **El corolario, por si alguien lo lee al revés:** en `pg@8.22.0` el aviso salta sólo si la cola ya
> tiene una consulta esperando (`lib/client.js:714-717`, con el `shift()` de `_pulseQueryQueue` en
> 603-624). La 1.ª pasa a activa y deja la cola en 0; la 2.ª encuentra 0 y **no avisa**; la 3.ª sí.
> **El aviso necesita tres consultas; el defecto del `25P02` necesita dos.**

**El emisor real quedó NOMBRADO y SECUENCIADO:** `lib/repositories/CierreDiaRepository.ts`, la
lectura del snapshot con `SNAPSHOT_SELECT` dentro del `$transaction` de `crearCierre`. Eran 5
relaciones anidadas que Prisma expandía a 1+5 consultas lanzadas a la vez; ahora proyecta los FK y
lee los cinco catálogos en serie. **5 en vuelo y 4 solapes con el aviso capturado → 1 y 0.** Y cuadra
con dónde se leía: `crearCierre` es el único punto por el que pasan `/cierre-dia` y
`/api/cron/corte-diario`.

El candidato que yo daba por fuerte —`ConteosPublicosRepository.ts:22`, tres consultas en la
landing— **no reproduce**: 1 en vuelo. Se midió antes de tocarlo.

**Gate completo, dos veces en verde.** El último: `INIT_EXIT=0`, 2057 archivos, **29.990 tests**, 26
saltados (los 17 de `AnaliticaPage` y los 9 de `AnaliticaShell`, ajenos) y **284 archivos de
`integration/db` con cero saltados** — las sondas se ejecutaron de verdad.

**Revisión: OK tras dos rechazos**, los dos de papeleo. Detalle y lo verificado ejecutando en
`progress/review_450.md`. El segundo bloqueante merece recordarse: la nota de `docs/release.md`
quedó **invertida** tras secuenciar («>0 es lo ESPERADO» cuando ya era al revés), y quien mirase los
logs el día 7 habría leído el resultado del lado contrario.

**Autorizaciones del humano, para no reabrirlas:** alcance «todo dentro de la 450» (no se parte);
cierre por contador determinista + gate completo, con la observación de producción **fechada** y no
bloqueante; y vía «leer en serie» para T2.7, con permiso para ampliar los dobles. Ese permiso se
aplicó a **cinco** suites y no a las dos nombradas, porque las cinco fallaban por la causa idéntica
(`TypeError: reading 'findMany'`); se respetó la línea roja: **cero aserciones tocadas**.

**LO QUE QUEDA VIVO Y ES EL SIGUIENTE ESCALÓN:** 6 lecturas que lanzan **dos** consultas hermanas
sobre un `tx`, en `CierreDiaRepository`, `CierresAdminRepository`, `LiquidacionPagoRepository` y
`UserRepository`. No disparan el aviso, pero **dos consultas compartiendo conexión son la condición
del `25P02` de la 440**. Censadas por el brazo C de la guardia; fuera del alcance de la 450.

## La 451 — los paquetes sin gestionar no se piden escanear (BORRADOR, sin registrar)

Pedida por el humano el 2026-09-21. La ventana de confirmación física de un cierre se construye
desde **gestiones**, filtrando por `RESULTADOS_QUE_VUELVEN`. Una orden **sin gestionar** no tiene
resultado, así que no existe en esa lista y nadie la escanea — aunque al aprobar, la liberación de
la feature 109 **sí** la manda a bodega en la misma transacción. El sistema da esos paquetes por
recibidos sin pedir prueba.

**Medido contra producción el 2026-09-21:**

| | |
| --- | --- |
| Filas en `cierre_sin_gestion` | **185**, en **14 cierres** (174 órdenes distintas) |
| Sin `num_guia` | **0** — todas escaneables hoy |
| Ventana | 2026-08-27 → **2026-09-19** |
| Esos 14 cierres | **todos aprobados** |
| Escaneados / NO escaneados en ellos | **50** / **185** |

**El 78,7 % del bulto que volvía a bodega en esos cierres se aprobó sin que nadie lo confirmara.**

**Decisión del humano (2026-09-21):** se escanean igual que reprogramadas, devueltas y rechazadas, y
**mientras falte uno el cierre no se aprueba** — misma regla, sin salida de emergencia.

**Los dos puntos delicados del diseño, para el spec:**

1. El punto único de «qué vuelve a bodega» es hoy un `Record<GestionResultado, boolean>` exhaustivo
   a propósito (si el enum crece, el repo no compila). Una orden sin gestionar **no es** un
   `GestionResultado`, así que no cabe dentro. Hay que extender el concepto a dos orígenes
   —gestiones y barridas— **sin** crear una segunda lista suelta: ya existe una guardia que
   persigue esas copias.
2. `cierre_sin_gestion.num_guia` admite NULL. Hoy hay **cero** en producción, pero si aparece uno
   ese cierre sería imposible de aprobar. Reutilizar el criterio ya resuelto para las gestiones sin
   guía: avisar **antes** de empezar a escanear, no dejar que bodega descubra el bloqueo al final.

## La 448 está bloqueada por una decisión, no por trabajo

El diseño cuenta **órdenes** (91) y `ConteoDevolucionesRepository` cuenta **gestiones**, y su propia
cabecera declara que sus totales no tienen por qué cuadrar con el anillo de arriba. Subirlo al lado
del héroe heredaría esa discrepancia en la misma fila.

Recomendación pasada al humano: **órdenes** — la pregunta que responde el panel es «de las que no
llegaron, ¿cuántas fue por no ubicar al cliente?», y una orden con tres intentos fallidos es un
problema, no tres. **Pendiente de su decisión.**

## Sin commitear en el árbol

7 carpetas `design-*` (analitica, asistente, ayuda, etiquetas, filtros, satelites, sinpe) y ~35 logs
de `progress/`. `design-notificaciones` sí está trackeado, así que el precedente es que se commitean.

## Gate de arranque de esta sesión

`./init.sh --rapido` sobre `dev` limpio: **`INIT_EXIT=0`**, 240 archivos / 3466 tests, cero fallos,
`DATABASE_URL resuelta` — los 195 archivos contra Postgres SÍ se ejecutan
(`progress/gate_21sep_arranque.log`).

---

## Estado anterior — sesiones del 2026-09-10 al 17

## RESUELTO — los deploys de PREVIEW volvieron el 2026-09-16

Estuvieron caídos **unas 20 horas** (desde las 02:33 UTC). Producción nunca se vio afectada.

**El fallo tenía DOS causas encadenadas, y la segunda estaba escondida detrás de la primera.**

1. **P3009.** La migración `20260918120200_zona_sinpe_no_nulo` encontró las columnas vacías y abortó
   —lo diseñado—, pero ese fallo queda registrado y desde entonces todo `migrate deploy` se negaba.
   Se resolvió con `migrate resolve --rolled-back` + `seed-sinpe-inicial.ts` contra la base de preview.
2. **P1000, autenticación.** Al levantar la primera, apareció la segunda: `DATABASE_URL` y
   `DIRECT_URL` de preview en Vercel llevaban **51 y 58 días** sin tocarse y su contraseña ya se había
   regenerado. Se reescribieron las dos. Redespliegue: `✓ Ready in 2m`.

**Tres cosas que costaron tiempo y conviene no volver a aprender:**

- El host directo de Supabase (`db.<ref>.supabase.co`) **sólo resuelve por IPv6** y esta red no lo
  enruta (100 % de pérdida). La vía que funciona es el *session pooler*
  (`aws-0-<region>.pooler.supabase.com:5432`), que sí tiene IPv4. Queda guardada en `.env` como
  `DATABASE_URL_PREVIEW` — deliberadamente NO como `DATABASE_URL`, que apunta a la base local y es la
  que usan todos los gates.
- **Un error puede tapar a otro.** Dar por arreglado tras levantar el primero habría dejado el preview
  igual de caído, y con la sensación de haberlo resuelto.
- **En producción la que hay que mirar es `DIRECT_URL`, no `DATABASE_URL`.** La de ejecución está
  probada sola: `ordenex.co` sirve a gente real cada día, así que es válida. Pero `DIRECT_URL` la usa
  **sólo `migrate deploy`**, y la última release —la 428, del 2026-09-15— fue 100 % de presentación,
  **sin una sola migración**: esa credencial lleva sin ejercitarse desde vaya a saber cuándo. La
  release de SF-001 **sí trae migraciones** (429 y 431). Es exactamente la forma del fallo de preview:
  una credencial que nadie tocó en meses y que sólo se descubre rota cuando hace falta. **Comprobarla
  antes de abrir la release, no durante.**

**El arreglo de fondo sigue pendiente: la ficha 432** — que la siembra corra DENTRO de
`migrate-deploy.ts` en vez de depender de que alguien la ejecute a mano entre dos migraciones.
Committeada en `fix/432-siembra-dentro-del-despliegue` (`c6467fe5`), **sin gate y sin mergear**.

---

## PREVIEW: entra, funciona, y de paso destapó un fallo mío (2026-09-17)

**Entrar ya se puede.** Faltaba `AUTH_RISK_THRESHOLD=999` en el entorno Preview de Vercel —producción
sí lo tenía— y sin él pedía un código de 6 dígitos que se manda a `@ordenex.test`, un dominio que no
recibe nada. Puesta con autorización del humano.

**Y al entrar apareció esto**, que llevaba horas ahí sin que nadie lo viera:

```
DriverAdapterError: (EMAXCONNSESSION) max clients reached in session mode
— max clients are limited to pool_size: 15
```

**Es un fallo que introduje yo el 2026-09-16** al reparar las credenciales de preview: le puse el
*session pooler* (**5432**) como `DATABASE_URL`. Ese modo tiene **15 plazas** y en serverless se
agotan. La app en Vercel va por el de **transacción (6543)**; el de sesión es SOLO para
`DIRECT_URL`/migraciones.

**Lo que se veía, y por qué engaña:** 500 intermitentes en rutas cualesquiera y **el botón «?»
desaparecido** —su `try/catch` se tragaba el fallo y devolvía un mapa vacío—. Parecía un defecto de la
ficha recién mergeada. No lo era.

**Dos cosas que lo hacen peor de lo que suena:**

1. **Se realimenta.** Las funciones del despliegue malo siguen ocupando las 15 plazas, y como el build
   migra por el MISMO pooler de sesión, **ningún despliegue nuevo puede entrar** hasta que drenen.
   Un despliegue no arregla el despliegue: hay que esperar.
2. **`pg_stat_activity` no lo ve.** El tope es de Supavisor, no de Postgres: por SQL se ven 5 o 6
   conexiones y todo parece en calma.

**Arreglado y verificado:** `DATABASE_URL` de preview → 6543; `DIRECT_URL` se queda en 5432.
Redesplegado. Comprobado con sesión real sobre Vercel: `/ayuda` con sus 33 enlaces, tres documentos
rindiendo con los mismos tamaños exactos que en local (3937 / 3033 / 2091 caracteres), el «?»
resolviendo en dos pantallas distintas, y **cero errores de consola**.

**Con eso queda cerrada por medida la única duda que el gate no puede responder:** leer los `.md` con
`fs` **funciona en serverless**. Era el fallo mudo clásico —verde en local, 404 en producción— y no
ocurre.

**Comprobar antes de la release:** que la `DATABASE_URL` de producción NO sea el pooler de sesión.
Lleva 51 días sin tocarse y sirve tráfico real, así que casi seguro es la de transacción — pero
«casi seguro» no es medido.

---

## EN CURSO — SF-001, las cuatro funcionalidades nuevas

**Las cuatro aprobadas, ninguna prioritaria sobre otra.** Diseño de cada una revisado contra el código
y escrito en `progress/design_sf001_p{1,2,3,4}_*.md`.

### Dónde va cada una (2026-09-16)

| Punto | Ficha | Estado |
| --- | --- | --- |
| **2** · SINPE por bodega | 429 | ✅ **`done`**, en `dev`. PR #799. Revisión rechazada y levantada |
| **3** · Contacto anticipado | 430 | ✅ **`done`**, en `dev`. PR #800. Revisión OK |
| **1** · Cierres de satélite | 431 | ✅ **`done`**, en `dev`. PR #801. Revisión OK tras relevo del frontend |
| **4a** · Módulo de documentación | 433 | ✅ **`done`**, en `dev`. PR #802. Revisión rechazada y levantada |
| **4b** · Asistente | 436 | ✅ **`done`**, en `dev`. PR #806. Revisión rechazada y levantada |

**SF-001 ESTÁ COMPLETA EN `dev`.** Nada desplegado a producción, como se acordó: las cuatro salen
juntas. Fichas de apoyo que salieron por el camino y también están en `dev`: **432** (el despliegue se
desatasca solo), **434** (las tres pantallas sin ayuda) y **435** (la oficina lee la ayuda de los
portales que atiende).

### Lo que hay que hacer ANTES de abrir la release

1. **`DIRECT_URL` de producción**: es la credencial que sólo usa `migrate deploy`, y la última release
   no llevó ni una migración. Ésta trae cinco. Comprobarla antes, no durante.
2. **Que la `DATABASE_URL` de producción NO sea el pooler de sesión** (5432, tope 15). Es el fallo que
   tumbó preview durante horas.
3. **`ANTHROPIC_API_KEY` en Vercel**, preview y production **por separado**. Sin ella, T25/T26/T27 de
   la 436 no se pueden cerrar.
4. **Recapturar los números de la 431** (`max(updated_at)` y el conteo de `aprobado` en
   `cierre_bodega`): medidos el 2026-09-17 daban 35 aprobados, ninguno con campos nulos — pero la
   referencia caduca sola.

### El frontend de la 431 tuvo un relevo

El primer agente **murió por límite de cuota** mientras hacía T23. Dejó **39 archivos sin commitear**
—2.395 líneas, las pantallas ya creadas— que se rescataron en el commit **`900fa7b6`** de la rama
`worktree-agent-a1ae1bb85ec71588a`. **Ese commit NO está verificado**: sin gate, sin typecheck, sin
mutaciones. El relevo tiene el encargo de auditarlo antes de construir encima.

**CONDICIÓN DEL HUMANO, aplica a las cuatro:** nada sale a producción hasta estar seguros de que no
hace daño a lo que ya funciona. Tres de las cuatro tocan cosas vivas — el control del efectivo, el
número al que los clientes transfieren, y la regla que impide entregar antes de tiempo.

### Orden de trabajo acordado: tres vías en paralelo

| Vía | Trabajo | Migración | Paralelizable |
| --- | --- | --- | --- |
| **A** | punto **2** (SINPE) → luego punto **1** (cierres) | sí, las dos | con B y C |
| **B** | punto **3** (contacto anticipado) | no | con A y C |
| **C** | punto **4** — los 33 documentos de ayuda | no toca código | con todo |

**Por qué 1 y 2 van en serie y no en paralelo, y NO es lo que dice el documento.** El documento afirma
que «tocan las mismas áreas del sistema»: es falso, no comparten un archivo — comparten la palabra
(en cierres «SINPE» es un medio de pago, `total_simpe`; en plantillas es el número). El choque real es
otro: **las dos necesitan migración**, y en este repo dos worktrees con migraciones distintas contra la
misma base local se rompen el gate el uno al otro.

### Reglas de esta tanda

- **Toda superficie NUEVA pasa por `/design`** antes de implementarse (pedido del humano). Son tres:
  `/wallet/satelites`, la pantalla de configuración del SINPE, y el módulo de documentación + chat.
- **Primero los documentos, después el asistente** (punto 4). Los escribe Claude verificando contra el
  código —documentación inventada es peor que ninguna—, y cada `.md` cita de dónde sale lo que afirma.
- Se empieza por el **mundo del mensajero**: 18 de los 37 usuarios, solo 4 superficies.

### Autorizaciones del punto 4

- **Costos de operación: AUTORIZADOS** por el humano el 2026-09-15.
- **Datos de clientes a un proveedor externo de IA: AUTORIZADO** por el humano el 2026-09-15
  («se asume lo de los datos del punto 4»).
- **Modelo: Sonnet 5.** No se preguntó: el documento lo recomienda y el humano aprobó el documento.
  Revisable cuando se mida el uso real — con caché de prompt el coste puede cambiar el cálculo.
- Cuando toque, hay que montar cuenta con crédito + clave de API como variable de entorno en Vercel,
  **separada por entorno** — ver la nota de las variables mal repartidas.

### Sigue sin leerse el PDF firmado

No hay visor de PDF en la máquina y la conversión por Word no terminó. El contenido se leyó del `.docx`
del 14 (`R:\job\singularis\admin\`), que es el borrador con las casillas vacías. El humano confirmó de
viva voz que se aprobaron las cuatro.

---

## Desplegado en producción — release del 2026-09-15 (2.ª), la 428

`prod` = **`efd06fb4`** (PR #798, merge commit con 2 padres, no squash) ·
`dpl_3oHKLtGvYMPKHvap4TPRhpkTnsPD` **READY** · alias `ordenex.co` con `aliasError: null`.
Recorrida completa en `docs/release.md` («Release del 2026-09-15 (2.ª)»). La 428 queda `done`;
`in_progress` = 0.

Los dos conmutadores de ORDEN de `/ordenes` pasan a solo icono + tooltip: ocupaban ~800 px de los
~1480 de la fila y empujaban «Filtros» a una tercera línea. Opt-in (`SegmentedToggle.soloIcono`,
default `false`); solo lo pasa `OrdenesListado`, los otros 8 consumidores no cambian.

Gate completo sobre `7c4b77ee`: 1975/1975 archivos, 28.858 tests, **cero saltados**. Revisión OK,
8 mutaciones y 8 muertas. El humano verificó la pantalla antes de mergear.

### Lo que quedó SIN MEDIR en esta release

**Los errores de runtime.** `get_runtime_errors` dio timeout dos veces (1 h y 24 h). No es «cero
errores»: es que no se midió. `ordenex.co`, `/login` y `/sw.js` sí respondieron 200.

### Dos cosas que muerden más adelante

- **La red contra poner `soloIcono` en global es UNA sola** (`segmented-toggle-solo-icono.test.tsx`).
  Con el default en `true`, los tests de las otras pantallas siguen VERDES: localizan por nombre
  accesible y ese se preserva.
- Los dos costes de la 428 los aceptó el humano con los números delante —sin hover en móvil; la
  misma flecha con dos significados—. Se le ofrecieron dos variantes más conservadoras y las
  descartó: **no reproponer**.

Anotado y FUERA de la ficha: el naranja `brand-outline` de «Descargar» y del botón de columnas
compite con el naranja de selección (22 tablas), y `ColumnasPopover` y «Filtros» usan el mismo
icono `SlidersHorizontal` a 40 px uno del otro (12 pantallas).

### Worktrees: 1,2 GB huérfanos

`.claude/worktrees/agent-a0e69447ad05ef4a8` ocupa **1,2 GB y NO está en `git worktree list`**: es
una huérfana ya desregistrada, el fallo conocido de `worktree remove` con rutas largas. Quedan
además 16 worktrees registrados (ramas de la 366 a la 422), sin purgar por no borrar trabajo ajeno
a ciegas.

---

## Desplegado en producción y VERIFICADO — release del 2026-09-15

**`prod` = `1ab83dd5`** (PR #796, merge commit con 2 padres) · despliegue
`dpl_8MuD5fsVkFAVSRJ7mvQCh6ufWQJP` READY · recorrido completo, con su evidencia, en `docs/release.md`
(«Release del 2026-09-15»). Las cinco fichas quedan `done`.

| Ficha | PR | Qué |
| --- | --- | --- |
| **423** | #791 | ordenar las tablas de órdenes por número de remisión (orden natural, columna generada) |
| **426** | #792 | una ruta de api con la sesión vencida responde 401 JSON, no HTML |
| **424** | #793 | el admin vuelve a poder eliminar órdenes, con rastro en el historial |
| **427** | #794 | traspasar a otro mensajero las órdenes que alguien ya lleva encima |
| **425** | #795 | los rechazos de la tienda llegan al cierre del mensajero, sin cobrarse |

Salió **después del corte de medianoche** por decisión del humano: Carlos Cambronero y Kendall Hernández
habían pedido su cierre antes, y con la 425 activa en el corte habrían amanecido sin poder recibir trabajo.

### Lo que toca mañana (no esta noche)

- **V5 de la 425** sobre el primer cierre que traiga rechazos: `total_pago_mensajero` = Σ del pago de las
  gestiones con `cierre_id`, y ningún rechazo con `cierre_id`. No vale si antes se aprueba el cierre del
  11/09 de Arnel: sus tres órdenes saldrían por ese.
- **Primera noche con la 425** (corte del 16/09): Andy Cortés y Arnel Guillen recibirán un `vencido` con
  sus rechazos. Se saca con «Destrabar cierre vencido» y después «Aprobar».

### Hecho A MANO contra producción el 2026-09-14 (y nada más)

- **29 remisiones de Sicommer** renombradas de `REMISIÓN DE VENTA #NN` a `SC-0NN` (su número de
  siempre). Causa: la fila `REM … FECHA …` no cabe en la etiqueta de 100 × 100 con más de 20
  caracteres. 0 colisiones, 0 cierres afectados, `busqueda_texto` recalculada sola.
- **31 órdenes `en_reparto` + sus 31 conversaciones** de Andy Cortés a Carlos Eduardo (Andy se enfermó).
  Las 37 entregadas y las 24 `devolviendo_a_tienda` de Andy **no se tocaron**. Es el caso que originó
  la 427.

### Lo que sigue abierto y es del humano

- Los **25 rechazos sin `ingreso_bodega_rechazo`** (~₡4.000): decidir ahora que la 425 está fuera.
- El correo con las **4 funcionalidades nuevas** (cierres de satélite, SINPE por bodega, mensajes el día
  anterior, documentación + asistente con IA): pendiente de aprobación del cliente; no se toca nada
  hasta entonces.

### Seguimientos técnicos (ninguno bloquea)

- La **carrera entre el R9 de la 412 y el N/V de la 271**: rojos falsos en el gate; ficha aparte.
- **425:** tres casos que faltan en el test del `WHERE` (un rechazo anulado, uno con `cierre_id` y uno
  de otro mensajero). Hoy los protege el literal del predicado.
- **427:** la lista de destinos es solo de zona central (no sirve a una satélite); un mensajero sin
  vehículo aparece habilitado; «Se movieron 1 orden»; la `$transaction` anidada del arnés de M1.

### Del entorno, para no re-diagnosticar

- **Flake:** `ranking-snapshot-migration.test.ts` con `40P01` (deadlock) cambia de bloque entre
  corridas y es verde aislado. No es de ninguna ficha; no va al baseline.
- Una **release entre las 00:00 y las 00:30 CR** deja dos `analitica_rollup_diario` pendientes, y es
  correcto: la siembra del build planta la clave del día antes de que el rollup la encadene, y el
  `ON CONFLICT DO NOTHING` impide el duplicado.
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
