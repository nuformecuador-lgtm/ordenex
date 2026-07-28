# Review — Feature 146 · Campana de notificaciones funcional

Rama `feature/146-campana-notificaciones`, worktree `ordenex-wt-146`, 15 commits sobre
`origin/dev` @ `56ff0aa`. Diff revisado: `git diff origin/dev...HEAD` (48 archivos, +6711/-123).

## VEREDICTO: **APROBADO-CON-NOTAS**

**0 bloqueantes. 9 notas menores.** Ninguna exige tocar codigo de produccion; seis son
bookkeeping o deuda ya declarada y aceptada en el design.

---

## 1. Resultados ejecutables (medidos por el reviewer, no copiados de la bitacora)

| comprobacion | resultado | veredicto |
| --- | --- | --- |
| `pnpm run typecheck` | **2 errores**, exactamente los 2 preexistentes de `dev` (`GestionarOrdenPanelEvidencias.test.tsx(84,6)` y `NotaPrivadaMensajero.test.tsx(253,8)`, prop `count`) | **delta 0** OK |
| `pnpm lint` | exit 0 · **0 errores**, 145 warnings — todos en `.claude/skills/**` (herramienta) y 4 preexistentes en tests ajenos. **Ningun archivo de la feature aparece.** | OK |
| `pnpm test` (suite completa) | **528 archivos · 5 rojos** / **5426 tests · 15 rojos** | **delta 0** OK |
| `./init.sh` | **ROJO**, y falla solo en el paso `pnpm run typecheck` por los 2 errores preexistentes | ver nota menor 3 |

### Desglose de los 5 archivos rojos

- `tests/components/DataTable.test.tsx` (2) — preexistente ajeno
- `tests/components/MarcarLuegoToggle.test.tsx` (2) — preexistente ajeno
- `tests/components/MisAsignacionesModule.test.tsx` (9) — preexistente ajeno
- `tests/components/NotaPrivadaMensajero.test.tsx` (1) — preexistente ajeno
- `tests/unit/guards/no-embalaje.test.ts` (1) — **flaky por contencion de CPU**: cayo por
  timeout a los 31 s en la corrida completa; **verificado en aislado: 1/1 verde en 860 ms**.
  No es regresion.

### Los 14 archivos de test de la feature, corridos en aislado

`Test Files 14 passed (14) · Tests 213 passed (213)` — sin un solo rojo.

---

## 2. Trazabilidad R1-R50 -> test

Verificacion aplicada: no basta con que el test exista y se llame `R<n>`; se leyo el cuerpo
para confirmar que ejercita el comportamiento.

### Bloque 1 — Modelo de datos y migracion

| R | Test | Verificacion del reviewer |
| --- | --- | --- |
| R1 | `notificacion-migration` › "crea la tabla con id, tipo, evento, descripcion, anexo, entidad y fecha" | Regex sobre el `migration.sql` real; lei el SQL: las 12 columnas estan. OK |
| R2 | `notificacion-migration` › "crea notificacion_lectura…" + "a lo sumo UNA fila por (notificacion, usuario)" | Indice unico `notificacion_lectura_notificacion_id_usuario_id_key` presente. OK |
| R3 | `notificacion-service` › "lo que lee el admin 1 sigue no leido para el admin 2" / "lo que descarta el admin 1 sigue en el listado del admin 2" | Repo fake en memoria que modela de verdad la tabla de lectura por usuario, no un mock de llamadas. OK |
| R4 | `notificacion-migration` › "declara el CHECK XOR" | `CHECK ((destinatario_rol IS NULL) <> (destinatario_usuario_id IS NULL))` verificado en el SQL. OK |
| R5 | `notificacion-migration` › "crea tienda_id y zona_id nullable y sin default" + "no acopla los dos alcances" | OK |
| R6 | `notificacion-orden-rechazada` › "emite maestro y admin sin alcance, adminTienda por tienda y adminSatelite por zona" | Corre `appendCambioEstado` REAL y cuenta 4 `create`. OK |
| R7 | `notificacion-migration` › "no altera ni elimina ninguna tabla/columna/enum preexistente" | Lei el SQL: solo `CREATE TYPE/TABLE/INDEX`, `ADD CONSTRAINT` sobre tablas nuevas y `ENABLE RLS`. Puramente aditiva. OK |
| R8 | `notificacion-migration` › "la carpeta trae migration.sql y down.sql" + orden inverso + enums al final | `down.sql` revisado a mano: drop de las 2 tablas en orden FK-inverso + los 3 enums. Coherente. OK |
| R9 | `notificacion-migration` › "habilita RLS en ambas" + "no crea ninguna policy" | OK (patron del repo: sesion propia, sin `auth.uid()`) |
| R10 | `notificacion-migration` › 3 tests de indices | 5 indices parciales de listado/alcance + entidad + `usuario_id` en lectura. OK |
| R11 | `notificacion-migration` › "las tres FK de notificacion cascadean" + "las dos de lectura cascadean" | 5 FK con `ON DELETE CASCADE` verificadas. OK |
| R12 | `zonas-migration` (verde) + `notificacion-migration` › "zonas-migration excluye `_notificacion`" | Corri `zonas-migration`: verde. OK |

### Bloque 2 — Alcance y visibilidad

R13-R17 se prueban en `notificacion-visibilidad.test.ts` contra el **predicado real**
(`predicadoVisibilidad`), evaluado con un interprete generico de OR/AND/igualdad sobre filas
en memoria. **No re-implementa la regla**: si el predicado cambia, los tests lo notan. Es el
punto mas solido de la entrega.

| R | Test | Verificacion |
| --- | --- | --- |
| R13 | "dos maestros distintos ven la misma notificacion dirigida a maestro" | OK |
| R14 | "la tienda dueña del alcance ve la notificacion" | OK |
| R15 | "la tienda 2 no ve el rechazo acotado a la tienda 1" + "el alcance por tienda no se cuela por la rama de destinatario directo" | **Caso negativo real**, el que pedia el encargo. OK |
| R16 | "el adminSatelite de la zona 2 NO ve el aviso acotado a la zona 1" + "un adminSatelite SIN zona no ve ninguna acotada por zona" | **Ambos casos negativos presentes.** Actor sin zona = fail-closed. OK |
| R17 | 3 tests (tienda no ve la de maestro; satelite no ve la de tienda; maestro no ve la de adminSatelite en su misma zona) | OK |

### Bloque 3 — Productores (D1)

| R | Test | Verificacion |
| --- | --- | --- |
| R18 | `notificacion-orden-rechazada` › 4 tests | Corre el `appendCambioEstado` real con el emisor real por defecto; asserta rol+tiendaId+zonaId de las 4 filas, tipo `alert`, anexo = guia o remision. OK |
| R19 | idem › "no crea nada cuando viene de escalado_devuelta_sla" + "en un lote mixto solo notifica el de gestion" + "no notifica gestion cuyo destino no es rechazada" | El filtro `destino==="rechazada" && origenTipo==="gestion"` esta en `emitir.ts:149-153` y los tests lo ejercitan por ambos lados. **El escalado SLA no notifica.** OK |
| R20 | idem › "la emision vive dentro del mismo tx que el append" + "si el append falla, la emision no llega a ejecutarse" | OK |
| R21 | idem › "propaga el error del emisor para que la transaccion revierta" + "el fallo de la lectura de la orden tambien propaga" | `appendCambioEstado` hace `await emitirNotificaciones(...)` sin try/catch: el error sube. OK |
| R22 | `notificacion-productores` + `-wiring` › "emite una sola vez, al usuario de la key" + `-reales` › "cargarViaApi con el notificador REAL cableado crea la fila" | OK |
| R23 | `-wiring` › "notifica con el postulante y su nombre" + 2 negativos + `-reales` › camino real | OK |
| R24 | `-wiring` › los **tres** caminos (creacion, vencido->solicitado, rechazado->solicitado) + "propaga la zona destino" + "NO avisa en conflicto" | Los 3 `await this.avisarCierrePorAprobar(...)` estan en el codigo y cada uno tiene su test. OK |
| R25 | `-wiring` › 3 tests de "el notificador lanza y la operacion sigue ok" (uno por productor) + `-reales` › 3 de "absorbe y registra" | El de postulacion ademas comprueba que `storage.remove` **no** se dispara: el aviso fallido no arrastra la limpieza de documentos de la feature 21. OK |
| R26 | `-wiring` › 5 tests (vercel.json, enum JobTipo, rutas de cron, la migracion no toca `jobs`, el enum de eventos tiene exactamente 4 valores) | OK |
| R27 | `notificacion-productores` › "la segunda emision del mismo cierre no crea ninguna fila" + "vuelve a emitir para el destinatario que YA leyo"; `notificacion-repository` › "devuelve false cuando choca con notificacion_dedupe_key" | Guardia en `emitirFilas` + indice unico parcial `NULLS NOT DISTINCT` como red. OK |

### Bloque 4 — Server Actions

| R | Test | Verificacion |
| --- | --- | --- |
| R28 | `notificacion-service` › "ordena por fecha descendente" + mapeo a DTO | OK |
| R29 | idem › ventana + limite + "deja fuera lo creado antes de la ventana" | `VENTANA_DIAS`/`PAGE_SIZE` salen de `lib/config/notificaciones.ts`, sin literales sueltos. OK |
| R30 | idem › "el contador se calcula sobre el mismo conjunto que se devuelve" | OK |
| R31 | idem › "la notificacion aparece con read=true tras marcarla" | Marca y **vuelve a listar**, comprobando `read===true` y `noLeidas===0`. Test de comportamiento. OK |
| R32 | idem › "marca todas las visibles y no descartadas" + "no altera el contador de otro usuario del mismo rol" | OK |
| R33 | idem › "deja de listarse sin borrar la fila subyacente" + "descartar una no leida no descuadra el contador" | OK |
| R34 | `notificaciones-action` › 5 tests, uno por accion | Cada uno asserta que el service **no fue tocado**. OK |
| R35 | `notificacion-service` › forbidden sin crear fila de lectura + not_found | El service autoriza con el MISMO predicado que lista (`verificarVisible`). OK |
| R36 | `notificaciones-action` › 5 tests de borde (id vacio, id no-texto, contadores negativos, creadas>total, loteId no-uuid) | OK |
| R37 | `notificacion-service` (x2) + `notificacion-repository` (x2) | `upsert` sobre la clave unica; re-marcar no reescribe el instante. OK |
| R38 | `notificaciones-action` › "declara 'use server'" + "no existe ruta API de notificaciones" + "ningun modulo hace fetch" | OK |
| R39 | `notificaciones-action` › "usa siempre el actor autenticado" + "segunda invocacion con el mismo loteId no crea otra" + "un lote distinto si"; `OrdenesCargaMasivaNotificacion` › 7 tests de cliente | El destinatario **no viaja en el input**: se fija server-side. Nadie puede sembrar avisos ajenos. OK |

### Bloque 5 — Campana (frontend)

| R | Test | Verificacion |
| --- | --- | --- |
| R40 | `NotificationsBell` › 3 tests (fuente sin `EXAMPLE_NOTIFICATIONS`; se puebla solo con la accion; no inventa contenido) | OK |
| R41 | › "muestra el distintivo con la cantidad" | OK |
| R42 | › "con mas de 99 no leidas muestra +99" | Verde, pero ver **nota menor 4**: la rama es inalcanzable en produccion. |
| R43 | › "sin no leidas no se muestra ningun distintivo" | OK |
| R44 | › "listado vacio -> No tienes notificaciones." | OK |
| R45 | › deshabilitado sin no leidas + "invoca la accion y deja el contador en cero" | OK |
| R46 | › "la X invoca descartarNotificacion y retira el elemento" | OK |
| R47 | › "abrir el popover revalida" + "refreshInterval sale de la config (60 s)" + "no hay Realtime ni canal" | El tercero recorre el fuente del componente y del hook sin comentarios buscando `realtime`/`supabase`/`.channel(`/`subscribe(`. OK |
| R48 | › 3 tests (unauthenticated, la accion lanza, el resto de la cabecera sobrevive) | El hook fuerza `items: []` / `noLeidas: 0` ante error. OK |
| R49 | › "muestra el icono de su tipo, la descripcion y el anexo" | OK |
| R50 | › "NotificationItem es alias de NotificacionDTO, asignable en ambos sentidos" + "notifications se usa como datos iniciales" | `PageHeader.tsx` intacto. OK |

**Cobertura: 50/50. Ningun requisito sin test que lo verifique de verdad.**

---

## 3. Puntos calientes del encargo

### 3.1 Recableado de los notificadores — verificado, sin apagados por entorno

- `grep -rn "VITEST|NODE_ENV" lib app` devuelve **2 aciertos y ninguno es de esta feature**:
  `lib/actions/auth.ts:60` (`secure` de la cookie) y `app/layout.tsx:53`. **No queda ningun
  `if (enTest()) return`.** El anti-patron de la feature 140 esta genuinamente erradicado.
- Hay un test que fija el invariante recorriendo `lib/` y `app/` completos
  (`notificacion-notificadores-reales` › "ningun modulo apaga la emision segun el entorno").
- La direccion es la correcta: `notificadorNoOp` es el **default del constructor** (inocuo por
  construccion, no por husmear el entorno) y `notificar*Real` se inyecta en el composition root.
- **El camino real esta cubierto de verdad**, no solo por grep: `notificacion-notificadores-reales`
  ejercita `notificar*Con(repoDoble)` (emite las filas correctas y absorbe el fallo) y ademas
  monta el notificador REAL dentro de `PostulacionMensajeroService` y `BulkOrdenService`
  comprobando que las filas llegan al repositorio. Los 3 tests de grep sobre los composition
  roots son complemento, no la unica cobertura.

**Composition roots: confirmado que son exactamente 3.** Barrido de `app/`, `lib/`,
`components/`, `hooks/` buscando `new PostulacionMensajeroService` / `new CierreDiaService` /
`new BulkOrdenService`:

- `lib/actions/postulacion-mensajero.ts:49` -> inyecta OK
- `lib/actions/cierre-dia.ts:37` -> inyecta OK
- `app/api/ordenes/api-key/carga/route.ts:108` -> inyecta OK
- `app/api/ordenes/carga-masiva/chunk/route.ts:36` -> **construye `BulkOrdenService` y se queda
  con el no-op.** Inspeccionado: **es intencional y correcto**. Esa ruta atiende los chunks
  troceados por el cliente y **no sabe cual es el ultimo**; notificar ahi produciria N avisos
  por carga. El cierre de esa via es la Server Action `notificarCargaMasivaTerminada` (F1.4-4),
  invocada una sola vez desde `OrdenesCargaMasivaButton.handleConfirmar`. **No es un agujero
  silencioso.**

### 3.2 no-migration-102.test.ts — edicion minima, invariantes intactos

Comparado linea por linea:

- De `CONCEPTOS_PROHIBIDOS` solo se retiran `notificac`, `notification` y `campana` **como
  nombres de carpeta de migracion**, y se sustituyen por un test **mas estricto que un simple
  borrado**: `expect(conNotificacion).toEqual([<la carpeta de la 146>])`, una allowlist de una
  sola entrada. Una segunda carpeta con concepto de notificacion romperia.
- Los conceptos que son el invariante REAL de la 102 (`clasificacion_sla`, `es_rechazo_sla`,
  `total_ingreso_bodega_rechazos_sla`, `rechazo_sla_visible`) **siguen prohibidos, sin tocar**.
- El test "schema.prisma NO tiene columna snapshot de la clasificacion SLA" esta **intacto**:
  la clasificacion sigue derivandose del historial, no se snapshotea.
- Las dos aserciones de modelos/`@@map` pasan de "no existe ninguna" a una **igualdad exacta**
  con la lista de la 146. Un modelo de notificacion adicional de un tercero romperia el test.
  **Se endurece, no se afloja.**
- La asercion "sin badge ni campana persistidos" **sobrevive sin relajarse**; para conservarla
  el implementer reformulo un comentario de `schema.prisma` en vez de debilitar el test.
- El archivo gana 2 tests (5 -> 7).

**Conclusion: edicion minima; los invariantes propios de la 102 quedan verificados igual o
mejor que antes.** Aprobada.

### 3.3 Alcance / RLS — sin caminos que esquiven el predicado

- Ambas tablas con `ENABLE ROW LEVEL SECURITY` y **sin policies** (patron del repo). Toda la
  autorizacion vive en aplicacion, como se declaro.
- **Auditoria de superficies de acceso**: `notificacion` / `notificacionLectura` solo se tocan
  desde `NotificacionRepository` y desde el emisor transaccional. `NotificacionRepository` solo
  se instancia en `lib/actions/notificaciones.ts` (las 5 acciones), en
  `lib/notificaciones/notificadores.ts` (productores, que solo **escriben** avisos dirigidos) y
  en `emitir.ts` sobre el `tx` del choke point. **No hay ruta API de notificaciones.**
- Las 5 consultas con alcance (`listarParaUsuario`, `verificarVisible`, `marcarTodasLeidas`, y
  `marcarLeida`/`descartar` a traves de `verificarVisible`) usan `predicadoVisibilidad`.
  **No existe un segundo filtro de alcance** escrito a mano en ninguna parte.
- `marcarLeida` y `descartar` del repositorio no filtran por alcance, pero **son inalcanzables
  sin pasar antes por `NotificacionService.autorizar`**, su unico llamador. Verificado.
- Casos negativos probados: `adminTienda` que no ve el rechazo de otra tienda (R15), actor sin
  zona que no ve nada acotado por zona (R16), rol ajeno que no ve nada (R17), y
  `forbidden`/`not_found` sin crear fila de lectura (R35).
- `Actor.zonaId` es opcional pero `NotificacionService` normaliza con `?? null` en un unico
  punto: un actor construido a mano falla **cerrado** (ve menos), nunca abierto.

### 3.4 Migracion — revisada por lectura, NO aplicada

Confirmo que **no ejecute ninguna migracion** contra la base. `migration.sql` es puramente
aditiva; `down.sql` revierte exactamente lo que crea y en orden FK-inverso. `NULLS NOT
DISTINCT` exige Postgres 15+ (Supabase cumple), fijado por test.

### 3.5 git add -A del commit 03ba0df

Revisado: **es atribucion, no correccion**. El contenido final del diff `origin/dev...HEAD` es
coherente y completo — los archivos de frontend involucrados (`useNotificaciones.ts`,
`NotificationsBell.tsx`) estan integros y sus tests verdes. No es hallazgo.

---

## 4. Bloqueantes

**Ninguno.**

## 5. Notas menores

1. **`tasks.md` tiene D1, D2 y D3 sin marcar `[x]`.** Incumple `CHECKPOINTS.md >
   Especificacion`. La sustancia si esta hecha (mapa de trazabilidad, verificacion pegada y 15
   commits granulares en vez de un mega-commit): es el archivo el que miente. Marcarlos antes
   del merge.
2. **D1 pide `progress/impl_146.md` (uno) y hay dos** (`impl_146_backend.md` /
   `impl_146_frontend.md`). El mapa R1-R50 completo solo se obtiene leyendo ambos. Aceptable
   dado que fueron dos agentes, pero conviene un indice o consolidar.
3. **`./init.sh` termina en rojo.** La causa es 100 % preexistente de `dev` (los 2 errores de
   la prop `count`) y el delta de la feature es 0, asi que **no es imputable a la 146** — pero
   `CHECKPOINTS.md > Verificacion final` no se cumplira para ninguna feature hasta que alguien
   arregle esos dos tests.
4. **R42 (`+99`) es una rama inalcanzable en produccion.** R30 obliga a contar las no leidas
   dentro del conjunto devuelto y `PAGE_SIZE = 50`, de modo que `noLeidas` no puede superar 50
   y el badge nunca mostrara `+99`. Es una inconsistencia **del propio spec**, no de la
   implementacion (que cumple ambos requisitos literalmente); el test la ejercita inyectando
   `noLeidas: 137` a mano. Dejar registrado.
5. **Nombre de indice divergente entre schema y migracion.** `schema.prisma` declara
   `@@index([entidadTipo, entidadId])` (Prisma lo nombraria
   `notificacion_entidad_tipo_entidad_id_idx`) mientras `migration.sql` crea
   `notificacion_entidad_idx`. Un futuro `prisma migrate diff` vera drift. Sin impacto
   funcional; el resto de nombres si coinciden.
6. **`findCierreSolicitado?` opcional en `ICierreDiaRepository`.** Es deuda real —un repositorio
   que no lo implemente no notifica y el typechecker calla— pero **no esconde un agujero hoy**:
   el unico implementador de produccion (`CierreDiaRepository`) si lo trae, y el unico
   composition root de produccion (`lib/actions/cierre-dia.ts`) usa ese repositorio. La
   motivacion (no editar dobles de test de las features 37/38/109/111) es legitima.
   **Promoverlo a obligatorio en cuanto esos dos archivos se toquen por otra razon.**
7. **`marcarNotificacionLeida` (R31) sin consumidor de UI.** **No incumple ningun requisito**:
   R31 exige que el sistema registre la lectura, y esta probado de punta a punta; R40-R50 no
   piden ningun control de "marcar esta como leida" en la campana. Hoy una notificacion pasa a
   leida via "marcar todas" o al descartarla. **Deuda aceptable**, no bloqueante.
8. **El default no-op depende de que un futuro composition root recuerde cablear.** Mitigado
   con tests, pero un cuarto call-site nuevo perderia el aviso en silencio y habria que
   añadirlo a esa lista a mano. Deuda inherente al patron, ya declarada por el implementer.
9. **Bookkeeping pendiente del leader** (no del implementer): `feature_list.json` sigue con
   `"status": "pending"` para la 146 y no hay entrada en `progress/history.md`.

---

## 6. Checklist de CHECKPOINTS.md

| item | estado |
| --- | --- |
| `specs/146/requirements.md` con EARS numerados | OK — R1-R50 |
| `design.md` con alternativa descartada y su porque | OK — A1-A8 descartadas + seccion 10 con las 9 decisiones de F1.4 |
| `tasks.md` todas `[x]` | **NO — D1/D2/D3 sin marcar** (nota 1) |
| Cada `R<n>` mapea a test concreto | OK — 50/50 |
| `progress/impl_146*.md` con el mapa `R -> test` | OK (repartido en 2 archivos, nota 2) |
| `pnpm run typecheck` sin errores | NO — 2 preexistentes, **delta 0** (nota 3) |
| `pnpm run lint` sin errores | OK — 0 errores |
| `pnpm test` pasa | OK — delta 0; los 5 rojos son ajenos o flaky verificado en aislado |
| E2E si toca flujo critico | n/a — la feature **añade** un aviso best-effort sobre ingesta y cambio de estado sin alterar su comportamiento; los caminos criticos ya tienen sus `e2e/*.spec.ts` y no cambian |
| RLS en tablas nuevas | OK — ambas, sin policies (patron del repo) |
| Migracion versionada y reversible con `down.sql` | OK |
| Sin secretos hardcodeados | OK — ninguna variable de entorno nueva |
| Webhooks nuevos con firma e idempotencia | n/a — no hay webhook nuevo |
| Controller sin queries ni logica | OK — las 5 acciones solo resuelven actor, validan con zod y delegan |
| Service sin HTTP | OK — `NotificacionService` no conoce Next ni Prisma |
| Repository solo queries | OK — `predicadoVisibilidad` es composicion de `where`, no logica de negocio |
| Interfaces en `lib/interfaces/` por categoria | OK — `repositories/INotificacionRepository.ts`, `services/INotificacionService.ts` |
| Paginas protegidas validan en servidor via `cookies()` | OK — `resolveActorFromSession` en las 5 acciones |
| `private/` recibe datos por props | n/a — la campana es `components/shared/`, cliente, y obtiene sus datos por Server Action (design seccion 2 lo justifica) |
| Mutaciones internas por Server Action, no fetch | OK — verificado por test y por inspeccion |
| Sin hardcode de pais/moneda/cuenta | OK |
| `./init.sh` en verde | NO — por deuda preexistente ajena (nota 3) |
| `progress/review_146.md` con veredicto OK | OK — este archivo |
| Entrada en `progress/history.md` | NO — pendiente del leader (nota 9) |

---

## 7. Conclusion

La feature esta **bien construida y bien probada**. Los tres riesgos que el encargo señalaba
como criticos —el apagado por entorno de los notificadores, el debilitamiento de la guardia de
la feature 102 y un camino de lectura/mutacion que esquive el predicado de alcance— **se
verificaron uno por uno y ninguno se materializa**. La cobertura R1-R50 es real, no nominal:
los tests de visibilidad evaluan el predicado de produccion y los del rechazo corren el choke
point de verdad.

Las 9 notas son bookkeeping (1, 2, 9), deuda preexistente ajena (3), una inconsistencia del
propio spec (4), cosmetica de esquema (5) y deuda tecnica ya declarada y razonada (6, 7, 8).
**Ninguna justifica devolver la feature al implementer.**

**APROBADO-CON-NOTAS** — apto para merge una vez el leader cierre las notas 1, 2 y 9.
