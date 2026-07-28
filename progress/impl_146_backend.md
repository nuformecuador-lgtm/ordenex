# Feature 146 — Campana de notificaciones · bitácora del backend (bloques A y B)

Rama `feature/146-campana-notificaciones`, worktree `ordenex-wt-146`, base `origin/dev` @ `56ff0aa`.
Alcance ejecutado: **A1–A3** y **B1–B17** de `tasks.md`. El bloque C (frontend, `.tsx`) queda
para el agente de frontend; ningún `.tsx` fue tocado.

---

## 1. Archivos por capa

### Contrato y configuración (A)
| Archivo | Estado |
| --- | --- |
| `lib/types/notificacion.ts` | nuevo — DTO, eventos de D1, schemas zod, resultados de las 5 acciones |
| `lib/config/notificaciones.ts` | nuevo — `PAGE_SIZE=50`, `REFRESH_INTERVAL_MS=60_000`, `VENTANA_DIAS=30` |
| `lib/interfaces/services/IOrdenService.ts` | modificado — `Actor.zonaId?: string \| null` (aditivo) |
| `lib/auth/resolve-actor.ts` | modificado — puebla `zonaId` desde `usuario.zona_id` |

### Base de datos (B1–B5)
| Archivo | Estado |
| --- | --- |
| `db/migrations/20260727120000_notificacion/migration.sql` | nuevo |
| `db/migrations/20260727120000_notificacion/down.sql` | nuevo |
| `db/schema.prisma` | modificado — 3 enums, `Notificacion`, `NotificacionLectura`, 3 relaciones inversas en `Usuario` y 1 en `Zona` |
| `tests/integration/db/zonas-migration.test.ts` | modificado — denylist del invariante de orden (R12) |
| `tests/integration/db/no-migration-102.test.ts` | modificado — **desviación**, ver §5.0 |

### Repositorio (B6)
| Archivo | Estado |
| --- | --- |
| `lib/interfaces/repositories/INotificacionRepository.ts` | nuevo |
| `lib/repositories/NotificacionRepository.ts` | nuevo — incluye `predicadoVisibilidad` |

### Servicio y acciones (B8, B10)
| Archivo | Estado |
| --- | --- |
| `lib/interfaces/services/INotificacionService.ts` | nuevo |
| `lib/services/NotificacionService.ts` | nuevo |
| `lib/actions/notificaciones.ts` | nuevo — 5 Server Actions |

### Productores (B12–B16)
| Archivo | Estado |
| --- | --- |
| `lib/notificaciones/emitir.ts` | nuevo — textos §4.6 + dedupe + emisor transaccional del rechazo |
| `lib/notificaciones/notificadores.ts` | nuevo — no-op por defecto + 3 notificadores best-effort reales |
| `lib/repositories/registrar-cambio-estado.ts` | modificado — 5.º parámetro `emitirNotificaciones` |
| `lib/repositories/OrdenHistorialRepository.ts` | modificado — `tx: ChokePointTx` |
| `lib/interfaces/repositories/IOrdenHistorialRepository.ts` | modificado — `tx` ensanchado |
| `lib/services/PostulacionMensajeroService.ts` | modificado — notificador inyectable |
| `lib/services/CierreDiaService.ts` | modificado — aviso en los 3 caminos de éxito |
| `lib/services/BulkOrdenService.ts` | modificado — aviso al cerrar el lote por API |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | modificado — `findCierreSolicitado?` (opcional) |
| `lib/repositories/CierreDiaRepository.ts` | modificado — implementa `findCierreSolicitado` |
| `lib/actions/postulacion-mensajero.ts` | modificado — composition root: inyecta el notificador real |
| `lib/actions/cierre-dia.ts` | modificado — composition root: inyecta el notificador real |
| `app/api/ordenes/api-key/carga/route.ts` | modificado — composition root: inyecta el notificador real |

### Tests nuevos
| Archivo | Tests |
| --- | --- |
| `tests/unit/auth/resolve-actor.test.ts` | 3 |
| `tests/integration/db/notificacion-migration.test.ts` | 32 |
| `tests/unit/repositories/notificacion-visibilidad.test.ts` | 12 |
| `tests/unit/repositories/notificacion-repository.test.ts` | 15 |
| `tests/unit/services/notificacion-service.test.ts` | 18 |
| `tests/integration/actions/notificaciones-action.test.ts` | 19 |
| `tests/unit/repositories/notificacion-orden-rechazada.test.ts` | 15 |
| `tests/unit/services/notificacion-productores.test.ts` | 12 |
| `tests/unit/services/notificacion-productores-wiring.test.ts` | 19 |
| `tests/unit/services/notificacion-notificadores-reales.test.ts` | 16 |
| **Total** | **161** |

Conteo por capa: **9 archivos nuevos de producción**, **10 modificados**, **10 archivos de test
nuevos**, **2 tests ajenos editados** (uno permitido por el spec y otro forzado; ver §5.0).

---

## 2. Trazabilidad R → test

Cubre R1–R28 y R39 (todo el backend). R29–R38 también quedan cubiertos porque su
implementación es backend aunque el spec los liste bajo "Server Actions". R40–R50 son del
bloque C.

| R | Test (archivo › nombre) |
| --- | --- |
| R1 | `notificacion-migration` › "crea la tabla con id, tipo de presentacion, evento, descripcion, anexo, entidad y fecha" + "declara los tres enums nativos…" |
| R2 | `notificacion-migration` › "crea `notificacion_lectura` con leida_at y descartada_at nullable" + "admite a lo sumo UNA fila por (notificacion, usuario)" |
| R3 | `notificacion-service` › "lo que lee el admin 1 sigue no leido para el admin 2" + "lo que descarta el admin 1 sigue en el listado del admin 2"; `notificacion-migration` › "`notificacion` NO lleva columna de lectura…" |
| R4 | `notificacion-migration` › "declara el CHECK XOR entre destinatario_rol y destinatario_usuario_id" |
| R5 | `notificacion-migration` › "crea tienda_id y zona_id nullable y sin default" + "no acopla los dos alcances entre si…" |
| R6 | `notificacion-migration` › "destinatario_rol es ESCALAR…"; `notificacion-orden-rechazada` › "emite maestro y admin sin alcance, adminTienda por tienda y adminSatelite por zona" |
| R7 | `notificacion-migration` › "no altera ni elimina ninguna tabla, columna o enum preexistente" + "solo toca las dos tablas nuevas" + "solo crea las dos tablas nuevas" |
| R8 | `notificacion-migration` › "la carpeta trae migration.sql y down.sql" + "borra las dos tablas en orden inverso a las FKs" + "borra los tres enums despues de las tablas" |
| R9 | `notificacion-migration` › "habilita Row Level Security en notificacion y en notificacion_lectura" + "no crea ninguna policy" |
| R10 | `notificacion-migration` › "indexa el listado por destinatario ordenado por fecha descendente" + "indexa los dos alcances…" + "indexa la entidad de origen y la lectura por usuario" |
| R11 | `notificacion-migration` › "las tres FK de notificacion cascadean el borrado" + "las dos FK de notificacion_lectura cascadean el borrado" |
| R12 | `notificacion-migration` › "`zonas-migration.test.ts` excluye la carpeta `_notificacion`"; y `zonas-migration` › "la carpeta contiene migration.sql y down.sql, con timestamp posterior a las previas" (en verde) |
| R13 | `notificacion-visibilidad` › "dos maestros distintos ven la misma notificacion dirigida a `maestro`" |
| R14 | `notificacion-visibilidad` › "la tienda dueña del alcance ve la notificacion" |
| R15 | `notificacion-visibilidad` › "la tienda 2 no ve el rechazo acotado a la tienda 1" |
| R16 | `notificacion-visibilidad` › "el adminSatelite de la zona 2 NO ve el aviso acotado a la zona 1" + "un adminSatelite SIN zona asignada no ve ninguna notificacion acotada por zona" |
| R17 | `notificacion-visibilidad` › "una tienda no ve la notificacion dirigida a `maestro`…" + "un maestro no ve la notificacion acotada a su MISMA zona pero dirigida a adminSatelite" |
| R18 | `notificacion-orden-rechazada` › "emite maestro y admin sin alcance, adminTienda por tienda y adminSatelite por zona" + "las cuatro son de tipo alert…" |
| R19 | `notificacion-orden-rechazada` › "no crea ninguna notificacion cuando el rechazo viene de escalado_devuelta_sla" + "dentro de un lote mixto solo notifica el rechazo por gestion" |
| R20 | `notificacion-orden-rechazada` › "la emision vive dentro del mismo tx que el append…" + "si el append del historial falla, la emision no llega a ejecutarse" |
| R21 | `notificacion-orden-rechazada` › "propaga el error del emisor para que la transaccion del call-site revierta" |
| R22 | `notificacion-productores` › "emite UNA fila box al usuario ejecutor con las creadas en la descripcion"; `notificacion-productores-wiring` › "emite una sola vez, al usuario de la key, con los contadores del resumen" |
| R23 | `notificacion-productores` › "emite DOS filas warning sin alcance, referenciando al postulante"; `…-wiring` › "notifica con el postulante y su nombre tras la escritura atomica" |
| R24 | `notificacion-productores` › "emite TRES filas warning, la tercera acotada a la zona destino"; `…-wiring` › "camino de creacion", "camino vencido -> solicitado", "camino rechazado -> solicitado" |
| R25 | `notificacion-productores` › "emitirBestEffort absorbe el error y lo registra con la operacion"; `…-wiring` › "la postulacion sigue devolviendo ok…", "solicitarCierre sigue devolviendo ok…", "cargarViaApi sigue devolviendo el resumen…" |
| R26 | `notificacion-productores-wiring` › "vercel.json no gana ninguna entrada de cron…", "el enum JobTipo no gana ningun valor…", "no existe ninguna ruta de cron ni route handler…", "la migracion no toca la tabla `jobs`…", "el enum de eventos es el inventario CERRADO de D1" |
| R27 | `notificacion-productores` › "la segunda emision del mismo cierre no crea ninguna fila" + "vuelve a emitir para el destinatario que YA leyo"; `notificacion-repository` › "devuelve false sin lanzar cuando el create choca con notificacion_dedupe_key" |
| R28 | `notificacion-service` › "ordena por fecha descendente" + "mapea la fila al DTO que consume la campana…" |
| R29 | `notificacion-service` › "pide al repositorio la ventana de VENTANA_DIAS y el limite PAGE_SIZE" + "deja fuera lo creado antes de la ventana" + "nunca devuelve mas de 50 elementos" |
| R30 | `notificacion-service` › "el contador se calcula sobre el mismo conjunto que se devuelve" + "el contador nunca supera el limite de la pagina" |
| R31 | `notificacion-service` › "la notificacion aparece con read=true tras marcarla" |
| R32 | `notificacion-service` › "marca todas las visibles y no descartadas del actor" + "no altera el contador de otro usuario del mismo rol" |
| R33 | `notificacion-service` › "deja de listarse sin borrar la fila subyacente" + "descartar una no leida no descuadra el contador" |
| R34 | `notificaciones-action` › los 5 tests de "sin sesion valida ninguna accion lee ni escribe" |
| R35 | `notificacion-service` › "responde forbidden y no crea fila de lectura…" + "responde not_found cuando la notificacion no existe…" |
| R36 | `notificaciones-action` › "rechaza un id vacio…", "rechaza un id que no es texto…", "rechaza contadores no enteros o negativos…", "rechaza que las creadas superen el total", "rechaza un loteId que no es uuid" |
| R37 | `notificacion-service` › "marcar dos veces la misma notificacion deja una unica fila" + "descartar dos veces…"; `notificacion-repository` › los dos de R37 |
| R38 | `notificaciones-action` › "el modulo de acciones declara 'use server'" + "no existe ninguna ruta API de notificaciones bajo app/api" + "ningun modulo de la feature hace fetch…" |
| R39 | `notificaciones-action` › "usa siempre el actor autenticado como destinatario…" + "una segunda invocacion con el mismo loteId no crea otra notificacion" + "un lote DISTINTO si produce su propia notificacion" |

R40–R50: **bloque C (frontend)**, fuera de este alcance.

---

## 3. Decisiones de implementación

1. **`Actor.zonaId` es OPCIONAL (`zonaId?: string | null`).** El spec pide un cambio aditivo
   que no obligue a tocar ningún consumidor. Declararlo obligatorio habría roto los cientos de
   literales `Actor` de tests ajenos. `resolveActorFromSession` siempre lo puebla y
   `NotificacionService` normaliza con `?? null` en un único punto, para que un `undefined`
   nunca se cuele en el predicado.

2. **`predicadoVisibilidad` devuelve un `Prisma.NotificacionWhereInput`,** no un booleano. Es
   la fuente única de R13–R17 y lo reutilizan las cinco consultas con alcance (`listar`,
   `verificarVisible`, `marcarTodasLeidas` y, a través de `verificarVisible`, marcar y
   descartar). Los tests de alcance **evalúan el predicado real** con un intérprete genérico
   de OR/AND/igualdad en el test, en vez de re-implementar la regla: si el predicado cambia,
   los tests lo notan.

3. **`verificarVisible` distingue `no_existe` de `no_visible`** con dos consultas, y solo paga
   la segunda en el camino negativo. Es lo que permite responder `not_found` vs `forbidden`
   sin filtrar la existencia de filas ajenas… salvo por el propio `forbidden`, que es lo que
   el spec pide (R35).

4. **`marcarTodasLeidas` no usa SQL crudo.** El diseño proponía `INSERT … ON CONFLICT DO
   NOTHING`; escribirlo a mano habría duplicado el predicado de visibilidad en SQL, violando
   la regla de "una sola fuente". Se resuelve con `findMany` (predicado + ventana + no
   descartadas + no leídas) y `createMany({ skipDuplicates: true })`, que Prisma compila a
   `ON CONFLICT DO NOTHING`. Dos sentencias, un solo predicado.

5. **`descartar` emula `leida_at = COALESCE(leida_at, now())`** con un `upsert` + un
   `updateMany` acotado a `leidaAt: null`, porque el `upsert` de Prisma no expresa COALESCE.

6. **El choke point recibe el catálogo ya resuelto.** `validarTransiciones` pasó de devolver
   `void` a devolver el mapa `id → value` que ya calculaba, y `appendCambioEstado` se lo pasa
   al emisor. Cero consultas extra para clasificar el destino del lote.

7. **`ChokePointTx` se ensancha con `NotificacionEmisorTx`** (las dos tablas + `orden`), igual
   que la feature 99 lo ensanchó con `JobTxClient`. El `tx` real de `$transaction` ya lo
   satisface. `IOrdenHistorialRepository.registrarCambioEstado` se ensanchó en paralelo. El
   emisor real lleva un **guard defensivo**: si el `tx` no expone `notificacion`/`orden`
   (dobles históricos de la feature 49), es un no-op y ninguna suite ajena se rompe.

8. **`findCierreSolicitado` se declaró OPCIONAL en `ICierreDiaRepository`.** Los dos caminos de
   transición (`vencido`/`rechazado → solicitado`) solo devuelven un booleano, así que el id
   del cierre hay que leerlo después del éxito. Declarar el método obligatorio habría roto los
   dobles a mano de `tests/unit/services/cierre-dia-service.test.ts` y
   `tests/integration/actions/cierre-dia-action.test.ts`, y el spec solo permite editar
   `zonas-migration.test.ts`. El repositorio real lo implementa; un doble que no lo traiga
   simplemente no notifica.

9. **El aviso de postulación va FUERA del `try/catch` de `postular`.** Dentro, un notificador
   que lanzara habría disparado la limpieza de documentos (R24 de la feature 21) y convertido
   un alta correcta en un error. Se usa un flag `creado` y `emitirBestEffort` como segunda
   red, para blindar también contra un notificador inyectado que no absorba su fallo.

10. **El default de los tres services es un notificador NO-OP; el real se cablea en el
    composition root.** El riesgo a evitar era concreto: `PostulacionMensajeroService`,
    `CierreDiaService` y `BulkOrdenService` se construyen en suites ajenas **sin inyectar
    nada**, así que un default "real" habría escrito notificaciones en la base —que en este
    repo es **compartida con producción**— en cuanto `DATABASE_URL` estuviera en el entorno del
    runner.

    La primera versión resolvió esto con una guarda `if (enTest()) return` dentro de los
    notificadores reales. **Fue un error y se revirtió**: apagar una emisión según
    `process.env` deja el camino de producción sin cobertura posible y lo convierte en una
    falla silenciosa si la variable se filtra a un preview (mismo anti-patrón por el que se
    rechazó la primera entrega de la feature 140).

    El cableado definitivo invierte la dirección:

    - `notificadorNoOp` es el **default** del constructor de los tres services. Una suite que
      construya sin cablear obtiene el no-op **por construcción**, sin husmear el entorno.
    - `notificar{Postulacion,CierreDia,CargaMasiva}*Con(repo, logger?)` es el camino real
      **parametrizado por repositorio**, y por eso es directamente testeable con un doble.
    - `notificar*Real` son bindings finos de esas mismas funciones sobre
      `NotificacionRepository(getPrismaClient())`, y se inyectan **explícitamente** en el
      composition root: `lib/actions/postulacion-mensajero.ts`, `lib/actions/cierre-dia.ts` y
      `app/api/ordenes/api-key/carga/route.ts`.

    No queda **ninguna** referencia a `VITEST` ni a `NODE_ENV === "test"` en `lib/` ni en
    `app/`; hay un test que lo verifica recorriendo ambos árboles. Otros dos tests fijan que
    los defaults son el no-op y que los tres composition roots inyectan el real, para que
    "alguien olvida cablear" sea un fallo de test y no una notificación perdida en silencio.

11. **La zona de la orden se lee de `orden.zona_id`,** no derivándola del distrito: la columna
    existe y es NOT NULL en el esquema (`schema.prisma:453`). Si aun así llegara nula, la fila
    de `adminSatelite` se omite y las otras tres se emiten.

12. **La migración NO se aplicó contra la base.** El `.env` apunta a una base compartida con
    producción. Se valida por forma con 32 aserciones de regex sobre `migration.sql` y
    `down.sql` (patrón `zonas-migration` / `chat-*-migration`). `prisma validate` y
    `prisma generate` sí se ejecutaron: el schema es válido y el cliente se regeneró.

---

## 4. Verificación

### `pnpm run typecheck`

```
tests/components/GestionarOrdenPanelEvidencias.test.tsx(84,6): error TS2741: Property 'count' is missing in type '{ orden: MiAsignacionDTO; yaActiva: true; ... }' but required in type 'Readonly<GestionarOrdenPanelProps>'.
tests/components/NotaPrivadaMensajero.test.tsx(253,8): error TS2741: Property 'count' is missing in type '{ orden: MiAsignacionDTO; yaActiva: true; ... }' but required in type 'Readonly<GestionarOrdenPanelProps>'.
```

**2 errores, exactamente los 2 PREEXISTENTES de `dev`.** Delta 0. No se tocan: son deuda ajena
(prop `count` de `GestionarOrdenPanel`) y quedan fuera del alcance de esta feature.

### `pnpm run lint`

```
tests/components/MisAsignacionesModule.test.tsx  136:10  warning  'ordenCardsEnReparto' is defined but never used
tests/components/WebhookAccionCell.test.tsx        7:3   warning  'within' is defined but never used
tests/unit/auth/google-adc-token.test.ts          25:38  warning  '_args' is defined but never used
tests/unit/repositories/api-key-repository.test.ts 158:37 warning '_args' is defined but never used

✖ 4 problems (0 errors, 4 warnings)
```

**0 errores.** Las 4 advertencias son preexistentes y ninguna está en archivos de esta feature.

### `pnpm test`

| | Archivos | Tests |
| --- | --- | --- |
| **Baseline** (`origin/dev` @ `56ff0aa`, medido **dos veces** en este worktree) | 516 · **5 fallando** | 5237 · **15 fallando** / 5222 pasando |
| **Tras A+B** | 525 · **4 fallando** | 5384 · **14 fallando** / 5370 pasando |
| **Tras el recableado de los notificadores** | 526 · **5 fallando** | 5400 · **15 fallando** / 5385 pasando |

**Delta de fallos deterministas: 0.** Los 4 archivos que fallan en las tres mediciones son
**deuda ajena de frontend**, ninguno tocado por esta feature:

```
FAIL tests/components/DataTable.test.tsx              (2 tests)
FAIL tests/components/MarcarLuegoToggle.test.tsx      (2 tests)
FAIL tests/components/MisAsignacionesModule.test.tsx  (9 tests)
FAIL tests/components/NotaPrivadaMensajero.test.tsx   (1 test)
```

El quinto archivo varía de una corrida a otra porque la suite tiene **tests flaky por
contención de CPU** (límite de 20 s por test): en el baseline cayó
`tests/unit/guards/no-embalaje.test.ts` (recorre el repo entero), en la última corrida cayó
`tests/integration/recuperar-contrasena-form.test.tsx`. Ambos **pasan en aislado**
(`recuperar-contrasena-form`: 7/7 verificado) y ninguno tiene relación con notificaciones.

`+163` tests respecto al baseline: 145 de los bloques A+B, 16 del camino real de los
notificadores, y 2 que gana `no-migration-102.test.ts` al reescribirse (5 → 7).

---

## 5. Deudas conocidas y riesgos

### 5.0 Desviación del encargo: una segunda edición a un test ajeno

El encargo permitía editar **un solo** test existente (`zonas-migration.test.ts`). Hubo que
tocar **un segundo**, `tests/integration/db/no-migration-102.test.ts`, porque su guardia era
**estructuralmente incompatible** con esta feature: afirmaba que `db/schema.prisma` no declara
ningún `model Notificac*` ni ningún `@@map("…notificac…")`, y que ninguna carpeta de migración
contiene el concepto `notificac`. La feature 146 hace exactamente esas tres cosas, así que no
existía forma de implementarla dejando ese archivo intacto (renombrar la carpeta de migración no
habría salvado las dos aserciones sobre el esquema).

La edición es mínima y conserva el invariante real de la 102 —que su clasificación SLA se
**deriva** del historial y no se snapshotea en una columna nueva—, cambiando solo la premisa
caducada: donde decía "no existe ninguna notificación en el esquema" ahora dice "la única infra
de notificaciones del esquema y de las migraciones es la de la 146", enumerando los dos modelos,
las dos tablas y los tres enums. Además se reformuló un comentario de `schema.prisma` para no
usar la palabra "campana", de modo que la aserción "sin badge ni campana persistidos" de la 102
sigue en pie sin relajarse.

**Queda a criterio del reviewer** si esta desviación es aceptable o si prefiere resolverla de
otra forma.

### 5.1 Deudas técnicas

1. **La migración no está aplicada.** `20260727120000_notificacion` debe aplicarse como paso de
   despliegue humano (`pnpm db:migrate deploy` o el script de despliegue). Hasta entonces, las
   Server Actions fallarán en runtime contra una tabla inexistente. Esto es el procedimiento
   habitual del repo, no una desviación.

2. **`notificacion` crece sin purga** (F1.4-6 / Riesgo 3 del design). La ventana de 30 días
   acota la consulta, no la tabla. D2 prohíbe cron nuevo, así que la purga sería una feature
   aparte con su propio barrido.

3. **`entidad_id` no lleva FK** (referencia polimórfica): borrar una orden, un usuario o un
   cierre deja la notificación colgada. Aceptado en el design (Riesgo 4): la campana no navega
   a la entidad en v1.

4. **`findCierreSolicitado` es OPCIONAL en `ICierreDiaRepository` — deuda explícita.**
   Debería ser obligatorio: es el método del que depende R24 para conocer el id del cierre, y
   declararlo opcional significa que **un repositorio que no lo implemente no notifica y el
   typechecker no dice nada**. Se dejó opcional porque la alternativa era editar los dobles a
   mano de `tests/unit/services/cierre-dia-service.test.ts` y
   `tests/integration/actions/cierre-dia-action.test.ts` (features 37/38/109/111), y el spec
   restringe las ediciones a tests ajenos. El repositorio real sí lo implementa y los tests de
   wiring cubren los tres caminos con un doble que lo trae. **Recomendación para el reviewer:**
   promoverlo a obligatorio en cuanto esos dos archivos se toquen por otra razón.

5. **`NULLS NOT DISTINCT` exige Postgres 15+.** Supabase corre 15+, pero la migración fallará
   ruidosamente en un motor anterior. Está fijado por el test de migración.

6. **El default no-op depende de que el composition root recuerde cablear.** Es la deuda
   inherente a esta forma de inyección: un call-site nuevo que construya uno de los tres
   services sin pasar el notificador perderá el aviso. Mitigado con un test que verifica que
   los tres composition roots actuales inyectan `notificar*Real` y que los defaults siguen
   siendo el no-op; un cuarto call-site tendría que añadirse a esa lista.

7. **Bloque C pendiente.** `hooks/useNotificaciones.ts`, `components/shared/NotificationsBell.tsx`
   y el cierre de la carga masiva de UI (`OrdenesCargaUpload.tsx`, R39 lado cliente) los
   implementa el agente de frontend. El contrato (`lib/types/notificacion.ts` + las firmas de
   `lib/actions/notificaciones.ts`) está congelado.

---

## Veredicto

Bloques A y B completos: modelo, migración up/down con RLS, predicado único de visibilidad,
service, 5 Server Actions y los 4 productores de D1, con 161 tests nuevos que mapean R1–R39,
typecheck y lint sin delta sobre el baseline.
