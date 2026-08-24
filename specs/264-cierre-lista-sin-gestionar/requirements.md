# Feature 264 — El detalle del cierre lista las órdenes SIN GESTIONAR

> Requisitos en EARS. El **qué**, no el cómo: nombres de tablas, columnas, rutas y
> componentes viven en `design.md`.
>
> **Las ocho preguntas abiertas fueron resueltas por el humano el 2026-08-22.** Sus respuestas
> están aquí como requisitos (R27–R34) o, cuando la respuesta fue «fuera de alcance», en
> *Límites declarados*. No queda ninguna pregunta abierta.

## Contexto (lo que es cierto hoy, verificado en el código)

El detalle de un cierre se construye **entero sobre las gestiones** vinculadas a él
(`gestion_orden.cierre_id`), y sus pestañas son los cinco valores del enum
`gestion_resultado`. Una orden que el corte diario barrió a `sin_gestionar` **no tiene
gestión**: el corte solo le cambia el estatus dentro de la transacción que crea el cierre
`vencido` (`CierreDiaRepository.crearCierre`, bloque «corte sin gestionar»), y **no la
vincula al cierre por ningún lado**. La única relación entre las dos cosas es viva e
implícita —«las órdenes en `sin_gestionar` del mensajero de ese cierre»— y **se destruye al
aprobar**, porque la aprobación las libera a bodega y les borra `mensajero_asignado_id`.

De ahí el defecto reportado: el cierre `vencido` se crea *precisamente* por esas órdenes y
la pantalla esconde justo eso.

## Alcance

**Dentro:** el registro del vínculo en el momento del barrido, su lectura en el detalle de un
`cierre_dia`, y su pintado **en toda pantalla que renderice ese mismo comprobante detallado**
—hoy, la de cierres del admin (maestro / adminSatelite) y la del propio mensajero, que
comparten componente (R30)—.

**Fuera:** ver *Límites declarados*.

---

## Requisitos

### A. Registro del vínculo (de dónde salen)

- **R1.** El sistema DEBE conservar, para cada cierre, la lista de las órdenes que el corte
  diario barrió a `sin_gestionar` al crearlo.
- **R2.** CUANDO el corte diario crea un cierre y barre una o más órdenes a `sin_gestionar`,
  el sistema DEBE registrar el vínculo entre ese cierre y cada una de esas órdenes **dentro
  de la misma transacción** que las barre.
- **R3.** SI esa transacción se revierte, ENTONCES el sistema NO DEBE dejar ningún vínculo
  registrado para ese cierre.
- **R4.** CUANDO el corte registra el vínculo de una orden, el sistema DEBE guardar además
  **el estado del que esa orden salió**, tomado de la operación que la barre —que es el
  momento en que se conoce— y nunca supuesto.
- **R5.** MIENTRAS el cierre exista, el vínculo DEBE sobrevivir a la aprobación del cierre y
  a la liberación de sus órdenes a bodega: no se borra ni se reescribe.
- **R6.** CUANDO un mensajero solicita su cierre por el flujo normal (sin corte diario), el
  sistema NO DEBE registrar ningún vínculo de orden sin gestionar.

### B. Lectura y contrato

- **R7.** CUANDO se consulta el detalle de un cierre, el sistema DEBE devolver las órdenes
  sin gestionar vinculadas **a ese cierre y a ninguno otro**.
- **R8.** MIENTRAS el actor no tenga alcance sobre el cierre, el sistema NO DEBE devolver
  ninguna orden sin gestionar de ese cierre, con la misma respuesta indistinguible que el
  detalle ya da hoy fuera de alcance.
- **R9.** Cada orden sin gestionar DEBE viajar con: identificador de la orden, número de guía
  (o su ausencia explícita), número de remisión, destinatario, producto, nombre de la tienda,
  nombre de la zona y el estado del que salió (o su ausencia explícita).
- **R10.** Ninguna orden sin gestionar DEBE llevar monto cobrado, monto recibido, método de
  pago, pago al mensajero, ingreso de Ordenex, ingreso de bodega, indemnización, evidencia ni
  resultado de gestión.
- **R11.** Los datos descriptivos de una orden sin gestionar DEBEN ser los que eran ciertos
  cuando el corte la barrió, y NO los que la orden tenga hoy.
- **R12.** El sistema DEBE devolver esa lista en un orden estable y determinista entre dos
  lecturas del mismo cierre.

### C. Pantalla

- **R13.** CUANDO el detalle de un cierre se pinta y ese cierre tiene al menos una orden sin
  gestionar, el sistema DEBE mostrarlas en una **sección propia** del comprobante, fuera del
  grupo de pestañas por resultado.
- **R14.** El grupo de pestañas por resultado DEBE seguir teniendo exactamente **cinco**
  pestañas.
- **R15.** SI el cierre registró sus órdenes sin gestionar y no hubo ninguna, ENTONCES el
  detalle NO DEBE pintar la sección. *(El caso «no se registraban» NO cae aquí: lo gobierna
  R28.)*
- **R16.** La sección DEBE indicar cuántas órdenes contiene.
- **R17.** La sección DEBE llevar un texto que explique que son órdenes que el corte cerró
  **sin gestión** y que por eso no tienen dinero asociado.
- **R18.** La sección DEBE mostrar por fila la guía (o «—»), el destinatario, la remisión, el
  producto y la tienda, y NO DEBE mostrar columna de cobrado, de método de pago, de pago al
  mensajero, de ingreso ni de evidencia.

### D. Dinero — la restricción que no se puede fallar

- **R19.** El total recaudado y el número de entregas del pie del comprobante DEBEN ser los
  mismos con y sin órdenes sin gestionar en el cierre.
- **R20.** Los KPI y renglones de dinero del comprobante —total general, totales por método
  de pago, ingreso de Ordenex, pago al mensajero, ganancia, pago a la tienda e ingreso de
  bodega por rechazos— DEBEN ser los mismos con y sin órdenes sin gestionar en el cierre.
- **R21.** El KPI de conteo del comprobante DEBE contar únicamente las gestiones del cierre
  **y DEBE rotularse con lo que cuenta**, de modo que no contradiga al conteo de la sección
  de órdenes sin gestionar (R16). Dos números que se desmienten en la misma pantalla son un
  error de lectura garantizado.
- **R22.** CUANDO se aprueba un cierre que tiene órdenes sin gestionar registradas, el sistema
  DEBE producir exactamente los mismos movimientos de dinero que produciría el mismo cierre
  sin ellas.

### E. Datos y despliegue

- **R23.** La estructura de datos nueva DEBE quedar con seguridad a nivel de fila habilitada.
- **R24.** La estructura de datos nueva DEBE ser reversible: aplicarla y revertirla no DEBE
  perder ni alterar ningún dato preexistente.
- **R25.** CUANDO se aplique el cambio, el sistema DEBE poblar el vínculo de los cierres
  **abiertos** ya existentes (`solicitado`, `vencido`, `rechazado`) con las órdenes en
  `sin_gestionar` de su mensajero.
- **R26.** SI un cierre ya fue resuelto antes de este cambio, ENTONCES el sistema NO DEBE
  registrarle vínculos: no hay dato del que derivarlos y no se inventa ninguno.

### F. «Ninguna» y «no lo sabemos» son cosas distintas *(Q3)*

- **R27.** El sistema DEBE saber, por cada cierre, si sus órdenes sin gestionar llegaron a
  registrarse, con independencia de cuántas sean.
- **R28.** SI un cierre es anterior al registro, ENTONCES el detalle DEBE decirlo con un aviso
  explícito en el lugar de la sección, y NO DEBE presentarlo como un cierre sin órdenes sin
  gestionar. Una sección ausente o vacía en ese caso comunica «no hubo ninguna», que es
  **tranquilizador y falso**: es el mismo patrón de «parece verificado y no lo está» que esta
  sesión ya encontró cinco veces.
- **R29.** CUANDO se aplique el cambio, los cierres poblados por R25 DEBEN quedar marcados
  como registrados, y los ya resueltos, como anteriores al registro.

### G. Dónde se pinta, qué se puede hacer y qué no se esconde *(Q1, Q5, Q6, Q7)*

- **R30.** El sistema DEBE mostrar la sección en **toda** pantalla que renderice el
  comprobante detallado de un cierre, con los mismos datos y las mismas reglas. Un mismo
  componente NO DEBE pintarla en una pantalla y callarla en otra.
- **R31.** La sección NO DEBE ofrecer ninguna acción sobre esas órdenes: ni botones, ni
  enlaces, ni filas desplegables. Es una pantalla de consulta.
- **R32.** SI el estado del que salió una orden no se conoce, ENTONCES la fila NO DEBE pintar
  un marcador de ausencia en su lugar: la pieza se omite. Un «—» permanente es el mismo
  silencio ambiguo de R28 en pequeño.
- **R33.** CUANDO se pueble el vínculo de un cierre abierto ya existente (R25), el sistema
  DEBE recuperar el estado de origen del historial de esa orden si ahí consta, y dejarlo
  vacío únicamente cuando no conste.
- **R34.** El sistema DEBE mostrar **todas** las órdenes sin gestionar del cierre, sin
  recorte. SI alguna vez se aplicara un recorte, ENTONCES la pantalla DEBE decir cuántas no
  se muestran: una lista truncada en silencio se lee como una lista completa.

---

## Límites declarados (respuestas «fuera de alcance», con puntero)

1. **Detalle del cierre de BODEGA** *(Q2)*. `CierresBodegaAdminModule` **no** renderiza
   `CierreFacturaDetalle` —usa su propio detalle consolidado—, así que R30 no lo alcanza. Si
   se retoma: `lib/repositories/CierresBodegaAdminRepository.ts` y el módulo de
   `app/(app)/cierres-bodega-admin/`, agregando por los `cierre_dia` que consolida.
2. **Descargas de gestiones** *(Q8)*. Esos archivos salen de `gestion_orden`
   (`CierresAdminRepository.findGestionesPorAlcanceCompleto`, features 170/230) y **una orden
   sin gestión no tiene fila que emitir**. Incluirlas exigiría una segunda fuente y un
   contrato de columnas propio; queda fuera y con puntero.
