# Feature 267 — Diseño técnico

Contrato nuevo: `GET /api/ordenes/api-key/analitica` (canal integrador por API key, features
88/106/177/255/257) sobre la maquinaria de analítica de las features 122/126/128/135.
Cubre `requirements.md` R1–R44. **Sin migración.**

> Todas las citas `archivo:línea` se verificaron en el worktree `C:/w267` el 2026-08-22.
> Las decisiones marcadas ⟨P*⟩ dependen de una pregunta abierta y se cierran en la puerta.

---

## 1. La reversión de la decisión firmada (lo más delicado de la ficha)

### 1.1 Qué decisión se revierte, exactamente

`lib/analytics/alcance.ts:92-103` declara, con todas sus letras:

> «R11 / D9 — … Hoy solo la cuenta de integración `apiKey` (`db/schema.prisma:41`), denegada POR
> DISEÑO: si algún día se quiere reporting por API será ficha propia con su puerta, no una
> excepción colada por aquí.»

Esta ficha es esa ficha, y su puerta es la aprobación humana del spec. La decisión de 122/D9 **no
se estaba equivocando**: cerraba un canal que en su momento no tenía consumidor ni contrato. Lo que
ha cambiado es el hecho externo (Dropi pregunta por indicadores) y lo que existe ahora (un canal
por API key con ocho endpoints, un contrato OpenAPI publicado y una cuenta dedicada 1:1 por key).
Revertirla no es aflojar una defensa: es **abrir una segunda puerta con la misma cerradura**.

### 1.2 Por qué la cerradura sigue siendo la misma

Tres propiedades hacen que el integrador sea, para la analítica, un sujeto tan acotado como un
`adminTienda` — y ninguna de ellas es nueva:

1. **La cuenta es dedicada.** `api_key.usuario_id` es `@unique` (D6/R21 de la 81/88) y el usuario
   tiene correo y cédula sintéticos. Es otro `usuario`, con su propio id.
2. **El recorte se hace por `actor.usuarioId` contra `orden.tienda_id`** (`alcance.ts:207-211`), que
   es FK a `usuario`. Como el integrador tiene id propio, **el integrador y un `adminTienda` nunca
   son el mismo sujeto**: no comparten filas, ni `tiendaId`, ni entrada de caché.
   *(Corrección del 2026-08-22 del humano ya incorporada: el supuesto contrario que traía la ficha
   original es falso; no se gasta ni un requisito en él.)*
3. **La clave de caché ya distingue el alcance** (`cache-clave.ts:62-96`) y no hace falta tocarla.
   Invariante que sí sigue vivo y se deja escrito para el futuro: la clave se compone de métrica +
   granos + rango + alcance + filtro, y **NO** incluye la política de identidad. Hoy es inocuo
   porque dos sujetos distintos nunca comparten alcance; si algún día lo compartieran, dos
   políticas de identidad distintas se servirían la misma entrada. Que quede aquí, no en la cabeza
   de nadie.

### 1.3 Cómo se escribe la reversión en el código

`lib/analytics/alcance.ts` pasa de una partición binaria a una **partición ternaria explícita** de
los seis `RolValue`:

```
ROLES_ANALITICA            = 5 roles de UI      (lib/analytics/types.ts:54, SIN CAMBIOS)
ROLES_ANALITICA_INTEGRACION = ["apiKey"]        (NUEVA, en alcance.ts)
ROLES_SIN_ANALITICA        = []                 (se VACÍA; la constante SOBREVIVE, R5)
```

⚠ **Hallazgo que corrige esta versión del diseño (2026-08-22).** Una partición por ROL a secas
—"si `rol ∈ ROLES_ANALITICA_INTEGRACION`, conceder"— es **incompatible con R6**.
`resolverAlcance(actor, metricaId)` no sabe quién lo invoca: `prepararConsultaAnalitica` es la
MISMA función para el canal de sesión (`lib/actions/analitica-operativa.ts:110`) y para el canal
por API key de esta feature. Si la concesión dependiera solo del rol, un actor `apiKey` forzado
dentro de `consultarAnaliticaOperativa` (que es EXACTAMENTE el escenario que T10/R6 exige probar,
vía `deps.getActor`, porque hoy no hay login por cookie para `rol: "apiKey"` pero el código debe
fallar cerrado aunque esa garantía externa se rompiera) recibiría `ok`, no `forbidden` — R1 y R6
se pisarían entre sí en la misma función. Por eso `resolverAlcance` y `prepararConsultaAnalitica`
ganan un **tercer parámetro**, `canal`, con un default que reproduce el comportamiento actual en
el único llamador que existe hoy:

```ts
export type CanalAnalitica = "interno" | "api_key";

export function resolverAlcance(
  actor: ActorAnalitica | null | undefined,
  metricaId: string,
  canal: CanalAnalitica = "interno",
): ResolucionAlcance { ... }

export function prepararConsultaAnalitica(
  raw: unknown,
  actor: ActorAnalitica | null,
  metricaId: string,
  now?: Date,
  canal: CanalAnalitica = "interno",
): PreparacionAnalitica { ...  resolverAlcance(actor, metricaId, canal) ... }
```

`lib/actions/analitica-operativa.ts` **no cambia ni una línea**: llama con la misma aridad de
siempre, `canal` toma su default `"interno"` y reproduce el comportamiento de hoy byte a byte
(R43). Solo el borde nuevo de esta feature (§4.4) pasa `"api_key"` explícito.

`resolverAlcance` gana **una rama explícita**, colocada donde hoy está la denegación
(`alcance.ts:162-165`), y con el mismo criterio de fallo cerrado:

- rol en `ROLES_ANALITICA_INTEGRACION` **y** `canal === "api_key"` **y** `metricaId` en la lista
  blanca ⇒ `concedido({ tipo: "tienda", tiendaId: actor.usuarioId })` (R1);
- rol en `ROLES_ANALITICA_INTEGRACION` pero `canal !== "api_key"` (p. ej. llegó por el canal de
  sesión) ⇒ `denegado("rol_sin_analitica")`, **sin mirar siquiera la métrica** (R6): el canal
  manda antes que la lista blanca, porque conceder-por-métrica-primero dejaría una rendija donde
  una métrica publicable colase por sesión;
- rol de integración, canal correcto, métrica **no** publicable ⇒
  `denegado("metrica_prohibida")` (R15/R16);
- métrica inexistente ⇒ `denegado("metrica_desconocida")`. Los dos motivos son internos y el
  borde los traduce al **mismo** 403 mudo, así que desde fuera son indistinguibles (R16).

El orden de guardas se conserva: actor → rol → **canal** → métrica → alcance. Y el `switch` de
`alcanceAcotado` sobre `RolAnalitica` **no se toca**: el integrador no es un `RolAnalitica`, su
rama vive antes.

**Por qué no alcanza con confiar en que `apiKey` nunca tiene sesión** (alternativa descartada,
detallada también en §7.7): es verdad HOY, pero es una garantía que vive FUERA de
`lib/analytics/` (en que no existe flujo de login por cookie para ese rol). R6 pide que el propio
resolutor de alcance sea la segunda capa que no dependa de esa promesa externa — el mismo
principio de "fallar cerrado" que ya aplica R12/R13 de este mismo archivo a un rol o una métrica
desconocidos.

`ROLES_SIN_ANALITICA` vacía **no** es un adorno: es el sitio donde el próximo rol denegado se
declara sin volver a inventar el mecanismo, y `resolverAlcance` sigue consultándola (R5). Es el
mismo patrón que la 268 aplicó a `ORIGENES_SIN_EVENTO_PUBLICO`, que quedó vacía conservando el
predicado y su punto único de decisión.

### 1.4 Qué guardias se ponen rojas a propósito, y cómo se cierran

| Guardia | Por qué se pone roja | Cómo se cierra |
| --- | --- | --- |
| `alcance-fuente-unica.guardia.test.ts:138` | la unión de DOS listas ya no cubre los seis roles | se reexpresa sobre las TRES listas: unión == los 6 y **disjuntas dos a dos** (R4), más un caso que falla si dos listas comparten un rol |
| `alcance-fuente-unica.guardia.test.ts:132` | (sigue verde) `ROLES_ANALITICA` no contiene `apiKey` | **no se toca**: R3 lo exige |
| `alcance-fuente-unica.guardia.test.ts:143` | (sigue verde) ninguna métrica declara alcance para `apiKey` | **no se toca**: la lista blanca son ids, no una tabla de alcance (R21) |
| `alcance.test.ts:222` | itera roles y asume `apiKey ⇒ rol_sin_analitica` | se actualiza al comportamiento nuevo, conservando el caso «rol desconocido ⇒ denegado» **y añadiendo** «`apiKey` por canal `interno` ⇒ sigue denegado» (R6) |
| `operativa-frontera.guardia.test.ts:45-58` | prohíbe analítica en `app/api` | allowlist nominal (§5) |
| `tablero-operativo-frontera.guardia.test.ts:194-200` | prohíbe un archivo de `app/api` que se llame `analitica` | allowlist nominal (§5) |
| `openapi-177-paths…test.ts:81-98,228-238` | 8 paths firmados | sube a 9 en el mismo commit, en TS y en `.yaml` (R39) |

Ninguna se «relaja a un aserto de tamaño» ni se silencia: cada una cambia con la decisión escrita al
lado y conserva (o gana) su autocomprobación sintética.

---

## 2. Modelo de datos, migraciones y RLS

**Nada.** No hay tabla nueva, columna nueva, índice nuevo ni cambio de RLS (R44). Las fuentes son
las que ya usa la 126: `analytics_daily` (rollup, vía `AnaliticaOperativaRollupRepository` decorado
con la caché de la 128) y las tablas vivas para el día en curso
(`AnaliticaOperativaVivaRepository`, **sin** decorar: el día en curso no puede entrar en caché por
construcción, `lib/actions/analitica-operativa.ts:71-82`).

**Gate:** al no tocar `db/`, `lib/types/` ni configuración de build, el modo rápido `./init.sh
--rapido` debería bastar. **Se comprueba con el diff real antes de abrir el PR**: si aparece
`lib/types/analitica-operativa.ts` en el diff (p. ej. porque el DTO público se colocara ahí), el
modo rápido se niega solo y hay que correr `./init.sh` completo. Por eso §4.3 coloca el DTO público
**fuera** de `lib/types/`.

---

## 3. Qué métricas se publican: la lista BLANCA

⟨P1⟩ El contenido lo firma el humano. La **forma** es esta:

```
lib/analytics/publicacion-api-key.ts        (módulo PURO, sin Prisma, sin Next)
  export const METRICAS_API_KEY = [ ...ids... ] as const
  export function esMetricaPublicableApiKey(id: string): boolean
```

Por qué **inclusión** y no exclusión: es el patrón de `ORIGEN_TIPOS_VISITA_REAL` del repo — con una
lista de exclusión, una métrica nueva del catálogo se publicaría sola el día que alguien la añada
(R20). Con inclusión, lo peor que pasa es que un integrador no vea algo que podría ver, y eso se
arregla con un alta; al revés se arregla con un incidente.

El módulo vive en `lib/analytics/` porque el guardia de módulo puro lo cubre y porque
`resolverAlcance` lo importa; contiene **sólo ids** (R21), así que el censo de
`alcance-fuente-unica.guardia.test.ts` (que busca literales con forma `{ maestro: "total", … }`) no
lo confunde con una segunda tabla de alcance.

La lista se ata al catálogo por **tres asertos derivados**, no por confianza (T3):

1. todo id de la lista existe en `METRICAS` (`getMetrica(id) !== undefined`);
2. ninguna es `dominio: "financiera"` (R17) → de aquí sale gratis R34: **no hay importes en este
   canal**, así que la convención de dinero de la 230 no llega a aplicarse. Si mañana se publicara
   una métrica de `unidad: "moneda"`, la regla es la de los contratos de máquina: **céntimos
   conservados**, y una línea explícita en el OpenAPI;
3. ninguna tiene `alcance.adminTienda === "prohibido"` (R18) ni
   `estadoProduccion === "declarada"` (R19).

El tercero es el que hace verdadera la frase que vende esta feature: **el integrador nunca ve más
de lo que ve la tienda dueña de sus órdenes.**

---

## 4. El endpoint

### 4.1 Ruta y forma ⟨P4⟩

```
GET /api/ordenes/api-key/analitica?metrica=<id>&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
Authorization: Bearer ordx_...
```

Una métrica por llamada. Convivencia de rutas: segmento estático hermano de `[numGuia]/`, mismo
precedente que `carga/`, `orden/` y `cotizacion/` — el estático gana al dinámico en el App Router.

**Middleware: NADA que tocar (R41).** `middleware.ts:32` declara `/api/ordenes/api-key` en
`SELF_AUTH_ROUTES` y `:47` compara por PREFIJO, así que este subpath pasa sin darse de alta en
`PUBLIC_ROUTES` y **la guardia de la 229 sigue verde**. Escrito aquí para que nadie lo
re-investigue ni «arregle» el middleware de paso.

### 4.2 Entrada: los mismos nombres que la 257 ⟨P3⟩

| Parámetro | Tipo público | Obligatorio | Semántica |
| --- | --- | --- | --- |
| `metrica` | `string` | **sí** | id del catálogo publicable |
| `desde` | `YYYY-MM-DD` | **sí** ⟨P3⟩ | fecha calendario CR, cota inferior inclusiva |
| `hasta` | `YYYY-MM-DD` | **sí** ⟨P3⟩ | fecha calendario CR, cota superior **inclusiva** |

Publicar aquí `rango: "personalizado" | "dia" | …` (el vocabulario interno de
`analiticaFiltroSchema`) le dejaría al integrador **dos convenciones de fecha en el mismo canal**:
`desde`/`hasta` en el listado (257) y presets aquí. Se traduce por dentro:

```
raw = { rango: "personalizado", desde, hasta }   →  prepararConsultaAnalitica(raw, actor, metrica, now)
```

Es decir: el borde HTTP **construye el filtro interno**, no lo recibe. Consecuencias buenas y
buscadas: `zona_id`, `tienda_id` y `mensajero_id` **no tienen forma de llegar** desde la query
(R9/R10/R37), porque el borde nunca los escribe; y los cuatro `.refine` de `filters.ts:86-116`
—fechas coherentes, rango no invertido (R25) y tope de 366 días (R26)— se aplican tal cual, sin
reescribir ni una validación.

Lectura de la query **clave por clave** (R27), igual que `app/api/ordenes/api-key/route.ts:93-101`:
volcar la query entera convertiría cualquier clave futura en entrada del schema, que es justo lo
que 106/R8 impide.

Orden normativo del borde, heredado de la 255 (`cotizacion/route.ts:97-99`):
`auth (401/403)` → `query (422)` → `preparar (403 | 422)` → `servicio (200)` (R23).

### 4.3 Salida: proyección explícita, nunca el objeto interno

La 126 devuelve `SerieOperativa` (`lib/types/analitica-operativa.ts:101-112`). **No se serializa
tal cual** (R31): el borde proyecta campo a campo a un DTO público declarado en
`lib/api/analitica-api-key-dto.ts` (fuera de `lib/types/`, ver §2 sobre el gate):

```jsonc
{
  "metrica": "entregas",
  "unidad": "conteo",
  "unidadDeConteo": "gestion",
  "rango":  { "desde": "2026-08-01", "hasta": "2026-08-21" },   // YYYY-MM-DD CR, como la 257
  "puntos": [
    { "fecha": "2026-08-20", "valor": 37 },
    { "fecha": "2026-08-21", "valor": 12, "parcial": true, "corteAt": "2026-08-21T18:40:00.000Z" }
  ],
  "cobertura": { "fechasNoComparables": [], "penumbra": "ordenes_vivas_al_horizonte_sin_transicion_posterior" }
}
```

- `rango` se publica con `desdeFecha`/`hastaFecha` del `RangoResuelto` (`types.ts:249-252`), no con
  los `Date`: así el eco del rango habla el mismo idioma que la entrada (R24) y **ningún `Date`
  crudo se serializa** (R30).
- `valor: number | null` siempre; `null` es «no se sabe», nunca `0` (R30).
- `cobertura` **obligatoria** (R29): es la razón entera por la que existe en el contrato interno
  (`analitica-operativa.ts:12-17`).
- `parcial`/`corteAt` ⟨P5⟩: aditivos y opcionales. Sin ellos, el día de hoy se lee como un día
  cerrado y el integrador ve una caída que no existe.
- `dimension` **no se publica en v1** ⟨P2⟩: sin desagregación no hay dimensión que emitir, y con la
  desagregación por mensajero prohibida, publicarla sólo abriría preguntas.
- **Nada de `BigInt`**: la conversión ya la hace la 126 (`seg_ciclo_acum` no cruza), y R30 lo
  asegura sobre la cadena serializada, que es donde `JSON.stringify` lanzaría.

Errores: `401`/`403`/`422` con la shape global del repo (`appErrorToResponse`), reutilizando por
`$ref` las responses que el OpenAPI ya declara.

### 4.4 Dónde vive la lógica: el borde del canal integrador

```
app/api/ordenes/api-key/analitica/route.ts     ← cascarón HTTP: bearer, query, status, JSON
lib/api/analitica-integrador.ts                ← EL BORDE: los cuatro pasos de la 126
```

`lib/api/analitica-integrador.ts` es el hermano de `lib/actions/analitica-operativa.ts` para el
canal público, y recorre **los mismos cuatro pasos, en el mismo orden**:

1. actor (aquí: el de `ApiKeyAuthResult.ok`, no el de la sesión);
2. `prepararConsultaAnalitica(raw, actor, metricaId, now, "api_key")` — una sola llamada (R14), con
   el **quinto argumento explícito** que distingue este canal del de sesión (§1.3): es la única
   diferencia de invocación entre este borde y `lib/actions/analitica-operativa.ts:110`;
3. `forbidden` ⇒ `logger.logError(describirDenegado({...}))` **y después** responder (R32) — con la
   trampa ya conocida: `normalizeError` sólo llama al logger en la rama del error desconocido
   (`lib/errors/normalize.ts:22,45`), así que lanzar `ForbiddenError` y confiar en
   `withErrorHandler` produce **un 403 mudo**. La llamada al logger es EXPLÍCITA y su test espía el
   logger, no el status;
4. `ok` ⇒ `AnaliticaOperativaService.consultar(consulta)` — **el mismo servicio, el mismo
   repositorio y la misma caché** que el canal de sesión (R43). No hay repositorio nuevo, no hay
   consulta nueva, no hay `$queryRaw` (R13).

El oráculo (`sondeaIdentidadDeMensajero`) se invoca **igual que en la Server Action**
(`analitica-operativa.ts:132-134`), sin duplicar el predicado (R37). Con política `seudonima` y un
filtro que nombre `mensajero_id`, 403 auditado; como el borde nunca escribe `mensajero_id`, es
defensa en profundidad, no una vía viva.

La política de identidad: `politicaIdentidadDe` (`consulta.ts:181-184`) hoy devuelve `"real"` para
un rol que no sea de analítica. Con `apiKey` llegando hasta ahí, **ese fallback pasa de inalcanzable
a peligroso**. Se cambia a fallo cerrado: rol de integración ⇒ `"seudonima"`, y el `else` final
⇒ `"seudonima"` en vez de `"real"` (R38). Es estrictamente más restrictivo y no altera a los cinco
roles (R43), que se resuelven por `politicaIdentidadMensajero` antes de llegar al fallback.

---

## 5. Las dos guardias de frontera ⟨P6⟩

Hoy dicen «ninguna analítica bajo `app/api`». Su motivo escrito es «las lecturas internas van por
Server Action; los route handlers son para webhooks y **API pública**». Este canal es API pública:
la excepción cabe en el motivo, pero el guardia no se borra, se **estrecha**.

- `operativa-frontera.guardia.test.ts` — la prohibición de mencionar
  `AnaliticaOperativaService` / `AnaliticaOperativa*Repository` / `consultarAnaliticaOperativa`
  desde `app/api` **se conserva íntegra**, y el diseño de §4.4 la respeta de verdad: el route
  handler no nombra ni el servicio ni el repositorio, sólo llama al borde de `lib/api/`. El guardia
  gana un caso NUEVO: *existe exactamente un borde de analítica por canal, y los dos auditan el
  denegado* (`lib/actions/analitica-operativa.ts` y `lib/api/analitica-integrador.ts`).
- `tablero-operativo-frontera.guardia.test.ts:194-200` — «ningún archivo de `app/api` con
  `/analitica/i` en la ruta» pasa a allowlist nominal de **un** camino,
  `app/api/ordenes/api-key/analitica/route.ts`, con la decisión fechada escrita encima y una
  autocomprobación: un segundo handler sintético (`app/api/reportes/analitica/route.ts`) **debe**
  seguir cayendo (R42).

Lo que NO se hace: renombrar la ruta para esquivar el regex. Pasaría el guardia sin pasar su motivo,
y el próximo lector no encontraría ni la analítica ni la decisión.

---

## 6. Documentación pública (R39/R40)

`lib/api/openapi-spec.ts` gana el **noveno** path, `"/api/ordenes/api-key/analitica"`, con:
`parameters` (`metrica` como `enum` con los ids de `METRICAS_API_KEY`, `desde`/`hasta` como
`format: date` con ejemplo y la nota «inclusivo; el día se mide en hora de Costa Rica (UTC-6)»,
copiada de la 257), `responses.200` con `$ref` a un schema nuevo `AnaliticaSerie` y `401/403/422`
por `$ref` a las responses existentes.

`docs/api/api-key-openapi.yaml` es **espejo textual exacto**: mismo path, misma posición (novena),
mismo schema. Nada más lo mantiene sincronizado, y por eso el test lo comprueba sobre los dos
artefactos.

⚠ **La prosa nueva no puede contener la subcadena `intentos`** (R40,
`tests/unit/types/intentos-no-alcance.test.ts:36-42`, que compara sobre el spec serializado en
minúsculas). Cuidado con redactar «intentos de entrega» en una descripción: es la trampa más fácil
de esta feature. Si la lista blanca ⟨P1⟩ incluyera una métrica con «intentos» en su etiqueta o
descripción del catálogo, **hay conflicto directo con 160/R31** y hay que resolverlo en la puerta
(no publicar esa métrica, o publicarla con etiqueta propia). Anotado en T3.

La colección Postman queda como está: es de ejemplos, no de contrato.

---

## 7. Alternativas evaluadas y descartadas

### 7.1 Declarar `apiKey` como sexto `RolAnalitica` y darle columna en las 25 métricas — DESCARTADA

Es la opción «limpia» a primera vista: `Metrica.alcance` es
`Readonly<Record<RolAnalitica, AlcanceMetrica>>` (`types.ts:195`), así que añadir `apiKey` al tipo
**obligaría** a que cada métrica declarase qué ve el integrador, y la fuente única (122/R8) seguiría
siendo el catálogo. Se descarta por el **radio de explosión**, que se midió:

- `lib/auth/menu-visibility.ts:155` deriva `ROLES_ACCESO_ANALITICA` **restando** de
  `ROLES_ANALITICA`. Un sexto rol lector entraría **automáticamente al sidebar y al gate
  `notFound()` de la ruta** salvo que alguien se acuerde de restarlo también. Una cuenta de máquina
  con ítem de menú es exactamente el fallo silencioso que R7 prohíbe.
- Al menos doce archivos de test afirman hoy `ROLES_ANALITICA.length === 5` o
  `not.toContain("apiKey")` (`types.test.ts:45-55`, `alcance.test.ts:41`, `metrics.test.ts:141`,
  `presentacion.test.ts:54`, `alcance-matriz`, `alcance-granos`, `alcance-dinero`,
  `financiera-alcance`, `metrics-dinero`, `menu-visibility`…). Cambiar el número no es «actualizar
  un guardia»: es reabrir la matriz de alcance de las 25 métricas para los cinco roles vivos.
- `lib/analytics/presentacion.ts` y `politicaIdentidadMensajero` son `switch` exhaustivos sobre los
  cinco roles: pasarían a exigir una respuesta de UI para una cuenta que no tiene UI.

Coste de la alternativa elegida: la publicación se declara en **dos** sitios (el catálogo dice el
alcance; la lista blanca dice qué se publica). Se paga atándolos por test (§3, R17/R18/R19) en vez
de por disciplina.

### 7.2 Inventar una quinta variante de `AlcanceDatos` (`{ tipo: "integrador", … }`) — DESCARTADA

`claveDeAlcance` (`cache-clave.ts:85-96`) es un `switch` exhaustivo **sin `default`** y su cabecera
avisa de que una clave que no distingue el alcance «NO da una cifra equivocada: FILTRA DATOS ENTRE
ROLES». Una quinta variante obliga a tocar esa función, `recortarFiltro` (`consulta.ts:144-166`),
`alcance-columnas.ts` y el guardia dedicado — todo para expresar **exactamente el mismo recorte**
que `tipo: "tienda"`: `orden.tienda_id = <usuarioId>`. Dos formas de decir lo mismo en una frontera
multi-tenant es una de más.

### 7.3 Un endpoint multi-métrica (`?metricas=a,b,c`) — DESCARTADA para v1

Ahorraría llamadas, pero obliga a inventar el contrato del éxito parcial: si tres de cinco métricas
no son publicables, ¿403 del lote, o 200 con huecos? Nadie lo ha pedido y cada respuesta es una
promesa difícil de retirar. Una métrica por llamada es lo que la maquinaria hace por dentro
(`prepararConsultaAnalitica` recibe UN `metricaId`) y hace trivialmente correcto el 403 de R16.
Nada impide añadirlo después sin romper este.

### 7.4 Publicar el vocabulario interno de filtros (`rango`, `zona_id`, `tienda_id`) — DESCARTADA

Sería «gratis» (el schema ya existe y es `.strict()`). Se descarta por dos razones: (a) le daría al
integrador una segunda convención de fechas en el mismo canal, contra la 257; y (b) aceptar
`tienda_id` del cliente convierte el 403 de R10 en un camino **vivo** que hay que probar y sostener,
cuando puede ser un camino **inexistente**: si el borde construye el filtro, no hay campo por el que
pedir datos ajenos. La intersección de `consulta.ts:144-166` queda como cinturón, no como puerta.

### 7.5 Servir la analítica por una Server Action y que el integrador la llame — IMPOSIBLE, anotada

Se anota para cerrarla: una Server Action no es una superficie HTTP estable ni documentable en
OpenAPI, y su protocolo es interno de Next. La analítica por API key **exige** un route handler; por
eso las guardias de §5 tienen que cambiar y no hay tercera vía.

### 7.7 Conceder por rol sin distinguir canal, confiando en que `apiKey` nunca tiene sesión — DESCARTADA

Es la primera redacción de §1.3 (corregida en esta versión). Funcionaría mientras siga siendo
cierto que ningún flujo de login por cookie produce `rol: "apiKey"` — pero esa es una garantía
que vive fuera de `lib/analytics/`, y R6 exige explícitamente que el propio resolutor de alcance
sea una segunda capa que no dependa de ella: el test de R6 fuerza el escenario con
`deps.getActor` y debe fallar cerrado igual. Sin un `canal` explícito, `resolverAlcance` no tiene
con qué negarse, y una concesión "por rol" colisionaría en la misma función con la denegación que
R6 exige para el canal de sesión. El parámetro `canal` (default `"interno"`, sin tocar al único
llamador existente) resuelve la colisión sin inventar una segunda función ni duplicar el orden de
los cuatro pasos (que sí violaría R13/R14).

### 7.8 Cachear la respuesta pública del endpoint — DESCARTADA

La caché ya existe donde debe (decorador de la 128 sobre el rollup, con clave que distingue el
alcance). Una segunda caché en el borde tendría su propia clave, y una clave de borde mal compuesta
es exactamente el fallo que `cache-clave.ts:6-18` describe: no una cifra equivocada, **datos de otra
tienda**.

---

## 8. El delta exacto que ve el integrador

Antes: nada. Analítica = no disponible por el canal de integración.

Después: **un** endpoint `GET`, autenticado con su key de siempre, que responde para **sus** órdenes
una serie diaria de **una** métrica de la lista publicada, con el rango que pidió en el mismo
formato de fecha que ya usa en el listado, con el bloque `cobertura` que le dice qué días no son
comparables, y con el día en curso marcado `parcial` ⟨P5⟩. Sin identidades de mensajero, sin dinero,
sin datos de otra tienda y sin forma de preguntar por ellos.

---

## 9. Archivos que se tocan

| Archivo | Cambio |
| --- | --- |
| `lib/analytics/alcance.ts` | partición ternaria + tercer parámetro `canal: CanalAnalitica` + rama `apiKey` en `resolverAlcance` (§1.3) |
| `lib/analytics/publicacion-api-key.ts` | **nuevo**: lista blanca de ids + predicado |
| `lib/analytics/consulta.ts` | quinto parámetro `canal` en `prepararConsultaAnalitica`, política de identidad del integrador y fallback cerrado (R38) |
| `lib/api/analitica-integrador.ts` | **nuevo**: el borde del canal (4 pasos + auditoría) |
| `lib/api/analitica-api-key-dto.ts` | **nuevo**: DTO público + proyección explícita (R31) |
| `app/api/ordenes/api-key/analitica/route.ts` | **nuevo**: cascarón HTTP |
| `lib/api/openapi-spec.ts` | noveno path + schema `AnaliticaSerie` |
| `docs/api/api-key-openapi.yaml` | espejo textual exacto |
| `tests/unit/analytics/alcance-fuente-unica.guardia.test.ts` | invariante ternario (R4) |
| `tests/unit/analytics/alcance.test.ts` | comportamiento nuevo del rol `apiKey` |
| `tests/unit/analytics/operativa-frontera.guardia.test.ts` | caso nuevo: un borde por canal |
| `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` | allowlist nominal (R42) |
| `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` | 8 → 9 paths |

**Sin tocar:** `db/schema.prisma`, migraciones, `middleware.ts`, `lib/types/`,
`lib/analytics/metrics.ts`, `lib/analytics/cache-clave.ts`, `lib/analytics/identidad.ts`,
`lib/auth/menu-visibility.ts`, los repositorios y servicios de analítica, la UI.

---

## 10. Trazabilidad `R<n> → test`

Nombres propuestos; el implementer los fija y el reviewer los verifica. `→ (existente)` = test que
ya existe y debe seguir verde o actualizarse con la decisión escrita.

| R | Test |
| --- | --- |
| R1 | `tests/unit/analytics/alcance-api-key.test.ts` › «un actor apiKey recibe alcance de tienda con su propio usuarioId» |
| R2 | `tests/unit/analytics/cache-clave-alcance.guardia.test.ts` (existente, sin cambios) + aserto de que `AlcanceDatos` sigue teniendo 4 variantes |
| R3 | `tests/unit/analytics/alcance-fuente-unica.guardia.test.ts` › «ROLES_ANALITICA no contiene apiKey y son cinco» (existente) |
| R4 | `alcance-fuente-unica.guardia.test.ts` › «las tres listas son disjuntas y cubren los seis RolValue» |
| R5 | `alcance-fuente-unica.guardia.test.ts` › «ROLES_SIN_ANALITICA sigue exportada, tipada y consultada, aunque esté vacía» |
| R6 | `tests/unit/analytics/alcance-api-key.test.ts` › «`resolverAlcance(actor apiKey, metrica publicable, canal "interno")` ⇒ denegado» + `tests/unit/actions/analitica-operativa-api-key-denegado.test.ts` › «un actor apiKey forzado por `deps.getActor` en `consultarAnaliticaOperativa`/`consultarAgregadoOperativo` sigue recibiendo forbidden, sin motivo» |
| R7 | `tests/unit/auth/menu-visibility.test.ts` (existente) + caso «apiKey no está en ROLES_ACCESO_ANALITICA» |
| R8 | `tests/unit/api/analitica-integrador-borde.test.ts` › «y con el recorte a SU propia tienda: la politica no sustituye al alcance» + `tests/unit/api/analitica-api-key-route.test.ts` › «el filtro que LLEGA AL SERVICIO es el mismo, recortado a la tienda del actor» |
| R9 | `tests/unit/api/analitica-api-key-route.test.ts` › «tienda_id/zona_id/mensajero_id en la query no alteran la consulta» |
| R10 | `analitica-integrador-borde.test.ts` › «pedir la tienda de otro es forbidden auditado, nunca 200 con serie vacía (267/R10)» + `analitica-api-key-route.test.ts` › «si alguien la colara en el filtro interno, la intersección vacía es 403 y NO 200 vacío» |
| R11 | `alcance-api-key.test.ts` › «actor sin usuarioId útil ⇒ denegado y cero llamadas al repositorio» |
| R12 | `tests/unit/analytics/cache-clave.test.ts` › «267/R12 · mismo rango, misma métrica, mismo filtro: la clave DIFIERE por el sujeto del alcance» (escrito en la revisión del 2026-08-23) + `cache-clave-alcance.guardia.test.ts` › «cada variante produce una clave DISTINTA, y el id entra en ella» |
| R13 | `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` (existente, **sin excepciones nuevas**) |
| R14 | `tests/unit/api/analitica-integrador-borde.test.ts` › «una sola llamada a prepararConsultaAnalitica» (espía) |
| R15 | `tests/unit/analytics/publicacion-api-key.test.ts` › «sólo los ids de la lista se conceden» |
| R16 | `analitica-api-key-route.test.ts` › «métrica no publicable y métrica inexistente devuelven respuestas idénticas» |
| R17 | `publicacion-api-key.test.ts` › «ninguna métrica publicable es financiera» |
| R18 | `publicacion-api-key.test.ts` › «ninguna publicable tiene adminTienda: prohibido» |
| R19 | `publicacion-api-key.test.ts` › «ninguna publicable está sólo declarada» |
| R20 | `publicacion-api-key.test.ts` › «una métrica nueva sintética del catálogo NO queda publicada» |
| R21 | `alcance-fuente-unica.guardia.test.ts` › censo (existente): la lista blanca no declara alcance por rol |
| R22 | `analitica-api-key-route.test.ts` › «sin Bearer ⇒ 401 antes de parsear la query» |
| R23 | `analitica-api-key-route.test.ts` › «401 sin key / 403 usuario inactivo / precedencia sobre 422» |
| R24 | `analitica-api-key-route.test.ts` › «desde/hasta YYYY-MM-DD CR, hasta inclusivo» (reloj fijo) |
| R25 | `analitica-api-key-route.test.ts` › «desde > hasta ⇒ 422 con fieldErrors.hasta» |
| R26 | `analitica-api-key-route.test.ts` › «ventana de 367 días ⇒ 422» |
| R27 | `analitica-api-key-route.test.ts` › «clave desconocida en la query no cambia la respuesta» |
| R28 | `analitica-api-key-contrato.test.ts` › «la respuesta 200 declara metrica, unidad, unidadDeConteo, rango, puntos y cobertura» |
| R29 | `analitica-api-key-contrato.test.ts` › «cobertura siempre presente» |
| R30 | `analitica-api-key-contrato.test.ts` › «JSON.stringify no lanza y no hay Date ni BigInt» |
| R31 | `analitica-api-key-contrato.test.ts` › «un campo nuevo del contrato interno NO aparece en la respuesta» (serie con campo extra inyectado) |
| R32 | `analitica-integrador-borde.test.ts` › «forbidden: 403 mudo y logger.logError llamado» (espía del logger) |
| R33 | `analitica-api-key-route.test.ts` › «ni la key ni el header aparecen en el logger ni en el cuerpo» |
| R34 | `publicacion-api-key.test.ts` › «ninguna publicable tiene unidad moneda» |
| R35 | `analitica-integrador-borde.test.ts` › «la consulta preparada lleva politicaIdentidad seudonima» |
| R36 | `analitica-api-key-contrato.test.ts` › «la cadena serializada no contiene ningún uuid de mensajero» |
| R37 | `analitica-integrador-borde.test.ts` › «filtro con mensajero_id ⇒ 403 auditado» |
| R38 | `tests/unit/analytics/consulta.test.ts` › «el fallback de política de identidad es seudonima» |
| R39 | `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` › «nueve paths en TS y en el .yaml, mismo orden» |
| R40 | `tests/unit/types/intentos-no-alcance.test.ts` (existente, sin cambios) |
| R41 | guardia 229 (existente, sin cambios) + `analitica-api-key-route.test.ts` › «middleware.ts no está en el diff» — verificación del reviewer sobre el diff, no un grep |
| R42 | `tablero-operativo-frontera.guardia.test.ts` › «un segundo handler sintético de analítica en app/api sigue cayendo» |
| R43 | suites existentes de 122/126/128/131/176 verdes sin editar sus asertos de comportamiento |
| R44 | `tests/unit/guards/schema-drift…` (existente) + ausencia de `db/migrations/**` en el diff, verificada por el reviewer |

### 10.1 Corrección de la revisión del 2026-08-23

El reviewer bloqueó la feature por un agujero REAL y reproducido: la guarda de canal vivía
**solo dentro** de la rama del rol de integración, así que un actor con `canal: "api_key"` y
cualquiera de los cinco roles lectores caía a la rama del catálogo (`resolverAlcance(
{rol:"maestro"}, "cod_recaudado", "api_key")` ⇒ `{tipo:"global"}`: métrica **financiera**,
**todos los inquilinos**). Como **R15/R17/R18/R19/R34 están escritos sobre el CANAL y no sobre
el rol**, esos cinco requisitos NO estaban cubiertos para un actor no-integrador. Se añade la
guarda simétrica —`canal === "api_key"` ⇔ rol de integración— en el punto único de decisión:

| R | Test |
| --- | --- |
| R15/R17/R18/R19/R34 (sobre el canal, no sobre el rol) | `alcance-api-key.test.ts` › «los CINCO roles lectores por canal api_key se deniegan, contra las tres métricas» (15 casos **derivados de `ROLES_ANALITICA`**: publicable / no publicable / financiera) + «el bicondicional en las dos direcciones» + el espejo positivo «el rol de INTEGRACIÓN por api_key con métrica publicable sigue concediendo su tienda» |
| Defensa en profundidad del canal (267, capa de autenticación) | `tests/unit/services/api-key-auth-service.test.ts` › «una fila cuyo usuario dedicado tiene rol X → forbidden» (`ApiKeyAuthService` deja de castear `encontrada.rol` sin comprobarlo) |
