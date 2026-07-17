# Feature 82 — Tasks

Rama `feature/82-api-keys-ui` sobre `feature/81-api-keys` (`1ebc350`). **No mergear a `dev` antes que la 81 (PR #86).**
Sin migraciones: `db/schema.prisma` no se toca.
Convencion de commits (`docs/conventions.md`): un commit por task, `feat(82): …` / `test(82): …`.

> **Bloqueante global:** las tasks marcadas `[GATE]` no arrancan hasta que el humano resuelva las **Decisiones abiertas D1–D9** de `requirements.md`. D1 (que se muestra como usuario dedicado) y D5 (UX del cierre del secreto) condicionan el DTO y el modal respectivamente.

## Fase 0 — Preparacion

- [ ] **T0.1 [GATE]** El leader agrega las entradas 81 y 82 a `feature_list.json` (82: `zone: "fullstack"`, `sdd: true`, `depends_on: 81`, `branch: "feature/82-api-keys-ui"`). [D8]
  **Hecho:** `./init.sh` en verde y la feature 82 aparece en el archivo.
- [x] **T0.2** Verificar baseline en el worktree: `pnpm typecheck` + `pnpm test` sobre `feature/82-api-keys-ui` sin cambios.
  **Hecho:** numeros de fallos anotados en `progress/impl_82.md`. Un test rojo preexistente NO se atribuye a esta feature.

## Fase 1 — Backend del listado (de adentro hacia afuera)

- [x] **T1.1 [P]** `lib/config/api-keys.ts`: molde de `lib/config/usuarios.ts` (defaults 25/100, env `API_KEYS_DEFAULT_PAGE_SIZE` / `API_KEYS_MAX_PAGE_SIZE`). [D3]
  **Hecho:** `apiKeysConfig` exportado y tipado; typecheck verde.
- [x] **T1.2 [P]** `lib/interfaces/repositories/IApiKeyRepository.ts`: agregar `ApiKeyListItem`, `ListApiKeysParams`, `ListApiKeysResult`, y los metodos `list` / `count` a la interfaz.
  **Hecho:** `ApiKeyRepository` falla el typecheck por no implementar `list` (prueba de que la interfaz manda). Dep: —
- [x] **T1.3** `lib/types/api-key.ts`: `listarApiKeysSchema`, `ListarApiKeysInput`, `ApiKeyListItemDTO`, `ListarApiKeysResult`. **Sin `keyHash` en ningun tipo.**
  **Hecho:** typecheck verde. Dep: T1.1, T1.2
- [x] **T1.4** `lib/repositories/ApiKeyRepository.ts`: `LIST_SELECT` (sin `keyHash`, con `usuario: { select: { email: true } }`), `list()` con `orderBy createdAt desc` + `skip`/`take`, `count()`. Aplanar a `usuarioEmail`.
  **Hecho:** typecheck verde; `PUBLIC_SELECT` y `createConUsuario` intactos. Dep: T1.2
- [x] **T1.5** `tests/unit/repositories/ApiKeyRepository.list.test.ts` — **R6**: el `select` pasado a `findMany` no contiene `keyHash`; el item devuelto no tiene la clave. **R7**: `orderBy: { createdAt: "desc" }`. Paginacion: `skip`/`take` correctos.
  **Hecho:** tests verdes. Dep: T1.4
- [x] **T1.6** `lib/interfaces/services/IApiKeyService.ts`: agregar `listar(input, actor)` con doc del contrato (solo `maestro`; nunca devuelve el secreto).
  **Hecho:** typecheck verde. Dep: T1.3
- [x] **T1.7** `lib/services/ApiKeyService.ts`: implementar `listar` reusando el `ALLOWED_ROLES` existente (linea 14). Sin Prisma, sin HTTP.
  **Hecho:** typecheck verde. Dep: T1.6, T1.4
- [x] **T1.8** `tests/unit/services/ApiKeyService.listar.test.ts` con `IApiKeyRepository` mock — **R2** (rol no maestro → `forbidden` y el repo NO se llama), **R4** (shape ok), **R5** (claves exactas del item), **R6** (`Object.keys` sin `keyHash`/`plainKey`), **R7**, **R9** (page fuera de rango → `items: []`, `total` real), **R10** (pasa sin DB).
  **Hecho:** un test por requisito, nombrado por comportamiento. Dep: T1.7
- [x] **T1.9** `lib/actions/api-keys.ts`: `listarApiKeys` (reusa `buildApiKeyService`, `ApiKeyActionDeps`, `toApiKeyActionError`, `withErrorHandler`). `generarApiKey` NO se modifica.
  **Hecho:** typecheck verde; diff de la action existente = 0 lineas. Dep: T1.7, T1.3
- [x] **T1.10** `tests/unit/actions/api-keys-listar.test.ts` — **R1** (sin sesion → `unauthenticated`, service NO invocado), **R2** (propaga `forbidden`), **R3** (`page: 0` → `validation_error`, service NO invocado), **R8** (`pageSize: 9999` → clamp a `MAX_PAGE_SIZE` reflejado en la salida).
  **Hecho:** tests verdes vía `deps` inyectadas. Dep: T1.9

## Fase 2 — UI

- [x] **T2.1 [P] [GATE:D1]** `app/(app)/configuracion/api/_components/api-keys-columns.tsx`: columnas identificador · prefijo (`font-mono`, con elipsis) · usuario dedicado · fecha. Sin columna de acciones.
  **Hecho:** typecheck verde; el modulo no importa nada del secreto. Dep: T1.3
- [x] **T2.2 [P]** `.../GenerarApiKeyForm.tsx`: molde `UsuarioForm` (`ref` + `FormHandle`), campo unico `identificador`, pinta `fieldErrors` del backend.
  **Hecho:** typecheck verde. Dep: —
- [x] **T2.3 [GATE:D5]** `.../RevelarApiKeyModal.tsx`: secreto seleccionable + aviso `role="alert"` + boton Copiar (con fallback de toast) + checkbox "Ya guarde la clave…" que habilita Cerrar + Escape/click-fuera bloqueados.
  **Hecho:** typecheck verde; no existe ninguna prop ni rama que reabra el secreto. Dep: —
- [x] **T2.4** `.../ApiKeysModule.tsx`: SWR con `fallbackData`, `DataTable`, `Pagination` (page-size options acotadas por `MAX_PAGE_SIZE`), boton "Generar API key", modal de creacion → modal de revelado, `useToast`, `mutate()` al recibir `ok`, guardia anti doble-submit.
  **Hecho:** typecheck verde. Dep: T2.1, T2.2, T2.3, T1.9
- [x] **T2.5 [GATE:D7]** `app/(app)/configuracion/api/page.tsx`: conservar el guard `maestro` existente, alinear a `PageHeader` + `Container`, pre-cargar pagina 1 y pasar `initialData`; fallback a listado vacio si no es `ok`.
  **Hecho:** typecheck verde; `/configuracion/api` renderiza la tabla. Dep: T2.4, T1.9

## Fase 3 — Tests de UI

- [x] **T3.1** `tests/components/ConfiguracionApiPage.test.tsx` — **R11** (rol no maestro y sesion ausente → alert, modulo NO renderizado), **R12** (maestro → llama a `listarApiKeys` y pasa los datos), **R13** (respuesta no-ok → modulo con listado vacio, sin excepcion).
  **Hecho:** 4 tests verdes. Dep: T2.5
- [x] **T3.2** `tests/components/ApiKeysModule.test.tsx` — listado: **R14** (columnas), **R15** (prefijo con elipsis; asercion negativa: el DOM no contiene la key completa), **R16** (vacio), **R17** (error), **R18** (cambio de pagina → refetch), **R19** (cambio de pageSize → vuelve a pagina 1).
  **Hecho:** un test por requisito. Dep: T2.4
- [x] **T3.3** `tests/components/ApiKeysModule.test.tsx` — generacion: **R20** (abre modal con un campo), **R21** (`validation_error` → error de campo, modal abierto), **R22** (`conflict`), **R23** (`forbidden`/`unauthenticated`), **R24** (`ok` → key visible + aviso), **R25/R26** (copiar → toast de exito; clipboard ausente → toast de error y key aun visible), **R27** (Cerrar deshabilitado sin checkbox; Escape no cierra), **R28** (tras cerrar, la key no esta en el DOM y no hay accion para reabrirla), **R29** (`mutate` invocado al recibir `ok`), **R31** (doble submit → una sola llamada a `generarApiKey`).
  **Hecho:** un test por requisito. Dep: T2.4
- [x] **T3.4** **R30**: test que espia `console.log`/`console.info`/`console.debug` y `localStorage.setItem`/`sessionStorage.setItem` durante el flujo completo de generacion y afirma que el `plainKey` no aparece en ningun argumento.
  **Hecho:** test verde. Dep: T2.4

## Fase 4 — Cierre

- [ ] **T4.1** `progress/impl_82.md` con la tabla de trazabilidad **R1–R31 → test concreto** (archivo + nombre del test). Un R sin test = feature fallida (`docs/specs.md` §Trazabilidad).
  **Hecho:** las 31 filas completas. Dep: Fase 3
- [ ] **T4.2** `./init.sh` + `pnpm typecheck` + `pnpm test` en verde (o con delta 0 respecto al baseline de T0.2).
  **Hecho:** salida pegada en `progress/impl_82.md`. Dep: T4.1
- [ ] **T4.3** Verificacion manual (`docs/verification.md`): login como maestro → `/configuracion/api` → generar key → copiar → cerrar → confirmar que la fila aparece con el prefijo y que la key completa ya no es recuperable en ninguna parte de la UI.
  **Hecho:** evidencia anotada. Dep: T4.2
- [ ] **T4.4** Anotar en `feature_list.json` las features hermanas sugeridas: **82a — revocacion de API keys** (requiere columna + migracion) y confirmar que **81a — consumo de la key** ya figura.
  **Hecho:** entradas creadas en `pending`. Dep: T4.2

## Grafo de dependencias (resumen)

```
T0.1 ─┐
T0.2 ─┤
      ├─ T1.1 [P] ─┐
      └─ T1.2 [P] ─┼─ T1.3 ─┬─ T1.6 ─ T1.7 ─┬─ T1.8
                   │        │               └─ T1.9 ─ T1.10
                   └─ T1.4 ─┴─ T1.5
                            │
      T2.2 [P] ┐            └──────────────┐
      T2.3 [P] ┼─ T2.4 ─ T2.5 ─ T3.1       │
      T2.1 [P] ┘   └─ T3.2, T3.3, T3.4     │
                        └─ T4.1 ─ T4.2 ─┬─ T4.3
                                        └─ T4.4
```
