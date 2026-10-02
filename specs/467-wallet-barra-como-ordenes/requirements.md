# Ficha 467 — Requisitos

**Barra del libro de la wallet igual a la de órdenes.**

## De qué va, en una línea

La 463 dejó dos zonas de filtros en cada wallet: una tarjeta arriba («Estos filtros cambian toda la
wallet», con Periodo, «Aplicar» y «A quién») y, junto al libro, controles sueltos (orden con texto,
Todo/Entra/Sale, un `Select` de categorías y un buscador estrecho). El humano (2026-10-02): *«estás
combinando cosas muy mal… compárala con los filtros que pusiste… reutiliza los componentes»*. La
referencia es la barra de `/ordenes`: una sola línea con el orden en iconos, el buscador ancho, el botón
**«Filtros»** con casillas (cada casilla monta su filtro), **Descargar** y el botón de **columnas**.

## Decisiones del humano (no se reabren)

1. **Una sola barra**, encima del libro, al estilo de órdenes.
2. En la caja, «Filtros» ofrece las casillas **Periodo, A quién, Entra/Sale y Concepto**.
3. Desaparecen la tarjeta de filtros de arriba (alcance, Periodo, «Aplicar», «A quién») y los controles
   sueltos del libro (orden con texto, Todo/Entra/Sale, `Select` de categorías, textos de zona).
4. **Periodo y A quién siguen moviendo también las cifras** de la caja (resumen, composición,
   desglose); Entra/Sale, Concepto y el buscador mueven **solo el libro**.
5. Vale por igual para la caja (`/wallet`) y para los estados de cuenta (tienda, mensajero, bodega
   satélite y `/mi-wallet`), respetando lo que cada superficie ya ofrece.
6. Solo componentes compartidos existentes; si a uno le falta algo, se extiende ese.

## Vocabulario

- **Superficie:** la caja (`/wallet`) o uno de los cuatro estados de cuenta
  (`/wallet/tiendas/[tiendaId]`, `/wallet/mensajeros/[mensajeroId]`, `/wallet/satelites/[zonaId]`,
  `/mi-wallet`).
- **Barra:** la fila de filtros que esta ficha deja encima de la tabla del libro de cada superficie.
- **Casilla:** cada entrada del selector «Filtros». Marcarla monta su control en la barra.
- **Filtros de la wallet:** Periodo y, en la caja, A quién. **Filtros del libro:** todo lo demás
  (Entra/Sale, Concepto, Tipo de movimiento, Cierre, término de búsqueda y orden).
- **Cifras:** en la caja, la tarjeta del resumen, la composición de la ganancia y el desglose de
  egresos; en un estado de cuenta, las tarjetas de saldo inicial, abonos, cargos y saldo final.
- **Tipo de movimiento:** el filtro que hoy son los chips del estado de cuenta (Cierres, Pagos, Cobros,
  Premios, Correcciones, Declarado, Recibido, según el tipo de cuenta).

## Requisitos

### A. Una sola barra

- **R1** (ubicuo) — Cada superficie DEBE presentar una única barra de filtros, situada dentro del bloque
  del libro y encima de su tabla, y NO DEBE presentar ningún otro control de filtro (ni antes de las
  cifras ni suelto en el bloque del libro).
- **R2** (ubicuo) — La barra DEBE presentar, de izquierda a derecha: el control de orden, los controles
  de las casillas marcadas, el buscador, el botón «Filtros» y, cuando corresponda, «Limpiar todo»; y en
  la misma fila de la cabecera de la tabla, a continuación de la barra, el botón «Descargar» y el botón
  de columnas.
- **R3** (ubicuo) — La barra NO DEBE mostrar textos de alcance («Estos filtros cambian toda la wallet»,
  «Estos filtros solo afectan al libro de movimientos») ni los botones «Aplicar» o «Quitar periodo».
- **R4** (ubicuo) — El control de orden DEBE ser un conmutador de dos botones que solo muestran icono,
  «Más recientes» y «Más antiguas», con esa etiqueta como nombre accesible y como texto emergente, y con
  los mismos iconos que la dirección por fecha de `/ordenes`.
- **R5** (de estado) — MIENTRAS ninguna casilla esté marcada, en una ventana de 1440 px de ancho la
  barra, «Descargar» y el botón de columnas DEBEN caber en una sola línea, y el buscador DEBE ocupar
  todo el ancho que dejan libre los demás controles.
- **R6** (opcional) — DONDE la superficie sea la caja, «Filtros» DEBE ofrecer exactamente las casillas
  «Periodo», «A quién», «Entra/Sale» y «Concepto», en ese orden.
- **R7** (opcional) — DONDE la superficie sea un estado de cuenta, «Filtros» DEBE ofrecer las casillas
  «Periodo» y «Tipo de movimiento» y, solo donde la superficie ofrece hoy el filtro por cierre (tienda,
  mensajero y `/mi-wallet`), la casilla «Cierre»; y ninguna otra.
- **R8** (por evento) — CUANDO el usuario marca una casilla, el sistema DEBE montar su control en la
  barra, delante del buscador, y NO DEBE hacer ninguna lectura al servidor de cifras ni de libro.
- **R9** (ubicuo) — Los controles montados DEBEN aparecer en el orden de la lista de casillas, sea cual
  sea el orden en que se marcaron.
- **R10** (por evento) — CUANDO el usuario desmarca una casilla cuyo filtro tiene un valor, el sistema
  DEBE quitar ese filtro con el mismo efecto sobre cifras y libro que tendría vaciarlo (R12–R15), con
  una sola recarga.
- **R11** (por evento) — CUANDO el usuario entra a una superficie, la barra DEBE tener todas las
  casillas desmarcadas, el buscador vacío y el orden en «Más recientes».

### B. Qué mueve cada filtro

- **R12** (por evento) — CUANDO cambia el Periodo o «A quién» de la caja, el sistema DEBE recalcular
  las cifras y el libro con esos filtros, y DEBE mostrar la página 1 del libro.
- **R13** (por evento) — CUANDO cambian Entra/Sale, Concepto, el término o el orden de la caja, el
  sistema DEBE releer solo el libro (página 1) y NO DEBE pedir ni modificar las cifras.
- **R14** (por evento) — CUANDO cambia el Periodo de un estado de cuenta, el sistema DEBE recalcular las
  tarjetas y el libro con ese periodo, y DEBE mostrar la página 1.
- **R15** (por evento) — CUANDO cambian el Tipo de movimiento, el Cierre, el término o el orden de un
  estado de cuenta, las tarjetas NO DEBEN cambiar y el libro DEBE mostrar la página 1.
- **R16** (ubicuo) — Las cifras de la caja y el detalle de una fila de la composición DEBEN calcularse
  solo con el Periodo y «A quién».

### C. Cada control

- **R17** (por evento) — CUANDO el usuario fija un rango en el control de Periodo, el sistema DEBE
  aplicarlo sin ningún botón de confirmación, tras la espera estándar de los filtros de la app; un rango
  de un solo día DEBE ser válido.
- **R18** (opcional) — DONDE la superficie sea la caja, el control de «A quién» DEBE buscar en el
  servidor, ofrecer solo opciones con movimientos en el Periodo aplicado y aplicarse al elegir una
  opción.
- **R19** (opcional) — DONDE la superficie sea la caja, el control de Entra/Sale DEBE ofrecer «Entra» y
  «Sale»; sin elección, el libro DEBE incluir los dos sentidos.
- **R20** (opcional) — DONDE la superficie sea la caja, el control de Concepto DEBE ofrecer los
  conceptos con movimientos bajo el Periodo, «A quién» y Entra/Sale aplicados, cada uno con su número de
  movimientos; el concepto elegido DEBE seguir ofrecido aunque su número pase a 0.
- **R21** (opcional) — DONDE la superficie sea un estado de cuenta, el control de Tipo de movimiento
  DEBE ofrecer los mismos tipos que hoy ofrecen los chips para ese tipo de cuenta; sin elección, el
  libro DEBE incluir todos.
- **R22** (opcional) — DONDE la superficie ofrezca el filtro por cierre, el control de Cierre DEBE
  ofrecer las mismas opciones y los mismos avisos (sin cierres, no disponible, solo los más recientes)
  que hoy.
- **R23** (ubicuo) — Cada control montado DEBE mostrar su nombre visible dentro de su propio disparador
  (p. ej. «Concepto: Todos») y DEBE tener la misma altura que el buscador.
- **R24** (ubicuo) — El buscador DEBE ser el buscador compartido de la app, DEBE empezar a filtrar con 3
  caracteres avisando de cuántos faltan, y DEBE buscar en los mismos campos que hoy en cada superficie.

### D. Limpiar todo

- **R25** (por evento) — CUANDO el usuario pulsa «Limpiar todo», el sistema DEBE vaciar el término,
  quitar el valor de todos los filtros y desmarcar todas las casillas, y NO DEBE cambiar el orden; en la
  caja, si había Periodo o «A quién», DEBE recalcular cifras y libro (R12) con una sola recarga, y si no,
  solo el libro.
- **R26** (de estado) — MIENTRAS el buscador esté vacío y no haya ninguna casilla marcada, «Limpiar
  todo» NO DEBE mostrarse.

### E. Coherencia de lo que se ve

- **R27** (ubicuo) — Todo filtro aplicado DEBE tener su casilla marcada y su control mostrando el valor
  aplicado: la pantalla NO DEBE filtrar por algo que no se ve.
- **R28** (si/entonces) — SI una lectura falla o no responde, ENTONCES el sistema DEBE avisar en español,
  conservar en pantalla las cifras y el libro de la última lectura buena, y devolver los controles, el
  término y las casillas a la selección de esa lectura.
- **R29** (de estado) — MIENTRAS una lectura está en curso, ningún control de la barra DEBE
  deshabilitarse, y solo la respuesta de la última selección pedida DEBE pintarse.
- **R30** (ubicuo) — La barra NO DEBE leer filtros de la URL al entrar ni escribirlos en ella.

### F. Descarga

- **R31** (por evento) — CUANDO el usuario descarga el libro de cualquier superficie, el archivo DEBE
  contener el conjunto completo con todos los filtros aplicados, el término y el orden vigentes, con las
  mismas opciones de descarga que hoy.

### G. Componentes

- **R32** (ubicuo) — La barra de cada superficie NO DEBE montar controles de filtro propios de la
  superficie: solo el buscador compartido, el orquestador de filtros compartido, el conmutador
  segmentado compartido y el selector con búsqueda compartido.
- **R33** (ubicuo) — Los demás consumidores del orquestador de filtros, del buscador compartido, del
  conmutador segmentado y del selector con búsqueda DEBEN conservar exactamente su comportamiento y su
  aspecto actuales.

### H. Regresión, textos y ayuda

- **R34** (por evento) — CUANDO el usuario entra a la caja sin tocar la barra, las cifras y la página 1
  del libro DEBEN ser las mismas que antes de esta ficha.
- **R35** (por evento) — CUANDO el usuario entra a un estado de cuenta sin tocar la barra, las tarjetas y
  la página 1 del libro DEBEN ser las mismas que antes de esta ficha.
- **R36** (ubicuo) — Los textos visibles y los nombres accesibles nuevos DEBEN estar en español claro y
  NO DEBEN usar la sigla «SLA» ni jerga técnica.
- **R37** (ubicuo) — La ayuda en pantalla de la caja, de los estados de cuenta de tiendas, mensajeros y
  satélites, y de `/mi-wallet` NO DEBE mencionar «Aplicar», «Quitar periodo» ni las dos zonas de
  filtros, y DEBE describir el botón «Filtros» con las casillas de esa superficie.

## Fuera de alcance

- Cualquier cambio de servidor: los contratos de la 463 (`q`, `sortBy`/`sortDir`, esquemas separados de
  libro y cifras) y de la 464 (descarga con detalle) se conservan tal cual.
- Vistas guardadas (ficha 453) en las wallets: el control de «Vistas» de `/ordenes` no se monta aquí.
- El Excel kardex (ficha 468).
- Los listados `/wallet/tiendas`, `/wallet/mensajeros` y `/wallet/satelites`.

## Preguntas abiertas (dependen del humano; ninguna bloquea la implementación)

1. **Entra/Sale en los estados de cuenta.** Hoy no existe (los chips separan por tipo) y el borde no
   sabe filtrar abonos de cargos. Añadir una casilla «Abonos/Cargos» exigiría tocar el servidor y
   pasaría la ficha a `fullstack`. **Propuesta:** no se añade; R7 deja las casillas que la superficie ya
   ofrece. ¿Se quiere?
2. **Campo de orden.** Órdenes tiene dos conmutadores (campo y dirección) porque ordena por fecha o por
   remisión. El libro solo sabe ordenar por fecha, así que la barra lleva **solo el de dirección** (un
   conmutador de campo con una única opción sería un botón que no hace nada). Ordenar por importe
   exigiría servidor. ¿Basta con la fecha?
3. **El Periodo se aplica solo, sin «Aplicar»** (como la fecha en `/ordenes`). Coste conocido: si entre
   el primer y el segundo clic del calendario pasa más de medio segundo, las cifras se recalculan una vez
   con el rango de un día y enseguida con el rango completo (sin mezcla: se pinta solo la última
   lectura). **Propuesta:** se acepta por coherencia con órdenes. ¿Conforme?

## Aprobación

Aprobado por el humano el 2026-10-02 con las propuestas por defecto de las preguntas abiertas: sin Entra/Sale en los estados de cuenta (queda para otra ficha) y periodo sin «Aplicar».
