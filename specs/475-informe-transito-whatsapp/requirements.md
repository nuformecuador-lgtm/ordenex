# 475 — Informe de tránsito por WhatsApp — requirements

> Un informe más del catálogo de envíos automáticos de la 474 (`InformeWhatsapp<P>`,
> `lib/whatsapp-envios/informes/tipos.ts` en `origin/feature/474-envios-automaticos-whatsapp`).
> Lista los paquetes **sin cierre logístico** que **superan o están por superar su plazo**, con
> todos los umbrales parametrizables en el panel del informe. Maquetas aprobadas:
> `design-whatsapp/ParamsTransito.dc.html` (panel), `PdfTransito1.dc.html` y `PdfTransito2.dc.html` (PDF).
>
> Vocabulario de este documento:
> - **Cierre logístico**: estado actual `entregado` o `devuelta_a_tienda`.
> - **Estados ofrecidos**: los 20 estados vigentes (`ORDER_STATUS_SEED`) menos los dos de cierre logístico (18).
> - **Zona central / GAM**: la zona con `es_central = true`. **Fuera de la GAM**: cualquier otra.
> - **Hito**: el instante desde el que se cuentan los días (parámetro).
> - **Días**: días naturales del calendario de Costa Rica (America/Costa_Rica) entre la fecha del hito
>   y la fecha del momento de generación (`ahora` del contexto del informe).
> - **Umbral de alerta de una zona**: `plazo − aviso` de esa zona.
> - **En alerta**: paquete que entra en el informe (R9). Se divide en **vencido** y **por vencer** (R15).

## Catálogo y contrato

- **R1** — El sistema DEBE registrar en el catálogo de informes de envíos automáticos un informe de
  clave `transito` y nombre «Informe de tránsito», que genera documento, NO es apto para `adminTienda`,
  NO es solo por evento y no ofrece ningún evento.
- **R2** — El informe DEBE declarar exactamente estas variables, cada una con nombre, descripción y
  ejemplo no vacíos: `total_en_alerta`, `vencidos`, `por_vencer`, `parados`, `por_cobrar`,
  `en_alerta_gam`, `en_alerta_fuera_gam`, `fecha`; y la variable común `destinatario_nombre` DEBE
  seguir llegando por el motor de la 474 (el informe no la declara).

## Parámetros

- **R3** — El sistema DEBE aceptar como parámetros del informe: el hito (`entrada_bodega_central`,
  `creacion` o `generacion_guia`), una lista de plazos por zona identificada por `zona_id` (plazo y
  días de aviso), para cada estado ofrecido si entra y su umbral de «parado» en días (opcional), y
  «enviar aunque no haya nada que informar».
- **R4** — SI los parámetros traen un plazo que no es un entero entre 1 y 365, un aviso que no es un
  entero entre 0 y `plazo − 1`, un umbral de parado que no es un entero entre 0 y 90, una zona
  repetida, un estado que no es de los ofrecidos (incluidos `entregado`, `devuelta_a_tienda`, códigos
  retirados o desconocidos), un estado repetido, ningún estado incluido, un hito desconocido o un campo
  no declarado, ENTONCES el sistema DEBE rechazarlos con un error que nombre el campo.
- **R5** — El sistema DEBE ofrecer como valores de partida: hito `entrada_bodega_central`; todos los
  estados ofrecidos incluidos salvo `en_preparacion`, `por_recolectar_en_tienda` y `recolectando`;
  umbral de parado de 2 días para `en_bodega_central`, `en_ruta_bodega_satelite` y
  `en_bodega_satelite`, 3 para `reprogramado`, 1 para `novedad`, `novedad_interna` e `incidente` y sin
  umbral para el resto; ninguna zona con plazo propio; y «enviar aunque no haya nada que informar»
  desactivado.
- **R6** — El sistema DEBE usar como plazo y aviso de una zona los que los parámetros declaran para
  su `zona_id`; SI la zona no está en los parámetros, ENTONCES DEBE usar los de partida de su tipo:
  plazo 10 y aviso 2 para la zona central, plazo 20 y aviso 5 para las demás.
- **R7** — SI los parámetros declaran un `zona_id` que no existe en la base, ENTONCES el sistema DEBE
  ignorar esa entrada sin fallar la generación.

## Selección de paquetes

- **R8** — El sistema DEBE tomar la zona de un paquete de `orden.zona_id` y nunca de un texto de la
  dirección, del cantón o del distrito.
- **R9** — El sistema DEBE incluir en el informe una orden si y solo si: no está borrada, su estado
  actual es uno de los incluidos por los parámetros, no está en cierre logístico, tiene el hito
  elegido y sus días desde el hito son mayores o iguales que el umbral de alerta de su zona.
- **R10** — SI los parámetros recibidos por la consulta incluyeran `entregado` o `devuelta_a_tienda`,
  ENTONCES el sistema DEBE excluir igualmente las órdenes en esos estados.
- **R11** — MIENTRAS el hito sea `entrada_bodega_central`, el sistema DEBE tomar como instante del
  hito la PRIMERA transición del historial de estados de la orden cuyo destino es `en_bodega_central`.
- **R12** — MIENTRAS el hito sea `creacion`, el sistema DEBE tomar como instante del hito la creación
  de la orden.
- **R13** — MIENTRAS el hito sea `generacion_guia`, el sistema DEBE tomar como instante del hito, para
  una orden con número de guía, el más antiguo de: su transición de origen `generacion_guia`, su
  transición de creación cuando nació en `por_recolectar_en_tienda` (nace con guía) y su transición de
  origen `ruteo_satelite`.
- **R14** — SI una orden en un estado incluido no tiene el hito elegido, ENTONCES el sistema NO DEBE
  incluirla en el informe y DEBE contarla como «sin el momento de inicio», cifra que el PDF y la vista
  previa del panel muestran.
- **R15** — El sistema DEBE clasificar como **vencido** un paquete en alerta cuyos días superan el
  plazo de su zona, y como **por vencer** uno cuyos días están entre el umbral de alerta y el plazo,
  ambos inclusive.
- **R16** — El sistema DEBE marcar como **parado** un paquete en alerta cuyo estado actual tiene umbral
  de parado y cuyos días naturales desde su última transición de estado superan ese umbral; SI el
  estado no tiene umbral o la orden no tiene transiciones, ENTONCES NO DEBE marcarlo como parado.
- **R17** — El sistema DEBE calcular toda fecha y todo conteo de días en el calendario de Costa Rica,
  de modo que el cambio de día ocurra a las 00:00 de Costa Rica (06:00 UTC).

## Resultado del informe

- **R18** — CUANDO no haya ningún paquete en alerta y «enviar aunque no haya nada que informar» esté
  desactivado, el informe DEBE responder «vacío» con un motivo legible.
- **R19** — CUANDO no haya ningún paquete en alerta y «enviar aunque no haya nada que informar» esté
  activado, el informe DEBE responder contenido con todos los conteos a `0`, `por_cobrar` a cero en
  el formato de moneda y, si la plantilla lleva documento, un PDF que diga que no hay paquetes en alerta.
- **R20** — CUANDO haya paquetes en alerta, el informe DEBE devolver: `total_en_alerta` = vencidos +
  por vencer; `vencidos`; `por_vencer`; `parados`; `por_cobrar` = suma de `monto_cobrar` de los
  paquetes en alerta (sin monto cuenta 0) con el formato de moneda configurado; `en_alerta_gam` y
  `en_alerta_fuera_gam` = paquetes en alerta de la zona central y del resto; `fecha` = fecha de
  generación `DD/MM/YYYY` de Costa Rica.
- **R21** — SI la plantilla del envío no lleva documento, ENTONCES el informe NO DEBE generar el PDF.
- **R22** — SI la lectura de datos falla, ENTONCES el informe DEBE propagar el error con el nombre de
  la operación y NO DEBE responder «vacío» ni contenido parcial.

## PDF

- **R23** — El PDF DEBE ser A4 vertical y empezar con: título «Informe de tránsito», fecha larga y
  hora de generación de Costa Rica, el hito usado en palabras y cuatro totales: vencidos, por vencer,
  parados y por cobrar.
- **R24** — DONDE haya paquetes parados, el PDF DEBE incluir, tras los totales, un bloque «ATENCIÓN»
  con los parados agrupados por estado en el orden del flujo, cada grupo con su umbral y cada fila con
  guía, zona, días en el estado y días totales; SI no hay parados, ENTONCES el bloque NO DEBE dibujarse.
- **R25** — El PDF DEBE incluir una tabla por zona con paquetes en alerta: primero la zona central, y
  las demás bajo un encabezado «fuera de la GAM» ordenadas por número de paquetes descendente, después
  por el mayor número de días descendente y después por nombre. Cada zona DEBE mostrar su plazo, el día
  en que se entra en alerta, su número de paquetes y su total por cobrar.
- **R26** — Cada fila de una tabla de zona DEBE mostrar: remisión, guía («—» si no tiene), días como
  «N/plazo», nombre visible del estado (el del catálogo de estados), nombre del cliente, cantón y
  distrito, y por cobrar («—» si no tiene monto o es 0); las filas DEBEN ir por días descendente y, a
  igualdad, por guía ascendente.
- **R27** — El PDF DEBE marcar cada paquete vencido con el texto «VENCIDO» y cada parado con el texto
  «PARADO», además de cualquier color.
- **R28** — DONDE haya zonas sin paquetes en alerta, el PDF DEBE listarlas por nombre bajo «Sin
  paquetes en alerta».
- **R29** — El PDF DEBE cerrar con un resumen de los parámetros usados (plazo y aviso por zona,
  umbrales de parado, hito y número de paquetes sin el momento de inicio) y llevar en cada página un
  pie con fecha y hora de generación y «Página X de Y».
- **R30** — El PDF NO DEBE contener teléfono, dirección, correo, notas, producto, tienda, mensajero ni
  identificadores internos de ninguna orden o usuario.
- **R31** — CUANDO una tabla no quepa en una página, el PDF DEBE continuarla en la siguiente
  repitiendo su cabecera, sin perder ni duplicar ninguna fila.
- **R32** — El PDF DEBE mostrar el símbolo de la moneda configurada en los importes.
- **R33** — El archivo DEBE llamarse `transito-YYYY-MM-DD.pdf`, con la fecha de generación de Costa Rica.

## Panel de parámetros

- **R34** — CUANDO el maestro elija el informe de tránsito en el formulario de un envío, el sistema
  DEBE mostrar el panel de la maqueta: tabla con todas las zonas reales (plazo, aviso y «entra en
  alerta el día N» calculado), las tres opciones de hito, la lista de estados ofrecidos con su casilla
  y su umbral de parado, y la aclaración de que los estados con cierre logístico nunca entran.
- **R35** — El panel DEBE mostrar cada zona sin plazo propio con los valores de partida de su tipo y,
  al guardar, DEBE enviar una entrada por cada zona mostrada.
- **R36** — CUANDO el maestro pulse «Volver a los valores de partida», el panel DEBE restablecer hito,
  plazos de todas las zonas, estados incluidos y umbrales a los de partida.
- **R37** — MIENTRAS un estado no esté incluido, el panel DEBE mostrarlo como «no entra» y no permitir
  editar su umbral.
- **R38** — CUANDO los parámetros del panel cambien y sean válidos, el sistema DEBE mostrar cuántos
  paquetes entrarían hoy, cuántos de ellos están parados y cuántos no tienen el momento de inicio; SI
  son inválidos, ENTONCES DEBE mostrar el error por campo y no mostrar el conteo.
- **R39** — La vista previa del panel DEBE estar disponible solo para el rol `maestro`, NO DEBE
  escribir nada en la base y DEBE contar con la misma selección que usa el informe.

## Rendimiento

- **R40** — El sistema DEBE resolver la selección de una generación con un número de consultas a la
  base que no dependa del número de órdenes, filtrando en la base de modo que solo vuelvan las órdenes
  en alerta.

## Preguntas abiertas

Decididas en este spec con un valor por defecto; el humano las confirma o las cambia al aprobar.

1. **Zona nueva (R6/R35).** La maqueta dice «Una zona nueva aparece aquí con los valores de la GAM».
   Con los valores de partida pedidos (GAM 10/2, fuera 20/5) eso daría plazo 10 a una zona fuera de la
   GAM. Este spec usa **la partida de su tipo** (fuera de la GAM → 20/5) y cambia ese texto del panel
   a «con los valores de partida de su tipo». ¿Conforme, o una zona nueva debe copiar los valores
   actuales de la GAM?
2. **Estados ofrecidos que la maqueta no pinta (R5).** La maqueta no lista
   `devolucion_a_origen_por_rechazo`, `devolviendo_a_bodega_central`, `por_devolver_a_tienda` ni
   `devolviendo_a_tienda`. No tienen cierre logístico, así que este spec los ofrece e **incluye por
   defecto** (sin umbral de parado), conforme a «partida: todos los no terminales». ¿Conforme?
3. **`incidente` (R5).** El código lo clasifica como terminal (`ESTADOS_TERMINALES`), pero la maqueta lo
   incluye con umbral de 1 día. Este spec sigue la maqueta: **entra por defecto** porque no es cierre
   logístico (el paquete no llegó ni volvió). ¿Conforme?
