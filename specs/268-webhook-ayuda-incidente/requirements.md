# Feature 268 — el webhook avisa del ciclo de AYUDA y del INCIDENTE

> Rama: `feature/268-webhook-ayuda-incidente` (desde `origin/dev` @ `ece96483`).
> Zona: `backend` · SDD: sí · Migración: **no** (los dos values ya existen en `ORDER_STATUS_SEED`).

## Contexto normativo (verificado contra `origin/dev` el 2026-08-22)

- `EVENTOS_PUBLICOS` (`lib/types/webhook-eventos.ts`) tiene **10** values; `ayuda_tienda` e
  `incidente` **no** están.
- `ORIGENES_SIN_EVENTO_PUBLICO` **no** está vacía: contiene `rescate_ayuda_tienda` (235/P4).
- `ORDER_STATUS_SEED` tiene 22 values e incluye los dos.
- `incidente` se alcanza vía familia `incidente` desde `en_bodega_central` (#48),
  `en_bodega_satelite` (#49), `en_ruta_bodega_central` (#50), `en_ruta_bodega_satelite` (#51),
  `por_recoger` (#52) y vía `gestion` desde `en_reparto` (#44). Tiene además seis salidas de
  REVERSIÓN: `deshacer_gestion -> en_reparto` (#53) y cinco `incidente -> <origen>` (#54–#58).

Esto es un cambio de **política de contrato público**, no de esquema ni de flujo: ninguna
transición nueva se declara, ningún productor cambia, ninguna orden cambia de estado.

---

## Requisitos

### Política de eventos públicos

**R1** — El sistema DEBE incluir `ayuda_tienda` en `EVENTOS_PUBLICOS`.

**R2** — El sistema DEBE incluir `incidente` en `EVENTOS_PUBLICOS`.

**R3** — El sistema DEBE conservar en `EVENTOS_PUBLICOS` los diez values vigentes antes de esta
feature (`por_recolectar_en_tienda`, `en_ruta_bodega_central`, `en_bodega_central`, `en_reparto`,
`entregada`, `reprogramada`, `devuelta`, `rechazada`, `devolviendo_a_tienda`,
`devuelta_a_tienda`): el cambio es estrictamente ADITIVO y ningún integrador deja de recibir un
evento que hoy recibe.

**R4** — El sistema DEBE mantener `devolucion_por_confirmar` FUERA de `EVENTOS_PUBLICOS`
(decisión 239/P2, firmada el 2026-08-19; no entra «por simetría» con esta feature).

**R5** — El sistema DEBE dejar `ORIGENES_SIN_EVENTO_PUBLICO` VACÍA: ninguna familia de origen
queda exceptuada de emitir.

**R6** — El sistema DEBE conservar el mecanismo de exención por familia aunque su lista quede
vacía: la constante exportada `ORIGENES_SIN_EVENTO_PUBLICO`, su restricción de tipo a
`OrdenHistorialOrigenTipo`, el predicado `esFamiliaSinEventoPublico` y el punto único de decisión
`esTransicionEmitible(estadoDestino, origenTipo)` DEBEN seguir existiendo con la misma firma y el
mismo comportamiento observable.

**R7** — MIENTRAS `ORIGENES_SIN_EVENTO_PUBLICO` esté vacía, el sistema DEBE cumplir que
`esTransicionEmitible(estado, familia)` sea equivalente a `esEventoPublico(estado)` para TODA
familia declarada en `ORDEN_HISTORIAL_ORIGEN_TIPOS`.

### Emisión

**R8** — CUANDO una orden cuyo dueño tiene suscripción de webhook activa y rol `apiKey`
transiciona `en_reparto -> ayuda_tienda` con familia `solicitud_ayuda_tienda`, el sistema DEBE
encolar un job `webhook_estado` para esa transición (la IDA del ciclo de ayuda deja de ser
invisible).

**R9** — CUANDO esa misma orden transiciona `ayuda_tienda -> en_reparto` con familia
`rescate_ayuda_tienda`, el sistema DEBE encolar un job `webhook_estado` para esa transición
(la VUELTA), aunque el integrador ya haya recibido un `en_reparto` sobre esa orden.

**R10** — CUANDO una orden emite dos veces el estado `en_reparto` (entrada normal y rescate), el
sistema DEBE producir dos jobs con `dedupeKey` distinta y, por tanto, dos entregas con `eventoId`
distinto: la clave sigue llevando el instante (`webhook_estado:<ordenId>:<estatusDestinoId>:<ISO>`)
y ninguno de los dos eventos se descarta en silencio por el `ON CONFLICT DO NOTHING`.

**R11** — CUANDO una orden con integrador suscrito transiciona a `incidente` —vía familia
`incidente` desde cualquiera de los cinco estados con arista declarada, o vía `gestion` desde
`en_reparto`— el sistema DEBE encolar un job `webhook_estado` para esa transición.

**R12** — El sistema DEBE seguir emitiendo los REINGRESOS LEGÍTIMOS a un estado público que hoy
emiten: al menos `liberacion_reprogramada`, `deshacer_gestion`, `recoleccion`, `gestion` y
`gestion_tienda_ayuda`. Vaciar la exención no puede alterar ninguno de estos casos.

**R13** — El sistema NO DEBE emitir evento para una transición cuyo estado destino no sea público;
en particular, `ayuda_tienda -> sin_gestionar` (corte de la noche, familia `corte_sin_gestionar`)
sigue sin emitir.

**R14** — El sistema DEBE seguir tomando la decisión de emitir en un único punto
(`esTransicionEmitible`), sin re-derivar la política en el emisor
(`lib/services/jobs/webhook-estado-encolado.ts`) ni duplicar listas en ningún otro módulo.

### Contrato publicado

**R15** — El sistema DEBE documentar `ayuda_tienda` e `incidente` en el enum de estados de orden
del contrato OpenAPI del canal por API key (`lib/api/openapi-spec.ts`), en los cuatro sitios donde
ese enum aparece.

**R16** — El sistema DEBE mantener `docs/api/api-key-openapi.yaml` como espejo EXACTO del objeto
TypeScript: los cuatro bloques `enum` del YAML deben ser idénticos, y en el mismo orden, a los
cuatro del objeto.

**R17** — El sistema DEBE garantizar que todo value de `EVENTOS_PUBLICOS` y todo value del enum
publicado existan en `ORDER_STATUS_SEED` (sin estados fantasma).

**R18** — El sistema DEBE congelar `EVENTOS_PUBLICOS` y `ORIGENES_SIN_EVENTO_PUBLICO` **por
igualdad de contenido**, de forma que cualquier alta o baja futura ponga rojo un test. Un aserto
de tamaño solo es aceptable ACOMPAÑANDO al de igualdad, nunca en su lugar.

### Cuerpo de la entrega

**R19** — El sistema DEBE conservar el nombre del evento (`orden.estado_actualizado`) y los campos
que el cuerpo ya tiene (`evento`, `eventoId`, `ocurridoAt`, `data.numGuia`, `data.numRemision`,
`data.estado`), sin renombrarlos ni cambiarles el tipo. Lo único que crece es `data`, con los
campos de R20 y R24, y siempre de forma ADITIVA y OPCIONAL: ningún consumidor actual se rompe.

**R20** — CUANDO el estado destino del evento sea `incidente`, el cuerpo DEBE llevar la causa
tipificada, con uno de los tres valores de `CAUSA_INCIDENTE_SEED` (`danado` | `perdido` | `robado`),
en español y sin traducir, resuelta AL ENTREGAR desde el registro vigente del incidente **sea cual
sea su procedencia**: la gestión del mensajero (`gestion_orden.causa_incidente`) o el reporte del
admin (`orden_incidente.causa`).

**R21** — CUANDO el estado destino NO sea `incidente`, o cuando lo sea pero no exista causa
resoluble, el cuerpo NO DEBE llevar el campo de causa, con la misma convención de ausencia que fije
la 256 para el motivo de `devuelta`.

**R22** — El sistema NO DEBE incluir en el cuerpo del webhook ninguna URL firmada, ningún token de
acceso ni ninguna credencial al portador. Todo enlace que viaje en el cuerpo DEBE ser ESTABLE y
DETERMINISTA: sin token, sin expiración, y calculable sin consultar Storage.

**R24** — CUANDO el estado destino del evento sea `incidente`, el cuerpo DEBE llevar un enlace al
recurso del canal por API key que expone las evidencias de esa orden. CUANDO el estado destino sea
cualquier otro, ese enlace NO DEBE viajar.

**R25** — CUANDO un mismo job se reejecute (reintento con backoff, hasta `MAX_INTENTOS_WEBHOOK`), el
sistema DEBE producir el MISMO enlace y el MISMO `eventoId` en el intento 1 y en el intento 5.

**R26** — El recurso enlazado por R24 DEBE exigir `Authorization: Bearer ordx_...`, DEBE forzar el
owner al dueño de la key y DEBE devolver el mismo 404 uniforme para una orden inexistente y para
una orden de otro dueño.

**R27** — El detalle de orden del canal por API key DEBE exponer las evidencias del incidente con
`resultado: "incidente"`, tanto las del camino del MENSAJERO (gestión con `resultado = incidente`)
como las del camino del ADMIN (registro `orden_incidente`), con exactamente la misma forma que hoy
tienen las de entrega y rechazo: URL firmada de corta duración, `contentType` y `expiraEnSegundos`,
y NUNCA el `storage_path` crudo ni el bucket.

**R28** — El sistema DEBE documentar el evento `orden.estado_actualizado` y su cuerpo completo
—incluidos los campos de R20 y R24— en el contrato OpenAPI del canal por API key
(`lib/api/openapi-spec.ts`), sin alterar el número de enums de estado de orden que cuenta el guard
vigente (siguen siendo CUATRO).

**R29** — El sistema DEBE derivar el enum de estados del cuerpo del webhook de `EVENTOS_PUBLICOS`,
con un orden determinista, y NO DEBE copiarlo como lista literal: la política sigue teniendo una
sola fuente de verdad.

**R30** — El sistema DEBE mantener `docs/api/api-key-openapi.yaml` como espejo del bloque nuevo de
R28, igual que ya lo es de los cuatro enums de estado.

**R31** — El sistema DEBE incluir `incidente` en el enum `resultado` del schema `Evidencia` del
contrato OpenAPI y de su espejo YAML.

### Alcance negativo

**R23** — El sistema NO DEBE introducir ninguna migración de base de datos, ningún cambio en
`db/schema.prisma`, ningún value nuevo en `ORDER_STATUS_SEED` ni ninguna arista nueva en
`TRANSICIONES`. Las dos tablas que la lectura de evidencias necesita (`gestion_orden_evidencia` y
`orden_incidente_evidencia`) ya existen con su RLS: se LEEN, no se tocan.

---

## Decisión FIRMADA en la puerta (2026-08-22)

**«Con causa y con el enlace de las evidencias.»** P1 queda **aprobada y cerrada**: no se reabre.

- **Con causa (R20/R21).** El integrador que recibe `incidente` sin causa no puede distinguir
  «dañado» de «robado», que es exactamente la información por la que esta feature sale del
  cuestionario de Dropi. Hacerlo después costaría un SEGUNDO aviso a integradores por el mismo
  cuerpo. Se resuelve AL ENTREGAR, reusando el mecanismo del PR #434 (feature 256).
- **Con el enlace de las evidencias (R22/R24/R25/R26/R27).** Una foto vale más que la causa: el
  integrador quiere ver el paquete dañado. Pero el enlace es **estable y determinista**, nunca una
  URL firmada. Las tres razones —cada una suficiente por sí sola— están en `design.md` §7.2:
  rompe la idempotencia del cuerpo (99/R23, fijada con tests por la 256), caduca a los 300 s
  (`gestionConfig.SIGNED_URL_TTL_SECONDS`) contra 5 intentos con backoff, y es una credencial al
  portador. El integrador cambia el enlace por URLs firmadas frescas usando su propia API key.

Asimetría de idioma: la causa de incidente va en **español** (`danado`/`perdido`/`robado`) y la de
devolución en **inglés**. Decisión consciente y firmada (73/F1.4-g y 158/Q-B). No se «corrige»
aquí ni se abre ticket de consistencia.

---

## Coste aceptado por escrito

Toda orden que pase por el ciclo de ayuda genera **dos eventos más** que hoy: la IDA
(`ayuda_tienda`) y la VUELTA (`en_reparto` **repetido** sobre la misma orden). Ese `en_reparto`
repetido es exactamente lo que 235/P4 evitaba, y esta feature lo revierte a propósito: la
alternativa —emitir la ida sin la vuelta— dejaría al integrador viendo entrar la orden en ayuda y
no verla salir nunca hasta el desenlace, que es peor que el silencio actual. La deduplicación es
posible en el consumidor porque `eventoId` es único por instante (R10).

---

## Preguntas abiertas

1. **Nombre del campo de causa, si #434 no ha aterrizado.** El nombre y la convención de ausencia
   deben ser los que fije el PR #434 para el motivo de `devuelta`, no unos propios. Si #434 usa un
   nombre genérico reutilizable (`motivo`), esta feature lo reusa para las dos causas; si usa uno
   específico de devolución, el hermano (`causaIncidente`) se decide con #434 delante. **No se
   inventa aquí.** Mientras tanto, `design.md` §7.1 fija los dos escenarios de aterrizaje.
2. **Base URL del enlace (R24).** El enlace absoluto necesita un origin. `NEXT_PUBLIC_APP_URL`
   existe (`lib/utils/paquete-url.ts`) pero no hay config de webhook que lo exponga.
   `design.md` §7.4 propone leerlo por configuración (nunca hardcode) y OMITIR el campo si no se
   puede resolver, antes que emitir un enlace roto. ¿Se confirma esa política de ausencia?
3. **¿El enlace solo en `incidente`?** R24 lo limita a `incidente`, que es lo pedido. El mismo
   enlace serviría para `entregada` y `rechazada`, cuyas evidencias YA se exponen. No se amplía por
   iniciativa propia: ampliar el cuerpo de los eventos más frecuentes del canal es otra decisión.
4. **Portada vs las N fotos (R27).** El detalle por API expone hoy UNA foto por gestión (la portada
   denormalizada de la 119), no las 1..N. Esta feature mantiene esa regla para el incidente, por
   simetría y para no reabrir la deuda de la 119. ¿Se confirma, o el incidente debe mostrar las N?
5. **Aviso a integradores: canal y plazo.** La ficha declara que bloquea el DESPLIEGUE (misma
   política que 239/T0.3), pero no consta en `docs/` cuál es el canal ni la antelación mínima.
   ¿Existe una lista de integradores activos y un plazo acordado?
6. **Reversiones del incidente (#54–#58).** Al reponer la orden desde `incidente` a
   `en_bodega_central` / `en_ruta_bodega_central`, el integrador recibe HOY un evento repetido de
   ese estado sin haber recibido nunca el `incidente` que lo explica; con esta feature pasa a
   recibir la secuencia completa. Se asume que es el comportamiento querido y que no requiere
   exención (mejora estricta), pero conviene confirmarlo en la puerta.
