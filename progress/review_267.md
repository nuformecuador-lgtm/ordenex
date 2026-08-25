# review 267 — analitica de la propia tienda por API key

> Reviewer, 2026-08-23. Worktree `C:/w267`, rama `feature/267-analitica-api-key`,
> 5 commits sobre `origin/dev` (`39115008`), PR #481 ABIERTO y sin mergear.
> No se edito codigo. Todo lo que se toco para reproducir se restauro y se verifico
> (`git status --porcelain` vacio; md5 del handler `ed176ceaae4b7cd021cfa5492bd338a9`
> antes y despues).

## VEREDICTO: **RECHAZADO**

Un hallazgo BLOQUEANTE. Todo lo demas —las tres guardias, el aislamiento por tienda,
la identidad, la reversion del muro de roles, el contrato— esta bien hecho y verificado
por mi, no por la bitacora.

---

## Checklist

### Especificacion
- [x] `specs/267-analitica-api-key/requirements.md` con 44 requisitos EARS numerados R1–R44.
- [x] `design.md` con alternativas descartadas y su porque (la columna `apiKey` en las 25
      metricas; los presets; la quinta variante de `AlcanceDatos`).
- [ ] `tasks.md` **no usa casillas**: cero `[x]` en el archivo. Las T0–T10 se declaran hechas en
      `progress/impl_267.md` (tabla) y yo las verifique una a una contra el codigo, pero el
      checkpoint literal «todas marcadas [x]» no se cumple. Ver hallazgo `menor 1`.

### Trazabilidad
- [x] Los 44 requisitos tienen aserto real. Abri los asertos; no me fie de la tabla.
- [ ] Tres filas de la tabla R -> test de `design.md:472-517` **nombran tests que no existen**
      con ese nombre (R8, R10 -> `tests/unit/api/analitica-api-key-alcance.test.ts`, archivo
      inexistente; R12 -> un caso de `cache-clave.test.ts` que no esta). Los asertos
      EQUIVALENTES si existen y los verifique. Ver hallazgo `menor 2`.
- [x] `progress/impl_267.md` remite al mapa; el mapa vive en `design.md`.

### Verificacion ejecutable (corrida por mi, no leida)
- [x] `tests/unit/analytics` + `tests/unit/api` + el test de acciones + `intentos-no-alcance` +
      `menu-visibility`: **163 archivos / 1939 tests / 0 rojos** (29 s).
- [x] Las tres guardias de frontera, en aislado: **3 archivos / 49 tests verdes**.
- [ ] `./init.sh` no se corrio: el leader ya midio el gate completo (typecheck y lint verdes;
      63 rojos = 61 preexistentes en `origin/dev` + 2 flakes que pasan aislados). Aceptado como
      contexto, no re-medido, por instruccion expresa.

### Datos y seguridad
- [x] Sin migracion, sin `db/schema.prisma`, sin RLS que revisar (R44): el diff no toca `db/`.
- [x] `middleware.ts` intacto (R41): no esta en el diff; la guardia de la 229 no se toca.
- [x] Sin secretos. La key, su hash y el header `Authorization` no cruzan a `lib/api/` ni al
      logger: el unico que ve el secreto es `extraerBearer` y se lo entrega solo al autenticador.
- [x] Sin webhook nuevo, luego no aplica firma/idempotencia.
- [x] Sin hardcode de contexto (pais, moneda, cuenta).

### Capas
- [x] El route handler no consulta la base ni nombra servicio/repositorio: delega en
      `lib/api/analitica-integrador.ts`. Esto lo COMPRUEBA la guardia de 126/R1, que no se toco.
- [x] El borde no toca HTTP (ni Request, ni Response, ni status).
- [x] Sin SQL crudo en el camino nuevo (verificado por grep sobre `lib/api/` y
      `app/api/ordenes/api-key/analitica/`).

---

## 1. La reversion del muro de roles — OK

- El invariante de exhaustividad **sigue vivo y se refuerza**: la particion pasa de binaria a
  TERNARIA (`ROLES_ANALITICA` 5 + `ROLES_ANALITICA_INTEGRACION` 1 + `ROLES_SIN_ANALITICA` 0) y
  el guardia `alcance-fuente-unica.guardia.test.ts` exige ahora union == los seis `RolValue`
  **y disyuncion dos a dos**, con autocomprobacion que contamina copias locales y comprueba que
  el invariante viejo (solo union) NO habria visto el fallo. Eso es estrechar, no relajar.
- La decision quedo **escrita dentro** de `lib/analytics/alcance.ts:93-126` y del propio guardia,
  con el texto anterior de 122/R11-D9 citado literal y fechada 2026-08-23.
- `ROLES_SIN_ANALITICA` se conserva vacia, tipada y **consultada** en `resolverAlcance:237`; hay
  aserto que lo exige (R5).
- **Ninguna via de rebote por la lista vacia**: la unica referencia a esas constantes fuera de
  `alcance.ts` es un COMENTARIO en `lib/analytics/entregas-conteo.ts:159`. Ese resolutor deniega
  `apiKey` por `esRolAnalitica`, no por la lista, asi que vaciarla no le cambia nada
  (comprobado en `entregas-conteo.ts:178-205`). Los otros dos llamadores directos de
  `resolverAlcance` —`lib/analytics/presentacion.ts:133` y `lib/services/TableroDiaService.ts:80`—
  usan la aridad de siempre, luego canal `interno` y `apiKey` sigue denegado.
- R7: `ROLES_ACCESO_ANALITICA` y el menu no se tocan; hay caso que lo afirma.

## 2. Las TRES guardias de frontera — OK, y verificadas por reproduccion

Por cada una:
- **censo POR CODIGO intacto y barriendo `app/api` entero, camino autorizado incluido**:
  - `operativa-frontera.guardia.test.ts`: el censo se refactoriza a `infractoresDeConsulta` +
    `entradasDeAppApi()` y sigue aplicandose a **todos** los archivos de `app/api`, sin
    excepcion nominal ninguna. Aqui no hay allowlist: la prohibicion NO se toco.
  - `export-csv-frontera.guardia.test.ts`: `porCodigo = infractores(DIR_API, EXPORT_DE_ANALITICA)`
    queda literalmente igual; solo `porRuta` gana la excepcion.
  - `tablero-operativo-frontera.guardia.test.ts`: su caso de `app/api` siempre fue POR RUTA (su
    censo por codigo mira `app/(app)/analitica`, no `app/api`); el codigo de `app/api` lo cubre
    el guardia hermano. No hay perdida de cobertura.
- **la excepcion es por NOMBRE DE RUTA, no por conducta**: la constante
  `HANDLER_ANALITICA_AUTORIZADO = "app/api/ordenes/api-key/analitica/route.ts"` es un camino
  entero, no un patron, y hay caso que exige que el archivo EXISTA (una allowlist apuntando a un
  archivo borrado seria una puerta abierta a nombre libre).
- **decision fechada dentro y razonamiento original conservado**: si, en los tres, con la fecha
  2026-08-23, la cita de P6, el descarte expreso de renombrar la ruta y el parrafo original de
  la 134/131 palabra por palabra encima.

**Autocomprobaciones negativas reproducidas por mi, sobre el arbol real:**
- (a) cree `app/api/reportes/analitica/route.ts` (trivial, sin analitica en su codigo) =>
  **2 archivos rojos / 4 casos rojos** (tablero + export-csv). Cae por la ruta, como debe.
- (b) al camino AUTORIZADO le anadi un import de `@/lib/analytics/serie` y un literal
  `"export.csv"` => **2 casos rojos** en export-csv, incluido «el censo POR CODIGO sigue vivo
  SOBRE EL PROPIO camino autorizado». La excepcion es para el nombre, no para la conducta.
- (c) extra mia: al camino autorizado le anadi un import de `AnaliticaOperativaService` =>
  **`operativa-frontera.guardia.test.ts` rojo (2 casos)**. La prohibicion de 126/R1 sigue
  mordiendo al handler autorizado.
- Arbol restaurado y verificado: `app/api/reportes/` borrado, md5 del handler identico,
  `git status --porcelain` vacio.

Ademas se anade un bloque ADITIVO util: «existe exactamente UN borde por canal», que congela los
tres llamadores de `prepararConsultaAnalitica` y exige que **solo** el borde publico escriba
`api_key` y que **ningun** borde de sesion lo escriba. Ese aserto es el que impide que abrir el
canal por API key acabe abriendo el de cookie.

## 3. El canal como tercera condicion — CORRECTO EN LO QUE CUBRE, con un agujero (ver BLOQUEANTE)

- La concesion del rol de integracion exige rol **y** canal `api_key` **y** metrica en la
  lista blanca, en ese orden (`alcance.ts:245-257`), con el canal ANTES de la metrica para que
  una metrica publicable no se cuele por sesion. Verificado con test propio.
- **Una sesion con cookie de la cuenta `apiKey` sigue denegada**: comprobado en las dos Server
  Actions (`analitica-operativa-api-key-denegado.test.ts`) y en el resolutor para las 25 metricas
  y para cualquier valor de canal distinto del autorizado, incluidos variantes de mayusculas y
  guiones.
- El default `interno` no cambia a ningun llamador existente: los tres llamadores previos
  (`analitica-operativa.ts` x2, `analitica-financiera.ts`) siguen con la aridad de siempre y esos
  archivos NO estan en el diff. `lib/actions/` intacto => R43 sostenido por ausencia de cambio,
  no por promesa.
- Vias de salto buscadas activamente y NO encontradas: sin SQL crudo en el borde nuevo; sin
  repositorio nuevo; el borde usa el MISMO servicio, repositorio y cache; el tipo opaco
  `ConsultaAnalitica` no se fabrica en ningun sitio nuevo; `alcance-obligatorio.guardia` sin
  excepciones nuevas.
- **Lo que si encontre es la via simetrica: el canal `api_key` no exige que el rol sea el de
  integracion.** Ver BLOQUEANTE 1.

## 4. Aislamiento por tienda — OK

- El sujeto sale SIEMPRE de `actor.usuarioId` (`alcance.ts:256`). No hay parametro de peticion
  que lo amplie: el handler lee la query **clave por clave** y solo lee `metrica`, `desde`,
  `hasta` (`route.ts:114-118`) —`tienda_id`, `zona_id` y `mensajero_id` no tienen linea que los
  lea— y el schema es estricto.
- Aunque llegaran por dentro, `recortarFiltro` interseca y devuelve 403 (nunca 200 vacio); hay
  caso que lo prueba.
- **Clave de cache**: `claveDeConsulta` incluye el alcance (`a=tienda:<usuarioId>`) ademas del
  filtro. Dos integradores distintos producen claves distintas por construccion; el guardia
  `cache-clave-alcance.guardia.test.ts` congela el switch exhaustivo sin `default` y que el id
  entra en la clave. No comparten entrada.
- Verificado que dos actores `apiKey` distintos resuelven a sujetos distintos (aserto de la
  feature, no solo prosa).

## 5. La lista blanca — OK

- 10 ids por INCLUSION. Los asertos se DERIVAN del catalogo, no de una copia: R17 (nada
  financiero), R18 (nada prohibido para `adminTienda`), R19 (nada declarada), R34 (nada moneda)
  y **el aserto derivado del grano `tienda`**, que existe (`publicacion-api-key.test.ts:74-76`)
  y **muerde**: sale del `granos` del catalogo, no de la lista.
- Las dos exclusiones tecnicas estan JUSTIFICADAS Y SON CIERTAS: comprobe en
  `lib/analytics/metrics.ts` que `sin_gestionar` (`:256`) y `primer_intento_ok` (`:386`) declaran
  `granos: ["fecha","zona","mensajero"]`, sin `tienda`. Si alguien las metiera en la lista, el
  aserto del grano se pone rojo.
- R20 probado con una metrica sintetica que cumple los cuatro criterios duros y aun asi NO se
  publica: la lista es de inclusion de verdad.
- R21: la lista es de IDS; no hay literal de tabla de alcance por rol y el censo de fuente unica
  no encuentra una segunda tabla.

## 6. Identidad — OK

- El canal viaja SIEMPRE con politica `seudonima`, escrita EXPLICITA para el rol de integracion
  y, ademas, el fallback general se invierte de `real` a `seudonima` (`consulta.ts:212-219`). Es
  estrictamente mas restrictivo: los cinco roles lectores se resuelven antes y no cambian.
- El DTO **no proyecta `dimension`** y hay caso que mete un uuid real de mensajero en la
  dimension y comprueba que no cruza; y otro que censa la cadena serializada entera buscando
  uuid. Ningun `mensajeroId` real puede salir.
- El oraculo de la 126 se REUTILIZA (no se reimplementa) y devuelve 403 auditado si el filtro
  nombra `mensajero_id`.

---

## Hallazgos

### BLOQUEANTE 1 — por el canal `api_key`, la lista blanca y el recorte a UNA tienda dependen del ROL de la cuenta, no del canal

Donde: `lib/analytics/alcance.ts:245-279`.

`resolverAlcance` aplica la lista blanca y el recorte `tienda: actor.usuarioId` **solo dentro de
la rama `esRolAnaliticaIntegracion(rol)`**. Si el actor que llega por el canal `api_key` tiene
cualquier otro rol, cae a la rama de los cinco roles lectores y el alcance sale del CATALOGO,
sin pasar por `esMetricaPublicableApiKey`. Reproducido por mi (test efimero, ya borrado, arbol
restaurado):

    resolverAlcance({usuarioId:"u-key", rol:"maestro"},    "cod_recaudado", "api_key")
      => { estado:"ok", alcance:{ tipo:"global" } }        // metrica FINANCIERA, TODOS los inquilinos

    resolverAlcance({usuarioId:"u-key", rol:"adminTienda"}, "sin_gestionar", "api_key")
      => { estado:"ok", alcance:{ tipo:"tienda", tiendaId:"u-key" } }   // metrica NO publicable

Nada aguas arriba lo impide: `ApiKeyAuthService:50` construye el actor con
`rol: encontrada.rol` **leido de la fila `usuario`, sin comprobar que sea `apiKey`**, y ni el
cascaron (`route.ts`) ni el borde (`analitica-integrador.ts`) miran el rol.

Por que es BLOQUEANTE y no «defensa en profundidad»:

1. **Es un incumplimiento literal de R15, R17, R18, R19 y R34**, que estan escritos SOBRE EL
   CANAL: «el sistema DEBE publicar **por este canal** unicamente las metricas declaradas en una
   lista blanca»; «NO DEBE devolver importes **en este canal**». Tal como esta, esas propiedades
   solo valen para un rol concreto, no para el canal.
2. **Rompe la simetria que el propio autor exige.** El comentario de `alcance.ts:158-169` que
   justifica el parametro `canal` dice, con estas palabras, que «hoy no existe flujo de login por
   cookie para rol apiKey... pero eso es una CIRCUNSTANCIA externa, no un invariante», y por eso
   pone la segunda capa. El caso espejo —hoy no existe una key cuya cuenta tenga otro rol— es
   exactamente la misma circunstancia externa y NO se le puso capa.
3. **Es la primera superficie del canal por API key cuyo alcance lo decide el rol.** Todas las
   demas fuerzan el sujeto: `ApiOrdenLecturaService:75,89,100` pone `ownerId: actor.usuarioId`
   pase lo que pase con el rol. La 267 introduce la excepcion, y es la que puede devolver datos
   agregados de TODOS los inquilinos.
4. El peor caso no es una cifra equivocada: es dinero de todas las tiendas por un endpoint
   publico. El propio encabezado del modulo dice que sin RLS debajo esta capa «es la UNICA
   separacion entre inquilinos».

Que falta para cumplirlo (no lo arreglo yo):
- En `resolverAlcance`, antes de la rama de los cinco lectores, cerrar el canal: si el canal es
  `api_key` y el rol no es de integracion, denegar. Asi el canal externo concede SOLO por la
  rama que aplica la lista blanca.
- Un caso en `tests/unit/analytics/alcance-api-key.test.ts` que recorra los CINCO roles lectores
  por el canal `api_key` sobre una metrica publicable, una no publicable y una financiera, y
  exija denegado en los quince. Sin ese aserto el arreglo se pierde en el proximo refactor.
- Opcional y recomendable como cinturon: que `ApiKeyAuthService` (o el borde) afirme que el rol
  de la cuenta dedicada es el de integracion.

### menor 1 — `tasks.md` no tiene ni una casilla `[x]`
`CHECKPOINTS.md > Especificacion` exige «todas las tasks estan marcadas [x]». El archivo no usa
casillas: usa secciones `## T0..T11` con «Hecho cuando». El trabajo esta hecho —lo verifique task
por task contra el codigo y los tests—, pero el checkpoint literal no se cumple. Cierre de
bookkeeping antes de `done`; T11 (gate y PR) sigue siendo del leader.

### menor 2 — tres filas de la tabla de trazabilidad citan tests que no existen con ese nombre
`design.md:481,483,485`: R8 y R10 apuntan a `tests/unit/api/analitica-api-key-alcance.test.ts`,
archivo que **no existe**; R12 apunta a un caso «dos integradores distintos => claves distintas»
de `cache-clave.test.ts` que **no esta**. Los asertos equivalentes SI existen y los verifique
(R8/R10 en `analitica-api-key-route.test.ts:277,350,363` y
`analitica-integrador-borde.test.ts:227`; R12 por `cache-clave-alcance.guardia.test.ts:72` mas el
caso de dos integradores de `alcance-api-key.test.ts:50`). Es drift de la tabla, no falta de
cobertura — pero la tabla es el artefacto que el proximo reviewer va a creerse.

### menor 3 — R12 no tiene aserto DIRECTO de «dos integradores => dos claves de cache»
La propiedad se sostiene por composicion (la clave incluye el alcance) y el guardia afirma «dos
ids distintos del mismo tipo no comparten» **solo para la variante `zona`**. Una linea con
`tienda` cerraria el caso que esta feature estrena.

### menor 4 — `construirServicio` duplicado: ACEPTABLE, con ficha aparte
La duplicacion respecto de `lib/actions/analitica-operativa.ts` esta forzada por `use server`
(todo export debe ser async) y extraerlo tocaria el cableado del canal de sesion, que R43 exige
intacto. La justificacion esta escrita en el propio archivo. Se acepta **para esta ficha**: son
~15 lineas de composition root sin logica, y el riesgo real (que el repositorio VIVO se decore
por error y el punto parcial entre en cache) esta documentado en las dos copias. Merece ficha de
deuda para extraer el factory cuando alguien toque cualquiera de las dos; hoy no bloquea.

### menor 5 — comentario caduco en `lib/analytics/entregas-conteo.ts:159`
Dice «apiKey -> DENEGADO por el mismo criterio que ROLES_SIN_ANALITICA». Esa lista ahora esta
vacia y el criterio real de ese modulo es `esRolAnalitica`. El comportamiento es correcto; el
comentario apunta a una constante que ya no dice lo que dice.

---

## Pendiente de bookkeeping (leader, no implementer)
- `feature_list.json` y `progress/current.md`.
- Entrada en `progress/history.md` (checkpoint de verificacion final).
- Aviso a integradores coordinado con la 266 y la 256/#434, en una sola tanda.

---
---

# SEGUNDA RONDA — re-revision del arreglo, 2026-08-23

> Reviewer, misma rama, ahora **9 commits** sobre `origin/dev`. Los cuatro nuevos:
> `65eaf21d` (fix), `e50703c2` (test + menores), `cb64f0d9` y `245a6b1e` (docs).
> La primera ronda de arriba **no se toca**: el hallazgo queda en el historial.
> Todo lo que toque para reproducir se restauro; `git status --porcelain` vacio al cerrar.

## VEREDICTO DE LA SEGUNDA RONDA: **APROBADO**

El BLOQUEANTE esta cerrado en el punto correcto y con mordida comprobada por mi. Los cinco
menores, atendidos. Ningun hallazgo nuevo.

## 1. Los quince casos, reproducidos por mi — y el agujero era MAS ANCHO de lo que escribi

Con el arreglo puesto: **0 de 15 conceden**. Los cinco roles lectores (`maestro`, `admin`,
`adminSatelite`, `adminTienda`, `mensajero`) x tres metricas (`ordenes_creadas` publicable,
`incidentes` operativa NO publicable, `cod_recaudado` financiera) devuelven los quince
`{estado:"denegado", motivo:"rol_sin_analitica"}`.

Desactive la linea del arreglo (`alcance.ts:276`) y volvi a medir. **Concedian 12 de 15**, y la
confirmacion importa porque mi enunciado original se quedaba corto:

    maestro       + ordenes_creadas / incidentes / cod_recaudado => ok, {tipo:"global"}    (3/3)
    admin         + ordenes_creadas / incidentes / cod_recaudado => ok, {tipo:"global"}    (3/3)
    adminSatelite + ordenes_creadas / incidentes                 => ok, {tipo:"zona"}      (2/3)
    adminTienda   + ordenes_creadas / incidentes                 => ok, {tipo:"tienda"}    (2/3)
    mensajero     + ordenes_creadas / incidentes                 => ok, {tipo:"mensajero"} (2/3)

`maestro` y `admin` concedian **GLOBAL las tres, incluida la financiera**: el peor caso no era
«otra tienda», era el recaudo de TODOS los inquilinos por un endpoint publico. Las tres unicas
denegaciones (`adminSatelite`/`adminTienda`/`mensajero` + `cod_recaudado`) salian con motivo
`metrica_prohibida`, es decir **por la columna de alcance de esa metrica en el catalogo, no por
el canal**: casualidad del catalogo, exactamente como reporto el implementer. Si manana una
financiera dejara de estar prohibida para `adminTienda`, esas tres tambien habrian concedido.
Confirmado: el agujero era mas ancho que mi redaccion de la primera ronda.

**El test ACUMULA, no corta.** `alcance-api-key.test.ts` construye el array de los quince y lo
compara con `toEqual` contra el esperado, en vez de asertar dentro del bucle. Lo comprobe con la
linea desactivada: el fallo enumera **las doce** concesiones en el diff, no la primera. Si
cortara, la mordida habria vuelto a subestimar el agujero. Ademas el recorrido se DERIVA de
`ROLES_ANALITICA`, asi que un sexto rol lector futuro entra solo en la red.

Arbol restaurado: `lib/analytics/alcance.ts` con su contenido original y el probe borrado.

## 2. La denegacion vive en el punto UNICO — si

`if (canal === "api_key") return denegado("rol_sin_analitica");` esta en
`lib/analytics/alcance.ts:276`, dentro de `resolverAlcance`, **despues** de la rama de
integracion y **antes** de `esRolAnalitica` y de mirar el catalogo. No esta en el borde: grep de
`rol` sobre `lib/api/analitica-integrador.ts` y `app/api/ordenes/api-key/analitica/route.ts` no
devuelve **ninguna** comprobacion de rol. El unico cambio de `cb64f0d9` en el borde es prosa (la
nota de deuda tecnica). Es el arreglo correcto y no la repeticion del error de origen.

Con las dos guardas, las ramas quedan exhaustivas sobre el canal en los dos sentidos, y el test
del bicondicional lo afirma en ambas direcciones (canal `api_key` + cualquier rol no-integracion
=> denegado; canal interno + rol de integracion => denegado), incluidos `"rol_inventado"` y `""`.

Nota sin consecuencia: con la guarda nueva, un rol DESCONOCIDO por el canal `api_key` cambia de
motivo (`rol_desconocido` -> `rol_sin_analitica`). Es un literal interno; el borde traduce los
dos al mismo 403 mudo, asi que desde fuera no se distingue nada. No es hallazgo.

## 3. La defensa en profundidad de `ApiKeyAuthService` — correcta, indistinguible y sin romper el alta

- La guarda `if (encontrada.rol !== ROL_API_KEY) return { status: "forbidden" };` devuelve **el
  mismo literal exacto** que la rama de key revocada: no hay dos mensajes, ni codigo distinto, ni
  campo extra. El test lo afirma comparando los dos resultados con `toEqual`, no leyendo el
  codigo. La indistinguibilidad es real.
- La comparacion es estricta: `"APIKEY"` tambien cae (esta en el `it.each`).
- **No rompe el alta legitima**, y lo verifique por los dos extremos que importan:
  (a) `ApiKeyRepository.createConUsuario` fija el rol por LOOKUP de `apiKey` (`rolId: rol.id`),
  unica alta del canal; (b) `findByKeyHash` **si selecciona el rol** —
  `usuario: { select: { estado: true, rol: { select: { value: true } } } }`, devuelto como
  `rol: row.usuario.rol.value`—, que era el riesgo real: si el `select` no lo trajera, la guarda
  habria dejado fuera a TODAS las keys vivas mientras los tests con dobles pasaban en verde.
  No es el caso.
- Corri el canal entero: `tests/integration/api` + cotizacion + carga-etiquetas + el unit del
  auth service + acciones de api-keys => **21 archivos / 263 tests verdes**.

## 4. Los cinco menores — atendidos, comprobados uno a uno

- **menor 1 (`tasks.md`)**: 11 casillas `[x]`; T0–T10 marcadas y **T11 (gate y PR) abierta a
  proposito**, que es lo correcto: es del leader, no del implementer.
- **menor 2 (tabla de trazabilidad)**: las tres afirmaciones del implementer son ciertas.
  R8 y R10 **ya estaban cubiertos** por tests reales (los verifique en la ronda 1) y lo que
  fallaba era la cita; ahora apuntan a `analitica-integrador-borde.test.ts` y
  `analitica-api-key-route.test.ts` con los nombres de caso EXACTOS que existen en esos archivos.
  R12 **no** estaba cubierto y ahora tiene test propio, citado.
- **menor 3 (dos integradores, dos claves)**: escrito en `cache-clave.test.ts`, y bien escrito:
  no forja la consulta, la construye por el camino real
  (`prepararConsultaAnalitica(..., "api_key")`), asi que compara la clave que produce el canal de
  verdad. Cubre las cuatro caras (difiere por sujeto, estable consigo mismo, el `usuarioId` entra
  en la clave, y el caso mismo-id/otro-rol dejado escrito como no-laguna).
- **menor 4 (`construirServicio`)**: anotado como DEUDA TECNICA ACEPTADA en el propio archivo y
  en `impl_267.md`. Era lo pedido; no bloqueaba.
- **menor 5 (comentario caduco)**: `entregas-conteo.ts` actualizado, solo prosa.

## 5. El arreglo no cerro de mas — comprobado, que es la otra mitad

Una denegacion total tambien habria pasado los quince casos y estaria igual de rota. No es el
caso:

- El **integrador legitimo** con metrica publicable **sigue concediendo** su tienda:
  `resolverAlcance(INTEGRADOR, publicable, "api_key")` => `{ok, {tipo:"tienda", tiendaId: su
  usuarioId}}`, afirmado en test y ejercitado ademas de rebote por el test de caches (que lanza
  si la preparacion no concede).
- El **canal de sesion sigue intacto** para los cinco lectores: hay caso espejo explicito
  (`maestro` por canal interno => `{tipo:"global"}`), y las suites de 122/126/128/131/176 pasan
  sin editar sus asertos de comportamiento.
- El **auth service** sigue concediendo con el rol correcto (caso propio).
- Suites corridas por mi tras el arreglo: `tests/unit/analytics` + `tests/unit/api` + acciones +
  auth service + `intentos-no-alcance` + `menu-visibility` => **164 archivos / 1969 tests / 0
  rojos**. Los rojos del gate completo son los preexistentes y los flakes que el leader ya midio;
  no los re-investigo por instruccion.

## Estado final

- BLOQUEANTE 1: **CERRADO**.
- menores 1–5: **CERRADOS** (T11 abierta a proposito, es del leader).
- Sin hallazgos nuevos.
- **Veredicto: APROBADO.** Queda solo el bookkeeping del leader: `feature_list.json`,
  `progress/current.md`, entrada en `progress/history.md` y el aviso a integradores coordinado
  con la 266 y la 256/#434 en una sola tanda.
