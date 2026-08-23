# Feature 267 — tasks

> **Regla de «hecho» en esta ficha:** el criterio es **un aserto que se pone rojo si el código está
> mal**, nunca un `grep`. En la feature 257 se «cumplieron» criterios de grep reescribiendo
> comentarios y hubo que retractarlo. Cuando algo sólo se puede comprobar leyendo, se dice
> explícitamente que la verificación es **humana** y quién la firma.

> **Nada de esto empieza antes de la puerta.** El spec está en `spec_ready`; hay cinco decisiones
> del humano (P1–P5) y tres hallazgos (P6–P8) en `requirements.md > Preguntas abiertas`. T0 las
> cierra por escrito.

Leyenda: `[P]` = paralelizable con las demás `[P]` de su bloque.

---

## T0 — Cerrar las preguntas abiertas y fijar el punto de partida (BLOQUEA TODO)

1. Pegar en `progress/impl_267.md` la respuesta del humano a **P1–P8**, una línea por pregunta,
   con fecha. En particular: la **lista blanca de métricas** (P1), si el mensajero se prohíbe
   entero (P2), si `desde`/`hasta` son obligatorios (P3), la ruta (P4), si se publica `parcial`
   (P5), y la autorización explícita para tocar las dos guardias de frontera (P6).
2. `git fetch origin && git log --oneline origin/dev -- lib/analytics/ lib/api/openapi-spec.ts docs/api/api-key-openapi.yaml app/api/ordenes/api-key/`
   — comprobar que la 266 y el PR #434 no han aterrizado ya sobre los mismos archivos.
3. Medir el baseline **antes** de tocar nada: `pnpm exec tsc --noEmit` y la suite de
   `tests/unit/analytics/` + `tests/unit/api/`. Los baselines de la bitácora caducan.

**Hecho cuando:** `progress/impl_267.md` abre con el SHA de `origin/dev` usado, las ocho respuestas
y los dos conteos del baseline (typecheck y rojos preexistentes por archivo). Verificación humana:
la firma el implementer, la revisa el reviewer.

---

## T1 — La lista blanca de métricas (depende de T0; **es la primera pieza de código**)

Crear `lib/analytics/publicacion-api-key.ts`: módulo puro, `METRICAS_API_KEY` con los ids que
firmó P1 y `esMetricaPublicableApiKey(id)`. Sólo ids: **nada de una tabla `{ maestro: …, apiKey: … }`**
(R21).

**Hecho cuando** `tests/unit/analytics/publicacion-api-key.test.ts` está verde con, como mínimo,
estos asertos derivados del catálogo (no listas copiadas a mano):
- todo id de la lista resuelve con `getMetrica(id)` (R15);
- `METRICAS.filter(m => esMetricaPublicableApiKey(m.id))` no contiene ninguna
  `dominio: "financiera"` (R17), ninguna con `alcance.adminTienda === "prohibido"` (R18), ninguna
  `estadoProduccion: "declarada"` (R19), ninguna `unidad: "moneda"` (R34);
- una métrica sintética añadida al catálogo en el test **no** queda publicada (R20).

**No hacer:** tocar `lib/analytics/metrics.ts`. Si alguna métrica deseada por P1 incumple R17–R19,
**se para y se pregunta**; no se ajusta el catálogo para que quepa.

---

## T2 — La reversión en `lib/analytics/alcance.ts` y `consulta.ts` (depende de T1)

⚠ **Corrección de diseño (2026-08-22) sobre la primera redacción de esta task:** una rama que
conceda solo por pertenencia a `ROLES_ANALITICA_INTEGRACION` es incompatible con R6 —
`resolverAlcance` es la misma función para el canal de sesión y para el canal por API key, y sin
saber quién la invoca no puede negarse para el primero y conceder para el segundo. Se añade un
tercer parámetro `canal` (ver `design.md §1.3`).

1. `ROLES_ANALITICA_INTEGRACION = ["apiKey"] as const`; `ROLES_SIN_ANALITICA = [] as const`
   (constante, tipo y uso en `resolverAlcance` **conservados**, R5).
2. `export type CanalAnalitica = "interno" | "api_key"` en `alcance.ts`. `resolverAlcance` gana un
   tercer parámetro `canal: CanalAnalitica = "interno"`; `prepararConsultaAnalitica`
   (`consulta.ts`) gana un quinto parámetro `canal: CanalAnalitica = "interno"` y lo reenvía tal
   cual a `resolverAlcance`. **No se toca la llamada existente** en
   `lib/actions/analitica-operativa.ts:110`: con el default, su comportamiento no cambia (R43).
3. Rama explícita en `resolverAlcance`, en el lugar donde hoy está la denegación (`:162-165`):
   rol de integración + `canal === "api_key"` + métrica publicable ⇒
   `{ tipo: "tienda", tiendaId: actor.usuarioId }` (R1); rol de integración + `canal !== "api_key"`
   ⇒ `denegado("rol_sin_analitica")` **sin mirar la métrica** (R6); rol de integración + canal
   correcto + métrica no publicable ⇒ `metrica_prohibida`; sin `usuarioId` útil ⇒ `sin_sesion` (ya
   lo hace la guarda de `:157`, comprobarlo, no duplicarlo).
4. Comentario fechado (2026-08-22, feature 267) que diga: qué decisión de 122/D9 se revierte, por
   qué el sujeto sigue acotado (cuenta dedicada 1:1, recorte por `orden.tienda_id`), por qué NO se
   creó una quinta variante de `AlcanceDatos`, y por qué existe el parámetro `canal` (R6 no puede
   apoyarse solo en que hoy no hay login por cookie para `apiKey`).

**Hecho cuando** `tests/unit/analytics/alcance-api-key.test.ts` está verde con, como mínimo:
alcance de tienda con el `usuarioId` del propio actor bajo `canal: "api_key"` (R1); **el mismo
actor y la misma métrica bajo `canal: "interno"` (o sin pasar el tercer argumento) siguen
denegados** (R6 — este es el caso que la redacción anterior de esta task no cubría); métrica no
publicable bajo `canal: "api_key"` ⇒ denegado (R15); actor sin id ⇒ denegado sin tocar el
repositorio (R11); y `AlcanceDatos` sigue teniendo cuatro variantes (R2, comprobado porque
`claveDeAlcance` compila y su guardia sigue verde). El punto 4 es verificación **humana** del
reviewer: no se acepta ningún `grep` sobre el comentario.

---

## T3 — Actualizar las guardias de rol que se ponen rojas a propósito (depende de T2)

- `tests/unit/analytics/alcance-fuente-unica.guardia.test.ts`: el invariante pasa a **tres listas**
  — unión == los seis `RolValue` y **disjuntas dos a dos** (R4) —, más un caso que falla si un rol
  aparece en dos listas, más el aserto de que `ROLES_SIN_ANALITICA` sigue exportada y tipada aunque
  esté vacía (R5). **No se tocan** los casos «ROLES_ANALITICA no contiene apiKey» (R3) ni «ninguna
  métrica declara alcance para apiKey» (R21).
- `tests/unit/analytics/alcance.test.ts:222`: el caso que asumía `apiKey ⇒ rol_sin_analitica` se
  reexpresa al comportamiento nuevo, conservando «un rol desconocido sigue denegado».

**Hecho cuando** los dos archivos pasan y el caso de disjunción falla al inyectar (en el test, sobre
copias locales) un rol duplicado en dos listas.

---

## T4 [P] — Política de identidad: fallo cerrado (depende de T2)

En `lib/analytics/consulta.ts:181-184`: rol de integración ⇒ `"seudonima"`, y el fallback final
pasa de `"real"` a `"seudonima"` (R38).

**Hecho cuando** `tests/unit/analytics/consulta.test.ts` afirma que (a) una consulta preparada para
un actor `apiKey` lleva `politicaIdentidad: "seudonima"` (R35) y (b) un actor con rol basura
tampoco obtiene `"real"`; y las suites de los cinco roles siguen verdes sin editar sus asertos
(R43).

---

## T5 [P] — El borde del canal integrador (depende de T2; se escribe junto con T6)

`lib/api/analitica-integrador.ts`: los cuatro pasos de la 126 con el actor de la key —
`prepararConsultaAnalitica(raw, actor, metricaId, now, "api_key")` (una sola llamada, **con el
quinto argumento `"api_key"` explícito** — es la pieza que activa la rama de concesión de T2 y la
única diferencia de invocación frente a `lib/actions/analitica-operativa.ts:110`), `forbidden` ⇒
`logger.logError(describirDenegado(...))` **y después** responder, oráculo
`sondeaIdentidadDeMensajero` reutilizado (no reimplementado), `ok` ⇒
`AnaliticaOperativaService.consultar`. Deps inyectables (`service`, `logger`, `now`), patrón de
`AnaliticaOperativaDeps`.

**Hecho cuando** `tests/unit/api/analitica-integrador-borde.test.ts` está verde con: espía que
comprueba **una** llamada a `prepararConsultaAnalitica` (R14); un `forbidden` que llama al logger
(R32 — el test espía el **logger**, no el status: la trampa de `normalizeError` está en
`design.md §4.4`); política `seudonima` en la consulta (R35); filtro con `mensajero_id` ⇒ 403
auditado (R37); y **cero** llamadas al repositorio en todos los caminos denegados.

---

## T6 [P] — El DTO público y su proyección (depende de T2)

`lib/api/analitica-api-key-dto.ts` — **fuera de `lib/types/`** a propósito: tocar `lib/types/` niega
el gate rápido (`design.md §2`). Proyección campo a campo desde `SerieOperativa`, con `rango` en
`YYYY-MM-DD` (de `desdeFecha`/`hastaFecha`) y `cobertura` obligatoria.

**Hecho cuando** `tests/unit/api/analitica-api-key-contrato.test.ts` está verde: forma completa
(R28), `cobertura` presente siempre (R29), `JSON.stringify` no lanza y no queda ningún `Date` ni
`BigInt` (R30), un campo extra inyectado en la serie interna **no** aparece en la salida (R31), y la
cadena serializada no contiene ningún uuid (R36).

---

## T7 — El route handler (depende de T5 y T6)

`app/api/ordenes/api-key/analitica/route.ts`: `runtime = "nodejs"`, bearer con
`extraerBearer`/`buildAutenticar` de `lib/api/api-key-request.ts` (no se reescribe la extracción),
query **clave por clave**, schema zod con `metrica`/`desde`/`hasta`, y llamada al borde de T5. El
handler **no** nombra el servicio ni el repositorio de analítica (así la guardia 126/R1 sigue verde
de verdad, no por casualidad).

**Hecho cuando** `tests/unit/api/analitica-api-key-route.test.ts` está verde: 401 sin key y con key
inexistente, 403 con usuario inactivo, ambos **antes** de cualquier 422 (R22/R23); `desde`/`hasta`
inclusivos con reloj fijo (R24); `desde > hasta` ⇒ 422 en `fieldErrors.hasta` (R25); 367 días ⇒ 422
(R26); `tienda_id`/`zona_id`/`mensajero_id`/clave inventada en la query no cambian ni la respuesta
ni el filtro que llega al servicio (R9/R27); métrica no publicable y métrica inexistente devuelven
respuestas **idénticas** (R16); pedir otra tienda ⇒ 403, nunca 200 vacío (R10); ni la key ni el
header aparecen en el logger ni en el cuerpo (R33).

---

## T8 — Estrechar las dos guardias de frontera (depende de T7; **no antes**)

Se hace **después** de que el handler exista, para que el cambio de guardia se vea junto a lo que
autoriza y no como una relajación suelta.

- `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts:194-200` ⇒ allowlist nominal de
  **un** camino, con la decisión fechada escrita encima.
- `tests/unit/analytics/operativa-frontera.guardia.test.ts` ⇒ se conserva íntegra la prohibición de
  mencionar servicio/repositorio/Server Action desde `app/api`, y gana el caso «existe exactamente
  un borde de analítica por canal».

**Hecho cuando** las dos guardias pasan **y** su autocomprobación sintética falla ante un segundo
handler inventado (`app/api/reportes/analitica/route.ts`) y ante un handler que importe
`AnaliticaOperativaService` (R42). Sin ese caso negativo la task **no** está hecha.

---

## T9 — Publicar el contrato (depende de T7)

`lib/api/openapi-spec.ts` gana el noveno path y el schema `AnaliticaSerie`;
`docs/api/api-key-openapi.yaml` se actualiza como espejo textual **en el mismo commit**, mismo
orden, misma posición.

**Hecho cuando** `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` afirma **nueve** paths en
el objeto TS y en el `.yaml`, en el mismo orden (R39), **y**
`tests/unit/types/intentos-no-alcance.test.ts` sigue verde sin tocarlo (R40 — ojo con la prosa
nueva: si la lista blanca de P1 trajera una métrica con «intentos» en su texto, se para y se
pregunta).

---

## T10 [P] — No-regresión del canal de sesión y del tablero (depende de T2, T4)

**Hecho cuando** están verdes, **sin editar sus asertos de comportamiento**: las suites de 122
(`alcance*`, `consulta`, `identidad`), 126 (`operativa*`), 128 (`cache-clave*`), 131/133
(`tablero-*`, `presentacion`) y `tests/unit/auth/menu-visibility.test.ts`; más un caso nuevo que
afirma que `ROLES_ACCESO_ANALITICA` sigue con los cuatro roles y que un actor `apiKey` por **sesión**
(es decir, `deps.getActor` devolviendo `{ usuarioId, rol: "apiKey" }` a `consultarAnaliticaOperativa`
o `consultarAgregadoOperativo`, que llaman a `prepararConsultaAnalitica` con el `canal` por
defecto) recibe `forbidden`, sin datos y sin motivo, de las dos Server Actions (R6/R7/R43). Este es
el caso que la task T2 corrigió: antes de la corrección de diseño del 2026-08-22, este mismo test
habría fallado.

---

## T11 — Gate y PR (depende de todo)

1. `git diff --stat origin/dev` y comprobar con el diff REAL que no aparecen `db/`, migraciones,
   `lib/types/`, `middleware.ts` ni configuración de build (R41/R44). Si aparece alguno, el modo
   rápido **se niega solo** y hay que correr `./init.sh` completo.
2. `./init.sh --rapido` en verde. En la rama, `--changed` puede arrastrar la suite entera: correr
   los tramos por separado si tarda.
3. Cuerpo del PR: la primera línea anuncia que **esta feature revierte la decisión firmada
   122/R11–D9** y que estrecha dos guardias de frontera, con el porqué. No se anuncia como «añade un
   endpoint».
4. Coordinar con la 266 y el PR #434 (bloque de integración de Dropi): el aviso a integradores sale
   junto, no en tres tandas.

**Hecho cuando:** gate en verde con la salida pegada en `progress/impl_267.md`, tabla
`R1..R44 → test` completa (ningún requisito sin test) y el PR abierto con ese cuerpo. Verificación
humana del reviewer para los puntos 3 y 4.
