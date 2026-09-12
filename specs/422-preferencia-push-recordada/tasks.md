# Ficha 422 — Tareas

Zona `fullstack`: se secuencia **backend → frontend**. `[P]` = puede ir en paralelo con las de su
misma tanda. Cada task trae su criterio de *hecho*; sin él no está hecha.

> **El gate de esta ficha es `./init.sh` completo.** El diff toca `db/schema.prisma` y
> `db/migrations/**`, así que `--rapido` se niega solo (`docs/verification.md`). No se pierda tiempo
> intentándolo.

---

## Tanda 1 — El lugar de la preferencia (backend, datos)

- [x] **T1.1 — Modelo en `db/schema.prisma`.** Añadir `UsuarioPreferencia` (design §2.1) y la
  relación `preferencia` en `Usuario`, con el comentario `///` que diga **por qué es tabla y no
  columna**.
  *Hecho:* `pnpm run typecheck` en verde tras `prisma generate`, y `prisma migrate diff` no reporta
  más deriva que la migración de T1.2.

- [x] **T1.2 — Migración + `down.sql`.** `db/migrations/20260915120000_usuario_preferencia/`:
  `CREATE TABLE`, índice único de `usuario_id`, FK CASCADE, **backfill** (design §2.2) y
  `ENABLE ROW LEVEL SECURITY`. `down.sql` = `DROP TABLE IF EXISTS`. Depende de T1.1.
  *Hecho:* `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte; volver a aplicar deja la
  base igual. En el `down.sql`, escrito en voz alta qué se pierde. **No se toca ningún `down.sql`
  anterior** (son fotos de su rama) y **no hay enum**, así que la lección del enum recreado con lista
  no aplica — dejarlo dicho en el propio archivo.

- [x] **T1.3 — Test de integración de la migración.** `tests/integration/db/usuario-preferencia-migration.test.ts`,
  molde de `push-migration.test.ts`: las dos mitades (lo que se lee del `.sql` y lo que **solo** sabe
  el motor). Cubre R1, R2, R4, R5 y la RLS. Depende de T1.2.
  *Hecho:* con `DATABASE_URL`, los casos **se ejecutan** (no `skipped`): la tabla existe con su forma,
  el único índice está, `relrowsecurity` es `true`, borrar un usuario borra su preferencia, y el
  backfill deja `true` **solo** a quien tenía suscripción. El archivo empieza por su autocomprobación
  (si el `.sql` no se leyera, toda la guardia quedaría verde y muda).

- [x] **T1.4 [P] — Repositorio.** `lib/interfaces/repositories/IUsuarioPreferenciaRepository.ts` +
  `lib/repositories/UsuarioPreferenciaRepository.ts` (design §6.2). `fijarAvisosPush` es un **upsert**
  por `usuario_id`; `avisosPushDe` no crea nada.
  *Hecho:* `tests/integration/db/usuario-preferencia.test.ts` contra Postgres real —el `WHERE` se
  prueba donde vive— demuestra: sin fila → `false`; dos `fijarAvisosPush` seguidos → **una** fila; dos
  concurrentes (`Promise.all`) → una fila y ningún error propagado.

---

## Tanda 2 — La intención en el servidor (backend). Depende de T1.4

- [x] **T2.1 — `registrarSuscripcionPush` deja la preferencia puesta (R3).** En `lib/actions/push.ts`,
  con el repositorio nuevo inyectable por `deps` (patrón de hoy).
  *Hecho:* `tests/unit/actions/push-action.test.ts` afirma que un registro correcto llama a
  `fijarAvisosPush(actor.usuarioId, true)`; y que **sin sesión** no se escribe ni la suscripción ni la
  preferencia (R24).

- [x] **T2.2 — `olvidarPreferenciaDeAvisos()` (R7).** Server Action sin cuerpo; actor de la sesión;
  `withErrorHandler` + `toActionError`, igual que sus tres hermanas.
  *Hecho:* test de la acción: con sesión → `fijarAvisosPush(id, false)` y `{status:"ok"}`; sin sesión
  → error de autenticación y **cero** escrituras.

---

## Tanda 3 — La costura (⚠️ el nudo). Depende de T2.2

- [x] **T3.1 — `lib/pwa/baja-push.ts` pide el motivo.** `MotivoDeLaBaja`, `ResultadoBajaPush`
  ampliado, `switch` exhaustivo con `never`, la intención **antes** del corte por «sin suscripción»
  (design §3.1). El trabajo del dispositivo **no se toca**: mismas dos mitades, mismo orden, mismo
  «no lanza nunca».
  *Hecho:* `tests/unit/pwa/baja-push.test.ts` ampliado y en verde, cubriendo R7, R8, R9, R11 y R12; el
  caso de R9 afirma que **los dos motivos producen exactamente las mismas llamadas al dispositivo**.

- [x] **T3.2 — Las dos superficies declaran su motivo.** `hooks/usePushSuscripcion.ts:207` →
  `"la-persona-apago-el-interruptor"`; `app/_components/LogoutButton.tsx:41` → `"cierre-de-sesion"`.
  En `LogoutButton` se **conserva** el comentario que explica por qué se da de baja al salir y se le
  añade una línea: por qué ese motivo **no** borra la preferencia. Depende de T3.1.
  *Hecho:* `tests/components/LogoutButton.push.test.tsx` afirma el argumento literal y que la sesión
  se cierra igual; `tests/unit/hooks/usePushSuscripcion.test.tsx` afirma el suyo.

- [x] **T3.3 — Guardia G1, `tests/unit/guards/push-intencion-de-baja.guardia.test.ts`** (design §9).
  Censo con lista blanca de **dos** entradas, cada una con su cuenta, su motivo y su porqué escrito;
  autocomprobaciones incluidas (el detector cuenta, no dice sí/no; no se dispara con un comentario; un
  intruso inyectado **en el recorrido** se caza). Depende de T3.2.
  *Hecho:* la guardia pasa sobre el árbol real y sus autocomprobaciones pasan; añadir una tercera
  llamada sin declararla en la lista la pone roja (se prueba inyectándola en el mapa de fuentes, no en
  el árbol).

---

## Tanda 4 — El alta en un solo sitio (backend/cliente). Depende de T3.1

- [x] **T4.1 — `lib/pwa/alta-push.ts`.** Extraer de `activar()` el trabajo de suscribir + registrar
  (design §4). **Comprueba el permiso; no lo pide.**
  *Hecho:* `tests/unit/pwa/alta-push.test.ts`: con permiso `granted` suscribe y registra; con
  `default` y con `denied` devuelve `sin-permiso` **sin llamar a `subscribe`**; un registro fallido
  deshace la suscripción; `requestPermission` no se llama en ningún caso.

- [x] **T4.2 — `activar()` usa `alta-push`.** El hook se queda con el permiso y el estado.
  *Hecho:* los tests de `usePushSuscripcion` de la 410 (R10–R15) siguen **verdes sin tocarlos**, salvo
  el del motivo (T3.2).

- [x] **T4.3 [P] — Guardia G2, `tests/unit/guards/push-alta-punto-unico.guardia.test.ts`**:
  `Notification.requestPermission(` **una** vez en todo el árbol; `pushManager.subscribe(` **una** vez
  y dentro de `lib/pwa/alta-push.ts`; `<PushReactivacion` **una** vez y en `app/(app)/layout.tsx`
  (R24); y la preferencia (`avisosPush` / `usuario_preferencia`) **cero** veces en el camino del
  envío (`lib/push/**`, `lib/services/PushWeb*`, `lib/notificaciones/**`) → R6.
  *Hecho:* pasa con autocomprobación (lee fuentes con contenido y distingue comentario de código).

---

## Tanda 5 — La reactivación (frontend). Depende de T4.1 y T2.1

- [ ] **T5.1 — `components/shared/PushReactivacion.tsx`.** Cliente, devuelve `null`, prop
  `avisosRecordados: boolean`, `useRef` de un solo intento, orden de comprobaciones de design §5.
  *Hecho:* `tests/components/PushReactivacion.test.tsx` con el fixture `tests/fixtures/navegador-push.ts`
  cubre R14, R15, R16, R17, R18, R19, R20, R21, R23. Cada caso negativo lleva **su control positivo al
  lado** (el mismo escenario, cambiando una sola condición, tiene que dar lo contrario): sin eso, un
  escenario vacío pasa en verde sin haber comprobado nada.

- [ ] **T5.2 — Cableado en `app/(app)/layout.tsx`.** Leer la preferencia del actor con el repositorio
  y montar el componente; sin actor, no se monta. Depende de T5.1 y T1.4.
  *Hecho:* alguien **pasa** el dato (no basta con importar el componente): la guardia G2 lo afirma, y
  el test del layout comprueba que con actor sin preferencia baja `false`. Es la lección de los dos
  notificadores muertos: comprobar que se inyecta, no que se importa.

- [ ] **T5.3 [P] — El texto del control (R25, R26).** Una frase en `TEXTOS.ayuda` de
  `components/shared/PushOptIn.tsx` (design §8), pendiente del visto bueno de P3.
  *Hecho:* `tests/components/PushOptIn.test.tsx` afirma el **literal** visible —es el contrato con la
  persona, no un reflejo de su propia fuente— y que no contiene «suscripción», «endpoint» ni «token».

---

## Tanda 6 — Cierre

- [ ] **T6.1 — Carrera de dos pestañas contra la base (R22).** En
  `tests/integration/db/usuario-preferencia.test.ts` o su hermano de push: dos registros concurrentes
  del **mismo** `endpoint` → una fila, y la exclusión la da el índice único (si se quita el `UNIQUE`
  del esquema de prueba, salen dos).
  *Hecho:* el caso **se ejecuta** (no `skipped`) y no tiene ningún `if (!datos) return;` que lo deje
  verde sin comprobar nada.

- [ ] **T6.2 — Medición del backfill contra producción, ANTES de desplegar** (design §2.4).
  *Hecho:* el número de personas con suscripción escrito en `progress/impl_422.md` **antes** de
  aplicar, y las tres cifras de después (`filas = puestas = intactas`) escritas a continuación.

- [ ] **T6.3 — Mapa `R<n> → test` y mutaciones** en `progress/impl_422.md`, con la salida real de los
  tests pegada. Depende de todo lo anterior.
  *Hecho:* los 26 requisitos mapeados, y la tabla de mutaciones de abajo **ejecutada de verdad**, con
  el nombre del test que se puso rojo y su salida. Una tabla de mutaciones sin salida pegada no se
  acepta: este arnés ya reportó «9/9 supervivientes» dos veces sin haber ejecutado un test.

---

## El rojo que hay que entregar

Cada mutación se aplica **sola**, se corre el gate, se anota qué se puso rojo y se revierte. Si alguna
**no** pone nada en rojo, el test que debía cazarla está mal y se arregla antes de cerrar la ficha.

| # | Mutación | Qué DEBE ponerse rojo |
| --- | --- | --- |
| **M1** | En `LogoutButton.tsx`, cambiar el motivo a `"la-persona-apago-el-interruptor"` | `baja-push.test.ts › cerrar sesión CONSERVA la preferencia` (R8) **y** `LogoutButton.push.test.tsx › sale declarando que solo se va` (R13). **Esta es la que la ficha exige: quitar la distinción entre «salir» y «apagar» rompe un test por sí sola.** |
| **M1b** | Quitar el parámetro `motivo` y volver a una sola función sin intención | `pnpm run typecheck` (dos sitios de llamada) **y** G1. El compilador es la primera línea; la guardia, la segunda. |
| **M1c** | Añadir un tercer motivo a la unión sin tratarlo en el `switch` | `pnpm run typecheck` (el `never` del `default`) |
| **M2** | En `lib/pwa/alta-push.ts`, quitar la comprobación `Notification.permission !== "granted"` | `alta-push.test.ts › con el permiso en «default» NO se suscribe` y `PushReactivacion.test.tsx › la preferencia puesta no se salta el permiso` (R17). **La segunda que la ficha exige: la preferencia puesta no puede saltarse la comprobación del permiso.** |
| **M3** | Que la reactivación llame a `Notification.requestPermission()` cuando el permiso está en «default» | `PushReactivacion.test.tsx › no pide nada, nunca` (R16) **y** G2 (`requestPermission` deja de aparecer una sola vez) |
| **M4** | En `baja-push.ts`, mover el tratamiento del motivo **después** del corte por «sin suscripción» | `baja-push.test.ts › apagar sin suscripción viva borra la preferencia igual` (R11) |
| **M5** | Borrar el `INSERT ... SELECT` del backfill de `migration.sql` | `usuario-preferencia-migration.test.ts › quien ya tenía suscripción queda con la preferencia puesta` (R5) |
| **M6** | Que el camino del envío filtre por `avisosPush` además de por las filas de suscripción | G2 (censo del camino del envío) y los tests de destinatarios de la 410 (R6) |
| **M7** | Que `PushReactivacion` pinte un toast al reactivar | `PushReactivacion.test.tsx › la reactivación es silenciosa` (R19) |
| **M8** | Que `registrarSuscripcionPush` no ponga la preferencia | `push-action.test.ts › registrar deja la preferencia puesta` (R3) |
| **M9** | Quitar el `useRef` de un solo intento | `PushReactivacion.test.tsx › se intenta como mucho una vez` (R23) |
| **M10** | Cambiar el `UNIQUE` de `usuario_id` por un índice normal | `usuario-preferencia.test.ts › dos escrituras concurrentes dejan una fila` (R22 en la preferencia) |

---

## Trazabilidad `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `usuario-preferencia-migration.test.ts` › la tabla existe, cuelga del usuario y no depende de ningún dispositivo · `baja-push.test.ts` › cerrar sesión conserva la preferencia |
| R2 | `usuario-preferencia.test.ts` › sin fila, la preferencia es «no puesta» |
| R3 | `push-action.test.ts` › registrar una suscripción deja la preferencia puesta |
| R4 | `usuario-preferencia-migration.test.ts` › borrar el usuario borra su preferencia (CASCADE) |
| R5 | `usuario-preferencia-migration.test.ts` › el backfill pone `true` solo a quien tenía suscripción |
| R6 | `push-alta-punto-unico.guardia.test.ts` › la preferencia no aparece en el camino del envío · tests de destinatarios de la 410 |
| R7 | `baja-push.test.ts` › apagar el interruptor borra la preferencia |
| R8 | `baja-push.test.ts` › cerrar sesión NO borra la preferencia |
| R9 | `baja-push.test.ts` › los dos motivos hacen exactamente el mismo trabajo con el dispositivo |
| R10 | `push-intencion-de-baja.guardia.test.ts` (censo + intruso inyectado) · `pnpm run typecheck` (M1b) |
| R11 | `baja-push.test.ts` › apagar sin suscripción viva borra la preferencia igual |
| R12 | `baja-push.test.ts` › si olvidar la preferencia falla, la baja y el cierre siguen y no se lanza |
| R13 | `LogoutButton.push.test.tsx` › al salir, este dispositivo queda sin suscripción en los dos sitios · `baja-push.test.ts` › solo toca este dispositivo |
| R14 | `PushReactivacion.test.tsx` › al montar evalúa sin pedir nada |
| R15 | `PushReactivacion.test.tsx` › preferencia + permiso concedido + sin suscripción → suscribe y registra |
| R16 | `PushReactivacion.test.tsx` › `requestPermission` no se llama nunca · `push-alta-punto-unico.guardia.test.ts` |
| R17 | `PushReactivacion.test.tsx` › con el permiso en «default»/«denied» no hace nada · `alta-push.test.ts` |
| R18 | `PushReactivacion.test.tsx` › sin preferencia no se suscribe nada (con su control positivo) |
| R19 | `PushReactivacion.test.tsx` › no pinta nada ni avisa de nada |
| R20 | `PushReactivacion.test.tsx` › un fallo deja el estado «sin activar», conserva la preferencia y registra sin el endpoint |
| R21 | `PushReactivacion.test.tsx` › con suscripción viva, reafirma el registro y no crea una segunda |
| R22 | `usuario-preferencia.test.ts` / `push-canal-restricciones.test.ts` › dos registros concurrentes del mismo endpoint dejan una fila |
| R23 | `PushReactivacion.test.tsx` › se intenta como mucho una vez por carga |
| R24 | `push-action.test.ts` › sin sesión no se lee ni se escribe la preferencia · `push-alta-punto-unico.guardia.test.ts` › el componente solo se monta en el layout autenticado |
| R25 | `PushOptIn.test.tsx` › el texto dice qué pasa al cerrar sesión y al volver |
| R26 | `PushOptIn.test.tsx` › el texto no promete avisos sin sesión ni usa jerga |

---

## Riesgos anotados

1. **P1 sin resolver cambia T3.1.** Si el humano decide que apagar en un dispositivo debe retirar
   **todas** las suscripciones de la persona, esto deja de ser una costura de intención y pasa a tocar
   el alcance de 410/R19. Resolverlo antes de empezar la tanda 3.
2. **La base local es compartida entre worktrees.** La migración de esta ficha pone rojo el gate de
   las demás features vivas mientras no la tengan aplicada. Avisar antes de aplicarla.
3. **Sin `DATABASE_URL` las tandas 1 y 6 se saltan enteras** y el gate sale «verde» sin haber tocado
   la capa de datos. Mirar los `skipped`, no solo el `INIT_EXIT`.
