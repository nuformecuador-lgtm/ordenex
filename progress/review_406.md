# Revisión — Feature 406 (enlace de evidencias del webhook con identificador resoluble)

**Rama:** `feat/406-enlace-evidencias-webhook-identificador` · **HEAD revisado:** `c0c40fc2`
**Base:** `dev` = `7acd9cb0` (la rama la contiene: `git merge-base --is-ancestor origin/dev HEAD` OK)
**PR:** #772 · **Fecha:** 2026-09-10 · **Rol:** reviewer (no edito código de producción)
**Dónde se corrió todo:** worktree aislado `.claude/worktrees/agent-aacf3d83594c0be1c`, con su
propio `node_modules` y su `.env` (`DATABASE_URL` local).

## Veredicto: **OK (APROBADO)** — cero bloqueantes

---

## 1. Lo más importante: el test de cierre de lazo SÍ ve el rojo

Reproducido por mí, no leído de la bitácora. Revertí **solo** el arreglo
(`git checkout origin/dev -- lib/services/WebhookEstadoService.ts`, árbol por lo demás intacto):

```
== M1: arreglo REVERTIDO -> tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts ==
AssertionError: expected 404 to be 200 // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
```

Los cuatro casos del lazo caen con **404**, exactamente lo que declara `impl_406.md`. El quinto
(el 404 que JUSTIFICA la omisión de R7) pasa siempre porque mide el endpoint, no el emisor: es
correcto que no cambie.

Con el arreglo revertido caen además, en la misma corrida:

```
 Test Files  3 failed (3)      <- SQL real + los dos de unit
      Tests  18 failed | 72 passed (90)
```

de los cuales **4 son los de `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts`**
(Postgres real). Total 22 rojos en 4 archivos: coincide con M1 de la bitácora. Restaurado con
`git checkout HEAD --`; `git status --porcelain` vacío tras cada mutación.

## 2. La mutación que el lazo NO caza — comprobada, y el literal de R4 la mata

Invertí la precedencia en el código de producción (la remisión primero, la guía de respaldo):

```
== M2 -> LAZO SOLO ==      Test Files 1 passed (1) · Tests 5 passed (5)   <- ENTERO EN VERDE
== M2 -> resto ==          Test Files 3 failed (3) · Tests 8 failed | 82 passed (90)
   FAIL … 406/R4: con guia, el ultimo segmento es la guia en decimal
   FAIL … 406/R3: orden CON guia -> el segmento resuelve por num_guia a ESA fila   (Postgres real)
   FAIL … 404/R2 (mensajero), 268/R24 (1), 268/R25 (3), 268/R22 (4), 268/R18, 268/R25+406/R4
```

Cierto tal como lo declara: el archivo del lazo sobrevive entero (resuelve igual de bien por
remisión) y quien la mata es el literal a mano de R4. **Ese literal no está derivado de la función
que construye la URL**: es la cadena `"https://app.ordenex.co/api/ordenes/api-key/orden/100235"`
escrita entera, y el archivo no importa `PATH_ORDEN_API_KEY` ni ninguna función del service.
No hay «aserción contra su propia fuente».

## 3. Otras mutaciones que corrí yo

| Mutación mía | Resultado |
|---|---|
| M4 — quitar la guarda de R7 (el schema del borde + «no cambia al pasar por él») | **muerta**: 2 rojos (`406/R7a` 129 caracteres, `406/R7b` espacios de borde) |
| M5 — quitar el `try` de R8 | **muerta**: `AssertionError: promise rejected "URIError: URI malformed" instead of resolving` |
| M7 — devolver el uuid al ejemplo del **YAML** | **muerta**: «YAML: el espejo publica el MISMO enlace…» |
| M8 — quitar un acento a una palabra del **YAML** | **muerta**: «el espejo `.yaml` dice EXACTAMENTE lo mismo, palabra por palabra» |
| **Extra:** devolver el localizador VIEJO por fecha a `openapi-405-gestiones.test.ts` | **5 rojos ajenos** — confirma que el re-anclaje era necesario y no un apaño para pasar |

Ninguna sobrevivió. Árbol limpio tras cada una.

## 4. Trazabilidad — los 16 requisitos, verificados por mí

Verifiqué **16/16**: leí el test, comprobé que el aserto es discriminante (no vacío, no tautológico)
y **lo corrí**. Los marcados (M) los vi además caer con una mutación.

| R | Test | Cómo lo verifiqué |
|---|---|---|
| R1 (M) | `webhook-evidencias-url-resuelve.route.test.ts`, casos 1, 2 y 4 | verde; **404 al revertir**. El aserto de fondo es «el `orden.id` resuelto es el del evento», no la cadena |
| R2 (M) | mismo archivo, los 4 casos del lazo | verde; **404 al revertir** |
| R3 (M) | `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts` | **4 passed, NO skipped** contra Postgres real, en dos corridas. El `beforeAll` **lanza** si falta el catálogo o las FKs: no hay `if (!fks) return;`. Rojo con M1 y con M2 |
| R4 (M) | `webhook-estado-service.test.ts`, bloque `406/R4` | verde; **rojo con M2**. Literal a mano |
| R5 | ídem `406/R5` (dos casos) + caso 3 del lazo | verde; round-trip `A/B C` -> `A%2FB%20C` -> `A/B C` y un solo segmento de ruta |
| R6 | ídem `406/R6` | aserto por AUSENCIA sobre el string entregado + regex de uuid; y el `eventoId` sí lleva el uuid (contraprueba: el recolector no está ciego) |
| R7 (M) | ídem `406/R7a`, `406/R7b`, `406/R7c` + el 404 que la justifica | verde; **rojo con M4** |
| R8 (M) | ídem `406/R8` | verde; **rojo con M5** |
| R9 | `268/R24 (1)` preexistente | verde y **no reescrito** (el diff no lo toca) |
| R10 | `268/R24 (2)` preexistente | verde y no reescrito |
| R11 | `268/R24 (1)` (orden exacto de las 6 claves, `evidenciasUrl` la última) + `268/R18` (HMAC recalculado sobre el cuerpo real) | verdes, asertos intactos |
| R12 | `268/R22 (4)` (sin bucket, sin token, `url.search` vacío) | verde, aserto intacto |
| R13 | alcance del diff | `git diff --name-only dev...HEAD` = 11 archivos: **cero** bajo `db/`, `lib/types/`, `lib/interfaces/`, `lib/repositories/`, `app/`, `middleware.ts`, y ningún `package.json` ni fichero de configuración |
| R14 (M) | `openapi-406-evidencias-url.test.ts`, TS y YAML | verde; **rojo con M7**. El cruce es «último segmento === el `numGuia` del MISMO ejemplo»: dos campos, no la función contra sí misma |
| R15 (M) | ídem, «el espejo `.yaml` dice EXACTAMENTE lo mismo» | verde; **rojo con M8** (un solo acento de diferencia) |
| R16 | ídem: entrada del CHANGELOG localizada **por título**, sin uuid en su enlace, y la histórica del 2026-08-22 intacta | verde |

Corrida final aislada de los 6 archivos tocados: **6 passed / 130 tests passed**.

## 5. Los puntos declarados por la ficha, juzgados

- **Q5 (medido en `next dev`, no contra `next build && next start`) — ACEPTABLE, no bloqueante.**
  La sonda `app/api/docs/eco-406/[id]/route.ts` **está borrada**: no aparece en el diff, buscarla en
  la rama solo la encuentra mencionada dentro de `progress/impl_406.md`, y `app/api/docs/` solo
  contiene `openapi`. El único salto no medido es `params` en producción, y el `GET` real se limita
  a leer `ctx.params` y delegar en `handleConsultaOrdenApi`: el mismo mecanismo. Si en producción se
  comportara distinto, el efecto sería un enlace roto en el **subconjunto** de órdenes sin guía con
  caracteres especiales, es decir menos roto que el estado actual (404 siempre, para todas). No
  degrada nada respecto de `dev`.
- **Q4 sin medir — ACEPTABLE.** R7 está probado en los dos sentidos (129 / 128 exactos / con
  espacios) y el arreglo no depende del resultado. El riesgo de no medirlo no es un fallo ruidoso
  sino uno **mudo** (órdenes que se quedan sin enlace sin que nadie lo note); por eso queda como
  menor accionable, no como bloqueante: es un SELECT de solo lectura. **Yo no pude medirlo**: en
  esta sesión no tengo el MCP de Supabase entre mis herramientas.
- **Colisión heredada de la 177 — alcance CORRECTO.** Cerrarla exige tocar
  `ApiOrdenResolucionService`, declarado fuera de alcance, y afectaría a dos endpoints públicos.
  Guía-primero la reduce a un subconjunto estricto (solo órdenes sin guía cuya remisión sea un
  entero decimal canónico que coincida con la guía de otra orden viva de la misma tienda). Está
  escrita en `requirements.md` (Riesgos 2), en el design 7.4 y en la bitácora: no se disimula.
  **No debía cerrarse aquí.**
- **Deuda ajena (`openapi-405-gestiones.test.ts`) — arreglada, NO relajada.** El diff cambia **una
  sola línea** (el localizador) más el comentario; los cinco casos y sus asertos son idénticos.
  Además el bloque no puede pasar en falso: si el localizador no encuentra nada devuelve cadena
  vacía y el primer caso exige más de 500 caracteres de entrada. Comprobado al revés: con el
  localizador viejo, **5 rojos**.
- **Tests de la 268 (R9-R12) — el literal ERA el valor, no el contrato.** La constante `ENLACE` se
  usa en 4 sitios y en los cuatro como valor esperado del enlace; lo que esos casos protegen —el
  orden de las 6 claves, el cuerpo byte-idéntico entre relojes distintos, la firma recalculada sobre
  el cuerpo, la ausencia de query string— sigue afirmado con los mismos asertos. Cambiar el valor
  era obligatorio; ninguno se debilitó.
- **Orden `Evidencia` / `OrdenGestion` en el `.yaml` — intacto.** `Evidencia` en la línea 1087 y
  `OrdenGestion` en la 1142 (en `dev`, 1074 y 1129): mismo orden relativo, solo desplazadas por las
  13 líneas añadidas dentro del schema del webhook. El caso de la 405 que lo vigila está verde.

## 6. Contrato publicado (verificación humana)

Comparé a mano el bloque del `.yaml` contra el array de strings del `.ts`: **dicen lo mismo palabra
por palabra**, y ahora además hay un comparador (la descripción entera de `evidenciasUrl` cotejada
entre los dos artefactos) que M8 mata con un solo acento. El ejemplo es `.../orden/100235` en los
dos, y coincide con el `numGuia` que ese mismo ejemplo declara.

El CHANGELOG **describe lo que el código emite de verdad**: guía si existe y remisión si no
(coincide con `identificadorPublicoDe`), codificación de `/ ? # %` y espacios (verificado por mí con
`encodeURIComponent` real: `A/B C` -> `A%2FB%20C`), la promesa de idempotencia precisada, y la
omisión por más de 128 caracteres o por espacios de borde. La entrada histórica del 2026-08-22 no se
reescribe (decisión Q2) y hay un test que lo afirma.

## 7. CHECKPOINTS.md, punto por punto

| Punto | Estado |
|---|---|
| `requirements.md` EARS numerado, `design.md` con alternativa descartada, `tasks.md` | OK, los tres existen (en `dev`, commit base de la ficha) |
| Tasks marcadas `[x]` | AVISO: el `tasks.md` de esta ficha **no usa casillas** (T1..T13 con criterio «Hecho:»), igual que los de la 404 y la 405. **Verifiqué T1-T13 uno a uno contra el árbol**: todos cumplidos salvo la entrada de `history.md` (abajo). Es deriva de formato del arnés, no defecto de esta ficha |
| Cada `R<n>` mapea a un test concreto | OK, 16/16 verificados por mí |
| `progress/impl_406.md` con el mapa `R<n> -> test` | OK y commiteado (`c0c40fc2`) |
| `pnpm run typecheck` | OK dentro del gate |
| `pnpm run lint` | OK (183 warnings preexistentes y ajenos, 0 errores) |
| `pnpm test` | OK, ver sección 8 |
| E2E (Playwright) para flujo crítico | **inaplicable en este repo**: no hay harness E2E. El riesgo se cubre con el cierre de lazo contra el handler REAL y el resolutor REAL, más el WHERE real de Postgres |
| RLS en tablas nuevas | n/a: cero tablas, cero migraciones, cero archivos bajo `db/` |
| Migraciones reversibles | n/a. Los 3 avisos de `down.sql` del gate son deuda preexistente de agosto |
| Secretos hardcodeados | ninguno. El origin sale de `config.WEBHOOK_APP_ORIGIN`; `https://app.ordenex.co` solo aparece en ejemplos de docs y en literales de test |
| Webhooks: firma e idempotencia | OK: la firma verifica sobre el cuerpo ya ampliado; `eventoId` y `dedupeKey` no dependen del cuerpo; cuerpo byte-idéntico entre relojes distintos |
| Capas | OK: el service no toca HTTP. Importa `idOrdenApiSchema`, que es zod puro (ver hallazgo 5) |
| Permisos y Server Actions | n/a |
| Sin hardcode de país, moneda ni cuenta | OK |
| `./init.sh` verde | OK, ver sección 8 |
| `progress/review_406.md` con veredicto OK | este archivo |
| Entrada en `progress/history.md` | FALTA en la rama, pero en este repo la escribe el leader **después** del merge (igual que con la 400/402/403); la 404 y la 405 tampoco la tienen. Pendiente del leader antes de pasar la ficha a `done`, no bloqueante del PR |

## 8. Gate ejecutado por mí

`./init.sh --rapido` en el worktree, con `INIT_EXIT` escrito **dentro** del log (sin `tail` en la
tubería, para no truncar el fichero en origen):

```
✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
✓ typecheck paso
✓ lint paso                 (0 errors, 183 warnings preexistentes)
✓ DATABASE_URL resuelta: los 154 archivos de tests contra Postgres SI se ejecutan
 ✓ tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts (4 tests) 727ms
 Test Files  29 passed (29)      Tests  383 passed (383)      <- relacionados con el diff
 Test Files  202 passed (202)    Tests  3015 passed (3015)    <- guardias
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 228 ejecutado(s))
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados y no supuestos:** cero líneas de salto en todo el log. Cuatro archivos de
`tests/integration/db/` seleccionados por el modo rápido y **los cuatro ejecutados**, incluido el de
esta ficha.

**Sobre el aviso de contención con el otro agente:** cero apariciones de `40P01` o `deadlock` en el
log del gate y en todas mis corridas. Corrí el archivo contra Postgres real **dos veces aisladas**
(limpia, y otra vez tras las mutaciones) y las dos dieron recuento explícito `4 passed`, nunca
«suite roja con 0 tests fallidos». No hubo nada que aislar.

> El gate **completo** no lo corre el reviewer: `docs/verification.md` y la regla 5 de `CLAUDE.md`
> lo asignan al leader (post-merge a `dev` en segundo plano, y obligatorio antes de la release a
> `prod`).

## 9. Hallazgos

**BLOQUEANTES: ninguno.**

**Menores** (ninguno exige rehacer nada de esta ficha):

1. **menor — `.` y `..` como remisión rompen el segmento, y `encodeURIComponent` no los tapa.**
   Medido por mí con `new URL` real: un enlace terminado en `..` colapsa a `/api/ordenes/api-key/`
   y uno terminado en `.` a `/api/ordenes/api-key/orden/`. El resultado sería un enlace que no
   resuelve (404), **nunca** uno que resuelve OTRA orden, y es un subconjunto estricto del «404
   siempre» que había antes: no es regresión. Se cerraría con una línea en `identificadorPublicoDe`
   y su caso en el bloque R7. Para otra ficha, y solo si Q4 dice que existen remisiones así.
2. **menor — Q4 sigue sin medir.** Sin el `max(length(num_remision))` ni el recuento de remisiones
   con espacios de borde en producción, no se sabe si R7 llega a activarse. Si se activara mucho, el
   fallo sería **mudo** (enlace omitido y nadie se entera). Un SELECT de solo lectura antes de la
   release lo cierra.
3. **menor — quedan localizadores por fecha sin auditar, y encontré uno.**
   `tests/unit/api/openapi-374-nodo-retirado.test.ts:118-127` corta la entrada del CHANGELOG
   buscando su fecha (`2026-09-06`) a secas. Hoy no colisiona porque no hay otra entrada de ese día,
   pero es exactamente la trampa que la 406 destapó en la 405. Deuda ajena, fuera del alcance de
   esta ficha; convendría anclar todos los localizadores al título.
4. **menor — la nota del CHANGELOG sobre cuándo se omite el campo no menciona el caso R8**
   (sustituto UTF-16 desemparejado). Probablemente sea mejor así por exótico; queda dicho.
5. **menor — `lib/services/WebhookEstadoService.ts` importa `lib/api/api-orden-identificador`.**
   El módulo es zod puro y sin HTTP (lo dice su propia cabecera) y compartir la cota de 128 con el
   borde es mejor que duplicarla —M4 demuestra que la guarda tiene dientes—, pero su ubicación en
   `lib/api/` hace que un service dependa nominalmente de la carpeta del canal. Si algún día se
   mueve a `lib/validation/`, este import es uno de los tres a tocar.
6. **menor — el índice del grafo (`codebase-memory`) está rancio para este archivo:** no conoce
   `identificadorPublicoDe` ni la firma nueva de `evidenciasUrlDe`. Todo lo que afirmo aquí está
   confirmado en el archivo real, como manda la regla 7 de `CLAUDE.md`.
7. **menor (proceso) — falta la entrada de `progress/history.md`** (T13). Corresponde al leader tras
   el merge, como con la 400/401/402/403; se anota para que no se caiga.

## 10. Trampas buscadas activamente y no encontradas

- *Aserción contra su propia fuente*: no. Los esperados son literales a mano; el cruce del OpenAPI
  compara **dos campos del mismo ejemplo**; el lazo afirma sobre el `orden.id` resuelto, no sobre la
  cadena.
- *Literal, contrato o polizón*: el `ENLACE` de la 268 y el literal de la 404 eran **valores**; sus
  contratos (orden de claves, cuerpo byte-idéntico, firma, sin query) siguen intactos.
- *Los dobles no ven el SQL*: R3 corre contra Postgres real, se ejecuta (no se salta) y muere con M1
  y con M2.
- *Test verde sin datos*: no hay ningún `if (!x) return;`. El `beforeAll` **lanza** si falta el
  catálogo o las FKs, y cada caso siembra sus filas y afirma sobre ellas (incluido «las dos filas
  existen en la base» en el caso de `deleted_at`).
- *Test debilitado para que pase el propio*: revisado con lupa el único test ajeno tocado (405). Un
  solo localizador cambiado, asertos idénticos, y el localizador viejo da 5 rojos.
- *Reordenar el `.yaml`*: no se movió ningún bloque.

---

**Veredicto final: OK.** El arreglo es mínimo, aditivo, está probado extremo a extremo con el rojo
previo reproducido por el reviewer, resiste las mutaciones que importan, y el contrato publicado
dice lo que el código emite. Pendiente del leader antes de `done`: la entrada en
`progress/history.md`.
