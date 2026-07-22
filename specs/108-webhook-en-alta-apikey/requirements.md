# Feature 108 — Registrar webhook en el alta de la API key + botón de fila = "Editar"

> Zona: **frontend**. Refina la UI de `Configuracion > API` (features 82 = alta de API key,
> 105 = gestión de webhook). Las Server Actions ya existen (`generarApiKey`, `registrarWebhook`,
> `obtenerWebhook`, `rotarSecretoWebhook`, `desactivarWebhook`). **No hay cambios de backend.**
> Los schemas y tipos ya existen y se REUSAN (`generarApiKeySchema`, `registrarWebhookSchema`).

Pedido literal del humano: *"el webhook se debe poder registrar cuando se crea el api key,
y ese boton webhook deberia ser editar en su lugar"*.

Notación EARS. Cada `R<n>` es testeable con un test de componente (Testing Library) y está
mapeado en `tasks.md` (columna R→test).

---

## A. Alta de la API key con webhook opcional

**R1** — El sistema DEBE mostrar en el modal "Generar API key", además del campo obligatorio
`identificador`, un campo **opcional** de "URL de webhook (callback)".

**R2** — DONDE el usuario deja vacío el campo de URL de webhook, el sistema DEBE generar la
API key **sin** registrar ninguna suscripción de webhook (una sola acción: `generarApiKey`).

**R3** — CUANDO el usuario confirma el modal con un `identificador` válido y una URL de webhook
no vacía, el sistema DEBE, primero, validar la URL en cliente reusando `registrarWebhookSchema`
más el refuerzo `https` ya usado por la feature 105 (sin duplicar reglas de forma).

**R4** — SI la URL de webhook ingresada no es una URL `https` válida, ENTONCES el sistema DEBE
mostrar el error bajo ese campo y NO invocar `generarApiKey` ni `registrarWebhook` (no se crea
la key con una URL inválida).

**R5** — CUANDO el usuario confirma el modal con `identificador` válido y URL `https` válida,
el sistema DEBE invocar `generarApiKey` y, SI su resultado es `ok`, ENTONCES encadenar
`registrarWebhook({ ownerUsuarioId: apiKey.usuarioId, url })` usando el `usuarioId` que trae
`apiKey` (`ApiKeyPublico`).

**R6** — MIENTRAS las acciones encadenadas (`generarApiKey` y, en su caso, `registrarWebhook`)
están en curso, el sistema DEBE impedir un segundo submit del modal (reusando la fase `pending`
anti-doble-submit del `Modal`).

## B. Revelado de secretos (una sola vez)

**R7** — CUANDO `generarApiKey` devuelve `ok` y no se solicitó webhook (R2), el sistema DEBE
revelar el secreto de la API key (`plainKey`) exactamente una vez, con el comportamiento actual
de la feature 82 (aviso de "única vez", copiar, checkbox obligatorio, cierre único).

**R8** — CUANDO `generarApiKey` devuelve `ok` y `registrarWebhook` devuelve `creada`, el sistema
DEBE revelar en una sola experiencia AMBOS secretos exactamente una vez: el `plainKey` de la API
key y el `secret` del webhook.

**R9** — El sistema DEBE exigir confirmación explícita del usuario (checkbox "ya guardé…") antes
de habilitar el cierre del revelado combinado, y NO DEBE ofrecer ninguna vía para volver a mostrar
ninguno de los dos secretos una vez cerrado.

**R10** — El sistema NO DEBE persistir, loguear ni exponer en URL/almacenamiento los secretos
revelados; viven solo en estado local del cliente y se descartan al cerrar el revelado.

## C. Fallo parcial (robustez)

**R11** — SI `generarApiKey` devuelve `ok` pero el `registrarWebhook` encadenado falla
(`forbidden` / `unauthenticated` / `validation_error` / `owner_invalido` / `config_error`),
ENTONCES el sistema DEBE, de todos modos, revelar el secreto de la API key (`plainKey`): la key
ya existe y su secreto no puede perderse ni quedar bloqueado.

**R12** — En el caso de R11, el sistema DEBE avisar claramente al usuario de que la API key se
creó pero el webhook NO quedó registrado, sin exponer internals del error del servidor.

**R13** — En el caso de R11, el sistema DEBE dejar la API key listada y permitir reintentar el
registro del webhook después, desde el botón de fila (sección D), sin recrear la key.

**R14** — CUANDO `generarApiKey` devuelve `ok` (con o sin webhook), el sistema DEBE refrescar el
listado de API keys antes de mostrar el revelado, de modo que la nueva fila esté presente.

## D. Botón/columna de fila: "Webhook" → "Editar"

**R15** — El sistema DEBE rotular el botón de la columna de acciones de webhook de cada fila como
**"Editar"** (en lugar de "Webhook").

**R16** — CUANDO el usuario pulsa "Editar" en una fila, el sistema DEBE abrir el modal de gestión
de la suscripción de ese owner y leer su estado on-demand con `obtenerWebhook` (comportamiento
actual de la feature 105).

**R17** — MIENTRAS la fila tiene una suscripción activa, el modal de gestión DEBE permitir editar
la URL, rotar el secreto y dar de baja la suscripción (comportamiento actual de la feature 105,
sin regresión).

**R18** — SI la fila NO tiene suscripción activa al abrir el modal, ENTONCES el sistema DEBE
permitir registrar (dar de alta) una URL de webhook desde ese mismo modal, y el rótulo de la
acción de confirmación DEBE reflejar "Registrar" en ese estado y "Guardar URL" cuando ya existe
(comportamiento condicional actual de la feature 105, preservado).

**R19** — El sistema DEBE preservar el revelado del secreto del webhook una sola vez cuando el
registro por fila resulta `creada` o cuando se rota el secreto (`rotarSecretoWebhook` → `ok`),
sin regresión respecto de la feature 105.

## E. Accesibilidad y consistencia

**R20** — El campo de URL de webhook del alta DEBE tener etiqueta accesible asociada y anunciar
sus errores de validación de forma accesible (`role="alert"` / `FormField error`), consistente con
el resto de formularios del módulo.

---

## Preguntas abiertas

Ninguna que bloquee la redacción. Las decisiones de UX que requieren visto bueno humano están
consolidadas en `design.md` → **"Decisiones para el gate F1.4"** (puntos a–e), con recomendación
por defecto para cada una. Si el humano difiere de alguna recomendación, cambian R8/R11/R18 y sus
tests asociados.
