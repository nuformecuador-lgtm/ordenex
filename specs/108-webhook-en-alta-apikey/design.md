# Feature 108 — Diseño

## Alcance y no-alcance

- **Alcance:** UI de `Configuracion > API`. Tres componentes cliente tocados y un componente nuevo
  de revelado combinado.
- **No-alcance:** cero cambios de backend. No se tocan Server Actions, services, repositorios,
  tablas, RLS ni migraciones. No se crean ni modifican schemas zod: se REUSAN
  `generarApiKeySchema` (`lib/types/api-key.ts`) y `registrarWebhookSchema` + el refuerzo
  `https` de cliente ya presente en `RegistrarWebhookForm` (`lib/types/webhook.ts`).

Verificado en código (worktree `ordenex-wt-108`):
- `generarApiKey(input)` → `{ status:'ok', apiKey: ApiKeyPublico, plainKey }`; `ApiKeyPublico`
  incluye `usuarioId` (`lib/types/api-key.ts:29`). Confirma que el cliente puede encadenar el
  webhook sin re-consultar.
- `registrarWebhook({ ownerUsuarioId, url })` → `creada` (con `secret`) | `actualizada` |
  `unauthenticated` | `forbidden` | `validation_error` | `owner_invalido` | `config_error`.
- El `Modal` compartido ya implementa anti-doble-submit por fase `pending` con `closeOnConfirm={false}`
  (patrón usado en `ApiKeysModule.onConfirmForm` y `WebhookAccionCell.onConfirmRegistrar`).

## Componentes afectados

### 1. `GenerarApiKeyForm.tsx` (modificado)
- Añade estado `webhookUrl` y su `FormField` opcional ("URL de webhook (callback)", `type="url"`,
  placeholder `https://…`).
- El `submit()` imperativo pasa a devolver, además del `GenerarApiKeyResult`, la URL introducida
  (o vacío) para que el anfitrión decida si encadenar. Contrato propuesto del handle:
  `submit(): Promise<{ keyResult: GenerarApiKeyResult; webhookUrl: string }>`.
- Validación de la URL en cliente: reusar `registrarWebhookSchema` (para `min(1)` y forma) más el
  helper `esHttpsValida` ya existente en `RegistrarWebhookForm`. Para no duplicarlo, se extrae ese
  helper a un módulo compartido pequeño (`_components/webhook-url.ts`) y lo consumen ambos formularios.
  Si la URL es no vacía e inválida → set field error y `submit` retorna sin invocar la action (R4).

### 2. `ApiKeysModule.tsx` (modificado — orquestador del encadenado)
- `onConfirmForm` pasa a orquestar las dos acciones:
  1. `const { keyResult, webhookUrl } = await formRef.current.submit();`
  2. Si `keyResult.status !== 'ok'` → comportamiento actual (toast/campo), no cierra el modal.
  3. Si `ok` y `webhookUrl` vacío → refresca listado, cierra modal, `setRevelado({ plainKey, identificador })`.
  4. Si `ok` y `webhookUrl` no vacío → `const wh = await registrarWebhook({ ownerUsuarioId: keyResult.apiKey.usuarioId, url: webhookUrl })`.
     - `wh.status === 'creada'` → refresca, cierra, revelado combinado con `plainKey` + `wh.secret`.
     - cualquier otro `wh.status` (fallo parcial, R11) → refresca, cierra, revelado de la key SOLO
       (`plainKey`) + bandera `webhookFallo` que el revelado combinado renderiza como aviso, y toast.
- El estado `Revelado` se amplía: `{ plainKey; identificador; webhookSecret: string | null; webhookFallo: string | null }`.
- La fase `pending` del `Modal` cubre TODA la promesa `onConfirmForm` (las dos acciones encadenadas),
  garantizando anti-doble-submit (R6). No se añade guard manual: se reusa el del `Modal`.

### 3. `RevelarApiKeyModal.tsx` → revelado combinado
- **Decisión (gate, punto b):** un **único modal** con dos secciones. Reutiliza el molde de
  `RevelarApiKeyModal`/`RevelarWebhookSecretoModal`. Se crea un componente nuevo
  `RevelarSecretosModal.tsx` que:
  - Sección 1 "Clave de API": input readonly + copiar (siempre).
  - Sección 2 "Secreto de webhook": input readonly + copiar (solo si `webhookSecret != null`).
  - Si `webhookFallo != null`: en lugar de la sección 2, un aviso `role="alert"` "La API key se creó
    pero el webhook no quedó registrado: <motivo neutro>. Puedes registrarlo con el botón Editar de
    la fila." (R11/R12/R13).
  - Un **único** checkbox "Ya guardé mis credenciales…" habilita el único botón "Cerrar"
    (`dismissible={false}`, `hideCancel`), cubriendo R9 para ambos secretos a la vez.
  - `RevelarApiKeyModal` y `RevelarWebhookSecretoModal` originales se conservan (los usa el flujo por
    fila de la feature 105); el nuevo modal combinado es exclusivo del alta.

### 4. `api-keys-columns.tsx` + `WebhookAccionCell.tsx` (rótulo de fila)
- Cambiar el texto del botón de `WebhookAccionCell` de "Webhook" a **"Editar"** (R15). El
  `aria-label` pasa a "Editar webhook de {identificador}".
- **Decisión (gate, punto c):** el botón se rotula "Editar" siempre; el modal ya distingue estado
  y su acción de confirmación muestra "Registrar" si no hay suscripción y "Guardar URL" si la hay
  (lógica `confirmLabel` ya existente en `WebhookAccionCell`). Es decir: "Editar" abre; dentro se
  registra o se edita según estado (R16/R17/R18). No se añade una segunda variante de rótulo en el
  botón de fila para no multiplicar estados por fila (que exigiría precargar el estado del webhook
  en el listado; hoy se lee on-demand, D2 de la feature 105).

## Contratos de I/O (sin cambios de backend)

| Acción | Entrada | Salida relevante |
| --- | --- | --- |
| `generarApiKey` | `{ identificador }` | `{ status:'ok', apiKey:{...,usuarioId}, plainKey }` \| errores |
| `registrarWebhook` | `{ ownerUsuarioId, url }` | `creada`(secret) \| `actualizada` \| errores |
| `obtenerWebhook` | `{ ownerUsuarioId }` | `{ webhook:{url,activa}\|null }` \| errores |

El cliente NO inventa contratos: solo compone llamadas existentes.

## Alternativa descartada

**Registrar el webhook en el servidor dentro de `generarApiKey` (una sola Server Action que cree
la key y la suscripción atómicamente).** Sería más robusto ante fallo parcial (una transacción) y
evitaría encadenar dos llamadas en el cliente. **Descartada** porque:
1. Viola el no-alcance: exige tocar backend (`api-keys.ts`, `ApiKeyService`, tipos y tests de
   servicio), cuando el pedido y el contexto acotan la feature a **frontend** y las acciones ya
   existen.
2. Acopla dos dominios hoy separados (alta de key en feature 82; webhooks en features 99/105 con su
   propia autorización `maestro` y cifrado `WEBHOOK_SECRET_ENC_KEY`). Fusionarlos duplicaría reglas
   de validación/roles ya resueltas.
3. El fallo parcial es manejable en cliente sin degradar la seguridad: la key ya revela su secreto y
   el webhook se reintenta por el botón "Editar" de la fila (R11–R13). El costo (un aviso + reintento)
   es menor que el de reescribir el borde de negocio.

## Decisiones para el gate F1.4

> Puntos que requieren visto bueno humano antes de implementar. Cada uno con recomendación por
> defecto (la que asume esta spec). Si el humano difiere, se ajustan los R indicados.

- **(a) URL opcional vs obligatoria en el alta.** → **Recomendado: opcional.** El pedido dice "se
  debe PODER registrar". Refleja R1/R2. *(Si obligatoria: cambia R2.)*
- **(b) Revelado combinado: un modal vs pasos.** → **Recomendado: un solo modal, dos secciones**
  (`RevelarSecretosModal`), un único checkbox de confirmación y un único botón de cierre. Layout
  descrito en el componente 3. Refleja R8/R9.
- **(c) Botón "Editar" cuando la fila NO tiene webhook aún.** → **Recomendado: rótulo fijo "Editar"**
  en el botón de fila; el registro se hace desde dentro del modal (que ya muestra "Registrar" como
  acción de confirmación cuando no hay suscripción). Trade-off: un rótulo condicional
  "Editar"/"Registrar" en el propio botón sería más explícito, pero obligaría a precargar el estado
  del webhook por fila en el listado (hoy se lee on-demand al abrir, D2/F105), añadiendo N lecturas o
  un cambio de contrato del listado — fuera de alcance. Refleja R15/R18.
- **(d) Fallo parcial (key creada, webhook falla).** → **Recomendado:** revelar igual el secreto de
  la key, avisar que el webhook no se registró (sin internals), dejar la key listada y permitir
  reintentar por el botón "Editar" de la fila. Refleja R11/R12/R13. Requisito de robustez, cubierto
  por EARS.
- **(e) Doble-submit durante el encadenado.** → **Recomendado:** reusar la fase `pending` del `Modal`
  (`closeOnConfirm={false}`), que ya bloquea el segundo submit mientras la promesa `onConfirm` corre;
  la promesa abarca las dos acciones. Sin guard manual nuevo. Refleja R6.
