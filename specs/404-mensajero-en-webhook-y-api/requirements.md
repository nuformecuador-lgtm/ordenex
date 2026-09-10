# Feature 404 — el mensajero de la orden viaja en el webhook y en la API de lectura

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en la tabla de
trazabilidad de `tasks.md` (`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el
CÓMO vive en `design.md`.

**Quién lo pide y para qué (2026-09-07).** Un integrador real necesita medir su operación **por
mensajero y por zona** —tasa de entrega, novedades y devoluciones— desde su propio dashboard. Hoy
ninguna de las tres superficies del canal dice qué mensajero lleva la orden: ni el evento
`orden.estado_actualizado`, ni el listado, ni el detalle. Con estos dos puntos dice, textualmente,
que le basta para arrancar.

**Alcance:** backend puro, canal integrador. **UN campo nuevo, ADITIVO y opcional**, con la MISMA
forma en tres superficies ya existentes:

1. `data.mensajero` en el evento `orden.estado_actualizado` (feature 99/104).
2. `mensajero` por orden en `GET /api/ordenes/api-key` (listado, feature 106).
3. `mensajero` en `GET /api/ordenes/api-key/orden/{id}` (detalle, features 106 + 177).

**Reutiliza (verificado contra el código el 2026-09-09, no supuesto):**

- El dato ya existe y ya se compone en un solo sitio: `orden.mensajero_asignado_id` →
  `usuario`, con el nombre completo resuelto por `nombreCompletoUsuario`
  (`lib/utils/nombre-usuario.ts`). `OrdenRepository.toRelaciones` ya construye
  `{ id, nombre }` con esa función para la pantalla de `/ordenes`.
- El payload del webhook (`DataEvento` / `armarData`, `lib/services/WebhookEstadoService.ts`) ya
  tiene precedente de campo **aditivo**: `evidenciasUrl` (feature 268). La cabecera de `armarData`
  documenta las **dos convenciones de ausencia** que conviven a propósito, y por qué omitir un
  campo ya anunciado sería romper un contrato.
- Autenticación, scope por owner y 404 uniforme del canal: sin cambios (features 88, 106, 177).

**Fuera de alcance (declarado):** el historial de gestiones y el mensajero **por gestión** (es la
feature **405**, que depende de esta); filtrar u ordenar el listado por mensajero; cualquier dato
del mensajero que no sea su nombre; una superficie nueva de mensajeros; UI.

### Dos hechos del sistema que acotan lo que esta feature puede prometer

**(a) Quién recibe eventos.** La ficha decía «la emisión solo cubre órdenes cuyo dueño es un
usuario de API key (feature 104)», y **eso ya no es cierto**: la feature **302** retiró ese
`JOIN "rol"` del emisor porque dejaba mudas las keys apuntadas a una tienda real
(`lib/services/jobs/webhook-estado-encolado.ts`, comentario fechado 2026-09-04, medido contra
producción). Hoy el criterio es **una suscripción de webhook ACTIVA colgada del owner de la
orden**. Consecuencia para el integrador, que se declara y no se disimula: **una orden suya sin
suscripción activa en su owner no emite ningún evento**, y ese hueco no lo abre esta feature.

**(b) Qué significa el campo.** `orden.mensajero_asignado_id` es «quién LLEVA la orden ahora», no
«quién la gestionó». Hay flujos que lo **limpian a `null`** —generación de guía, quitar mensajero,
devolución a bodega, liberación de reprogramada, recuperación a bodega y el barrido del corte
diario—, así que una orden histórica puede quedar sin mensajero aunque alguien la haya llevado. La
identidad de quien gestionó vive en `gestion_orden.mensajero_id` (NOT NULL) y es material de la
**405**. Ver R7, R23 y `design.md` §9.

---

## Bloque A — La forma del campo (transversal a las tres superficies)

**R1.** El sistema DEBE exponer el mensajero de una orden como un objeto con EXACTAMENTE dos
claves, `id` y `nombre`, y ninguna otra.

**R2.** SI la orden no tiene mensajero asignado, ENTONCES el sistema DEBE emitir el campo
`mensajero` con valor `null`; el campo DEBE estar SIEMPRE PRESENTE y NUNCA omitirse.

**R3.** El sistema DEBE poblar `mensajero.nombre` con el nombre completo de la persona resuelto por
la ÚNICA fuente de composición ya existente (nombre + primer apellido + segundo apellido), sin
volver a componerlo en un segundo sitio.

**R4.** El sistema DEBE poblar `mensajero.id` con un identificador ESTABLE EN EL TIEMPO: el mismo
mensajero DEBE producir el mismo `id` en todas las superficies y en todas las lecturas, y ese `id`
NUNCA DEBE reasignarse a otra persona.

**R5.** El campo `mensajero` DEBE tener la MISMA forma —mismas claves, mismos tipos y la misma
convención de ausencia de R2— en el webhook, en el listado y en el detalle.

**R6.** El sistema NO DEBE incluir en el objeto `mensajero` ningún dato personal adicional del
mensajero (teléfono, email, cédula, foto, zona, vehículo) ni ningún campo de estado interno.

**R7.** El campo `mensajero` DEBE significar «el mensajero ASIGNADO a la orden en el momento de la
lectura o de la entrega del evento», y NUNCA «quién gestionó la orden».

---

## Bloque B — Webhook `orden.estado_actualizado`

**R8.** CUANDO el sistema entrega un evento `orden.estado_actualizado`, el cuerpo DEBE incluir
dentro de `data` el campo `mensajero` con la forma del bloque A.

**R9.** El sistema DEBE conservar intactas las cuatro claves ya publicadas de `data` (`numGuia`,
`numRemision`, `estado`, `motivo`) con su forma y su convención de presencia actuales, y DEBE
conservar `evidenciasUrl` como la ÚNICA clave OPCIONAL del objeto.

**R10.** El sistema DEBE insertar `mensajero` en una POSICIÓN FIJA del objeto `data`, de modo que
dos serializaciones del mismo evento sobre el mismo estado de la orden produzcan cuerpos idénticos
byte a byte (invariante de firma e idempotencia, 99/R18 y 99/R23).

**R11.** MIENTRAS un evento se reintenta, el sistema DEBE publicar el mensajero VIGENTE en el
instante de ESA entrega —la misma regla que ya rige a `motivo`—, y NO una foto del instante del
cambio de estado.

**R12.** El sistema DEBE resolver el mensajero DENTRO de la lectura de la orden que el emisor del
cuerpo ya realiza, sin añadir ninguna consulta adicional por evento.

**R13.** El sistema NUNCA DEBE escribir el `id` ni el `nombre` del mensajero en un log, en un
mensaje de error, ni en el payload del job encolado (99/R13, 99/R29).

---

## Bloque C — Listado (`GET /api/ordenes/api-key`)

**R14.** CUANDO un integrador autenticado solicita el listado, CADA ítem devuelto DEBE incluir el
campo `mensajero` con la forma del bloque A.

**R15.** El sistema DEBE resolver el mensajero de TODOS los ítems de una página dentro de la MISMA
consulta que ya lee esa página; NO DEBE ejecutar una consulta por ítem.

**R16.** El sistema DEBE conservar sin cambio de forma los nueve campos ya publicados del ítem
(`numGuia`, `numRemision`, `estado`, `destinatario`, `telefonoDest`, `producto`, `direccion`,
`montoCobrar`, `createdAt`) y el bloque `pagination` (`limit`, `offset`, `total`), así como el
orden de las filas entre páginas.

**R17.** El sistema NO DEBE admitir `mensajero` como criterio de filtrado ni de ordenación del
listado: un parámetro de query que lo intente DEBE ignorarse igual que hoy se ignora cualquier
clave desconocida (106/R8).

---

## Bloque D — Detalle (`GET /api/ordenes/api-key/orden/{id}`)

**R18.** CUANDO un integrador autenticado consulta el detalle de una orden propia, la respuesta
DEBE incluir el campo `mensajero` con la forma del bloque A.

**R19.** El detalle DEBE conservar sin cambio de forma su array `evidencias[]` (incluido el `[]`
cuando no hay) y los nueve campos que hereda del ítem del listado.

---

## Bloque E — Privacidad y alcance

**R20.** El sistema DEBE entregar el nombre del mensajero ÚNICAMENTE al dueño de la orden —el owner
resuelto por la autenticación del canal— y solo sobre órdenes propias; esta feature NO DEBE
introducir ninguna vía nueva por la que un integrador alcance una orden ajena.

**R21.** El sistema NO DEBE exponer, por ninguna de las tres superficies, el TEXTO LIBRE
`gestion_orden.motivo` que escribe el mensajero (256/R22). Ese texto no es la causa tipificada que
ya viaja como `data.motivo`.

**R22.** Como consecuencia de esta feature, el sistema NO DEBE exponer `evidencia_storage_path`, el
nombre del bucket, ni ningún id interno de orden o de tienda que hoy no se exponga (106/R16).

**R23.** SI la orden pierde su mensajero asignado —reasignación, quitar mensajero, devolución o
recuperación a bodega, liberación de una reprogramada, o el barrido del corte diario—, ENTONCES el
listado y el detalle DEBEN devolver `mensajero: null` para esa orden, sin error y sin inventar un
mensajero anterior.

---

## Bloque F — Contrato publicado

**R24.** El contrato publicado —`lib/api/openapi-spec.ts` y su espejo textual
`docs/api/api-key-openapi.yaml`— DEBE declarar `mensajero` en los tres schemas afectados
(`WebhookOrdenEstadoActualizado.data`, `OrdenListItem` y, por herencia, `OrdenDetalle`), con su
convención de presencia (R2) y con la advertencia de que es «quién la lleva» y no «quién la
gestionó» (R7).

**R25.** El contrato publicado DEBE dejar escrito que la exclusión de «datos personales de terceros
(p. ej. el mensajero)» de la feature 106/R16 queda **ACOTADA** por esta feature: el **nombre** del
mensajero asignado SÍ se publica al dueño de la orden, y el resto de sus datos personales sigue
excluido. Ninguna descripción publicada DEBE quedar afirmando lo contrario.

---

## Preguntas abiertas

Ninguna bloquea la implementación; las tres tienen decisión por defecto escrita en `design.md`. Se
listan porque son decisiones que el humano puede querer cambiar antes de aprobar.

**Q1 — El `id` es un UUID en texto, no el entero `123` del ejemplo del integrador.**
`usuario.id` es `String @default(uuid())` (`db/schema.prisma:84`). El ejemplo de la petición decía
`"mensajero": { "id": 123, ... }`, y ese entero no existe en el modelo: no hay ningún identificador
numérico de usuario que publicar. **Decisión por defecto (D2 en `design.md`):** se publica el UUID
como string, que cumple R4 (estable, nunca reasignado). Solo hace falta confirmarle al integrador
que su clave de agrupación será texto, no entero — va en la entrada del CHANGELOG.

**Q2 — «Quién la lleva» no es «quién la entregó», y el integrador quiere medir entregas.**
El campo se lee de `orden.mensajero_asignado_id`, que varios flujos limpian a `null` (ver hecho (b)
arriba y R23). Para una orden entregada o devuelta el mensajero **sí** se conserva, así que la
métrica principal funciona; pero una orden **barrida por el corte** o **recuperada a bodega**
quedará con `mensajero: null` en el censo diario, aunque alguien la llevara. **Decisión por
defecto:** se entrega el arreglo mínimo pedido y se declara el hueco; la vía para cerrarlo es la
**405** (historial de gestiones, con `gestion_orden.mensajero_id`, que es NOT NULL y no se limpia
nunca). ¿El humano quiere confirmarlo con el integrador antes de aprobar?

**Q3 — La premisa de privacidad se verificó cierta para UN modelo de propiedad de las órdenes, y no
es literalmente comprobable para el otro.** Ver `design.md` §2 para la evidencia completa. Resumen:
con una key apuntada a una tienda real (feature 302, `api_key.tienda_destino_id`), el owner de las
órdenes es una cuenta `adminTienda` que **entra a `/ordenes` y ve la columna «Mensajero» con este
mismo nombre**: la premisa del humano es exactamente cierta. Con una key de cuenta dedicada
(modelo original, feature 88), el owner es una cuenta de rol `apiKey`, que es **una cuenta de
máquina que no navega** (`lib/auth/menu-visibility.ts:152`): esa cuenta no «ve» nada en ninguna
UI, así que la premisa se sostiene por transitividad comercial (el integrador ES la tienda), no por
una pantalla que se pueda señalar. **Decisión por defecto:** la excepción se aplica a los dos
modelos por igual, porque el destinatario del dato es en ambos casos el dueño de la orden. Si el
humano prefiere acotarla al owner `adminTienda`, es una condición extra en un solo sitio y hay que
decirlo ANTES de implementar.
