# Feature 255 — Cotización por API key: precio y cobertura antes de crear la orden

Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
Cada `R<n>` se mapea a un test concreto en `tasks.md`.

**Alcance en una línea:** un borde NUEVO que toma la MISMA entrada que la carga por API key,
NO persiste nada y devuelve, por cada fila, su cobertura y cuánto cuesta en los DOS escenarios
posibles (entregado y devuelto).

**Fuera de alcance (explícito):** el contrato y el comportamiento de
`POST /api/ordenes/api-key/carga` (features 88/141/155) NO se tocan. La asimetría deliberada
—la carga tolera la falta de tarifa con `"0.00"`, la cotización la rechaza— se declara en
`design.md` §3 y NO se "unifica" aquí.

---

## 1. Autenticación y titularidad

**R1.** CUANDO llega una petición a este borde sin header `Authorization` con esquema `Bearer`
o con un token vacío, el sistema DEBE responder `401` con la shape de error global, sin leer el
cuerpo, sin consultar tarifas y sin consultar geografía.

**R2.** CUANDO la key presentada no corresponde a ninguna key registrada, el sistema DEBE
responder `401` con exactamente la misma shape y el mismo mensaje que R1 (una key inexistente y
una key ausente son indistinguibles desde fuera).

**R3.** CUANDO la key existe pero su usuario dedicado no está activo, el sistema DEBE responder
`403`.

**R4.** El sistema DEBE resolver el dueño de la cotización SIEMPRE a partir del actor de la key,
y DEBE ignorar cualquier identificador de tienda, dueño o tarifa que venga en el cuerpo o en la
query.

**R5.** El sistema NO DEBE contener ninguna comprobación propia de "la tienda tiene API key":
la existencia y validez de la key la resuelve por completo la autenticación (R1–R3).

## 2. Entrada

**R6.** CUANDO el cuerpo no es JSON válido, o no cumple el schema del borde, el sistema DEBE
responder `422` con el código `VALIDATION_ERROR` y los errores por campo, sin cotizar ninguna
fila.

**R7.** El sistema DEBE aceptar filas con la MISMA forma que las de la carga por API key: pares
clave/valor de texto, con la geografía en las columnas SEPARADAS `provincia`, `canton`,
`distrito`, `direccion` (contrato público de la feature 88), y con `monto_cobrar` como texto.

**R8.** El sistema DEBE aceptar entre 1 y `cargaMasivaConfig.MAX_CHUNK_ROWS` filas por petición;
un lote vacío o que supere ese tope DEBE responder `422` sin cotizar ninguna fila.

**R9.** El sistema NO DEBE exigir `num_remision` para cotizar. SI la fila trae `num_remision`,
ENTONCES el sistema DEBE devolverlo tal cual en el resultado de esa fila como dato de
correlación; SI no lo trae, ENTONCES DEBE devolver `null` en ese campo.

**R10.** El sistema NO DEBE deduplicar contra la base de datos ni contra el propio lote: dos
filas con el mismo `num_remision` DEBEN cotizarse ambas, y una fila cuyo `num_remision` ya
exista como orden NO DEBE marcarse como duplicada.

## 3. Tarifa (la inversión deliberada del gap 98/D1)

**R11.** El sistema DEBE resolver la tarifa de la tienda del actor UNA sola vez por petición,
nunca una vez por fila.

**R12.** El sistema DEBE considerar "tarifa cotizable" la fila de tarifa de esa tienda que no
esté borrada (`deleted_at IS NULL`) Y esté en estado `activo`; entre varias candidatas, la más
reciente.

**R13.** SI la tienda del actor no tiene ninguna tarifa cotizable, ENTONCES el sistema DEBE
responder con un error explícito que diga que no hay tarifa vigente asociada, sin cotizar
ninguna fila y sin emitir ningún importe.

**R14.** El sistema DEBE ejecutar la comprobación de tarifa (R13) ANTES de resolver la geografía
de ninguna fila.

**R15.** El sistema NUNCA DEBE emitir un importe de valor cero como consecuencia de la ausencia
de tarifa (inversión explícita del gap D1/R8 de la feature 98: en una carga el cero es
tolerable, en una cotización es una mentira sobre dinero servida como precio).

**R16.** El mensaje de error de R13 NO DEBE contener la API key, su hash, ni datos personales de
ninguna fila.

## 4. Cobertura (por fila, geográfica)

**R17.** Para cada fila el sistema DEBE resolver la cobertura encadenando provincia → cantón
(dentro de la provincia) → distrito (dentro del cantón), y DEBE derivar la zona DEL DISTRITO.

**R18.** CUANDO el distrito de una fila no se encuentra dentro de su cantón, el sistema DEBE
marcar esa fila como error con el mensaje `distrito no encontrado en el canton` bajo la clave
`distrito`, carácter a carácter idéntico al que emite hoy la carga.

**R19.** CUANDO el distrito de una fila resuelve a más de un candidato dentro de su cantón, el
sistema DEBE marcar esa fila como error con el mensaje `distrito ambiguo en el canton` bajo la
clave `distrito`, carácter a carácter idéntico al de la carga.

**R20.** CUANDO el distrito de una fila existe pero no tiene zona asignada, el sistema DEBE
marcar esa fila como error con el mensaje `el distrito '<nombre>' no tiene zona asignada` bajo la
clave `distrito`, carácter a carácter idéntico al de la carga.

**R21.** CUANDO al menos una fila del lote no tiene cobertura o no pasa la validación de fila, el
sistema DEBE responder `200`, marcar esas filas como error y cotizar todas las demás (éxito
parcial, mismo comportamiento que la carga).

**R22.** SI una fila resulta en error, ENTONCES el sistema NO DEBE emitir ningún bloque de costos
para esa fila.

## 5. Los dos escenarios de costo

**R23.** Para cada fila con cobertura, el sistema DEBE emitir DOS escenarios de costo: el de
orden ENTREGADA y el de orden DEVUELTA.

**R24.** El sistema DEBE derivar ambos escenarios invocando DOS VECES la derivación de ingreso ya
existente, con el mismo input de fila y distinto resultado (`entregada` y `devuelta`), y NO DEBE
reimplementar ninguna de las fórmulas de flete, IVA ni comisión.

**R25.** El sistema DEBE elegir la columna de flete de la tarifa según el indicador de zona
central (`esCentral`) de la zona DEL DISTRITO DE ESA FILA, y no según ningún atributo del lote ni
de la tienda.

**R26.** El escenario ENTREGADO DEBE emitir exactamente cinco importes: `flete`, `iva` (IVA del
flete), `comision` (comisión COD), `ivaComision` (IVA de la comisión) y `total`.

**R27.** El escenario DEVUELTO DEBE emitir exactamente cuatro importes: `flete` (flete de
devolución), `iva` (IVA de ese flete), `comision` y `total`. NO DEBE emitir `ivaComision`.

**R28.** El sistema DEBE emitir `comision` del escenario DEVUELTO como un cero EXPLÍCITO. Ese
cero es la AFIRMACIÓN de que una devolución no cobra comisión COD (no hubo recaudo), no un dato
ausente: el campo NUNCA DEBE faltar ni valer `null`.

**R29.** El sistema DEBE asumir que la orden que se crearía cobra comisión (el mismo `default
true` de la columna `orden.cobra_comision`) y DEBE declarar ese supuesto en el contrato publicado
del endpoint.

**R30.** El sistema DEBE calcular `total` del escenario ENTREGADO como el monto a cobrar de la
fila menos la suma de los cuatro conceptos facturados (`flete + iva + comision + ivaComision`).
Es decir: lo que la TIENDA RECIBE. *(Decisión firmada D1, 2026-08-21.)*

**R31.** El sistema DEBE calcular `total` del escenario DEVUELTO como el negativo de la suma
`flete + iva`, de forma que sea NEGATIVO siempre que esos conceptos sean mayores que cero (la
tienda queda debiendo el flete de devolución). *(Decisión firmada D1, 2026-08-21.)*

**R32.** SI `monto_cobrar` viene vacío o ausente en una fila, ENTONCES el sistema DEBE tratar la
base de la comisión como cero, y el `total` del escenario ENTREGADO DEBE resultar negativo por el
importe de los conceptos facturados.

**R33.** El sistema DEBE realizar toda la aritmética de dinero con decimales exactos y NO DEBE
convertir ningún importe a número de punto flotante en ningún punto del cálculo.

## 6. Formato de los importes

**R34.** El sistema DEBE emitir cada importe SOLO en su forma formateada, y NO DEBE emitir además
su valor crudo de escala 2. *(Decisión firmada por el humano el 2026-08-21; no se reabre.)*

**R35.** El sistema DEBE formatear cada importe como: signo (si corresponde), símbolo de moneda,
parte entera agrupada de tres en tres, separador decimal y exactamente DOS dígitos decimales.

**R36.** El sistema DEBE tomar el símbolo, el separador de miles y el separador decimal de la
configuración de moneda, y NO DEBE escribir ninguno de esos tres caracteres literalmente en el
código del formateador.

**R37.** El sistema DEBE colocar el signo negativo DELANTE del símbolo de moneda.

**R38.** CUANDO el importe vale cero, el sistema DEBE emitirlo sin signo (nunca un "menos cero").

**R39.** El sistema DEBE aplicar el redondeo a escala 2 en la ARITMÉTICA y agrupar los miles
DESPUÉS, de forma que un acarreo que cambie el número de dígitos de la parte entera quede
correctamente agrupado.

**R40.** El formateador de importes de la cotización DEBE residir fuera de los árboles de
pantalla, y ningún fuente de esos árboles DEBE serializar importes de la cotización por su cuenta.

**R41.** El formateador de importes de la cotización DEBE quedar declarado como EXCEPCIÓN de
salida de máquina en la guardia del dinero sin céntimos (junto a la excepción ya existente de las
descargas XLSX/CSV), y NO DEBE ser consumido por ninguna pantalla.

**R42.** El sistema DEBE seguir cumpliendo, sin excepciones nuevas, la regla de que los CINCO
caminos públicos de presentación de dinero no emiten parte decimal.

## 7. Lectura pura

**R43.** El sistema NO DEBE persistir nada como consecuencia de una cotización: ni orden, ni fila
de lote de carga, ni historial de orden, ni movimiento de wallet, ni notificación.

**R44.** El sistema NO DEBE consumir ningún número de guía.

**R45.** El sistema NO DEBE registrar la cotización en ninguna tabla de auditoría.
*(Decisión firmada D3, 2026-08-21: lectura pura, sin rastro.)*

## 8. Respuesta y contrato publicado

**R46.** La respuesta DEBE incluir el total de filas recibidas, el número de filas cotizadas, el
número de filas con error y el detalle por fila con su índice 1-based dentro del array recibido.

**R47.** El endpoint DEBE quedar publicado en el objeto OpenAPI del canal por API key Y en su
espejo `.yaml`, con la misma ruta, en ambos artefactos.

**R48.** El endpoint NO DEBE requerir ninguna alta en la lista de rutas públicas del middleware
(el prefijo del canal por API key ya está declarado como ruta de autenticación propia).

**R49.** El sistema NUNCA DEBE registrar en logs la API key ni su hash, ni incluirlos en el
cuerpo de ninguna respuesta.

**R50.** El comportamiento y el contrato de `POST /api/ordenes/api-key/carga` DEBEN permanecer
sin cambios observables tras esta feature.

## 9. Totales del LOTE

*(Sección añadida por la decisión firmada D2, 2026-08-21: la respuesta cotiza POR FILA **y** POR
LOTE. El desglose por fila de §5 no cambia.)*

**R51.** Además del desglose por fila, la respuesta DEBE incluir un bloque de totales del LOTE con
los DOS escenarios (`entregado` y `devuelto`).

**R52.** Cada escenario del bloque de lote DEBE tener exactamente la MISMA forma que el escenario
homónimo de una fila: `entregado` con `flete`, `iva`, `comision`, `ivaComision` y `total`;
`devuelto` con `flete`, `iva`, `comision` y `total` (sin `ivaComision`), y todos los importes con
el mismo formato que los de fila.

**R53.** El bloque de lote DEBE sumar ÚNICAMENTE las filas cotizadas. Una fila marcada como error
NO DEBE aportar a ningún importe del lote.

**R54.** El bloque de lote DEBE declarar explícitamente CUÁNTAS filas sumó y CUÁNTAS quedaron
fuera, como dos contadores propios del bloque, y la suma de ambos DEBE ser igual al total de filas
recibidas. Un total que calla las filas excluidas se lee como "esto cuesta el lote" cuando no lo
es, y ese es un fallo silencioso de la misma familia que las features 248, 252 y 254.

**R55.** El sistema DEBE acumular los importes del lote en decimales exactos, sobre los valores de
cada fila ANTERIORES al formateo, y DEBE formatear cada importe del lote UNA sola vez, al final.
El sistema NUNCA DEBE sumar importes ya formateados ni re-parsear un importe formateado (símbolo,
separador de miles o separador decimal) para operar con él.

**R56.** CUANDO ninguna fila del lote resulta cotizable, el sistema DEBE emitir el bloque de lote
igualmente, con todos sus importes en cero, con el contador de filas sumadas en cero y con el
contador de filas excluidas igual al total de filas recibidas. El bloque NUNCA DEBE omitirse: el
cero es una AFIRMACIÓN ("el lote no cuesta nada porque no hay nada cotizable"), la ausencia sería
un dato que falta — mismo criterio que R28.

---

## Decisiones firmadas — puerta humana resuelta el 2026-08-21

Este bloque sustituye a las preguntas abiertas del borrador. **El reviewer no las reabre**; para
cambiar cualquiera de ellas hace falta otra puerta, no un commit.

**D1 (era Q1) — APROBADA la lectura de "tras descuentos".**
`entregado.total = monto_cobrar − (flete + iva + comision + ivaComision)` = lo que la TIENDA
RECIBE; `devuelto.total = −(flete + iva)` = la deuda de la tienda. Es la lectura que produce el
`-1578` del ejemplo del humano. Fija R30 y R31. **Invertir esos signos es un cambio de contrato,
no un ajuste.**

**D2 (era Q2) — APROBADO: por fila Y por lote.** La respuesta emite el desglose de cada fila y
ADEMÁS un bloque de totales del lote con los dos escenarios. Abre §9 (R51–R56), que cierra las
tres cosas que un total de lote arrastra: qué filas suma, cómo se suma y el borde del cero.

**D3 (era Q4) — APROBADO: lectura pura, sin rastro.** Fija R45. Auditar la cotización sería
persistir y contradice la premisa de la feature; si algún día se necesita, es otra ficha.

**D4 (era Q3) — APROBADO: sin límite de tasa propio.** La única cota es el tope de filas (R8).
Escrito para que no se relea como un olvido: el riesgo (borde barato que expone precios) se evaluó
y se aceptó; el único precedente del repo (`lib/config/rastreo-publico.ts`) limita **por IP** y
este borde se autentica **por key**, así que copiarlo no encajaba tal cual.

**D5 (era Q5) — APROBADO: `num_remision` opcional y sin dedupe.** Fija R9 y R10. Consecuencia
aceptada: este borde **NO comparte `filaCargaSchema`** con la carga, porque allí `num_remision` es
obligatorio.

**D6 (era Q6) — APROBADO: la 255 NO depende de la feature 70.** Define su propio criterio de
"tarifa cotizable" (`deleted_at IS NULL` + `status = 'activo'`, la más reciente) en un resolver
NUEVO, sin tocar el resolver compartido que la 70 tiene bajo gate. Fija R12. El argumento de por
qué filtrar `status` es seguro aquí y no lo era allí está en `design.md` §4.

**No quedan preguntas abiertas.** Los 56 requisitos son implementables tal como están escritos.
