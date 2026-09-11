# Feature 415 — la orden dice su zona y lo que costó, en el listado y en el detalle

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en la tabla de
trazabilidad de `tasks.md` (`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el
CÓMO vive en `design.md`.

**Preguntas abiertas: NINGUNA.** Las cinco que abrió la primera revisión las cerró el humano el
2026-09-10 y viven como decisiones firmadas en `design.md` §3 (D2, D3, D4, D5, D6). Dos de ellas se
cerraron **contra** la propuesta original de este spec, y el porqué está escrito allí.

**Quién lo pide y para qué (2026-09-10).** Dos peticiones de un integrador real (Daniel Marín),
aprobadas por el humano. Quiere (a) **medir por zona** y (b) **restar el costo de cada paquete**
para calcular su rentabilidad. Hoy no puede hacer ninguna de las dos: ni la zona ni el costo se
publican por orden.

**Van JUNTAS a propósito, no por comodidad.** Son campos **aditivos** sobre el MISMO ítem del
listado y el MISMO detalle, tocan los mismos cinco artefactos de contrato
(`lib/types/api-orden.ts`, `OrdenRepository`, `lib/api/openapi-spec.ts`,
`docs/api/api-key-openapi.yaml`, `docs/api/CHANGELOG.md`) y el manual. Separadas serían dos gates
completos, un rebase garantizado entre ellas y **dos entradas de CHANGELOG el mismo día para el
mismo endpoint** — y esa entrada **es** el aviso al integrador, así que partirla lo empeora. La
ficha **416** queda `superseded` por ésta.

**Alcance:** backend puro, canal integrador, **dos superficies ya existentes**:

1. `GET /api/ordenes/api-key` (listado, feature 106) — cada ítem.
2. `GET /api/ordenes/api-key/orden/{id}` (detalle, features 106 + 177) — que hereda del ítem.

**El molde es la feature 404** (`specs/404-mensajero-en-webhook-y-api/`), cerrada hoy: añadió
`mensajero` como campo aditivo al mismo ítem y al mismo detalle, sin migración, sin endpoint nuevo
y sin tocar los controllers. Se reutilizan su forma, sus decisiones y su estructura de tests — y
desde la revisión del humano, **también la forma exacta de su campo**: `zona` es
`{ id, nombre }`, igual que `mensajero`.

**Fuera de alcance (declarado):** el **webhook** `orden.estado_actualizado` (la 404 sí lo tocaba;
ésta no: el integrador pidió medir sobre el listado y el detalle, y meter dinero en el cuerpo
firmado del evento es otra decisión); filtrar u ordenar por zona o por costo; cualquier endpoint
nuevo; la cotización (`POST /api/ordenes/api-key/cotizacion`), que no cambia ni una clave; la UI;
cualquier escritura.

---

## Verificado contra el código el 2026-09-10 (no supuesto)

- **El ítem publica EXACTAMENTE diez claves**: `numGuia`, `numRemision`, `estado`, `destinatario`,
  `telefonoDest`, `producto`, `direccion`, `montoCobrar`, `createdAt` y `mensajero`
  (`lib/types/api-orden.ts`, `ApiOrdenListItemDTO`). **La zona no está, y el costo tampoco.**
- `flete`, `iva`, `comision`, `ivaComision` y `fulfillment` se publican **sólo** dentro de
  `CotizacionEscenarioEntregado` (`lib/api/openapi-spec.ts`), nunca por orden.
- `orden.zona_id` es **NOT NULL**; `zona.id` es `String @id @default(uuid())` y `zona.nombre` es
  **NOT NULL y `@unique`** (`db/schema.prisma`).
- `cierre_detail` **no guarda importes derivados**: guarda la **tarifa congelada** (montos y
  porcentajes) más las entradas de la fórmula (`monto_cobrar`, `cobra_comision`, `es_central`,
  `es_zona_especial`, `tienda_id`) y el `tarifa_fulfillment`. El importe se **deriva** de ahí con
  `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`), la misma función que liquida el cierre y
  que cotiza el canal.
- `tarifas` **no tiene histórico**: una fila por (tienda, zona) que se **edita en sitio**
  (`@@unique([zonaId, tiendaId])`, sin `deleted_at`). Por eso `cierre_detail` es la única memoria
  de lo que se cobró.

### ⚠️ Trampa de lectura nº 1 — hay DOS «zona», y sólo una es ésta

| «zona» | Columna | Qué es | Esta ficha |
|---|---|---|---|
| del **MENSAJERO** | `usuario.zona_id` | en qué zona trabaja esa persona — **dato personal suyo** | **NO la toca.** Sigue excluida |
| de la **ORDEN** | `orden.zona_id` | a dónde va el paquete — **dato operativo del envío** | **La publica** |

El comentario de `API_ORDEN_SELECT` que excluye «zona» está **dentro de la proyección de
`mensajeroAsignado`** y habla de la primera. La `description` publicada de `OrdenListItem.mensajero`
repite la misma lista («teléfono, email, cédula, foto, **zona**, vehículo»), y esa frase **sigue
siendo verdad palabra por palabra**: no se retira, se acota (R39).

Sin decirlo, el siguiente que lea una sola de esas frases concluirá que la ficha contradice la
decisión de privacidad que el humano firmó el 2026-09-09 para la 404.

### ⚠️ Trampa de lectura nº 2 — el manual mintió, y esta ficha lo repara

`docs/api/manual-metricas-por-mensajero.md` llegó a decir «cruzá con el `zona` que ya recibís en el
listado». **Era falso** y ya está corregido *diciendo que era falso* (bloque «Corrección del
2026-09-10»: «hoy no publicamos la zona por ningún endpoint»). Esta ficha convierte la instrucción
original en verdad, y por tanto **esa corrección deja de ser cierta el día que esto se despliegue**:
hay que reescribirla, no borrarla (R40).

### Por qué DOS valores de costo y no uno — medido, no razonado

Comparando los **1.581** detalles congelados contra la tarifa vigente de su misma fila: el flete no
cambió, la comisión tampoco, el IVA tampoco, **pero el fulfillment cambió en 263 (1 de cada 6)**,
de 692,00 a 696,00. Son 4 colones —trivial en dinero— **pero prueban que la tarifa se mueve**.
Publicando sólo el estimado, **cada ajuste de tarifa reescribiría hacia atrás la rentabilidad
histórica del integrador** sin que él pudiera saberlo.

### Cobertura de `costoReal` — MEDIDA contra producción el 2026-09-10

De **1.652** órdenes vivas, **1.182 tienen fila en `cierre_detail` (72 %)** y **470 no (28 %)**. Y
las **1.182 pertenecen a cierres `aprobado`**: cero en `solicitado`, `rechazado` o `vencido`. Es
decir: **el filtro por `aprobado` (R26 / D5) no recorta nada hoy.** La sospecha de la primera
revisión —que la cobertura publicada caería por debajo del 72 %— **no se confirma**.

> ⚠️ **Pero el 100 % es contingente, no estructural, y la diferencia decide si el filtro se puede
> quitar.** La fila de `cierre_detail` se escribe en `CierreDiaRepository.crearCierre` —o sea **al
> SOLICITAR** el cierre, no al aprobarlo—, dentro de la misma `$transaction` que vincula las
> gestiones; el propio esquema lo dice al documentar `tarifa_id` (*«la tienda no tenía tarifa
> vigente al **solicitar**»*). Un cierre `solicitado` **sí** tiene filas congeladas, y esa fila es
> **INMUTABLE** (69/R10, con guardia que prohíbe borrarla desde `lib/`), así que un cierre
> rechazado **conserva** la suya.
>
> El 100 % medido significa, entonces, que hoy no quedan cierres sin resolver con órdenes vivas —un
> estado de los datos—, **no** que el código lo garantice. **Por eso el filtro se escribe
> explícitamente y nunca se omite**: es lo único que impide que `costoReal` cambie **hacia atrás**
> el día que se lea una orden mientras su cierre está solicitado, o después de que ese cierre se
> rechace. Un comentario que dijera «esto es redundante» sería la invitación a borrarlo.

---

## Bloque A — La zona de la orden

**R1.** CUANDO un integrador autenticado solicita el listado o el detalle de una orden propia, el
sistema DEBE incluir el campo `zona` como un objeto con EXACTAMENTE dos claves, `id` y `nombre`, y
ninguna otra.

**R2.** El campo `zona` DEBE estar SIEMPRE PRESENTE y NUNCA DEBE ser `null` ni omitirse: toda orden
tiene zona.

**R3.** El sistema DEBE poblar `zona.id` con un identificador ESTABLE EN EL TIEMPO: la misma zona
DEBE producir el mismo `id` en el listado y en el detalle y en todas las lecturas, y ese `id` NUNCA
DEBE reasignarse a otra zona.

**R4.** El sistema DEBE poblar `zona.nombre` con el nombre registrado en el catálogo **tal cual**,
sin derivar, traducir, recortar ni normalizar; y el contrato publicado DEBE declararlo como texto
para MOSTRAR, que puede cambiar, y NO como clave de agrupación.

**R5.** El sistema NO DEBE publicar ningún atributo derivado de la zona ni ningún dato adicional de
ella: ni marca de GAM/central, ni subzona, ni marca de zona especial del distrito, ni cobro por
vehículo, ni la geografía (provincia, cantón, distrito).

**R6.** El campo `zona` DEBE significar la zona **de la ORDEN** (el destino del paquete) y NUNCA la
zona **del MENSAJERO**; esta feature NO DEBE publicar ningún dato nuevo del mensajero.

**R7.** El sistema NO DEBE admitir `zona` —ni su `id` ni su `nombre`— como criterio de filtrado ni
de ordenación del listado: un parámetro de query que lo intente DEBE ignorarse igual que hoy se
ignora cualquier clave desconocida (106/R8).

**R8.** El sistema DEBE resolver la zona de TODOS los ítems de una página dentro del conjunto FIJO
de consultas que esa página ya realiza; el número de consultas NO DEBE depender del número de
ítems.

---

## Bloque B — La forma de los dos campos de costo (transversal)

**R9.** CUANDO un integrador autenticado solicita el listado o el detalle de una orden propia, el
sistema DEBE incluir EXACTAMENTE dos campos de costo, `costoEstimado` y `costoReal`; las dos claves
DEBEN estar SIEMPRE PRESENTES y NUNCA DEBEN omitirse.

**R10.** CUANDO un campo de costo tiene valor, el sistema DEBE emitirlo como un objeto con
EXACTAMENTE cinco claves —`flete`, `iva`, `comision`, `ivaComision`, `fulfillment`— y ninguna otra.

**R11.** El sistema NO DEBE publicar ningún campo que sume los cinco conceptos, con ningún nombre.

**R12.** El sistema DEBE emitir cada uno de los cinco conceptos como una CADENA con exactamente dos
decimales y punto como separador decimal, sin símbolo de moneda y sin agrupación de miles: el mismo
dialecto de dinero que ya usan los importes de la cotización y el `costoEnvio` de la carga.

**R13.** El sistema NUNCA DEBE emitir `null` para un concepto DENTRO de un objeto de costo: un
concepto que no aplica a esa orden DEBE emitirse como `"0.00"` explícito.

**R14.** Los dos campos de costo DEBEN tener la MISMA forma: mismas cinco claves, mismos tipos y la
misma convención de ausencia.

**R15.** Los dos campos de costo DEBEN corresponder al escenario de **ENTREGA** de la orden, y el
contrato publicado DEBE decirlo **con esas palabras**: `costoReal` es «lo que se congeló al
cerrar», NO «la línea que entró en tu wallet»; si la orden termina RECHAZADA, lo que se factura es
el flete de devolución y su IVA, que NO es este importe.

**R16.** El sistema DEBE derivar los cinco conceptos con la MISMA función de derivación de importes
que ya liquida el cierre y que ya cotiza el canal; NO DEBE implementar una segunda fórmula de
flete, IVA, comisión ni fulfillment.

**R17.** El sistema NUNCA DEBE alimentar la derivación de importes con un valor en coma flotante:
toda entrada monetaria DEBE cruzar la frontera como cadena de escala 2. En particular, el
`montoCobrar` **publicado** (que es un número) NO DEBE usarse como entrada del cálculo.

**R18.** El sistema NO DEBE admitir `costoEstimado`, `costoReal` ni ninguno de sus cinco conceptos
como criterio de filtrado ni de ordenación del listado, ni DEBE publicar la procedencia interna de
los importes: ni el identificador de la fila de tarifa, ni el del cierre, ni el del detalle de
cierre, ni la fecha de congelación.

---

## Bloque C — `costoEstimado` (la tarifa VIGENTE)

**R19.** El sistema DEBE derivar `costoEstimado` de la tarifa VIGENTE que resuelve para el par
(tienda dueña de la orden, zona de la orden) en el instante de la lectura, usando la ÚNICA regla de
cascada que ya existe; NO DEBE escribir una segunda regla de resolución.

**R20.** El sistema DEBE usar como entradas de `costoEstimado` los valores VIVOS de la orden: si su
zona es central, si su distrito está marcado como zona especial, su monto a cobrar y si cobra
comisión.

**R21.** SI la orden no tiene distrito registrado, O su distrito no tiene decidida la marca de zona
especial, ENTONCES el sistema DEBE tratar la orden como NO especial.

**R22.** SI ninguna tarifa resuelve para el par (tienda, zona), ENTONCES el sistema DEBE emitir
`costoEstimado: null` y NUNCA un objeto con los cinco conceptos en `"0.00"`.

**R23.** MIENTRAS `costoReal` sea `null`, el sistema DEBE admitir que `costoEstimado` cambie entre
dos lecturas de la misma orden, y el contrato publicado DEBE **decirlo con todas las letras**.

**R24.** El sistema DEBE resolver la tarifa vigente de TODOS los ítems de una página en UNA sola
consulta, con los pares (tienda, zona) DISTINTOS de esa página; NO DEBE ejecutar una consulta por
ítem ni una por zona repetida.

---

## Bloque D — `costoReal` (lo CONGELADO)

**R25.** El sistema DEBE derivar `costoReal` de la tarifa CONGELADA y de las entradas CONGELADAS
(monto a cobrar, cobro de comisión, zona central, zona especial) de la fila de detalle de cierre de
esa orden; NUNCA de datos vivos.

**R26.** SI la orden no tiene ninguna fila de detalle de cierre perteneciente a un cierre cuyo
estado es **`aprobado`** y a la tienda que hoy es su dueña, ENTONCES el sistema DEBE emitir
`costoReal: null`. El filtro por estado DEBE escribirse de forma EXPLÍCITA, aunque hoy no recorte
ninguna fila.

**R27.** SI la orden tiene más de una fila de detalle de cierre elegible, ENTONCES el sistema DEBE
elegir la **MÁS RECIENTE** mediante un criterio determinista y totalmente ordenado, de modo que dos
lecturas consecutivas sin cambios de datos devuelvan el MISMO valor.

**R28.** SI la fila congelada elegida no tiene tarifa congelada, ENTONCES el sistema DEBE emitir
los cinco conceptos en `"0.00"` —un cero AFIRMADO— y NO `null`: ese cierre no cobró esos conceptos.

**R29.** El sistema DEBE poblar el `fulfillment` de `costoReal` con el monto CONGELADO en esa fila;
SI ese monto no está congelado, ENTONCES DEBE emitir `"0.00"`.

**R30.** El sistema NUNCA DEBE escribir en `cierre_detail` ni en ninguna otra tabla de dinero: esta
feature es de SOLO LECTURA.

**R31.** El sistema DEBE resolver la fila congelada de TODOS los ítems de una página dentro del
conjunto FIJO de consultas de esa página; el número de consultas NO DEBE depender del número de
ítems ni del número de cierres en que aparezca cada orden.

---

## Bloque E — Alcance, privacidad y no-regresión

**R32.** El sistema DEBE entregar `zona`, `costoEstimado` y `costoReal` ÚNICAMENTE sobre órdenes
cuyo dueño es el actor resuelto por la autenticación del canal; una orden ajena DEBE seguir
respondiendo 404, exactamente igual que una inexistente. Esta feature NO DEBE introducir ninguna
vía nueva por la que un integrador alcance una orden ajena.

**R33.** El sistema DEBE acotar la lectura de la fila congelada al dueño de la orden usando el
`tienda_id` **CONGELADO** de esa fila, y NO el `tienda_id` vivo de la orden: un cambio posterior de
dueño NO DEBE poder publicar a una tienda lo que se le facturó a otra.

**R34.** El sistema DEBE conservar sin cambio de forma los DIEZ campos ya publicados del ítem
(`numGuia`, `numRemision`, `estado`, `destinatario`, `telefonoDest`, `producto`, `direccion`,
`montoCobrar`, `createdAt`, `mensajero`), el bloque `pagination` (`limit`, `offset`, `total`), el
orden de las filas entre páginas, y —en el detalle— `evidencias[]` y `gestiones[]`.

**R35.** El sistema NO DEBE publicar, por causa de esta feature, ningún identificador interno nuevo
salvo `zona.id`, ni ningún dato personal nuevo del mensajero, ni el `evidencia_storage_path`, ni el
nombre del bucket, ni el texto libre `gestion_orden.motivo`. `zona.id` NO DEBE aceptarse como
entrada por ningún endpoint del canal.

**R36.** El sistema DEBE seguir emitiendo la respuesta de los dos endpoints con los MISMOS códigos
de estado que hoy (200 / 401 / 403 / 404 / 422) y sin cambiar su criterio.

---

## Bloque F — Contrato publicado, aviso y manual

**R37.** El contrato publicado —`lib/api/openapi-spec.ts` y su espejo textual
`docs/api/api-key-openapi.yaml`— DEBE declarar `zona`, `costoEstimado` y `costoReal` en el schema
del ítem del listado (y por herencia en el del detalle), en su lista de requeridos, con la
convención de presencia de R9, con la advertencia de R23 y con la del escenario de R15.

**R38.** El contrato publicado DEBE instruir a agrupar por `zona.id` y NUNCA por `zona.nombre`, con
la MISMA regla y el MISMO tono con que ya lo hace para `mensajero`; las dos entidades con nombre del
mismo payload DEBEN publicarse con la MISMA forma y la MISMA regla de agrupación.

**R39.** El contrato publicado DEBE dejar escrito que la exclusión de «zona» que figura entre los
datos personales del mensajero se refiere a la zona DEL MENSAJERO y NO al campo `zona` de la orden.
Ninguna `description` publicada DEBE quedar afirmando que el canal no publica ninguna zona.

**R40.** El sistema DEBE publicar **UNA sola** entrada fechada en `docs/api/CHANGELOG.md` que cubra
las dos partes —que es el aviso al integrador, listo para enviar— y DEBE actualizar
`docs/api/manual-metricas-por-mensajero.md` reescribiendo la «Corrección del 2026-09-10» (sin
borrar el rastro de que la hubo) y explicando cómo se usan los dos campos de costo. Los dos textos
DEBEN incluir el aviso a clientes con **validación estricta de esquema**.

---

## Preguntas abiertas

**Ninguna.** Las cinco que abrió la primera revisión están cerradas por el humano el 2026-09-10 y
escritas como decisiones firmadas en `design.md` §3:

| # | Pregunta | Decisión | Dónde |
|---|---|---|---|
| Q1 | ¿`costoReal` refleja el resultado real de la gestión? | **No**: es el escenario de ENTREGA, y el contrato lo dice con esas palabras | D3 / R15 |
| Q2 | ¿Sólo cierres `aprobado`? ¿cuánto recorta? | **Sí, y no recorta nada hoy** (1.182 de 1.182, medido). El filtro se escribe igual: el 100 % es contingente | D5 / R26 |
| Q3 | ¿La primera fila congelada o la última? | **La última**, mismo criterio que la 411 fijó para su desenlace | D6 / R27 |
| Q4 | ¿Un sexto campo sumado, con otro nombre? | **No**: otro nombre reintroduce la misma ambigüedad con disfraz | D4 / R11 |
| Q5 | ¿`zona` como cadena o como `{id, nombre}`? | **`{ id, nombre }`**, como `mensajero`: misma forma y misma regla de agrupación en el mismo payload | D2 / R1–R4, R38 |
