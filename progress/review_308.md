# Review — Feature 308 · el chat muestra media, reacciones, contactos y el cambio de numero

- **Rama:** `feature/308-chat-media-reacciones-contactos`
- **Commits propios:** `35bdd07c`, `8b9d35e5`, `ac7369d7`, `8b534461`, `773cd300`
- **Alcance medido contra el merge-base (`1f360a8e`):** 57 archivos, +6767 / -58. Coincide con lo
  declarado. Un `git diff origin/dev..HEAD` a secas da 73 archivos y -725: es DRIFT, la rama esta
  **21 commits por detras** de `origin/dev`, no trabajo suyo.
- **Fecha:** 2026-08-27
- **Veredicto:** **RECHAZADO** — 4 bloqueantes. Ninguno invalida el diseno; tres son de bitacora y
  uno es un bug medido en el borde de la descarga.

---

## Checklist de CHECKPOINTS.md

### Especificacion
- [x] `specs/308-.../requirements.md` con R1–R35 en EARS.
- [x] `specs/308-.../design.md` con alternativas descartadas y su porque.
- [ ] **`tasks.md` con todas las tasks marcadas — FALLA: 0 de 29 marcadas.** (bloqueante 2)

### Trazabilidad
- [x] Los 35 requisitos mapean a un test que existe y que MUERDE (detalle abajo).
- [ ] **`progress/impl_308.md` con el mapa R→test — FALLA: no existe.** (bloqueante 3)

### Calidad de codigo
- [x] `pnpm typecheck` verde (medido por mi).
- [x] `pnpm lint` verde (medido por mi).
- [~] `pnpm test`: 30 rojos, **exactamente el baseline heredado de `dev`**, delta 0. Ver "Gate".
- [n/a] E2E Playwright: el flujo critico tocado (webhook) ya lo cubren los tests de integracion de
  las features 109/121; no se abre superficie de auth ni de pagos nueva.

### Datos y seguridad
- [x] Sin tabla nueva ⇒ sin superficie RLS nueva. `chat_mensaje` conserva RLS sin policies (solo
      service role). La migracion lo declara explicitamente.
- [x] Migracion versionada `20260827180000_chat_mensaje_media_reacciones` con `down.sql`
      reversible (recrea el enum a los 4 valores previos, con su precondicion documentada). Un
      test de integracion aplica UP y DOWN contra Postgres real.
- [x] Ningun secreto hardcodeado; ninguna variable de entorno nueva. El token solo viaja en
      `Authorization: Bearer` del cliente de la Graph API.
- [x] El webhook conserva la firma HMAC intacta y responde 200 ante lo no accionable: todos los
      tipos nuevos degradan a `otro` sin lanzar (R3/R6/R8/R10/R11).

### Patron de capas
- [x] El route handler no tiene queries ni logica: sesion → repo → cliente → cabeceras.
- [x] `ChatWhatsappService` no conoce Request/Response.
- [x] `ChatMensajeRepository.findMediaParaMensajero` es una sola query con el scope en el `WHERE`.
- [x] Interfaces en `lib/interfaces/repositories/`; `contactos` viaja TIPADO, nunca `Json`.

### Permisos
- [x] La ruta proxy queda tras el guard de sesion (test de middleware) y ademas re-autoriza en el
      handler contra `orden.mensajero_asignado_id`, la MISMA puerta que `listarHilo`.
- [x] Las mutaciones siguen en Server Actions; la ruta API existe porque devuelve un BINARIO con
      cabeceras, el caso que `docs/architecture.md` reserva a un Route Handler.

### Verificacion final
- [ ] `./init.sh` completo en verde — rojo por baseline heredado (delta 0 de esta feature).
- [x] Este archivo.
- [ ] **Entrada en `progress/history.md` para la 308 — FALLA:** la entrada anadida en este diff es
      de la **278**, no de esta feature.

---

## Gate — numeros propios (`./init.sh` completo, 2026-08-27)

| Paso | Resultado |
| --- | --- |
| typecheck | **verde** |
| lint | **verde** |
| tests | **30 rojos / 20484 verdes / 26 skipped — 7 archivos rojos de 1488**, 657 s |

Los 7 archivos rojos, uno a uno, y ninguno toca chat/whatsapp/media:

| Archivo | Rojos |
| --- | --- |
| `tests/integration/db/premio-ranking-idempotencia.test.ts` | 14 |
| `tests/integration/db/premio-ranking-devengo-migration.test.ts` | 6 |
| `tests/integration/db/orden-remision-borrada-libera-numero.test.ts` | 5 |
| `tests/integration/actions/analitica-financiera-action.test.ts` | 2 |
| `tests/integration/db/usuarios-filtro-busqueda.test.ts` | 1 |
| `tests/unit/services/usuario-descarga.test.ts` | 1 |
| `tests/unit/guards/superficie-de-uso.guardia.test.ts` | 1 |

**Coincide archivo por archivo y conteo por conteo con el baseline heredado de `dev` (30). Delta
atribuible a la feature 308: 0.** Los de base fallan por `The column (not available) does not
exist in the current database`: la base local lleva migraciones de commits de `dev` que esta rama
todavia no tiene. Los dos flakes conocidos (`ranking-snapshot-migration`, `CrearTiendaForm`) NO
aparecieron en esta corrida.

Ademas corri por separado los 19 archivos de test de la feature: **262 verdes, 0 rojos**
(190 unit + 72 component/integration).

---

## Trazabilidad R→test: 35 de 35 cubiertos

Comprobe que el test citado existe y que su criterio es un `assert`, no un comentario. Ademas
**rompi la implementacion a mano en 8 puntos** para ver si el test se pone rojo:

| Mutacion aplicada | Requisito | Resultado |
| --- | --- | --- |
| `contentTypeSeguro` devuelve el mime tal cual (cae la lista blanca) | R25 | **2 rojos** OK |
| Quitar `customer_changed_number` del set de subtipos de `system` | R9 | **2 rojos** OK |
| La ruta deja de responder 403 con una orden ajena | R23 | **1 rojo** OK |
| La ruta deja de exigir sesion (401) | R22 | **1 rojo** OK |
| Un `console.warn` con el numero y el cuerpo en `ingerirEventos` | R35 | **1 rojo** OK |
| Una reaccion RETIRADA vuelve a contar como emoji | R5/R19/R20/R30 | **3 rojos** OK |
| El aviso "Mensaje no compatible" pasa a cadena vacia | R14/R27 | **1 rojo** OK |
| `hrefSeguro` deja de comprobar el protocolo | R34 | **0 rojos** — ver menor M2 |

El resto lo verifique leyendo el assert: R1/R2 (`it.each` sobre los cinco tipos de media, mas el
caption como cuerpo), R3/R6/R8/R10/R11 (degradacion a `otro` sin lanzar), R12 (dedupe y sellado),
R13 (migracion UP/DOWN contra Postgres real: `information_schema.columns` y `pg_enum`), R15 (el
modulo del proxy no importa Storage ni escribe), R16/R17/R18 —incluida la **LIMITACION CONOCIDA**,
fijada con su propio assert: tras migrar, un entrante desde el numero NUEVO no resuelve orden y se
cuenta `sinResolver`, que es lo DECIDIDO y no un defecto—, R21 (`not.toContain(mediaId)` en la
vista y en las cabeceras), R24 (410 distinguible de 502 en cliente, ruta y burbuja), R26 (307 a
`/login` sin cookie, y `PUBLIC_ROUTES`/`SELF_AUTH_ROUTES` no cubren `/api/chat`; la guardia 229 no
se toca), R28/R29/R31/R32/R33 (componentes, con `getByLabelText`, `role="status"` y `rel`).

**Ninguno flojo salvo el matiz de M2.**

---

## Invariantes criticas — verificadas una a una

1. **Autorizacion del proxy.** `findMediaParaMensajero` lleva el scope EN la query
   (`JOIN orden o ... AND o.mensajero_asignado_id = $2 AND o.deleted_at IS NULL`): sin fila no hay
   binario. Es la misma puerta que `listarHilo` (`OrdenEnvioReader.findParaEnvio` con
   `actor.usuarioId`). Sin sesion, 401 **antes de tocar la base**; orden ajena, 403 **sin llamar a
   la Graph API**; un `mensajeId` mal formado se trata como ajeno (403), no como 400, para no
   filtrar que ids existen. Rompi las dos ramas y las dos se ponen rojas.
2. **El token nunca sale.** Viaja solo en `Authorization`; la url temporal de Meta se consume en el
   servidor y no se reenvia al navegador; los detalles de error citan operacion y codigo HTTP. Hay
   test propio. El media id de Meta tampoco aparece en la vista ni en las cabeceras.
3. **PII en logs.** Ni el normalizador ni el service loguean. El test espia
   `console.warn/log/error` MAS el logger inyectado y busca numero, caption, correo, nombre del
   contacto, numero nuevo y media id. Se pone rojo si le metes un log (medido).
4. **XSS en la linkificacion.** `linkificar` devuelve DATOS, nunca HTML; `TextoConEnlaces` los
   pinta como hijos de React. `dangerouslySetInnerHTML` no aparece en ningun archivo de codigo del
   diff (solo en comentarios y en el spec). Enlaces con `target="_blank"` y
   `rel="noopener noreferrer"`.
5. **Fuerza de descarga.** Lista BLANCA corta (`image/jpeg|png|webp|gif` mas las familias
   `audio/*` y `video/*`); SVG y PDF quedan fuera a proposito y salen `attachment` +
   `application/octet-stream` + `nosniff`. `Cache-Control: private, no-store`.
6. **Accesibilidad.** `alt` nunca vacio (usa el caption y, si no hay, una etiqueta que dice que
   es); `audio` y `video` con `controls` y `aria-label`; el copiado confirma en un `role="status"`
   que existe desde el primer render, sin depender de ninguna animacion.

---

## Hallazgos

### BLOQUEANTE 1 (RESUELTO el 2026-08-28) — colision de id: el 299 ya estaba ocupado en `dev`

`origin/dev` trae desde `1b5cc90a` (PR #549) una ficha **id 299** distinta: *"la carga deja entrar
montos con decimales que la entrega no sabe cobrar"*, `status: done`, rama
`fix/299-carga-redondea-montos`. Esta rama anadia **otra entrada con id 299**. Al mergear,
`feature_list.json` queda con dos fichas del mismo id, y todo el rastro de esta feature (rama,
`specs/299-...`, prefijo de los commits) apuntaba a un numero que en `dev` significa otra cosa.
`./init.sh` NO lo detecta: no valida ids duplicados y ademas `jq` no esta instalado en esta
maquina, asi que ni el cupo por zona ni la comprobacion de specs llegan a correr.

**Que falta:** renumerar la ficha al siguiente id libre **conservando el slug de la rama**
(precedente 276→278, y el propio 294→299 de esta), mover el directorio del spec y dejarlo dicho en
el `status_note`. Es el mismo accidente que la nota de `history.md` de esta misma rama documenta
para la 278.

### BLOQUEANTE 2 — `tasks.md` con 0 de 29 tasks marcadas

CHECKPOINTS exige que todas esten marcadas. El archivo esta intacto: 29 sin marcar, 0 marcadas,
incluidas A1–A3, B1–B2, C1–C3, D1–D3, E1–E2, F1–F5, G1–G8 y H1–H3, que **si estan implementadas y
verificadas**. La bitacora no refleja el estado real del arbol.

**Que falta:** marcar lo hecho, y dejar H1 explicitamente como NO hecho (ver M6) en vez de
omitirlo.

### BLOQUEANTE 3 — no existe `progress/impl_308.md`; el que hay esta a medias

Solo existe `progress/impl_308_backend.md`. Su mapa R→test cubre **27 de 35** (R1–R26 y R35):
faltan **R27, R28, R29, R30, R31, R32, R33 y R34**, todo el bloque G. Y su ultima seccion sigue
titulada *"Pendiente para el frontend (bloque G)"*, listando como pendiente codigo que el commit
`ac7369d7` ya escribio. Un lector futuro concluiria que la UI no existe.

Es un fallo de BITACORA, no de cobertura: los ocho tests de R27–R34 existen, los ejecute, y uno de
ellos lo verifique por mutacion.

**Que falta:** `progress/impl_308.md` con el mapa de los 35 y el estado real del bloque G.

### BLOQUEANTE 4 — un nombre de archivo con emoji o CJK tumba la descarga (500)

**Medido, no deducido.** `sanearNombreArchivo` limpia CR/LF, comillas, barras, `..` y caracteres de
control, pero **no los que estan por encima de U+00FF**. `Content-Disposition` es una cabecera HTTP
y solo admite ByteString, asi que construir la respuesta LANZA:

    TypeError: Cannot convert argument to a ByteString because the character at index 22
    has a value of 22577 which is greater than 255.

Reproducido llamando al `GET` del proxy con `mediaNombre = "<nombre CJK + emoji>.pdf"` y
`?descarga=1`: el handler no responde 200, revienta, y en produccion eso es un 500. Un emoji en el
nombre de un adjunto de WhatsApp no es un caso exotico. Los acentos del espanol (n con tilde, vocal
acentuada) caen dentro de Latin-1 y no disparan el fallo, que es justo por lo que pasa
desapercibido en pruebas locales.

Afecta a R25 ("nombre de archivo saneado") y a R29 (la accion de descarga del documento). **Ningun
test lo ejercita:** el unico caso adverso probado es `fac"tura\r\n/../.pdf`, todo ASCII.

**Que falta:** que `sanearNombreArchivo` reduzca a ASCII seguro —o que `contentDisposition` emita
`filename*=UTF-8''` con el nombre percent-encoded junto al `filename` ASCII— y un test con un
nombre no Latin-1 que hoy este rojo y luego verde.

---

### menor M1 — un comentario afirma justo lo que R16 retiro por falso

En `lib/services/ChatWhatsappService.ts`, dentro de `ingerirEventos`: *"Migrar primero es lo que
hace que este mismo evento —y todo lo que venga despues del numero nuevo— caiga en el hilo que ya
existia"*. Esa es literalmente la clausula que el humano **retiro de R16 por falsa** el 2026-08-27,
y que la burbuja de sistema avisa al mensajero que NO ocurre ("Sus mensajes desde el numero nuevo
no llegaran a esta orden"). El assert de la LIMITACION CONOCIDA demuestra lo contrario que el
comentario. Reescribirlo: la migracion es EVIDENCIA, no continuidad.

### menor M2 — la segunda barrera de R34 no la muerde ningun test

Eliminando el chequeo `url.protocol === "http:" || "https:"` de `hrefSeguro`, **la suite sigue
verde**: la unica barrera que los tests ejercitan es la regex `CANDIDATO_URL`, que ya impide que
`javascript:`, `data:` y `file:` lleguen a ser candidatos. La defensa en profundidad esta bien
puesta y R34 SI queda cubierto de punta a punta; lo que no hay es red para el dia en que alguien
relaje la regex (por ejemplo, para enlazar dominios sueltos). Un test unitario directo sobre
`hrefSeguro` lo cerraria.

### menor M3 — `Content-Length` puede venir del metadato y no del binario

Si Meta no manda `content-length` en el segundo salto, el proxy emite el `file_size` de los
METADATOS. Si divergen, la respuesta se trunca o se queda colgada. Sin test. Lo prudente es
emitirlo solo cuando venga del binario.

### menor M4 — el Bearer se manda a la URL que devuelve Meta sin comprobar el host

Es la practica estandar de la Graph API y el origen es TLS de Facebook, pero no hay ningun assert
que fije que la url temporal pertenece a un dominio de Meta.

### menor M5 — la rama esta 21 commits por detras de `origin/dev`

El merge tocara `feature_list.json` (donde ademas esta el bloqueante 1) y `progress/`. Conviene
traer `dev` antes de abrir el PR y volver a medir: buena parte de los 30 rojos del baseline son
consecuencia de este desfase y el numero puede moverse al ponerse al dia.

### menor M6 — H1 (recorrido manual con payload real) no se hizo

La propia bitacora lo declara: no hay payload real de Meta capturado ni credencial en este entorno.
Se acepta como limitacion declarada —encaja con P1, que sigue sin medirse—, pero la task deberia
quedar marcada como NO hecha en vez de omitida.

---

## Decisiones del humano que NO cuento como defecto

- Media por proxy bajo demanda, sin bucket ni cron de purga (D1/R15).
- El cambio de numero es SOLO EVIDENCIA: un mensaje desde el numero nuevo no resuelve orden y se
  cuenta `sinResolver`. Esta fijado por un test propio y la burbuja lo dice explicitamente.
- `ordenex.co/guia` sin esquema no se enlaza; `www.` si. Con tests que lo fijan.
- `button`, `interactive`, `order`, `request_welcome` y `ephemeral`, fuera de alcance.
- Los entrantes viejos guardados como `otro` pasan a decir "Mensaje no compatible", sin backfill.

---

## Veredicto

**RECHAZADO.** El diseno y la implementacion son solidos —la autorizacion del proxy, la PII, el XSS
y el forzado de descarga estan bien resueltos, y lo verifique rompiendo el codigo—, pero hay
**cuatro bloqueantes**: la colision del id 299 con `dev` (B1, ya resuelta), `tasks.md` sin marcar (B2), la
bitacora `impl_308` inexistente e incompleta (B3) y el 500 al descargar un adjunto con nombre no
Latin-1 (B4). B1–B3 son minutos de bookkeeping; B4 es un cambio de una linea en
`sanearNombreArchivo` mas su test. Vuelve al implementer.

---

## Addenda — re-chequeo del 2026-08-28 (tras la renumeracion 299 → 308)

El leader aplico `64464b9b chore(308): renumerada de 299 a 308`, que ataca el bloqueante 1.
Comprobado por mi sobre el arbol resultante:

| Bloqueante | Estado |
| --- | --- |
| B1 colision de id | **RESUELTO.** `feature_list.json` no tiene ids duplicados (`uniq -d` vacio); la ficha es id 308, `specs/308-chat-media-reacciones-contactos/`, y no queda ninguna referencia residual a 299 en los archivos de la feature (las `#299` que sobreviven son a un PR viejo, correctamente protegidas). |
| B2 `tasks.md` sin marcar | **ABIERTO:** 0 marcadas / 29 sin marcar. |
| B3 bitacora `impl_308.md` | **ABIERTO:** solo `progress/impl_308_backend.md`, con 27 de 35 requisitos y la seccion "Pendiente para el frontend". |
| B4 filename no Latin-1 → 500 | **ABIERTO:** `sanearNombreArchivo` sigue sin filtrar por encima de U+00FF. |

**La renumeracion no rompio nada:** `pnpm typecheck` verde y los 19 archivos de test de la feature
en **262 verdes / 0 rojos** despues del cambio (58 archivos tocados, casi todos comentarios).

### Efecto colateral de la renumeracion, que corregi en este mismo archivo

El `sed` global de 299 a 308 **reescribio tambien las citas del numero VIEJO**, que estaban aqui a
proposito para documentar la colision. El bloqueante 1 acabo afirmando que *"el 308 ya esta ocupado
en dev"* y citando una rama `fix/308-carga-redondea-montos` que no existe: el registro de por que
hubo que renumerar quedaba diciendo lo contrario de lo que paso. Restaurado a mano (la ficha de
`dev` es la **299**, rama `fix/299-carga-redondea-montos`).

**La leccion, que es del arnes y no de esta feature:** un renumerado masivo por `sed` no distingue
"el id de esta ficha" de "el id que se cita como historia". Los textos que EXPLICAN una colision
son justo los que no deben renumerarse, y son invisibles al ojo porque el resultado sigue leyendose
bien.

### menor M7 (nuevo) — el registro de la primera colision quedo reescrito en tres sitios

Lo verifique despues de escribir el parrafo de arriba, y **la sospecha se confirma**. El `sed` de
`64464b9b` reescribio la narracion historica en:

1. **`status_note` de la ficha en `feature_list.json`:** *"RENUMERADA DE 294 A 308 el 2026-08-27,
   ANTES de crear la rama y sin ningun commit escrito con el numero viejo"*.
2. **`progress/current.md` (linea 19):** *"RENUMERADA DE 294 A 308 — cuarta colision de ids del
   mes"*, describiendo solo el evento del 294.
3. **`progress/history.md` (linea 4368):** *"La ficha 308 (chat: media y reacciones) nacio como 294
   y se renumero por lo mismo tres dias despues"*.

Las tres afirman ahora un salto **294 → 308 el 2026-08-27** que NO ocurrio: ese dia la ficha paso
de 294 a **299**, y el salto a 308 es del **2026-08-28**, un evento distinto y posterior. Peor, la
clausula *"ANTES de crear la rama y sin ningun commit escrito con el numero viejo"* era cierta del
294 y es **falsa del 308**: hay cinco commits escritos como `feat(299)` y la rama se llamaba
`feature/299-...` (el propio mensaje de `64464b9b` lo reconoce al justificar que renombra tambien
el slug).

El efecto es que **la segunda colision desaparece del registro**, justo la que destapo el hueco del
arnes que ese mismo commit dice querer anotar: `init.sh` no valida ids duplicados en
`feature_list.json`. No lo arreglo yo (es bookkeeping del leader); lo dejo medido y localizado.

### Veredicto tras la addenda

**Sigue RECHAZADO**, ahora con **tres** bloqueantes abiertos: B2, B3 y B4. B4 es el unico de
codigo.
