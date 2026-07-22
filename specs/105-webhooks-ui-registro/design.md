# Feature 105 — Design: Webhooks UI de registro (Configuración > API)

> Frontend puro. Consume el contrato de la 104 sin reimplementarlo. Rama base de
> implementación: `feature/99-webhooks-cambios-estado` (el backend NO está en `dev`).
> Sigue `docs/architecture.md` (Server Actions para mutaciones internas; componentes
> `private/` reciben datos por props; nada de `fetch` a rutas API internas) y
> `docs/conventions.md` (kebab-case archivos, PascalCase componentes, LF).

## 1. Contrato backend consumido (NO se modifica en esta feature)

De `lib/actions/webhooks.ts` (feature 104, rama `feature/99-webhooks-cambios-estado`, que
ahora incluye las acciones de rotación y lectura acordadas en el gate):

- `registrarWebhook(input: { ownerUsuarioId: string; url: string })` — ALTA o edición de
  URL (upsert por owner). El `ok` distingue ALTA de edición:
  - `{ status: "ok"; resultado: "creada"; secret: string }` — ALTA: secreto EN CLARO, UNA
    sola vez (dispara el modal de revelado, R7).
  - `{ status: "ok"; resultado: "actualizada" }` — solo se editó la URL: **sin secreto**
    (editar NO rota, R7b).
  - `{ status: "validation_error"; fieldErrors: { url?: string[]; ownerUsuarioId?: string[] } }`
  - `{ status: "owner_invalido" }` — el owner no es rol `apiKey`.
  - `{ status: "config_error" }` — falta la clave de cifrado del webhook en el servidor.
  - `{ status: "forbidden" }` | `{ status: "unauthenticated" }`
- `rotarSecretoWebhook(input: { ownerUsuarioId: string })` — rotación EXPLÍCITA (R19–R21):
  - `{ status: "ok"; secret: string }` — secreto NUEVO EN CLARO, UNA sola vez (invalida el
    anterior; dispara el modal de revelado, R21).
  - `validation_error` | `owner_invalido` | `config_error` | `forbidden` | `unauthenticated`
- `desactivarWebhook(input: { ownerUsuarioId: string })` →
  - `{ status: "ok" }` | `validation_error` | `forbidden` | `unauthenticated`
- `obtenerWebhook(input: { ownerUsuarioId: string })` — Server Action de lectura (NUNCA el
  secreto), usada por la UI en TODAS las páginas (D2):
  - `{ status: "ok"; webhook: { url: string; activa: boolean } | null }`
  - `forbidden` | `unauthenticated`
  - (Envuelve `IWebhookSuscripcionService.obtener`, que sigue existiendo server-side.)
- Schemas `registrarWebhookSchema` / `desactivarWebhookSchema` y tipos en
  `lib/types/webhook.ts` (misma rama). La validación de cliente (R6) reusa
  `registrarWebhookSchema` — no se duplican reglas (P5).

> El implementer debe confirmar los nombres exactos del union (`resultado`, `secret`,
> `webhook`) con `git show` en la rama base antes de cablear; si difieren, ajusta el mapeo,
> no los requisitos.

## 2. Modelo de datos, RLS, migraciones

Ninguno. Feature frontend: no hay tablas, RLS ni migraciones. Todo el estado persistente
lo maneja la 104. Esta feature solo compone UI sobre Server Actions y un service de lectura
ya existentes.

## 3. Rutas / endpoints

- No hay rutas nuevas. La UI vive en la ruta ya existente `app/(app)/configuracion/api`
  (Server Component `page.tsx` de la feature 82).
- Mutaciones vía Server Actions existentes (`registrarWebhook`, `desactivarWebhook`). Se
  respeta `docs/architecture.md`: NO se crean route handlers ni se hace `fetch` interno.

## 4. Componentes (todo bajo `app/(app)/configuracion/api/_components/`)

Se calca el patrón de la feature 82 (colocación junto a la página, sin promover a
`shared/` porque se usa en un solo lugar — `docs/architecture.md` "sin sobre-ingeniería").

1. **`WebhookAccionCell.tsx`** (client) — celda de la columna "Webhook" por fila
   (ver §D1). Renderiza el estado (activa / sin registrar) y un botón que abre el modal de
   gestión. Es dueño del ciclo de vida de los modales de esa fila. Recibe por props el
   `ownerUsuarioId` y el `identificador` (contexto humano). Al abrir el modal (y tras cada
   mutación, R18) lee el estado con la Server Action `obtenerWebhook` (D2), de modo que el
   estado es correcto también en páginas paginadas por el cliente. Orquesta: registrar/editar
   (dispara revelado solo si `resultado: "creada"`, R7/R7b), **"Rotar secreto"** con
   confirmación (R19–R21) y dar de baja con confirmación (R13).
2. **`RegistrarWebhookForm.tsx`** (client) — formulario con un único campo `url`,
   validado en cliente con `registrarWebhookSchema` (R6). Handle imperativo `submit()` que
   el modal anfitrión dispara (mismo molde que `GenerarApiKeyForm`). Pinta `fieldErrors`
   (`url`/`ownerUsuarioId`) bajo el campo (R9) y traduce `owner_invalido` (R10) /
   `config_error` (R11) a mensajes no-campo dentro del formulario.
3. **`RevelarWebhookSecretoModal.tsx`** (client) — espejo directo de `RevelarApiKeyModal`
   (feature 82/D5): muestra el `secret` en `font-mono`, aviso `role="alert"` de "única
   vez", botón Copiar con fallback si `navigator.clipboard` no existe, checkbox obligatorio
   que habilita el ÚNICO botón de cierre, `dismissible={false}` (R8). El secreto vive
   solo en `useState` del anfitrión; al cerrar se hace `setSecreto(null)` (R17). Lo dispara
   el ALTA (`registrarWebhook` → `creada`, R7) y la ROTACIÓN (`rotarSecretoWebhook` → `ok`,
   R21); NUNCA la edición de URL (`actualizada`, R7b).
4. **`api-keys-columns.tsx`** (edición) — se añade la columna "Webhook" que renderiza
   `WebhookAccionCell`. Hoy el archivo declara explícitamente "sin columna de acciones";
   esta feature la introduce. Es zona frontend, edición permitida.

Cambios de integración (frontend):

- **`ApiKeysModule.tsx`** (edición) — añade la columna "Webhook" (`WebhookAccionCell`) a las
  columnas. No necesita cargar el estado del webhook en la fila: cada celda lo lee por sí
  misma con `obtenerWebhook` al abrir el modal y tras mutaciones (§D2). No se toca la
  paginación por SWR de la 82.
- **`page.tsx`** (edición) — solo conserva la puerta `maestro` (feature 82/R11); no requiere
  pre-cargar estado de webhook porque la lectura es on-demand vía `obtenerWebhook` (§D2).

Reutilización directa (sin tocar): `components/shared/Modal`, `DataTable`, `FormField`,
`components/ui/*`, `hooks/useToast`.

## 5. Contratos I/O de la UI

Estado del webhook (frontend, tipo de `lib/types/webhook.ts` de la 104 si lo exporta, o
local a `_components/`):

```
WebhookEstadoDTO = { url: string; activa: boolean } | null   // salida de obtenerWebhook
```

- **Leer estado:** al abrir el modal y tras cada mutación, `WebhookAccionCell` llama
  `obtenerWebhook({ ownerUsuarioId })` → pinta URL + activa (R3) o "sin webhook" (R4). Nunca
  hay secreto en la lectura (R5).
- **Registrar/editar:** `RegistrarWebhookForm.submit()` → valida cliente (R6) →
  `registrarWebhook`. Si `ok/creada` → abre `RevelarWebhookSecretoModal` con `secret` (R7);
  si `ok/actualizada` → sin secreto, confirma y refresca (R7b); errores por campo/no-campo
  (R9/R10/R11). Refresca estado en `ok` (R18).
- **Rotar secreto:** "Rotar secreto" (visible solo con suscripción activa, R19) → confirmación
  que advierte invalidación (R20) → `rotarSecretoWebhook` → en `ok` abre
  `RevelarWebhookSecretoModal` con el secreto NUEVO (R21).
- **Desactivar:** confirmación (R13) → `desactivarWebhook` → en `ok` refresca (R14).

Anti-doble-submit (R16) vía fase `pending` del `Modal`/handle, igual que feature 82/R31.

## 6. Decisiones del gate F1.4 (FIJAS) y alternativas descartadas

### D1 — Ubicación en la UI: acción "Webhook" por fila (APROBADA)

**Decisión:** una columna/acción "Webhook" por fila en la tabla de API keys existente
(`api-keys-columns`), que abre un modal de gestión.

**Por qué:** una suscripción webhook pertenece 1:1 a un owner (API key). La fila del owner
es el contexto natural: el maestro ve la key y su estado de webhook de un vistazo, y opera
sobre esa misma fila. Reusa `DataTable` y la paginación ya montadas.

**Alternativa descartada — sección/tab aparte "Webhooks":** obligaría a re-listar y
re-paginar los owners en un segundo lugar (o a un selector de owner), duplicando el listado
que ya existe en la tabla de keys y desacoplando el estado del webhook de su dueño. Más
superficie de UI y de estado por mantener, sin beneficio: la operación es intrínsecamente
por-owner. Descartada por duplicación y peor contexto.

### D2 — Lectura del estado por owner: Server Action `obtenerWebhook` (APROBADA)

**Problema (resuelto):** `IWebhookSuscripcionService.obtener` es server-only, y la tabla se
pagina en el **cliente** vía `listarApiKeys`, que NO incluye el estado del webhook. Sin un
camino de lectura invocable desde el cliente, las páginas > 1 quedarían sin estado.

**Decisión:** el backend de la 104 expone la Server Action de lectura
`obtenerWebhook({ ownerUsuarioId }) → { status: "ok"; webhook: { url, activa } | null }`
(envoltorio fino de `obtener`, NUNCA el secreto). `WebhookAccionCell` la invoca **al abrir
el modal de la fila y tras cada mutación** (R18). Así el estado es correcto en TODAS las
páginas, incluidas las paginadas por el cliente, con como mucho 1 llamada por interacción
real del maestro (no por render de página). Elimina cualquier pre-carga en `page.tsx` y
cualquier enriquecimiento de la fila.

**Alternativa descartada — N lecturas al montar cada página (una por fila visible):** leer
el estado de cada fila al renderizar cada página de la tabla dispara N round-trips por
página y castiga la lista, cuando la inmensa mayoría de filas nunca se abren. Descartada
frente a la lectura on-demand al abrir el modal.

**Alternativa descartada — pre-carga server de la primera página + estado degradado en
páginas > 1:** era el plan de contingencia si el gate rechazaba el añadido backend; el gate
lo aprobó, así que se descarta por dejar estado incompleto en páginas > 1 sin necesidad.

### D3 — Comunicación de `config_error` (APROBADA)

**Recomendación:** mensaje no-campo dentro del formulario de registro, tono neutro-servidor:
> "La configuración de webhooks del servidor está pendiente. Contacta al administrador del
> sistema; no es posible registrar el webhook en este momento."

Sin nombrar la variable de entorno ni exponer trazas (R11, `docs/conventions.md`: no
filtrar secretos ni internals). El modal NO se cierra; el botón de reintento queda
disponible por si la configuración se resuelve. `config_error` se trata como estado de
"servidor no listo", no como error del usuario.

**Alternativa descartada — toast efímero:** un toast desaparece y el maestro no entiende
por qué el registro no completó. Un aviso persistente en el propio modal comunica mejor una
condición de servidor que probablemente requiere acción de un tercero. Descartada.

### D4 — Editar URL no rota; rotación es acción explícita (APROBADA, cambio del gate)

**Decisión:** editar la URL NO rota el secreto — el backend conserva el secreto y solo lo
genera en el ALTA (`registrarWebhook` → `resultado: "creada"` con `secret`; edición →
`resultado: "actualizada"` sin `secret`). La rotación es una acción explícita del maestro:
botón "Rotar secreto" en el modal de gestión, con confirmación que advierte que invalida el
secreto anterior, que llama `rotarSecretoWebhook` y muestra el secreto NUEVO UNA vez
(`RevelarWebhookSecretoModal`). El modal de revelado se dispara SOLO en ALTA (R7) y ROTACIÓN
(R21), nunca al editar URL (R7b).

**Por qué:** rotar en cada edición de URL sorprendería al integrador (rompería su callback
firmado sin quererlo, por un simple cambio de host). Separar "editar URL" de "rotar secreto"
hace explícita y consciente la única operación destructiva de credenciales.

**Alternativa descartada — re-registrar rota siempre el secreto:** era el supuesto inicial
del spec (P4). Rechazado en el gate por acoplar un cambio de configuración inocuo (la URL)
con la invalidación de una credencial en producción. Descartada.

## 7. Seguridad y trazabilidad

- Secreto solo en `useState`; nunca a `console`/URL/`storage`/tabla (R17), verificado con
  el mismo tipo de aserción negativa que feature 82/R30.
- Puerta `maestro` heredada del Server Component (R1); los componentes cliente no re-deciden
  permisos, solo reciben datos por props (`docs/architecture.md`, componentes `private`).
- Cada `R<n>` mapea a un test nombrado en `tasks.md`.
</content>
