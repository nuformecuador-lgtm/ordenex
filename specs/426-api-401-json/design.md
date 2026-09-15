# 426 — diseño

## 0. La decisión, en una frase

Una rama nueva en `middleware.ts`: **el rechazo por sesión de un path de API deja de ser un
`NextResponse.redirect` y pasa a ser un `401` con el `AppErrorShape` de la feature 10**. Ni una
lista de excepción tocada, ni un handler tocado, ni una línea de base de datos.

## 1. Modelo de datos

**Ninguno.** Esta feature no crea ni altera tablas, columnas, enums, índices, políticas RLS ni
migraciones. No hay `migration.sql` ni `down.sql` que escribir. Se dice explícitamente porque el
reviewer lo busca: aquí no aplica.

## 2. Dónde va el cambio, y en qué orden se decide

Archivo de producción tocado: **`middleware.ts`, y solo ese.**

**El arreglo no escribe un 401 nuevo: desatasca el que ya existe.** Las dos rutas afectadas ya
tienen su rechazo por falta de sesión escrito en el handler —`chunk/route.ts:105-106` y
`chat/media/[mensajeId]/route.ts:99-101`, ambos 401 con cuerpo JSON— y **nunca se ha ejecutado**,
porque el middleware responde el 307 antes. Lo que se hace aquí es que el borde emita ese mismo
desenlace en vez de redirigir. Ningún handler se toca.

El orden de decisión actual (`middleware.ts:43-75`) se conserva entero; se inserta **un único
desvío en el punto de rechazo**:

```text
1. PUBLIC_ROUTES        -> next()                      (sin cambios, R8)
2. SELF_AUTH_ROUTES     -> next()                      (sin cambios, R8)
3. pathname === "/"     -> landing o /dashboard        (sin cambios, R6)
4. sesión activa        -> next()                      (sin cambios)
5. RECHAZO:
   5.a  es ruta de API  -> 401 JSON            <-- NUEVO (R1, R2, R3, R5)
   5.b  REDIRECT_TO_ROOT-> 307 a /                     (sin cambios, R6)
   5.c  resto           -> 307 a /login?redirect=…     (sin cambios, R6)
6. cookie inválida presente -> se borra en la respuesta, sea 401 o 307   (R4)
```

Que 5.a vaya **después** de 1 y 2 no es cosmética: es lo que deja `/api/docs/openapi` público y los
21 endpoints auto-autenticados intactos (R8). Y que el borrado de cookie del paso 6 siga siendo
común a las dos ramas es lo que evita que el 401 resucite el roundtrip a la DB en cada petición.

**Qué cuenta como ruta de API (R7).** Una función local `esRutaApi(pathname)` con la regla
`pathname === "/api" || pathname.startsWith("/api/")`. No se reutiliza `matches()` con una lista
nueva **a propósito**: cualquier `const … = [ … ]` nuevo en este archivo es ruido para las tres
guardias que leen su fuente, y una lista de un solo elemento invita a que alguien le añada un
segundo. La regla del primer segmento excluye sola `/api-docs` (página) y `/apitos`.

## 3. Contrato de la respuesta

| | valor |
| --- | --- |
| status | `401` |
| `content-type` | `application/json` (lo pone `NextResponse.json`) |
| `location` | **ausente** |
| cuerpo | `{"status":"error","code":"UNAUTHORIZED","message":"No hay una sesion valida."}` |
| `set-cookie` | borra `session` **solo si** venía una cookie que falló la validación |

El cuerpo **no se escribe a mano**: se construye con las piezas que ya existen,

```ts
// ilustrativo — el implementer decide la forma final
import { appErrorToResponse } from "@/lib/errors/http";
import { UnauthenticatedError } from "@/lib/errors/app-error";
…
const response = appErrorToResponse(new UnauthenticatedError().toShape());
```

**Por qué esta forma y no otra** (decisión **D1** del humano, 2026-09-14: confirmada). Es
**exactamente** la que emitiría
`app/api/ordenes/carga-masiva/chunk/route.ts:105-106` si el handler llegara a correr
(`UnauthenticatedError` → `withErrorHandler` → `appErrorToResponse`). Así el integrador ve **un solo
contrato** para «no hay sesión», caiga el rechazo en el borde o dentro del handler; si se copiara el
literal `{error:"unauthorized"}` de los crons, el mismo endpoint contestaría 401 con **dos cuerpos
distintos** según dónde se le parara, que es una variante más sutil del problema que vinimos a
arreglar.

**El handler de la media conserva su `{error:"unauthenticated"}`** (decisión **D2**: no se unifica).
Es código que hoy funciona, ninguna evidencia lo señala y su único consumidor lee `res.status`, no
el cuerpo (`useMediaChat.ts:73-80`). La divergencia queda registrada a conciencia, no por descuido.

**Imports profundos** (`@/lib/errors/http`, `@/lib/errors/app-error`) en vez del barril
`@/lib/errors`: el barril arrastra `normalize.ts`, que importa `zod`, al bundle del middleware —que
corre en **cada** petición—. El repo ya usa imports profundos a este módulo (`lib/utils/action-error-message.ts:2`,
`lib/services/AnaliticaFinancieraService.ts:6`), así que no se inventa un patrón.

**Sin `WWW-Authenticate`.** El 401 canónico llevaría ese header, pero aquí el esquema no es HTTP
Basic/Bearer sino una cookie; anunciar un esquema que no aceptamos haría que algunos clientes
abrieran un diálogo de credenciales del navegador. Se omite a conciencia.

## 4. Rutas y endpoints

**No se crea, borra ni mueve ninguna ruta.** El desenlace sin credencial, antes y después:

| path | clasificación | hoy | tras el cambio |
| --- | --- | --- | --- |
| `/api/docs/openapi` | pública (`PUBLIC_ROUTES`) | pasa → 200 spec | **igual** |
| `/api/health` | pública, **sin handler** | pasa → 404 de Next | **igual** |
| `/api/cron/*` (11) | self-auth | pasa → 401 `{error:"unauthorized"}` del handler | **igual** |
| `/api/ordenes/api-key/*` (9) | self-auth | pasa → 401 del handler | **igual** |
| `/api/webhooks/whatsapp` | self-auth | pasa → 401 `{error:"unauthorized"}` del handler | **igual** |
| `/api/ordenes/carga-masiva/chunk` | **sesión** | **307 → login → 200 HTML** | **401 JSON** |
| `/api/chat/media/[mensajeId]` | **sesión** | **307 → login → 200 HTML** | **401 JSON** |
| `/api/<lo que sea futuro>` | sesión (por defecto) | 307 | **401 JSON** |
| `/api-docs`, `/apitos`, `/ordenes`, `/dashboard`, `/xyz` | páginas | 307 a `/login` | **igual** |
| `/paquete/*` | página (`REDIRECT_TO_ROOT`) | 307 a `/` | **igual** |

## 5. Consumidores: el antes y el después medido

La tabla completa (con archivo y línea) está en `requirements.md § Contexto medido`. El resumen
para el revisor:

- **`useMediaChat`**: hoy el `fetch` sigue el 307, recibe el HTML del login con `200`, lo mete en un
  `blob` y declara estado `"listo"` — el chat pinta una imagen rota y **no reporta ningún fallo**.
  Con el 401 cae en `!res.ok` → `"error"`, que la UI ya sabe pintar. **Mejora estricta.**
- **`procesarEnChunks`**: hoy revienta en `res.json()` con «Unexpected token '<'»; mañana lanza
  `ChunkRequestError(401)` y la UI dice «estado 401». **Mejora estricta.**
- **El `<a download>` del documento del chat**: ni mejora ni empeora (guarda basura en ambos casos,
  y en ninguno de los dos ve una página de login). **Es el único sitio donde cabía una dependencia
  del redirect y no la hay.**

**Conclusión medida: ningún consumidor propio depende del redirect.** No hace falta compensación
alguna en el cliente.

## 6. Alternativas descartadas

### A1 — Sacar las dos rutas del guard y confiar en su 401 propio (DESCARTADA)

Añadir `/api/ordenes/carga-masiva` y `/api/chat/media` a `SELF_AUTH_ROUTES`. **Funcionaría hoy
mismo**: los dos handlers ya resuelven la sesión y ya responden 401 JSON
(`chunk/route.ts:105-106`, `media/route.ts:99-101`). Descartada por tres razones, en orden de
gravedad:

1. **Cambia el modelo de seguridad, no la forma del mensaje.** `SELF_AUTH_ROUTES` significa «esta
   ruta trae su propia credencial»; estas dos traen la **cookie de sesión**, que es justo lo que el
   guard existe para validar. Moverlas ahí convierte el guard de *secure by default* en *secure si
   el autor del handler se acordó*, y el siguiente `/api/*` que alguien escriba sin acordarse queda
   **abierto**, no roto-pero-cerrado.
2. **Rompe dos redes que están puestas a propósito**: la guardia firmada de la feature 229
   (`rastreo-sin-ruta-nueva.guardia.test.ts:68-82`, comparación posicional de las tres listas) y el
   test de la feature 311 que comprueba que la media **no** está en ninguna lista de excepción
   (`chat-media-middleware.test.ts:49-72`, escrito con este error en mente y citándolo por su
   nombre). Ponerlas rojas para arreglar un mensaje de error es mal negocio.
3. **Es por ruta, no por clase.** Arregla 2 endpoints y deja el defecto vivo para el 25.º.

### A2 — Cambiar el 307 por un 303 See Other (DESCARTADA)

El 303 convierte el POST reenviado en GET, así que el cliente dejaría de postear su carga contra la
página de login. Pero **el desenlace final sigue siendo `200` + HTML del login**, que es
literalmente lo que el integrador reportó. Arregla el mecanismo y no el síntoma.

### A3 — Decidir por la cabecera `Accept` en vez de por el path (DESCARTADA)

Responder JSON solo si el cliente pidió `Accept: application/json`. Es el patrón de muchos
frameworks, y aquí es peor: **la cabecera la controla el cliente y no podemos medirla**. Medido en
este repo, el `fetch` de `useMediaChat` no fija `Accept` (sale `*/*`), y del cliente de Nuform no
sabemos nada. El path, en cambio, es determinista y lo controlamos nosotros: `/api/` **es** el
contrato de «esto lo consume una máquina». Además dejaría el desenlace dependiendo de algo que el
test puede fijar pero la realidad no.

### A4 — Un `redirect: "manual"` o un reintento en los clientes propios (DESCARTADA)

Parchear `useMediaChat` y `procesarEnChunks` para detectar el redirect. No arregla nada para el
integrador —que es quien reportó—, multiplica el parche por consumidor y deja el servidor mintiendo
igual.

## 7. Seguridad: qué afloja (nada)

- **Sigue rechazando exactamente lo mismo.** Cambia la **forma** del rechazo, no quién pasa. Ninguna
  ruta que hoy exige sesión deja de exigirla; ninguna lista de excepción se toca (R9).
- **No filtra información nueva.** Hoy un `/api/loquesea` inexistente responde 307 y uno existente
  también; mañana los dos responden 401. La respuesta **no distingue** «no existe» de «no
  autenticado», igual que ahora.
- **El cuerpo no lleva PII ni el pathname**: es el mensaje fijo de `MSG.UNAUTHORIZED`.
- El borrado de la cookie inválida se conserva (R4), así que no aparece un bucle de validación
  contra la DB.

## 8. Impacto en los tests que ya existen

Tres casos **afirman hoy el comportamiento defectuoso** y se **INVIERTEN**: no se borran, no se
relajan y no entran al baseline. Se nombran con ruta y línea para que el reviewer no lo confunda con
«comprar el verde» — en los tres se conserva **el veredicto** (esa petición se rechaza) y cambia
solo **la forma del rechazo**:

| archivo:línea | qué afirma hoy | qué debe afirmar |
| --- | --- | --- |
| `tests/unit/auth/middleware.test.ts:164-169` | «una ruta de API no self-auth sin sesion se guarda (307 a /login)» | sigue guardada, pero con **401 + JSON** |
| `tests/unit/auth/middleware.test.ts:246-253` | control negativo de la 177: `/api/ordenes/orden/ABC-123` fuera del prefijo api-key → 307 a `/login` | **el control se conserva** (la ruta NO pasa), solo cambia el desenlace a 401 |
| `tests/integration/api/chat-media-middleware.test.ts:29-36` | «GET sin cookie de sesion redirige (307) a /login» (feature 311, R26) | **la intención de R26 se conserva**: la media sigue detrás del guard; lo que cambia es que el rechazo es 401 JSON |

Lo que **no** se toca: los bloques de páginas del mismo archivo (`/ordenes`, `/dashboard`, `/xyz`,
`/apitos`, `/paquete`, `/`), el bloque de self-auth, y las dos aserciones de
`chat-media-middleware.test.ts:49-72` que comprueban que la ruta no entró en ninguna lista de
excepción — esas son justamente la prueba de que se eligió el camino correcto (§6, A1).

## 9. La guardia nueva (R10), y por qué no basta con los casos

Los casos de R1–R8 fijan dos pathnames concretos. La ruta de API **número 25** no está escrita
todavía, y el modo de fallo de este repo es el mudo: nadie va a notar que la nueva redirige.

La guardia enumera `app/api/**/route.ts` recorriendo el **árbol de archivos** (no por imports:
ningún grafo la seleccionaría), traduce cada archivo a su pathname —`[param]` → un literal— y corre
el middleware real sin cookie sobre cada uno, exigiendo que **ninguno** devuelva un `3xx`.

Dos controles de no-vacuidad, obligatorios (una guardia que no encuentra archivos queda verde por
vacío, que es el fallo que vino a cerrar):

- el barrido encuentra **≥ 24** archivos de ruta;
- los dos pathnames conocidos de sesión aparecen con `401` + `application/json`, y al menos un
  self-auth aparece como «pasa».

Y una **mutación de control** registrada en la bitácora: revertir la rama 5.a en memoria debe poner
la guardia **roja**. Sin esa salida pegada, la guardia no cuenta (en este repo ya hubo un arnés que
reportó supervivientes sin ejecutar un test).

## 10. Verificación: el gate rápido NO vale aquí

`middleware.ts` está en la lista de cimientos de `docs/verification.md:79`, así que
**`./init.sh --rapido` se niega solo** y manda al completo. El gate de esta ficha es **`./init.sh`
entero**, con `INIT_EXIT=$?` escrito **dentro** del log, y mirando los `skipped` (sin `DATABASE_URL`
se saltan los archivos de `integration/db`; ninguno de los tests de esta feature depende de la base,
pero el número hay que leerlo igual).

## 11. Lo que este diseño NO arregla

Repetido aquí a propósito, porque es la parte que se olvida: la sesión del integrador seguirá
venciendo a las 24 h y su carga seguirá fallando. Lo único que cambia es que el fallo será
**legible**: `401` con `{"code":"UNAUTHORIZED"}` en vez de un `200` con una página de login dentro.
El arreglo de fondo es que Nuform use la API key que ya tiene, y eso no es código.

Dos consecuencias que se gestionan **fuera del código** y están anotadas donde toca:

- **El aviso a Nuform** (D4): su cliente pasa de `200`+HTML a `401`+JSON. Es un cambio observable
  para un tercero y sale **antes** del despliegue — nota de despliegue en `tasks.md`.
- **El «tu sesión venció» en la interfaz del chat** (D3): mejora real para el mensajero, pero es UI
  y esta ficha es `backend`. Ficha aparte, a registrar cuando la 426 cierre.
