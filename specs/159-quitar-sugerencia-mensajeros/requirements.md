# Feature 159 — Quitar la sugerencia de mensajeros de la carga masiva

> Zona: `fullstack` · `depends_on: 156` · Asume aplicadas las features 153, 154 y 156.
> **Es RETIRO de código, no feature nueva.** El criterio de éxito no es "funciona",
> es **no queda rastro**: ni columna, ni tipo huérfano, ni método de repositorio sin
> consumidor, ni test que verifique algo que ya no existe.

## Contexto

Con el flujo v2 una orden **nace sin mensajero** y se asigna **siempre desde una
bodega** (`asignarDesdeBodega` y `AsignacionSateliteService`, los dos caminos que
sobreviven a la 156). La "sugerencia de mensajero" de la carga masiva —columna
`orden.mensajero_sugerido_id`, su Server Action, su paso de modal y la elección
**al azar** entre mensajeros de la zona— deja de tener sentido: sugiere para un
momento del flujo que ya no ocurre.

## Alcance

**Dentro:** la columna `mensajero_sugerido_id` y todo lo que la escribe, la lee,
la tipa, la documenta o la testea.

**Fuera (se declara explícitamente para que no se retire por arrastre):**

- `mensajero_asignado_id` y los dos caminos de asignación que sobreviven.
- El **gate de asignabilidad por coordenadas** (`IAsignabilidadCoordenadasService`):
  pese a lo que dice la ficha, **no es** la sugerencia por cercanía — es el gate que
  usan los writers de `mensajero_asignado_id` (ver `design.md §0`). Se conserva.
- El **resumen del lote recién cargado** (feature 16/R6): es una capacidad distinta
  de la sugerencia (16/R12–R18). Sobrevive en modo solo lectura (ver `design.md §5`).
- `IUserRepository.listMensajeros` / `MensajeroDTO`: los consume `RankingService`.

---

## Requisitos

### Modelo de datos

**R1.** El sistema DEBE almacenar las órdenes sin la columna `mensajero_sugerido_id`:
una vez aplicadas todas las migraciones, la tabla `orden` no expone la columna
`mensajero_sugerido_id`, ni el índice `orden_mensajero_sugerido_id_idx`, ni la
restricción `orden_mensajero_sugerido_id_fkey`.

**R2.** CUANDO se ejecute el rollback de la migración de retiro, el sistema DEBE
restituir la columna `mensajero_sugerido_id` (`TEXT`, nullable), su índice y su
clave foránea hacia `usuario` con `ON DELETE SET NULL ON UPDATE CASCADE`, con los
mismos nombres de objeto que tenían antes del retiro.

**R3.** SI la migración de retiro se aplica sobre una base que contiene órdenes con
`mensajero_sugerido_id` no nulo, ENTONCES el sistema DEBE completarla sin error y
sin modificar el valor de `mensajero_asignado_id` de ninguna orden.

**R4.** El esquema de datos NO DEBE declarar la relación `OrdenMensajeroSugerido`
en ninguno de sus dos extremos (`Orden.mensajeroSugerido`, `Usuario.ordenesMensajeria`).

### Carga masiva — backend

**R5.** CUANDO la carga masiva procese una fila que incluya la clave
`mensajero_sugerido_id`, el sistema DEBE crear la orden ignorando esa clave, sin
registrar error de campo y sin devolver `resultado: "error"` por esa causa.

**R6.** CUANDO la carga masiva procese una fila cuya clave `mensajero_sugerido_id`
contenga un identificador inexistente o de un usuario que no tiene rol `mensajero`,
el sistema DEBE producir exactamente el mismo `RowResult` que produciría la misma
fila sin esa clave.

**R7.** MIENTRAS se procesa un lote de carga masiva —por sesión o por API key— el
sistema NO DEBE consultar el catálogo de mensajeros.

**R8.** El contrato de creación en lote de órdenes NO DEBE admitir ningún campo de
mensajero sugerido.

### Contrato público de la API de carga (feature 88)

**R9.** CUANDO un integrador envíe a la API de carga una fila con la clave
`mensajero_sugerido_id`, el sistema DEBE responder con el mismo `RowResult`
(`resultado`, `estatus`, `numGuia`) que produciría esa misma fila sin la clave, y
con el mismo código HTTP.

**R10.** El documento OpenAPI publicado DEBE declarar la propiedad
`mensajero_sugerido_id` de `CargaRow` como obsoleta y describirla como aceptada e
ignorada por el servidor.
*(Sujeto a la decisión de la puerta F1.4 — ver Pregunta abierta Q1.)*

**R11.** El documento OpenAPI publicado y su espejo en `docs/` DEBEN declarar lo
mismo para `CargaRow`: toda propiedad presente en uno DEBE estar presente en el otro
con el mismo estado de obsolescencia.

### Interfaz de usuario

**R12.** CUANDO termine una carga masiva con al menos una orden nueva, el sistema
DEBE mostrar el resumen de las órdenes creadas SIN columna de mensajero y SIN
ningún control de asignación.

**R13.** El flujo de carga masiva NO DEBE ofrecer ninguna acción de "sugerir
asignación" ni ningún selector de mensajero.

**R14.** El sistema NO DEBE seleccionar mensajeros de forma aleatoria en ningún
punto del flujo de carga masiva.

**R15.** El indicador de pasos del modal de carga masiva NO DEBE anunciar ningún
paso de asignación de mensajero.

**R16.** CUANDO el listado de órdenes se filtre por un único estado, el sistema DEBE
renderizar la columna "Mensajero" con el nombre del mensajero **asignado**,
cualquiera que sea ese estado.

**R17.** SI la orden no tiene mensajero asignado, ENTONCES la columna "Mensajero"
del listado DEBE mostrar el marcador de dato ausente.

### Higiene del retiro

**R18.** El código de producción (`app/`, `lib/`, `components/`, `hooks/`,
`db/schema.prisma`) NO DEBE contener los identificadores `mensajero_sugerido_id`,
`mensajeroSugerido`, `mensajeroSugeridoId`, `MensajeroSugerido`,
`asignarMensajeroSugerido`, `ordenesColumnsMensajeroSugerido` ni
`ESTADOS_MENSAJERO_SUGERIDO`.

**R19.** El sistema NO DEBE exponer una Server Action de asignación de mensajero
sugerido.

**R20.** Todo símbolo exportado que quede sin consumidor de producción a raíz de este
retiro DEBE eliminarse; en particular los métodos de repositorio
`asignarMensajeroSugerido`, `findMensajerosByIds` y `countOrdenesDeTienda`, y sus
declaraciones en la interfaz correspondiente.

**R21.** El sistema DEBE conservar operativo el gate de asignabilidad por coordenadas
para los dos caminos de asignación que subsisten (asignación desde bodega central y
asignación desde bodega satélite).

**R22.** Tras el retiro, la suite DEBE seguir cubriendo, con tests que pasan, los
comportamientos NO relacionados con la sugerencia que hoy conviven con ella:

- (a) el troceado en lotes y la deduplicación por `num_remision` del envío por chunks;
- (b) el remapeo de la línea original del archivo en cada `RowResult`;
- (c) el fallo de un lote con respuesta HTTP no-ok;
- (d) el resumen del lote acotado a la tienda del actor y sin campos internos;
- (e) el agrupado del modal de generar guía y su encadenado a etiquetas y manifiesto;
- (f) el flujo de manifiesto de la carga masiva;
- (g) el rechazo por rol de las acciones del resumen de carga masiva.

---

## Preguntas abiertas

> Se listan aquí porque la respuesta **no está en `docs/`, `specs/` ni en el código**.
> Cada una lleva la recomendación razonada del autor del spec, pero **decide el humano
> en la puerta F1.4**. Q1 y Q5 están desarrolladas en `design.md §4` y `§1.3`.

**Q1 — ¿Se retira `mensajero_sugerido_id` del contrato público documentado, o se
acepta y se ignora?**
Hecho verificado: en runtime **no hay breaking change en ninguna de las dos ramas**
(`filaCargaSchema` no es `.strict()` por el ancla de la feature 143, y `CargaRow` ya
declara `additionalProperties`), así que "aceptar e ignorar" es el comportamiento por
defecto y no cuesta código. Lo único que se decide es **qué dice la documentación**.
Recomendación: marcarla `deprecated` + "aceptado e ignorado" ahora (R10), y borrarla
del documento en una limpieza posterior. Detalle y alternativas en `design.md §4`.

**Q2 — ¿El resumen del lote sobrevive como paso propio del modal?**
El spec asume que **sí**, en modo solo lectura (es la única confirmación visual de qué
se cargó y de él cuelga el manifiesto de la feature 148). La alternativa —borrar el
paso entero— se descarta en `design.md §6/A3` por ser pérdida de función, no retiro de
la sugerencia. Si el humano prefiere colapsar el modal a dos pasos, R12 y R15 cambian
y `design.md §5` se reescribe.

**Q3 — `OrdenesCargaResumenPaso.tsx` está huérfano hoy: ¿se borra en esta feature?**
Verificado: no tiene consumidor de producción (`OrdenesCargaMasivaButton` monta
`OrdenesCargaResumen` **directo**); solo lo referencian dos tests. Consecuencia
colateral: el botón de manifiesto de la feature 148 que vive en ese contenedor **no
está enganchado en producción**. Es deuda **preexistente y ajena** a la sugerencia.
Recomendación: NO borrarlo aquí (sería alcance nuevo) y registrarlo como feature
propia. Decide el humano.

**Q4 — ¿Hay integradores activos enviando `mensajero_sugerido_id` hoy?**
Dato que no vive en el repo. No cambia el código (ver Q1), pero decide si hace falta
aviso previo a los integradores y con cuánta antelación.

**Q5 — ¿Se conserva un respaldo de los valores de `orden.mensajero_sugerido_id`
antes del `DROP`?**
El `down.sql` restituye la **estructura**, no los datos: tras el rollback la columna
vuelve con todos los valores en `NULL`. Opciones: (a) aceptar la pérdida —el dato es
una sugerencia caduca que el flujo v2 no volverá a usar—; (b) volcar
`(orden_id, mensajero_sugerido_id)` a un CSV de archivo antes de migrar producción.
Recomendación: (a), con la salvedad de que el `down.sql` lo diga explícitamente para
que nadie crea que el rollback es completo.
