# Feature 82 — API keys: UI de gestion (Configuracion > API)

> Rama: `feature/82-api-keys-ui`, **apilada sobre `feature/81-api-keys`** (base `1ebc350`).
> El backend de la 81 no esta en `dev` (PR #86 abierto): sobre `dev` esto no compila.

## Contexto verificado contra el codigo (no contra la bitacora)

| Afirmacion | Verificacion |
| --- | --- |
| El submenu ya existe | `lib/auth/menu-visibility.ts:107` → `{ label: "API", href: "/configuracion/api" }`, dentro del item `Configuración` con `roles: ["maestro"]` (linea 103). **Esta feature NO lo toca.** |
| La pagina ya existe y ya autoriza server-side | `app/(app)/configuracion/api/page.tsx:9-31`: Server Component, `resolveActorFromSession()` y `actor?.rol !== "maestro"` → alert. Hoy es un placeholder con solo `PageHeader`. **Esta feature RELLENA esa pagina.** |
| El backend expone SOLO generar | `lib/actions/api-keys.ts:50` (`generarApiKey`) es la unica export. `IApiKeyService` (`lib/interfaces/services/IApiKeyService.ts:17`) declara solo `generar`. `IApiKeyRepository` (`.../IApiKeyRepository.ts:38`) solo `createConUsuario`. **No existe listado → esta feature lo agrega.** |
| El secreto se muestra una sola vez | `ApiKeyService.generar` (`lib/services/ApiKeyService.ts:62`) devuelve `plainKey` solo en el retorno; `PUBLIC_SELECT` (`ApiKeyRepository.ts:22-28`) nunca proyecta `keyHash`. |
| `key_prefix` es publico | `db/schema.prisma:1002` — `ordx_` + chars, en claro (81/D3: primeros 12 chars). |
| Molde de UI a reusar | `app/(app)/configuracion/_components/UsuariosModule.tsx` (DataTable + Pagination + Modal + `useToast` + SWR con `fallbackData` del server) y `usuarios-columns.tsx`. Prefetch server-side en `app/(app)/configuracion/page.tsx:35-47`. |
| `feature_list.json` | **NO contiene la feature 82** (ni la 81): el array termina antes. Dato, no supuesto — ver Decision abierta D8. |

## Alcance

- **DENTRO:** generar (cablear la action existente) + listar (backend nuevo + UI).
- **FUERA:** revocar/expirar (no hay columna en `api_key`; requiere migracion → **feature hermana sugerida: "82a — revocacion de API keys"**) y el consumo de la key en peticiones de terceros (**feature 81a**, ya definida).

---

## Requisitos

### Backend — `listarApiKeys` (action + service + repository + interfaces)

- **R1.** SI la peticion a `listarApiKeys` no tiene sesion valida, ENTONCES el sistema DEBE devolver `{ status: "unauthenticated" }` sin consultar la base de datos.
- **R2.** SI el actor autenticado tiene un rol distinto de `maestro`, ENTONCES el sistema DEBE devolver `{ status: "forbidden" }` sin consultar la base de datos.
- **R3.** CUANDO `listarApiKeys` recibe parametros que no cumplen su schema (`page` no entero positivo, `pageSize` no entero positivo), el sistema DEBE devolver `{ status: "validation_error", fieldErrors }` sin consultar la base de datos.
- **R4.** CUANDO un `maestro` invoca `listarApiKeys` con parametros validos, el sistema DEBE devolver `{ status: "ok", items, page, pageSize, total }`, donde `total` es el numero total de API keys existentes.
- **R5.** El sistema DEBE devolver cada item del listado con exactamente los campos `id`, `identificador`, `keyPrefix`, `usuarioId`, `usuarioEmail`, `createdAt`.
- **R6.** El sistema DEBE excluir `keyHash` y cualquier forma del secreto en claro de todo valor devuelto por `listarApiKeys`, de modo que el objeto serializado hacia el cliente no contenga esas claves. *(Requisito de construccion: se verifica sobre el objeto devuelto, no por inspeccion visual.)*
- **R7.** MIENTRAS no se especifique orden, el sistema DEBE devolver los items ordenados por `createdAt` descendente.
- **R8.** SI `pageSize` excede `MAX_PAGE_SIZE` de la configuracion, ENTONCES el sistema DEBE acotarlo a `MAX_PAGE_SIZE` y reflejar el valor efectivo en el `pageSize` devuelto.
- **R9.** SI `page` apunta mas alla del ultimo registro, ENTONCES el sistema DEBE devolver `items: []` conservando el `total` real.
- **R10.** El sistema DEBE resolver el listado sin logica de negocio en el repositorio ni queries Prisma en el service ni en la action. *(Verificable: el service se testea con un `IApiKeyRepository` mock, sin DB.)*

### Pagina `/configuracion/api`

- **R11.** SI el actor de la sesion no tiene rol `maestro` (incluida la sesion ausente), ENTONCES la pagina DEBE renderizar el mensaje de permiso denegado y NO DEBE renderizar el modulo de API keys.
- **R12.** CUANDO un `maestro` abre `/configuracion/api`, el sistema DEBE pre-cargar en el servidor la primera pagina del listado y pasarla al modulo cliente como datos iniciales.
- **R13.** SI la pre-carga del listado en el servidor no devuelve `status: "ok"`, ENTONCES la pagina DEBE renderizar el modulo con un listado vacio en vez de fallar.

### Listado (UI)

- **R14.** CUANDO el modulo se renderiza con datos, el sistema DEBE mostrar una tabla con las columnas: identificador, prefijo de la key, usuario dedicado y fecha de creacion.
- **R15.** El sistema DEBE mostrar el prefijo de cada key tal cual lo entrega el backend, seguido de un elipsis, y NO DEBE mostrar nunca la key completa ni su hash en el listado.
- **R16.** CUANDO el listado no tiene registros, el sistema DEBE mostrar un mensaje de vacio explicito.
- **R17.** SI la carga del listado en el cliente falla, ENTONCES el sistema DEBE mostrar un mensaje de error en la tabla en vez de una tabla vacia silenciosa.
- **R18.** CUANDO el usuario cambia de pagina o de tamano de pagina, el sistema DEBE recargar el listado con los nuevos parametros y reflejar el resultado en la tabla.
- **R19.** CUANDO el usuario cambia el tamano de pagina, el sistema DEBE volver a la pagina 1.

### Generacion (UI)

- **R20.** CUANDO el `maestro` activa la accion de generar, el sistema DEBE abrir un modal con un unico campo obligatorio: identificador.
- **R21.** SI el identificador enviado es rechazado por el backend con `validation_error`, ENTONCES el sistema DEBE mostrar el mensaje de error asociado al campo identificador y NO DEBE cerrar el modal.
- **R22.** SI la generacion devuelve `conflict`, ENTONCES el sistema DEBE informar que ya existe una key para ese identificador y NO DEBE cerrar el modal.
- **R23.** SI la generacion devuelve `forbidden` o `unauthenticated`, ENTONCES el sistema DEBE mostrar el mensaje correspondiente y NO DEBE cerrar el modal.
- **R24.** CUANDO la generacion devuelve `status: "ok"`, el sistema DEBE mostrar el valor de `plainKey` en pantalla junto con un aviso explicito de que es la unica vez que se mostrara y de que no podra recuperarse despues.
- **R25.** CUANDO se muestra el `plainKey`, el sistema DEBE ofrecer una accion de copiar al portapapeles.
- **R26.** CUANDO el usuario activa la accion de copiar, el sistema DEBE confirmar el resultado (exito o fallo) mediante feedback visible.
- **R27.** MIENTRAS el `plainKey` este visible y el usuario no haya confirmado explicitamente que lo guardo, el sistema DEBE mantener deshabilitada la accion de cerrar la vista del secreto.
- **R28.** CUANDO el usuario confirma que guardo el secreto y cierra la vista, el sistema DEBE eliminar el `plainKey` del estado del cliente y NO DEBE existir ninguna accion en la UI que permita volver a mostrarlo.
- **R29.** CUANDO una generacion termina en `ok`, el sistema DEBE refrescar el listado de modo que la nueva key aparezca con su prefijo.
- **R30.** El sistema NO DEBE escribir el `plainKey` en la consola, en la URL, en `localStorage`/`sessionStorage` ni en ningun almacenamiento persistente del navegador.
- **R31.** MIENTRAS una generacion este en curso, el sistema DEBE impedir un segundo envio del formulario.

---

## Trazabilidad prevista (cada R → test concreto)

| R | Test |
| --- | --- |
| R1–R3, R8 | `tests/unit/actions/api-keys-listar.test.ts` |
| R4, R5, R7, R9, R10 | `tests/unit/services/ApiKeyService.listar.test.ts` (repo mock) |
| R6 | `tests/unit/services/ApiKeyService.listar.test.ts` — asercion sobre `Object.keys` del item: no contiene `keyHash`/`plainKey`, + `tests/unit/repositories/ApiKeyRepository.list.test.ts` sobre el `select` |
| R11–R13 | `tests/components/ConfiguracionApiPage.test.tsx` |
| R14–R19 | `tests/components/ApiKeysModule.test.tsx` |
| R20–R31 | `tests/components/ApiKeysModule.test.tsx` (+ `GenerarApiKeyForm`) |

---

## Decisiones abiertas para el gate F1.4

> ## ✅ GATE F1.4 RESUELTA POR EL HUMANO — 2026-07-17
>
> **APROBADAS D1–D7 y D9 CON LA RECOMENDACION. CERO OVERRIDES.** Ya no son preguntas:
> son las decisiones vigentes. Implementalas tal cual y no las re-abras.
>
> - **D5 (UX central) — APROBADA la recomendacion, elegida EXPLICITAMENTE por el humano
>   sobre las 2 alternativas:** modal de revelado con secreto seleccionable + aviso de
>   advertencia ("Esta es la unica vez que veras esta clave...") + boton Copiar +
>   **checkbox obligatorio "Ya guarde la clave en un lugar seguro" que habilita el UNICO
>   boton de cierre**, con **Escape y click-fuera DESHABILITADOS** mientras el secreto
>   este visible.
> - D1 email sintetico (`apikey+<slug>@apikey.invalid`) via `include`, NO el uuid.
> - D2 listar TODAS las keys (sin scoping por `createdById`).
> - D3 `lib/config/api-keys.ts` con el molde de `usuarios.ts` (25 / 100 + envs).
> - D4 sin `sortBy`/`sortDir` en v1; `createdAt desc` fijo.
> - D6 fallback de portapapeles: si `navigator.clipboard` falla o no existe → toast de
>   error + secreto seleccionable. **Nunca un fallo duro** (el portapapeles es comodidad,
>   no la via de entrega).
> - D7 alinear `/configuracion/api` al patron `PageHeader` + `Container` de
>   `/configuracion/page.tsx`; modulo en `app/(app)/configuracion/api/_components/ApiKeysModule.tsx`.
> - D9 boton "Generar API key" arriba a la derecha (molde `UsuariosModule.tsx:137`).
>
> ### ❌ D8 — FALSA ALARMA, CERRADA POR EL LEADER
> El `spec_author` reporto que "la feature 82 no existe en `feature_list.json`" y **hizo
> bien en verificarlo en vez de creerle al leader** — pero la conclusion no aplica: las
> entradas **81 y 82 SI estan registradas**, en el working tree de la rama **`flow`**, **sin
> commitear**. Este worktree nace de `feature/81-api-keys`, que no las ve. **No hay accion
> pendiente.** Ojo al patron, que se repetira: `feature_list.json` y `progress/` viven sin
> commitear en `flow` mientras las features corren en worktrees aislados → **todo subagente
> vera un `feature_list.json` desactualizado**. No es motivo de hallazgo.

Regla 6: nada de esto esta en `docs/`, `specs/` ni el codigo. **No lo asumo.** Cada una lleva mi recomendacion y su porque; el humano aprueba u ordena lo contrario.

- **D1 — Que se muestra en la columna "usuario dedicado".** `ApiKeyPublico` (`lib/types/api-key.ts:20-27`) solo trae `usuarioId`, que es un uuid inutil para un humano.
  **Recomiendo: el email sintetico** (`apikey+<slug>@apikey.invalid`, 81/D4), via `include` del usuario en el repositorio. Porque identifica la cuenta de forma inequivoca y es exactamente el identificador con el que la key aparecera en 81a y en auditoria; el `nombre` es igual al `identificador` (`ApiKeyRepository.ts:64`), asi que mostrarlo seria una columna duplicada.

- **D2 — Ambito del listado.** No hay scoping por creador en el modelo.
  **Recomiendo: listar TODAS las keys, sin filtrar por `createdById`.** Porque el unico rol con acceso es `maestro` (R2) y ocultarle keys vigentes que su propio rol puede generar convertiria la pantalla en una foto incompleta del sistema — peor para seguridad, no mejor.

- **D3 — `MAX_PAGE_SIZE` / `DEFAULT_PAGE_SIZE`.**
  **Recomiendo: `lib/config/api-keys.ts` con el mismo molde y defaults que `lib/config/usuarios.ts` (25 / 100), env `API_KEYS_DEFAULT_PAGE_SIZE` / `API_KEYS_MAX_PAGE_SIZE`.** Porque es el patron ya establecido en 4 modulos (usuarios, zonas, tarifas, ordenes) y evita hardcode de contexto (`docs/architecture.md`, principio 4).

- **D4 — Orden configurable.**
  **Recomiendo: NO exponer `sortBy`/`sortDir` en v1; fijar `createdAt desc` (R7).** Porque nadie lo pidio y cada campo ordenable exige indice + lista blanca; se agrega cuando haya volumen que lo justifique.

- **D5 — Como se cierra el modal del secreto (decision de UX central).**
  **Recomiendo: modal de revelado con (a) el secreto en texto seleccionable, (b) aviso en tono de advertencia "Esta es la unica vez que veras esta clave. Si la pierdes, tendras que generar otra", (c) boton Copiar, (d) checkbox obligatorio "Ya guarde la clave en un lugar seguro" que habilita el unico boton de cierre, y (e) cierre por Escape/click-fuera DESHABILITADO mientras el secreto este visible.** Porque el coste de perder el secreto es regenerar (barato pero manual) y el coste de un cierre accidental es exactamente ese; el checkbox convierte el descarte en un acto deliberado sin bloquear a quien ya lo copio. **Rechazo explicitamente** "cerrar solo si pulso Copiar": copiar al portapapeles no prueba que lo haya pegado en ningun sitio, y ata la UX a una API que falla en contextos no seguros (ver D6).

- **D6 — Fallback del portapapeles.** `navigator.clipboard` no existe en contextos no seguros (HTTP) ni en algunos navegadores embebidos.
  **Recomiendo: intentar `navigator.clipboard.writeText` y, si falla o no existe, toast de error "No se pudo copiar; selecciona el texto y copialo manualmente", con el secreto ya seleccionable.** Porque el secreto siempre esta visible en pantalla: el portapapeles es una comodidad, no la via de entrega, y no debe ser un punto de fallo duro.

- **D7 — Ubicacion del modulo.** `/configuracion/api` hoy usa `<section className="flex flex-1 flex-col gap-6 p-6">` mientras `/configuracion` usa `PageHeader` + `Container`.
  **Recomiendo: alinear `/configuracion/api` al patron `PageHeader` + `Container` de `/configuracion/page.tsx` y colocar el modulo en `app/(app)/configuracion/api/_components/ApiKeysModule.tsx`** (colocado junto a su pagina: se usa en UN solo lugar → `docs/architecture.md`, "sin sobre-ingenieria"). Porque el humano pidio "config submenu/api" y la consistencia visual entre hermanas de Configuracion es gratis aqui.

- **D8 — La feature 82 no existe en `feature_list.json`** (verificado: el array no llega al id 81 ni 82).
  **Recomiendo: el leader agrega las entradas 81 y 82 (`zone: "fullstack"`, `sdd: true`, 82 con `depends_on: 81`) antes de aprobar el gate.** Porque `./init.sh` valida el invariante "una feature en `in_progress` por zona" leyendo ese archivo: si la feature no figura, el arnes no la esta vigilando.

- **D9 — Etiqueta de la accion de generar.**
  **Recomiendo: boton "Generar API key" arriba a la derecha, igual que "Crear usuario" (`UsuariosModule.tsx:137`).** Porque "generar" es el verbo que ya usa el backend (`generarApiKey`) y evita sugerir que el usuario aporta la clave.
