# Feature 266 — habilitar un pedido con novedad desde el canal por API key

## Requisitos (EARS)

Alcance: UN endpoint nuevo del canal por API key que recibe un LOTE de
`{ num_guia, nota }` y habilita cada pedido con novedad. Dos desenlaces por fila:
la orden vuelve a `en_reparto` (rama A) o queda registrada la habilitación sin
cambiar el estado (rama B).

Vocabulario fijado para todo el documento:

- **estado habilitable** — `ayuda_tienda` o `devuelta`, y **ningún otro**
  (decisión 1 de la puerta, 2026-08-23). `reprogramada`, `rechazada`,
  `incidente` y `sin_gestionar` NO son habilitables.
- **rama A** — la orden está en `ayuda_tienda` **y** conserva mensajero asignado
  (`mensajero_asignado_id IS NOT NULL`): el paquete sigue en la calle.
- **rama B** — cualquier otro estado habilitable, o `ayuda_tienda` sin mensajero
  asignado: el paquete ya está en bodega.
- **owner** — el usuario dedicado de la API key autenticada (`actor.usuarioId`),
  que es también el `tienda_id` de sus órdenes.
- **fila** — un elemento del array del cuerpo de la petición.

⚠️ **DICHO EN VOZ ALTA, porque el contrato tiene que declararlo y no dejar que se
descubra implementando:** una orden `devuelta` está **SIEMPRE desasignada** —su
paquete ya volvió a bodega, y los cuatro caminos que lo devuelven ponen
`mensajero_asignado_id` a NULL diciendo «handoff limpio a la bodega»—, así que
**la rama `devuelta` cae SIEMPRE en solo-log**. En la práctica, de los dos
estados habilitables **el único que puede volver a `en_reparto` es
`ayuda_tienda`**. No es un defecto del diseño: es la verdad física del paquete.
Consecuencias que se exigen por escrito: (a) el integrador NO debe esperar un
cambio de estado en la mitad de los casos, y el OpenAPI tiene que decírselo;
(b) ningún test puede escribirse esperando que una `devuelta` transicione.

---

### Autenticación y alcance

**R1.** CUANDO llega una petición al endpoint sin cabecera
`Authorization: Bearer <key>` o con una key que no autentica, el sistema DEBE
responder `401` y NO DEBE leer, escribir ni registrar ninguna orden.

**R2.** CUANDO la key autentica pero el actor no está habilitado para el canal,
el sistema DEBE responder `403` y NO DEBE leer, escribir ni registrar ninguna
orden.

**R3.** El sistema DEBE resolver el propietario de toda orden alcanzable por este
endpoint como `actor.usuarioId`, sin aceptar ningún identificador de tienda
proveniente del cuerpo ni de la URL.

**R4.** SI una `num_guia` del lote no corresponde a una orden viva
(`deleted_at IS NULL`) del owner, ENTONCES el sistema DEBE marcar ESA fila con
resultado `error` y código `no_encontrada`, sin revelar si la guía existe bajo
otro propietario.

**R5.** El sistema NUNCA DEBE escribir la API key —ni en claro ni su hash— en
logs, mensajes de error ni en el cuerpo de ninguna respuesta.

### Cuerpo de la petición

**R6.** SI el cuerpo no es JSON, o no contiene un array de filas, o el array está
vacío, o excede el tope de filas por lote, ENTONCES el sistema DEBE responder
`422` sin procesar ninguna fila.

**R7.** SI una fila individual no trae `num_guia` como entero positivo, o no trae
`nota` como texto no vacío tras recortar espacios y de longitud máxima 200,
ENTONCES el sistema DEBE marcar ESA fila con resultado `error` y código
`fila_invalida`, y DEBE seguir procesando el resto del lote.

**R8.** SI la misma `num_guia` aparece más de una vez en el mismo lote, ENTONCES
el sistema DEBE procesar la primera aparición y DEBE marcar cada aparición
posterior con resultado `error` y código `duplicada_en_lote`, sin volver a
escribir nada para esa orden.

### Respuesta

**R9.** CUANDO la autenticación y el envoltorio del cuerpo son válidos, el
sistema DEBE responder `200` con un resultado POR FILA, aunque todas las filas
hayan fallado, y NO DEBE convertir el fallo de una fila en un error global.

**R10.** El sistema DEBE distinguir en la respuesta, fila por fila, los tres
desenlaces `habilitada` (rama A), `habilitada_sin_cambio_de_estado` (rama B) y
`error`, y DEBE incluir en las dos primeras el estado en el que la orden quedó.

**R11.** El sistema DEBE devolver las filas de la respuesta en el mismo orden y
en la misma cantidad que las filas recibidas.

### Discriminador y guarda de estado

**R12.** El sistema DEBE decidir la rama de cada fila mirando exclusivamente el
estado actual de la orden y si conserva mensajero asignado, y NO DEBE derivarla
de ninguna otra columna, bandera ni historial.

**R13.** SI el estado actual de la orden no pertenece al conjunto declarado de
estados habilitables (`ayuda_tienda`, `devuelta`), ENTONCES el sistema DEBE
marcar ESA fila con resultado `error` y código `estado_no_habilitable`, y NO DEBE
escribir ni estado ni registro alguno para ella.

**R13-b.** CUANDO se pide habilitar una orden en `reprogramada`, el sistema DEBE
marcar ESA fila con resultado `error` y código `estado_no_habilitable`. Se
escribe aparte de R13 —y no como un caso más— porque `reprogramada` **sí** es una
novedad en la definición del integrador y estuvo propuesta como habilitable hasta
la puerta del 2026-08-23: sin un requisito propio, el día que alguien la «añada
por simetría» no romperá nada.

**R14.** El sistema DEBE aplicar la comprobación de R13 en el llamador de este
endpoint, antes de invocar cualquier escritura, y NO DEBE delegarla en la guarda
del repositorio.

**R14-b.** MIENTRAS una orden esté en `devuelta`, el sistema DEBE resolverla por
la rama B, sin excepción, y NO DEBE transicionarla a `en_reparto`.

### Rama A — vuelve a `en_reparto`

**R15.** CUANDO una fila cae en la rama A, el sistema DEBE transicionar la orden
de `ayuda_tienda` a `en_reparto` invocando el punto único de escritura de la
transición de ayuda, y NO DEBE ejecutar ninguna otra escritura sobre
`orden.estatus_id`.

**R16.** CUANDO una fila cae en la rama A, el sistema DEBE registrar la
transición en el historial con una familia de origen propia de esta feature,
distinta de la familia del rescate del botón de la tienda y del mensajero.

**R17.** CUANDO una fila cae en la rama A y la transición se ejecuta, el sistema
DEBE encolar el evento público del canal de webhooks para el estado destino
`en_reparto`.

**R18.** SI entre la lectura de la orden y la escritura la orden dejó de estar en
`ayuda_tienda`, ENTONCES el sistema DEBE marcar ESA fila con resultado `error` y
código `estado_no_habilitable`, y NO DEBE dejar ni transición ni registro
parciales para ella.

**R19.** SI alguno de los dos estados del catálogo (`ayuda_tienda`,
`en_reparto`) no resuelve, ENTONCES el sistema DEBE rechazar la fila sin escribir
nada.

### Rama B — solo registro

**R20.** CUANDO una fila cae en la rama B, el sistema NO DEBE modificar el estado
de la orden.

**R21.** CUANDO una fila cae en la rama B, el sistema DEBE persistir un registro
de la habilitación que conserve la orden, la nota, el actor, el instante y el
hecho de que no hubo cambio de estado.

**R22.** CUANDO una fila cae en la rama B, el sistema NO DEBE encolar ningún
evento de webhook.

### Registro de la habilitación

**R23.** CUANDO una fila se habilita —en cualquiera de las dos ramas—, el sistema
DEBE persistir un registro de la habilitación con su nota, y DEBE hacerlo en un
único lugar común a las dos ramas.

**R24.** El sistema DEBE conservar los registros de habilitación como
append-only: NO DEBE actualizar ni borrar un registro previo cuando la misma
orden se habilita de nuevo.

**R25.** MIENTRAS una fila de la rama A no haya confirmado su transición, el
sistema NO DEBE persistir su registro de habilitación.

### Dinero y contrato público

**R26.** El sistema NO DEBE contar la familia de historial nueva como visita real
de un mensajero, y por tanto NO DEBE alterar el conteo de intentos de entrega de
ninguna orden.

**R27.** El sistema NO DEBE exceptuar la familia de historial nueva de la
política de emisión de eventos públicos.

**R28.** El sistema DEBE describir el endpoint nuevo —ruta, verbo, cuerpo,
respuesta y códigos de error por fila— en la especificación OpenAPI publicada del
canal y en su espejo textual.

### Persistencia

**R29.** DONDE se cree una tabla nueva para el registro de habilitaciones, el
sistema DEBE habilitarle Row Level Security.

**R30.** El sistema DEBE entregar la migración del valor nuevo del enum de
familias de historial con su `down.sql`, que DEBE abortar ruidosamente si existe
alguna fila que use ese valor.

### Idempotencia

**R31.** CUANDO se habilita dos veces la misma orden de la rama A, el sistema DEBE
marcar la segunda con resultado `error` y código `estado_no_habilitable` —la
orden ya está en `en_reparto`, que no es un estado habilitable— y NO DEBE
producir ninguna escritura de estado, ninguna fila de historial ni ningún
registro de habilitación adicional. El sistema NO DEBE responder `habilitada` a
esa segunda llamada: un acuse falso es peor que un error honesto (decisión 3 de
la puerta, 2026-08-23).

---

## Fuera de alcance (declarado)

- El PULL de novedades (endpoint de gestiones / incidentes).
- Las evidencias de la visita y la georreferenciación.
- Notificar por webhook la habilitación de la rama B. Es **deuda declarada**, no
  olvido: el evento de estado no puede representarla sin mentir, y el flujo está
  SIN DEFINIR por decisión explícita del humano (2026-08-22). Cuando se defina,
  es ficha aparte. Esta feature NO deja ganchos a medio poner para ella.
- Ampliar el hilo de notas (227) al rol `apiKey`.

---

## Decisiones cerradas en la puerta (2026-08-23)

Las seis preguntas abiertas de la versión anterior de este documento están
**FIRMADAS por el humano el 2026-08-23**. No se reabren, no se «mejoran» y no se
reinterpretan al implementar. Se conserva el porqué de cada una para que el
reviewer pueda juzgarlas y para que nadie las deshaga por simetría.

**D1 — Estados habilitables: `ayuda_tienda` y `devuelta`. `reprogramada` QUEDA
FUERA.** Respuesta literal del humano: «ayuda_tienda y novedad». Se interpreta
como los DOS grupos que el repo YA declara —`GRUPOS_NOVEDAD = ["ayuda",
"devolucion"]`, `lib/types/novedad-grupo.ts:50`, que mapean a `ayuda_tienda` y
`devuelta`— y **no** como la definición más ancha de «novedad» de Dropi. Quedan
excluidas también `rechazada`, `incidente` y `sin_gestionar`. Por qué así: el
conjunto sale de una declaración que ya existe y que la pantalla de `/novedades`
consume, en vez de una segunda lista que alguien tendría que mantener de acuerdo
con la primera. Consecuencia declarada arriba, en el vocabulario: **solo
`ayuda_tienda` puede volver a `en_reparto`**. Requisitos afectados: R13, R13-b,
R14-b.

**D2 — Tope por lote: 100 filas.** Confirmado. El lote se procesa
secuencialmente, una transacción corta por fila, así que el tope no protege un
insert masivo sino un presupuesto de tiempo y de conexiones. Requisito
afectado: R6.

**D3 — La segunda habilitación devuelve `error` / `estado_no_habilitable`, con
cero escrituras.** Descartado el `habilitada` idempotente: **un acuse falso es
peor que un error honesto**. Requisito afectado: R31.

**D4 — La tabla nueva nace SIN LECTOR, y se acepta: es una bitácora de
auditoría.** Ninguna superficie la muestra. Exponerla —en el detalle por API key
o donde sea— **es ficha aparte**. Se deja declarado, y no descubierto, por el
precedente de la 270: allí una columna que nadie leía pasó inadvertida.

**D5 — La familia de historial se llama `habilitacion_api`.** Confirmado, en
línea con `cancelacion_api` (106). Requisitos afectados: R16, R26, R27, R30.

**D6 — La nota NO se copia al `motivo` de la fila de historial.** Vive SOLO en la
tabla nueva. Se acepta el coste: la nota no aparece en la línea de tiempo que
pinta la 49/262. A cambio, el dato tiene un único hogar y «todas las
habilitaciones de una orden» es una sola consulta. Requisito afectado: R23.
