# review_155 — Creación bifurcada por bodega + retiro de `en_fulfillment`

> Rama: `feature/155-creacion-bifurcada` · Worktree: `.claude/worktrees/lote-135`
> Spec: `specs/155-creacion-bifurcada-fulfillment/` (R1–R43) · Fecha: 2026-07-29
> Entradas leídas (como declaraciones, no como verdad): `progress/impl_155_backend.md`,
> `progress/impl_155.md`, `progress/roundtrip_155_migracion.md`.
> Método: lectura del código + `./init.sh` ejecutado por mí + **69 mutaciones** + consulta
> read-only a la base local para corroborar la migración.

## Veredicto

**APROBADO-CON-NOTAS.** **0 bloqueantes.** 69 mutaciones, **62 muertas / 7 supervivientes**;
ninguna superviviente esconde un defecto del código: las 7 son huecos de cobertura, y las 4 más
serias tienen evidencia compensatoria **medida** (el round-trip del leader, que además corroboré
contra la base). 9 hallazgos menores, uno de ellos con decisión humana (§5.1).

La bifurcación por bodega está viva y coherente en las tres vías; el retiro de `en_fulfillment` es
completo y no deja rastro vivo; la migración con backfill está medida sobre datos reales. La calidad
de los tests es alta: 62 de 69 mutaciones dirigidas al corazón de cada requisito murieron, incluidas
todas las de guía, historial, geocodificación, guardia de transiciones, contrato público y
degradación de UI.

---

## 1. Gate ejecutado por el reviewer

```
$ ./init.sh
OK node v24.13.0 · dependencias · max-2-por-zona (in_progress=2) · specs presentes
OK typecheck paso
   10 problems (0 errors, 10 warnings)  -> lint paso
 Test Files  573 passed (573)
      Tests  6329 passed (6329)         -> test paso
OK todas las migraciones tienen down.sql · .env presente
== init OK ==   EXIT=0
```

**Coincide exactamente con la referencia del leader** (573 / 6329 / 0 fallos, 10 warnings
preexistentes, `EXIT=0`). No hizo falta `pnpm db:generate`. Tras las 69 mutaciones el árbol quedó
**limpio** (`git status --porcelain` vacío) y los 8 archivos más mutados se reverificaron en verde
(226 tests).

> **Transparencia sobre mi propio método:** mi primera pasada del arnés de mutación usó
> `vitest --reporter=basic`, flag que no existe en vitest 4 y hace fallar la corrida entera. Todas
> aquellas lecturas eran falsos "MUERTA" y se **descartaron y re-midieron**. El arnés final se validó
> con dos mutaciones de control no-operativas que **sobrevivieron**, como debían.

## 2. Checklist de `CHECKPOINTS.md`

| Checkpoint | Resultado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — R1–R43, R24/R43 en forma final tras la puerta T0.1 |
| `design.md` con alternativa descartada y su porqué | OK — §9, **seis** alternativas (A1–A6) con razón |
| `tasks.md` todas `[x]` | OK — las 22 tasks marcadas, con las salvedades escritas en la propia task |
| Cada `R<n>` mapea a un test concreto | OK — R1–R43, verificado **por mutación**, no por lectura del mapa. Dos correcciones al mapa en §5.5 y §7 |
| `progress/impl_<feature>.md` contiene el mapa `R<n> → test` | OK — `impl_155.md §5`, completo, con la fase dueña de cada fila |
| `pnpm run typecheck` sin errores | OK |
| `pnpm run lint` sin errores | OK — 0 errores, 10 warnings preexistentes, 0 nuevos |
| `pnpm test` pasa | OK — 573 / 6329 |
| E2E si toca flujo crítico | **NO** — ver §5.1 (decisión humana) |
| RLS en tablas nuevas | N/A — ninguna tabla ni columna nueva; la migración es DML más un `DELETE` condicional de catálogo |
| Migración reversible con `down.sql` y `db:rollback` funcionando | OK **y ejecutado de verdad**: UP → `pnpm db:rollback` → UP contra Postgres local sobre 47 órdenes reales. Corroborado por mí (§4) |
| Ningún secreto hardcodeado | OK — el retiro de `lib/config/ordenes.ts` **elimina** dos variables de entorno; no añade ninguna |
| Webhooks nuevos validan firma/token y son idempotentes | N/A — no hay webhook entrante nuevo. El cambio es en la política de eventos **salientes** (`EVENTOS_PUBLICOS`), estrictamente aditiva |
| Controller sin queries ni lógica de negocio | OK — el route handler delega; su único condicional (`destino.emiteManifiesto`) es un flag que le entrega el service |
| Service sin HTTP | OK — `OrdenService`, `BulkOrdenService` y `destino-creacion` sin Request/Response/headers |
| Repository sin lógica de negocio | OK — `create` / `createManyOrdenesConGuia` reciben `opciones.conGuia`: deciden forma de persistencia, no regla de negocio |
| Interfaces en `lib/interfaces/` separadas por categoría | OK, con una salvedad de dirección de dependencia (§5.4) |
| Páginas protegidas validan permisos en servidor | N/A — sin páginas nuevas |
| `private/` recibe datos por props | N/A |
| Mutaciones internas por Server Actions | OK — el borde HTTP nuevo es para el canal de API key, que no tiene cookie (justificado en R24) |
| Sin hardcode de país/moneda/cuenta | OK |
| `./init.sh` en verde | OK |
| `progress/review_<feature>.md` con veredicto | OK — este archivo |
| Entrada en `progress/history.md` | **pendiente** — paso de cierre del leader (§5.9) |

## 3. Lo que verifiqué del retiro de `en_fulfillment` (censo, no "funciona")

Censo propio sobre todo el árbol, excluyendo `db/migrations/`:

| Superficie | Estado |
| --- | --- |
| `ORDER_STATUS_SEED` | fuera; 20 → **19**, resto en orden relativo. M35 (reintroducirlo) **muerta** en 5 archivos |
| `TRANSICIONES` | clave y 4 aristas (#1/#2/#3/#7b) fuera; `satisfies` y `_EnsureExhaustive` **no relajados**. M36 (reintroducir una arista) **muerta** |
| `ESTADOS_CREACION` | exactamente 2. M34 (recuperar `en_ruta_bodega_central`) **muerta** en 3 archivos |
| Guardia de la 140 | **falla CERRADO y sigue cerrada**: M65 (dejar de validar el nacimiento) **muerta**, 22 tests. El invariante de conectividad confirma que ningún estado quedó sin salida: `en_ruta_bodega_central` deja de nacer pero conserva entrada por #30/#43 |
| `lib/config/ordenes.ts` | dos claves y dos variables de entorno fuera. M37 (reintroducir una palanca de entorno) **muerta** |
| `GuiaAsignacionService` | orígenes de guía y de ruteo únicos. M38/M39 (admitir un segundo origen) **muertas** |
| UI (`EstatusBadge`, `OrdenesListado`, `OrdenesRevisionMaestro`) | entradas, `case` y apartado fuera. M45/M46/M47/M48/M49 **muertas** |
| OpenAPI TS y espejo `.yaml` | value fuera, `por_recolectar_en_tienda` dentro, nota de cambio incompatible. M40/M41 **muertas** |
| Guard de censo (7 values, allowlist de 3 entradas justificadas) | M50 (reintroducir el literal en `lib/`) **muerta** |
| Literal restante en el árbol | **solo nombres de carpeta de migración** (`..._en_fulfillment`), que por diseño no disparan la frontera de palabra porque el carácter previo es `_`. Ninguna ocurrencia como *value* |

## 4. Auditoría del round-trip de la migración, y corroboración independiente

`progress/roundtrip_155_migracion.md` **no afirma más de lo que midió.** Lo comprobé consultando la
base local en modo lectura (solo `SELECT`), y los números casan uno a uno:

| Lo que el registro afirma | Lo que medí yo |
| --- | --- |
| 0 órdenes en el value retirado; 50 en `en_preparacion` (47 migradas + 3 previas) | `[{en_preparacion, 50}]`, cero filas del retirado |
| 47 filas de rastro, familia `ajuste_estado`, **sin actor** | `[{familia: ajuste_estado, sin_actor: true, n: 47}]` |
| historial 108 -> 155 | `historial total: 155` |
| el `DELETE` del catálogo es NO-OP: la fila **sobrevive** huérfana | catálogo 21 filas, el value presente, y **94** filas de historial lo referencian (47 preexistentes por destino + 47 del rastro por origen): la razón exacta del no-op |
| la migración quedó aplicada por el camino de deploy real | `_prisma_migrations`: aplicada, `rolled_back_at IS NULL` |
| las órdenes migradas no perdieron `num_guia` ni mensajero | de las 47: `con_guia: 0`, `con_mensajero: 0`, coherente con que ambos ya eran NULL, tal como el registro declara honestamente al etiquetar esa mutación de "vacía" |

Sus tres limitaciones declaradas (rama de base limpia del paso 3, volumen de producción, R40) están
bien clasificadas y **ninguna merece ser bloqueante**: la rama limpia es la menos riesgosa y no aplica
a producción; el UP es un `UPDATE` por FK más un `INSERT ... SELECT`; y R40 se sostiene
estructuralmente (SQL puro que no pasa por `appendCambioEstado`) además de por test (M66 **muerta**).

Añado una cuarta limitación que el registro no menciona: su tanda de mutaciones (3) no cubrió las dos
del DOWN que mi arnés encontró sin asertar (§5.2, M61 y M63), aunque los conteos antes/después que sí
midió demuestran empíricamente ambos comportamientos sobre el SQL real.

Nota de lectura, no error: el registro dice "67 órdenes en local" en sus limitaciones frente a "47 + 3"
en la tabla de partida; el 67 es el total de la tabla `orden`, no el del estado retirado.

## 5. Hallazgos

### 5.1 menor (con DECISION HUMANA) — no hay E2E para la ingesta de órdenes ni para el evento público

`CHECKPOINTS.md` pide E2E "si la feature toca flujos criticos (auth, pagos, recaudo, **ingesta de
ordenes**, **webhooks**)". La 155 cambia dónde nace **toda** orden en las tres vías de ingesta y amplía
la política de eventos públicos. No se añadió ningún E2E y `pnpm run test:e2e` no se corrió.

Por qué **no** lo declaro bloqueante, y por qué aun así lo subo a decisión:

- **No hay ni un E2E de ingesta en todo el repo**: `e2e/` no tiene nada de carga masiva ni de API key.
  Exigírselo a la 155 significa construir infraestructura Playwright que ninguna feature de la familia
  de ingesta (27, 88, 98, 136, 142, 143) construyó. La 155 no regresa nada.
- La 155 no altera la **mecánica** de la ingesta (auth por key, parseo, dedup, tarifa, idempotencia):
  altera su **resultado**. Y el borde HTTP sí tiene cobertura de integración real
  (`tests/integration/api/ordenes-api-key-carga.route.test.ts`, donde 7 de mis mutaciones murieron).
- El cambio en webhooks es **saliente** y aditivo, no un webhook entrante nuevo, que es lo que vigila
  el checkpoint hermano de firma e idempotencia.

**Si el humano lee el checkpoint de forma literal, esta casilla no se puede marcar y el veredicto pasa
a RECHAZADO.** Lo dejo escrito para que la dispensa sea explícita y no por omisión.

### 5.2 menor — 4 mutaciones supervivientes en la migración: los tests validan un MODELO, no el SQL

`tests/integration/db/order-status-retiro-en-fulfillment-migration.test.ts` combina regex estáticas
sobre el `.sql` con una **simulación en memoria** que reimplementa la semántica de los tres pasos en
lugar de derivarla del SQL. Consecuencia medida: toda mutación del SQL que no caiga en una de las regex
ad-hoc **sobrevive**.

| Mutación | Qué pudo cambiar sin que nadie lo viera |
| --- | --- |
| M53 | el backfill manda las órdenes a `en_bodega_central` en vez de `en_preparacion` — **el corazón de R34** |
| M67 | el `SET` del UP toca otra columna (`notas`): la lista negra solo cubre 4 columnas nombradas, no "ni ningún otro campo" |
| M61 | el DOWN pierde su paso 3 y **no borra el rastro** — parte literal de R38 |
| M63 | el DOWN pierde el filtro `estatus_id = en_preparacion` y retrocedería órdenes que ya avanzaron — la decisión explícita del `down.sql` |

**Evidencia compensatoria, y es fuerte:** el round-trip real midió los cuatro comportamientos sobre el
SQL verdadero (47 a `en_preparacion`, checksum `md5(to_jsonb(o) - 'estatus_id')` sobre **toda** la
tabla, historial de vuelta a 108, y las 3 órdenes preexistentes intactas), y yo lo corroboré contra la
base (§4). El archivo, además, ya está aplicado: su texto es inmutable. Por eso es menor y no
bloqueante. Lo que **sí** hay que corregir es la lectura del mapa: "R34 -> 5 casos" y "R38 -> 7 casos"
sugieren una cobertura del SQL que esos casos no dan.

Las regex que **sí** discriminan, y bien: M51 (filtro `deleted_at`), M52 (`num_guia` en el `SET`), M54
(actor), M55 (familia), M56 (motivo divergente UP/DOWN), M57 (borrar historial), M58 (guarda del
`DELETE`), M59 (borrar otro value), M60 (filtro del rastro en el DOWN), M62 (reponer el value) y M66
(escribir en la cola de jobs): **11 muertas**.

### 5.3 menor — M26: "misma transacción" solo se verifica de forma estructural

Cambiar `tx.$executeRawUnsafe` por `this.prisma.$executeRawUnsafe` en `OrdenRepository.create` (es
decir, sacar la numeración de la transacción) **sobrevive**. Causa: el doble de Prisma del repo ejecuta
el callback de `$transaction` con el propio objeto como `tx`, así que `tx === prisma` y la distinción es
invisible. Es un patrón preexistente de todos los tests de repositorio, no algo que la 155 introduzca;
R12 queda verificado por el conteo de `$transaction` (1) y por la propagación de fallos (M24b y M21
**muertas**), no por la identidad del cliente de transacción.

### 5.4 menor — `lib/interfaces/` importa de `lib/services/` (primera vez en el árbol)

`lib/interfaces/services/IBulkOrdenService.ts:4` importa `DestinoCreacion` de
`@/lib/services/destino-creacion`. Es el **único** import de `lib/interfaces/` hacia `lib/services/` en
todo el repo, e invierte la dirección interfaz-implementación de `docs/architecture.md` (sección
Interfaces). El módulo es puro y por `docs/architecture.md` viviría en `lib/types/` ("tipos de dominio")
o `lib/utils/` ("helpers puros"). **La ruta la fijó `design.md` seccion 2**, así que es deriva
sancionada por el spec, no del implementer; queda anotada porque crea precedente.

### 5.5 menor — T7.2 cita un archivo que no demuestra su "Hecho cuando"

El "Hecho cuando" de T7.2 dice que `tests/unit/services/webhook-estado-encolado.test.ts` demuestra que
la creación por API key de una tienda con suscripción activa **sigue** encolando un evento. Medido:
quitar `por_recolectar_en_tienda` de `EVENTOS_PUBLICOS` **sobrevive** en ese archivo (M69) y **muere** en
`tests/integration/repositories/orden-webhook-enqueue.test.ts` (M68), que es el que ejercita de verdad
la transición de creación (origen `null`, familia `carga_api`, destino nuevo) contra el emisor real.
**R43 está bien cubierto**: el mapa de `impl_155.md` seccion 5 cita el archivo correcto; es el texto de
la task el que apunta al equivocado.

### 5.6 menor — un título de test promete más de lo que asevera

`orden-repository.creacion-bifurcada.test.ts` -> "R10: la numeracion va ANTES del historial, y el
historial se registra igual": sus aserciones solo miran el contenido de la fila de historial, no el
orden. Quien sí cubre el orden es el caso de R12 "si la numeracion falla, ni historial ni encolado
llegan a ejecutarse": intercambiar los dos bloques en el repositorio pone el archivo **rojo** (M21
muerta). El requisito está cubierto; el título debería decir lo que mide.

### 5.7 menor — el manifiesto de la rama (b) por la VIA SESION no tiene ningún llamador

R24 se cumple al pie de la letra: flujo propio `recoleccion_tienda` (M32 muerta), selección por
`numRemisiones` admitida (M33 muerta), canal de API key expuesto con disciplina best-effort (M27 a M31
muertas). Pero en la práctica:

- el **único** llamador de producción de `recoleccion_tienda` es
  `app/api/ordenes/api-key/carga/route.ts:287`, y usa `ordenIds`;
- la rama `numRemisiones` que se habilitó **para** ese flujo, y cuya justificación escrita es la carga
  masiva por UI (`lib/types/manifiesto.ts:97-101`), **no tiene ningún llamador**;
- el único sitio de la UI que descargaba un manifiesto post-carga,
  `app/(app)/ordenes/_components/OrdenesCargaResumenPaso.tsx:56`, sigue pidiendo
  `flujo="carga_masiva"` (justo el literal que R24 descarta) y su test (`ManifiestoFlujos.test.tsx`,
  caso "R18") sigue aseverándolo;
- y ese componente está **huérfano desde `b2181e7` (feature 159)**: ningún componente de producción lo
  monta, así que hoy una tienda que carga por UI y cae en la rama (b) **no puede obtener su manifiesto
  por ninguna vía**.

No es un defecto que introduzca la 155 (el resumen post-carga se lo llevó la 159, y con él el enganche
de la 148/R18), ni R24 exige una superficie de UI. Pero el humano eligió la **opción C** precisamente
para que ese papel exista, así que conviene saber que operativamente todavía no llega al mostrador.
Recomendación: anotarlo en la 157, que es la que posee la recolección en tienda. Y de paso: el
`carga_masiva` que sobrevive en código muerto **con test vivo** es una trampa para quien restaure el
resumen.

### 5.8 menor — dos derivas de contrato público, ambas con precedente

1. La respuesta de `POST /api/ordenes/api-key/carga` gana el campo `manifiesto` y **no** se documenta ni
   en `lib/api/openapi-spec.ts` ni en el `.yaml`. Sigue el precedente de `etiquetasPdf` (feature 136),
   igualmente indocumentado; R42 no lo exige. Deuda de contrato, no incumplimiento.
2. **M42 superviviente:** cambiar en el `.yaml` la línea de prosa que anuncia el estado inicial
   (`por_recolectar_en_tienda` -> `en_ruta_bodega_central`) **no** pone rojo el test del espejo, porque
   este comprueba que el `.yaml` *contiene* el value y no compara textualmente la descripción del
   endpoint entre los dos artefactos. Hoy **ambos dicen lo mismo** (verificado en el diff); el hueco es
   de cobertura futura.

### 5.9 menor — cierre pendiente y deudas declaradas que el humano debe conocer

- `progress/history.md` **no tiene entrada de la 155** (checkpoint de cierre; corresponde al leader tras
  este review).
- R4 se cumple en su intención ("una vez por lote, no por fila"), pero la carga masiva por UI trocea el
  archivo y llama a `cargarMasiva` **una vez por chunk**: el flag se lee una vez por chunk, no una por
  archivo. Comportamiento heredado de la 27; anotado para que nadie lea "una vez por archivo".
- Siguen vivas y sin saldar, tal como las declara `impl_155.md` seccion 7: censo de R39 contra
  **producción** sin hacer; `buildManifiestoService` real sin ejercer (un fallo de wiring saldría como
  `manifiesto: { error }`, no como test rojo); el `.yaml` no se valida como OpenAPI 3.1; Playwright sin
  correr; y **el aviso a integradores del cambio incompatible está pendiente**, que es lo único de esta
  lista capaz de romperle la integración a un tercero.
- El `DELETE` del catálogo será **no-op en producción** y el value sobrevivirá huérfano. Es correcto,
  testeado y medido, pero "el value desaparece de la tabla" **no es una promesa** de esta migración. En
  local hay 0 órdenes en `por_recolectar_en_tienda`: el estado nuevo todavía no tiene datos reales.

## 6. Tabla de mutaciones (69 · 62 muertas · 7 supervivientes)

Arnés: aplica la mutación, corre los archivos de test dueños del requisito, revierte y verifica el
árbol. Validado con 2 controles no-operativos que **sobrevivieron**, como debían.

| # | R | Mutación | Resultado |
| --- | --- | --- | --- |
| M1 | R2/R31 | rama (a) nace en `en_bodega_central` | muerta |
| M2 | R3 | rama (b) `conGuia: false` | muerta (3 archivos) |
| M3 | R2 | rama (a) `conGuia: true` | muerta (3 archivos) |
| M4 | R26 | rama (a) `emiteManifiesto: true` | muerta |
| M5 | R24 | rama (b) `emiteManifiesto: false` | muerta |
| M6 | R4 | la vía sesión lee el flag dos veces | muerta |
| M7 | R4 | la vía API key lee el flag dos veces | muerta |
| M8 | R16 | ignora `conGuia`: siempre ruta sin guía | muerta |
| M9 | R17 | el `dryRun` persiste igual | muerta |
| M10 | R18 | la duplicada intra-archivo reporta un estado fijo | muerta |
| M11 | R7 | el error de catálogo (sesión) no nombra el value | muerta |
| M12 | R19 | la vía API ignora el flag del dueño | muerta |
| M13 | R21 | la vía API fuerza `conGuia: true` | muerta |
| M14 | R13 | evalúa el flag del ACTOR, no del dueño | muerta |
| M15 | R5 | el `estatusId` del payload vuelve a mandar | muerta |
| M16 | R7 | el error del alta manual no nombra el value | muerta |
| M17 | R10 | el alta manual cambia la familia de historial | muerta |
| M18 | R3/R12 | el alta manual deja de pedir guía | muerta |
| M19 | R8 | `create` pierde la guarda `num_guia IS NULL` | muerta |
| M20 | R8 | `create` usa otra secuencia (no la atómica del repo) | muerta |
| M21 | R10/R12 | la numeración pasa DESPUES del historial | muerta |
| M22 | R11 | la ruta de lote con guía deja de encolar geocodificación | muerta (2 archivos) |
| M23 | R11 | encola también por orden duplicada | muerta (2 archivos) |
| M24b | R12 | `create` absorbe el fallo del historial | muerta |
| M25 | R21 | la ruta de lote ignora `conGuia: false` | muerta (2 archivos) |
| **M26** | R12 | la numeración sale de la tx (`this.prisma` en vez de `tx`) | **SOBREVIVE** (5.3) |
| M27 | R24 | el borde pide `flujo: carga_masiva` | muerta |
| M28 | R26 | el borde emite manifiesto también en la rama (a) | muerta |
| M29 | R25 | el fallo del manifiesto se oculta como `null` | muerta |
| M30 | R25 | un `forbidden` se disfraza de filas vacías | muerta |
| M31 | R23 | la respuesta pierde el resto del summary | muerta |
| M32 | R24 | `recoleccion_tienda` invierte origen y destino | muerta (2 archivos) |
| M33 | R24 | `numRemisiones` deja de admitir `recoleccion_tienda` | muerta (3 archivos) |
| M34 | R22/R31 | `ESTADOS_CREACION` recupera `en_ruta_bodega_central` | muerta (3 archivos) |
| M35 | R27 | el value retirado vuelve a `ORDER_STATUS_SEED` | muerta (5 archivos) |
| M36 | R28 | el grafo recupera una arista retirada | muerta (2 archivos) |
| M37 | R30 | vuelve una variable de entorno que fija el estado inicial | muerta |
| M38 | R29 | "generar guía" admite un segundo origen | muerta |
| M39 | R29 | "rutear a satélite" admite un segundo origen | muerta |
| M40 | R42 | el enum TS pierde el estado nuevo | muerta |
| M41 | R42 | el `.yaml` vuelve a documentar el value retirado | muerta |
| **M42** | R42 | la prosa del `.yaml` vuelve al estado inicial viejo | **SOBREVIVE** (5.8) |
| M43 | R43 | `EVENTOS_PUBLICOS` pierde el estado nuevo | muerta (2 de 3 archivos) |
| M44 | R43 | la ampliación deja de ser aditiva (cae un estado previo) | muerta |
| M45 | R32 | el `default` de `accionesDe` vuelve a ofrecer "Generar guía" | muerta |
| M46 | R32 | vuelve el apartado retirado en la revisión del maestro | muerta |
| M47 | R41 | un value desconocido deja de degradar a chip neutro | muerta |
| M48 | R41 | un value desconocido deja de mostrar el texto crudo | muerta |
| M49 | R28 | reaparece un gemelo del acento de marca | muerta |
| M50 | R33 | el literal retirado reaparece en `lib/` | muerta |
| M51 | R34 | el UP filtra por `deleted_at` | muerta |
| M52 | R34 | el UP también pisa `num_guia` | muerta |
| **M53** | R34 | el backfill manda las órdenes a otro estado | **SOBREVIVE** (5.2) |
| M54 | R35 | el rastro se escribe CON actor | muerta |
| M55 | R35 | el rastro usa otra familia | muerta |
| M56 | R35 | el motivo del UP deja de coincidir con el del DOWN | muerta |
| M57 | R36 | el UP borra historial preexistente | muerta |
| M58 | R37 | el `DELETE` pierde la guarda del historial | muerta |
| M59 | R37 | el `DELETE` alcanza a otro value del catálogo | muerta |
| M60 | R38 | el DOWN pierde el filtro del rastro | muerta |
| **M61** | R38 | el DOWN pierde el paso 3 (no borra el rastro) | **SOBREVIVE** (5.2) |
| M62 | R38 | el DOWN no repone el value | muerta |
| **M63** | R38 | el DOWN deja de acotar al estado destino | **SOBREVIVE** (5.2) |
| M64 | R11 | `create` (una orden) deja de encolar geocodificación | muerta (2 archivos) |
| M65 | R31 | la guardia deja de validar el estado de nacimiento | muerta (2 archivos, 22 tests) |
| M66 | R40 | el UP escribe en la cola de jobs | muerta |
| **M67** | R34 | el `SET` del UP toca otra columna (`notas`) | **SOBREVIVE** (5.2) |
| M68 | R43 | aislada: `EVENTOS_PUBLICOS` pierde el estado, vs. `orden-webhook-enqueue` | muerta |
| **M69** | R43 | aislada: ídem, vs. `webhook-estado-encolado` | **SOBREVIVE** (5.5) |
| S0/S1 | — | CONTROLES no-operativos (comentario, `void 0`) | sobreviven, como debían |

## 7. Trazabilidad R1-R43 — resultado del reviewer

Los 43 requisitos tienen test, y **cada uno lo verifiqué por mutación o por lectura del assert**, no por
el mapa. Correcciones al mapa declarado, ninguna de ellas un requisito sin cubrir:

- **R43**: el archivo que lo demuestra es `orden-webhook-enqueue.test.ts` (M68 muerta), no
  `webhook-estado-encolado.test.ts` (M69 sobrevive). El mapa de `impl_155.md` ya cita el correcto; el
  texto de T7.2, no. Ver 5.5.
- **R34 y R38**: cubiertos en su forma y sus guardas por las regex estáticas (11 mutaciones muertas), y
  en su **semántica de datos** por el round-trip medido, no por los casos de simulación. Ver 5.2.
- **R12**: la atomicidad se verifica por propagación de fallos (M24b, M21 y el caso "si la numeracion
  falla, ni historial ni encolado llegan a ejecutarse"), no por la identidad del cliente de
  transacción. Ver 5.3.
- **R24**: cumplido literalmente en sus cuatro cláusulas; sin llamador de UI para la vía sesión. Ver 5.7.
- **R26**: cumplido y testeado en el canal de API key (M4 y M28 muertas). En la UI se cumple de forma
  vacua: hoy la carga masiva no ofrece manifiesto en absoluto. Ver 5.7.

## 8. Qué tiene que decidir un humano

1. **La dispensa del E2E** (5.1). Es la única casilla de `CHECKPOINTS.md` que no se puede marcar. Si se
   lee de forma literal, esto es RECHAZADO; si se dispensa, que quede escrito.
2. **El aviso a integradores** del cambio incompatible de estado inicial (5.9). Es acción de producto y
   **no debería salir a producción en silencio**: quien compare el estado devuelto contra
   `en_ruta_bodega_central` se rompe.
3. **Dónde vive el manifiesto de la rama (b) por la vía sesión** (5.7): aceptar que la 155 lo entrega
   solo para el canal de API key y pasar la superficie de UI a la 157, o pedirlo ahora.

---

## 8. RESOLUCIÓN de las tres decisiones — humano, 2026-07-29

> Escritas aquí porque el §7 las dejó abiertas y una de ellas condicionaba el veredicto. La 155 se
> mergeó a `dev` en el **PR #203**.

**1. Dispensa del E2E — CONCEDIDA.** El humano recibió el planteamiento completo del §5.1 —incluido
que *«leído de forma literal, esa casilla no se puede marcar y el veredicto sería RECHAZADO»*— e
instruyó proceder. Queda como **dispensa explícita, no por omisión**, con su fundamento:

- **no existe ni un E2E de ingesta en todo el repo**, y ninguna feature de esa familia (27, 88, 98,
  136, 142, 143) construyó la infraestructura Playwright que haría falta;
- la 155 **no altera la mecánica** de la ingesta (auth por key, parseo, dedup, tarifa,
  idempotencia), sino su **resultado**, y el borde HTTP sí tiene integración real
  (`tests/integration/api/ordenes-api-key-carga.route.test.ts`, donde murieron 7 mutaciones);
- el cambio en webhooks es **saliente y aditivo**, no un webhook entrante nuevo.

**El precedente que esto fija, dicho para que no se use como coartada:** la dispensa vale para esta
feature por las tres razones de arriba, no para cualquier feature que toque ingesta. El día que
exista harness de E2E, esta casilla vuelve a ser exigible. **La deuda de fondo —que no haya harness
de E2E— sigue viva y sin dueño**, y es la que hace que este checkpoint sea inaplicable en la
práctica: sigue registrada en `progress/current.md`.

**2. Aviso a integradores — NO NECESARIO.** Decisión del humano. Se cierra: no queda como deuda de
esta feature ni se traspasa a ninguna otra. La nota del cambio incompatible ya viaja en el documento
OpenAPI y en su espejo (R42, verificado por las mutaciones M40/M41).

**3. El manifiesto de la rama (b) por la vía sesión — PASA A LA FEATURE 157.** Escrito como
requisitos **R41/R42/R43** en `specs/157-recoleccion-tienda-qr/requirements.md`, Bloque E, con la
causa real anotada: el hueco lo abrió `b2181e7` de la **159** al dejar
`OrdenesCargaResumenPaso.tsx` huérfano, no la 155. Se acepta que la 155 lo entrega solo para el
canal de API key, que es donde R24 lo exigía.

**Veredicto final: APROBADO-CON-NOTAS sostenido, 0 bloqueantes.** Las 7 mutaciones supervivientes
siguen siendo huecos de cobertura declarados, no defectos, y el mapa `R<n> → test` conserva las dos
correcciones del §5.5 y §7.
