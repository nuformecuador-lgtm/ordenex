# Feature 88 — Tasks

Checklist discreto y verificable. `[P]` = paralelizable. Cada task lleva su criterio de
"hecho". Trazabilidad `R<n>` → test en cada task de prueba. **No** empezar código antes
del gate F1.4 (aprobación humana de `requirements.md` + `design.md`).

> Nota de rebase: esta rama está apilada sobre `feature/81-api-keys` (base `1ebc350`),
> NO sobre `dev` (el modelo `ApiKey` de la 81 aún no está en `dev`, PR #86 abierto).
> Antes de mergear a `dev`, la 81 debe estar en `dev`.

## Bloque A — Autenticación por API key (backend, lo nuevo)

- [x] **T1 [P] — Extender `IApiKeyRepository` con `findByKeyHash`.**
  Añadir la firma y el tipo `ApiKeyAutenticada`
  (`{ apiKeyId, usuarioId, estado, rol }`, sin `key_hash` ni secreto).
  *Hecho:* typecheck verde; el tipo no expone ningún campo secreto.
  *(Dep: ninguna)*

- [x] **T2 — Implementar `ApiKeyRepository.findByKeyHash`.**
  `findUnique({ where: { keyHash }, select: {...usuario.estado, usuario.rol.value } })`.
  Ampliar el `Pick<PrismaClient>` del ctor si hace falta (`usuario`, `rol` ya presentes).
  *Hecho:* devuelve `null` si no hay fila; nunca proyecta `keyHash`.
  *(Dep: T1)*

- [x] **T3 — Implementar `ApiKeyAuthService.autenticar(rawKey)`** (o helper de borde),
  inyectando `IApiKeyRepository`.
  Lógica: null/vacío → `unauthenticated`; `hashApiKey(rawKey)` (reuso EXACTO del hasher
  81) → `findByKeyHash` → null → `unauthenticated`; `estado !== "activo"` → `forbidden`;
  ok → `{ actor: { usuarioId, rol } }`. **Cero logging** de key/hash.
  *Hecho:* función pura testeable con repo fake; sin `console.*`.
  *(Dep: T1)*

- [x] **T4 — Tests de `ApiKeyAuthService`** con repo fake.
  Casos: sin key → unauthenticated (R2); hash no encontrado → unauthenticated (R4);
  usuario `pendiente`/`inactivo`/`bloqueado` → forbidden (R5); usuario `activo` → ok con
  actor correcto (R3); verificar que el hash pasado al repo == `hashApiKey(rawKey)` (R3);
  aserción de que no se loguea el secreto (spy sobre console). 
  *Mapea:* R2, R3, R4, R5, R6.
  *(Dep: T3)*

## Bloque B — Persistencia con guía inmediata (repo)

- [x] **T5 — `IOrdenRepository.createManyOrdenesConGuia`** (firma + tipo de retorno con
  `numGuia` por orden).
  *Hecho:* typecheck verde.
  *(Dep: ninguna; [P] con Bloque A)*

- [x] **T6 — Implementar `OrdenRepository.createManyOrdenesConGuia`.**
  En una `$transaction` por chunk: diff before/after + `createMany({ skipDuplicates })`
  (patrón `createManyOrdenes:656-700`) → por cada nueva
  `UPDATE ... num_guia = nextval('orden_num_guia_seq') WHERE id=$1 AND num_guia IS NULL`
  (patrón `generarGuiaLote:894-896`) → `SELECT num_guia` → `appendCambioEstado`
  (origen null → `en_ruta_bodega_principal`, `origenTipo` según §F1.4-7). Devuelve
  `num_guia` por orden creada.
  *Hecho:* la secuencia se referencia por la constante `NUM_GUIA_SEQUENCE`, sin
  interpolar entrada; duplicados no consumen `num_guia`.
  *(Dep: T5)*

- [x] **T7 — Tests de `createManyOrdenesConGuia`** (repo real contra DB de test o el
  harness de repos existente).
  Casos: N órdenes nuevas → N `num_guia` distintos y consecutivos desde la secuencia
  (R9); duplicado por `num_remision` → no crea, no consume guía (R11); estado inicial
  `en_ruta_bodega_principal` (R8); guías no colisionan con `generarGuiaLote` (emitir por
  ambas vías y verificar unicidad). 
  *Mapea:* R8, R9, R11.
  *(Dep: T6)*

## Bloque C — Entrypoint del servicio

- [x] **T8 — `BulkOrdenService.cargarViaApi(rows, actor)`** + firma en `IBulkOrdenService`.
  Guarda `rol !== "apiKey"` → forbidden; `tiendaId = actor.usuarioId`; estado fijo
  `en_ruta_bodega_principal` (resuelto por `findEstatusIdByValue`, guarda de seed nulo);
  reuso de `precargar`/`resolveFila`/`buildSummary`; persistencia vía
  `createManyOrdenesConGuia`; devuelve summary + `num_guia` por orden.
  *Hecho:* `cargarMasiva` queda intacto (mismo diff = 0 en su cuerpo).
  *(Dep: T5; idealmente T6)*

- [x] **T9 — Tests de `cargarViaApi`** con repo fake.
  Casos: actor rol distinto de `apiKey` → forbidden (R15); estado inicial de cada creada
  == `en_ruta_bodega_principal` (R8); fila sin `monto_cobrar` válido → error, no crea
  (R13, según §F1.4-3); fila duplicada → duplicada, sin guía (R11); fila con geo inválida
  → error sin abortar el resto (R12); happy path → summary + `num_guia` por creada (R10);
  seed de estado faltante → todas a error (guarda).
  *Mapea:* R7, R8, R10, R11, R12, R13, R15.
  *(Dep: T8)*

## Bloque D — Route Handler

- [x] **T10 — `app/api/ordenes/api-key/carga/route.ts`.**
  Patrón `carga-masiva/chunk/route.ts`: `withErrorHandler`, `CargaApiDeps`
  (`autenticar`, `bulkService`), `cargaApiBodySchema`. Extrae `Authorization: Bearer`;
  ausente → `UnauthenticatedError`. `autenticar` → unauthenticated/forbidden mapeados a
  401/403. Cuerpo inválido → `ValidationError`. Éxito → respuesta §5, status 200.
  *Hecho:* `POST` delega en `handleCargaApi`; nada de la key entra a logs ni al cuerpo de
  error.
  *(Dep: T3, T8)*

- [x] **T11 — Tests del Route Handler** con deps inyectadas (sin DB ni cookies).
  Casos: sin header → 401 (R2); `autenticar` unauthenticated → 401 (R4); forbidden →
  403 (R5); JSON inválido / body inválido → 422 (R7); happy path → 200 con `ordenes`
  llevando `num_guia` (R10); assert de que el header/secreto no aparece en la respuesta
  de error (R6). 
  *Mapea:* R1, R2, R4, R5, R6, R7, R10.
  *(Dep: T10)*

## Bloque E — No-regresión y cierre

- [x] **T12 [P] — Test de no-regresión de la vía sesión.**
  Confirmar que `carga-masiva/chunk` sigue: default de estado sin cambios, sin
  `num_guia` inmediato, autenticada por sesión, `adminTienda`. (Reusar/verificar los
  tests existentes de `carga-masiva`.)
  *Mapea:* R14.
  *(Dep: T8)*

- [x] **T13 — `./init.sh` verde + suite completa.**
  Medir el baseline en este worktree ANTES (la bitácora caduca). Typecheck y tests
  verdes; todos los `R1..R15` mapeados a un test concreto.
  *Hecho:* `./init.sh` en verde; tabla de trazabilidad `R→test` completa en
  `progress/impl_88.md`.
  *(Dep: T4, T7, T9, T11, T12)*

## Mapa de trazabilidad (a completar por el implementer)

| Req | Task de test |
|-----|--------------|
| R1  | T11 |
| R2  | T4, T11 |
| R3  | T4 |
| R4  | T4, T11 |
| R5  | T4, T11 |
| R6  | T4, T11 |
| R7  | T9, T11 |
| R8  | T7, T9 |
| R9  | T7 |
| R10 | T9, T11 |
| R11 | T7, T9 |
| R12 | T9 |
| R13 | T9 |
| R14 | T12 |
| R15 | T9 |
