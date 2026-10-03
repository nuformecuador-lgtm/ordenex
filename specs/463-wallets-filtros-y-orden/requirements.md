# Ficha 463 — Requisitos

**Wallets: buscador y filtros canónicos en dos niveles, con selector de orden.**

## De qué va, en una línea

Hoy los filtros del libro de la caja mueven TODA la wallet (cifras, composición, desglose y libro) y
viven al final de la página, dentro de la tarjeta del libro. El humano pidió el 2026-10-01: separar
**lo que mueve toda la wallet** (arriba, antes de las cifras) de **lo que solo filtra el libro**
(junto al libro), usar en todas las wallets el **buscador y los filtros canónicos** de la app, y que
el libro **se pueda ordenar como la tabla de órdenes**, por defecto **lo más nuevo primero**.

## Decisiones de partida (del leader, revisables al aprobar este spec)

1. **Zona de la wallet (arriba):** el periodo (Desde/Hasta) y, en la caja, «A quién».
2. **Zona del libro (junto al libro):** Entra/Sale, categoría, buscador de texto y orden.
3. La zona de la wallet se aplica con un botón **«Aplicar»**, porque cada lectura recalcula
   agregados de dinero. Eso exige el modo «Aplicar» de `FilterComponent` (hueco 2 de la ficha 328).
4. La descarga actual respeta los filtros y el orden nuevos. Rehacer la descarga (columnas a elegir,
   detalle por orden) es la ficha 464 y **no** entra aquí.

## Vocabulario

- **Superficie de wallet con libro:** la caja (`/wallet`), el estado de cuenta de una tienda
  (`/wallet/tiendas/[tiendaId]`), de un mensajero (`/wallet/mensajeros/[mensajeroId]`), de una
  bodega satélite (`/wallet/satelites/[zonaId]`) y el de la propia tienda (`/mi-wallet`).
- **Estado de cuenta:** las cuatro últimas, que comparten un único componente de pantalla.
- **Cifras de la wallet:** en la caja, la tarjeta del resumen, la composición de la ganancia y el
  desglose de egresos; en un estado de cuenta, las tarjetas de saldo inicial, abonos, cargos y saldo
  final del periodo.
- **Zona de la wallet / zona del libro:** los dos grupos de filtros que define esta ficha.
- **Término:** el texto escrito en el buscador del libro, recortado en los extremos.
- **Orden vigente:** «Más recientes» (fecha del movimiento descendente) o «Más antiguas»
  (ascendente).

## Requisitos

### A. Dos niveles de filtros

- **R1** (ubicuo) — Cada superficie de wallet con libro DEBE presentar dos zonas de filtros
  separadas y con nombre accesible propio: la zona de la wallet, situada antes de las cifras de la
  wallet, y la zona del libro, situada dentro del bloque del libro y encima de su tabla.
- **R2** (ubicuo) — Cada zona DEBE mostrar un texto visible y breve que diga su alcance: la zona de
  la wallet, que afecta a toda la wallet; la zona del libro, que solo filtra el libro.
- **R3** (opcional) — DONDE la superficie sea la caja, la zona de la wallet DEBE contener el periodo
  (Desde/Hasta) y «A quién», y ningún otro filtro.
- **R4** (opcional) — DONDE la superficie sea un estado de cuenta, la zona de la wallet DEBE contener
  el periodo (Desde/Hasta) y ningún otro filtro.
- **R5** (opcional) — DONDE la superficie sea la caja, la zona del libro DEBE contener el buscador, el
  control de orden, el filtro Todo/Entra/Sale y el filtro de categoría.
- **R6** (opcional) — DONDE la superficie sea un estado de cuenta, la zona del libro DEBE contener el
  buscador, el control de orden y el filtro por tipo de movimiento (los chips actuales: Cierres,
  Pagos, Cobros, Premios, Correcciones, Declarado, Recibido, según el tipo de cuenta).
- **R7** (opcional) — DONDE la superficie de estado de cuenta ofrezca hoy el filtro por cierre
  (tienda, mensajero y `/mi-wallet`), ese filtro DEBE estar en la zona del libro.
- **R8** (por evento) — CUANDO el usuario aplica un cambio en la zona de la wallet de la caja, el
  sistema DEBE recalcular las cifras de la wallet y el libro con los filtros de la zona de la wallet
  aplicados, y DEBE mostrar la página 1 del libro.
- **R9** (por evento) — CUANDO el usuario cambia un filtro, el término o el orden de la zona del
  libro de la caja, el sistema DEBE releer solo el libro y su total, y NO DEBE volver a pedir ni
  modificar las cifras de la wallet.
- **R10** (por evento) — CUANDO el usuario aplica un periodo en un estado de cuenta, el sistema DEBE
  recalcular las tarjetas del periodo y el libro, y DEBE mostrar la página 1.
- **R11** (por evento) — CUANDO el usuario cambia un filtro, el término o el orden de la zona del
  libro de un estado de cuenta, las tarjetas del periodo NO DEBEN cambiar.
- **R12** (ubicuo) — Las cifras de la wallet de la caja (resumen, composición y desglose) y el detalle
  de una fila de la composición DEBEN calcularse SOLO con los filtros de la zona de la wallet.
- **R13** (ubicuo) — Las opciones del filtro de categoría de la caja DEBEN ser los conceptos con
  movimientos bajo el periodo y «A quién» aplicados y la selección Todo/Entra/Sale vigente, cada una
  con su número de movimientos.
- **R14** (si/entonces) — SI el borde de las cifras de la caja (resumen, desglose o detalle de una
  fila de la composición) recibe el término o el orden, ENTONCES DEBE responder `validation_error`
  sin leer ningún dato.

### B. La zona de la wallet se aplica con «Aplicar»

- **R15** (de estado) — MIENTRAS el usuario edita el periodo sin pulsar «Aplicar», el sistema NO DEBE
  hacer ninguna lectura al servidor.
- **R16** (por evento) — CUANDO el usuario pulsa «Aplicar» con un periodo válido distinto del
  aplicado, el sistema DEBE hacer exactamente una recarga de la superficie con ese periodo.
- **R17** (de estado) — MIENTRAS el periodo editado sea igual al aplicado, «Aplicar» DEBE estar
  deshabilitado.
- **R18** (si/entonces) — SI «Desde» es posterior a «Hasta», ENTONCES el sistema NO DEBE leer, DEBE
  deshabilitar «Aplicar» y DEBE mostrar un aviso en español que diga que «Desde» no puede ser
  posterior a «Hasta».
- **R19** (por evento) — CUANDO el usuario quita el periodo aplicado, el sistema DEBE volver a la
  wallet sin periodo, releer la superficie y conservar los filtros, el término y el orden de la zona
  del libro.
- **R20** (por evento) — CUANDO el usuario elige o quita «A quién» en la caja, el sistema DEBE aplicar
  el cambio en el acto (sin «Aplicar»), con el mismo efecto que R8.
- **R21** (opcional) — DONDE un consumidor de `FilterComponent` active el modo «Aplicar», el
  componente DEBE emitir la selección solo al pulsar «Aplicar» y NO DEBE emitir mientras se editan los
  controles.
- **R22** (ubicuo) — Un consumidor de `FilterComponent` que no active el modo «Aplicar» DEBE recibir
  exactamente las mismas emisiones que antes de esta ficha.

### C. Buscador del libro (canónico)

- **R23** (ubicuo) — La zona del libro de cada superficie DEBE usar el buscador compartido de la app
  (`BuscadorFiltros`), con un texto de ejemplo que enumere qué se puede buscar.
- **R24** (por evento) — CUANDO el término alcanza al menos 3 caracteres, el libro DEBE mostrar solo
  los movimientos cuyo texto buscable contiene el término, sin distinguir mayúsculas de minúsculas;
  por debajo de 3 caracteres el libro NO DEBE filtrarse por texto y el campo DEBE avisar de cuántos
  caracteres faltan.
- **R25** (opcional) — DONDE la superficie sea la caja, el texto buscable de un movimiento DEBE ser su
  descripción, el nombre y la referencia anotados y el nombre de quien lo registró.
- **R26** (opcional) — DONDE la superficie sea un estado de cuenta de la oficina, el texto buscable de
  una fila DEBE ser su descripción y el nombre de quien la registró.
- **R27** (opcional) — DONDE la superficie sea `/mi-wallet`, el texto buscable DEBE ser solo la
  descripción: buscar el nombre de una persona de Ordenex NO DEBE reducir ni ampliar el resultado.
- **R28** (ubicuo) — Los caracteres `%` y `_` del término DEBEN buscarse como texto literal.
- **R29** (por evento) — CUANDO cambian el término o un filtro de la zona del libro, el sistema DEBE
  mostrar la página 1 del libro.
- **R30** (por evento) — CUANDO el usuario pulsa «Limpiar todo» en la zona del libro, el sistema DEBE
  vaciar el término y quitar los filtros de la zona del libro, y NO DEBE cambiar ni el periodo ni «A
  quién» ni el orden.
- **R31** (ubicuo) — Ninguna de las dos zonas DEBE leer filtros de la URL al entrar ni escribirlos en
  ella.
- **R32** (de estado) — MIENTRAS una lectura del libro está en curso, el campo del buscador NO DEBE
  deshabilitarse (no se pierden teclas).

### D. Orden del libro

- **R33** (ubicuo) — La zona del libro de cada superficie DEBE mostrar, siempre a la vista y sin
  desplegar nada, un control de orden con dos opciones: «Más recientes» y «Más antiguas».
- **R34** (por evento) — CUANDO el usuario entra a cualquier superficie de wallet con libro, el libro
  DEBE estar ordenado por «Más recientes» y el control DEBE mostrarlo elegido.
- **R35** (por evento) — CUANDO el usuario cambia el orden, el servidor DEBE devolver la página 1 del
  conjunto filtrado COMPLETO en ese orden (no la página en pantalla reordenada).
- **R36** (ubicuo) — El orden DEBE ser total en los dos sentidos: recorriendo todas las páginas de un
  conjunto, cada movimiento DEBE aparecer exactamente una vez, también cuando varios movimientos
  comparten fecha.
- **R37** (ubicuo) — En un estado de cuenta, el saldo corrido de cada fila DEBE ser el mismo en los dos
  sentidos del orden.
- **R38** (de estado) — MIENTRAS el orden de un estado de cuenta sea «Más antiguas», la línea del saldo
  inicial DEBE ser la primera de la página 1.
- **R39** (de estado) — MIENTRAS el orden de un estado de cuenta sea «Más recientes», la línea del saldo
  inicial DEBE ser la última de la última página, y NO DEBE aparecer en ninguna otra página.
- **R40** (si/entonces) — SI un borde del libro recibe una dirección distinta de `asc`/`desc` o un
  campo de orden no admitido, ENTONCES DEBE responder `validation_error` sin devolver filas.
- **R41** (ubicuo) — Dos lecturas del libro que difieran solo en el término o en el orden NO DEBEN
  compartir la misma entrada de caché.

### E. Descarga

- **R42** (por evento) — CUANDO el usuario descarga el libro de la caja, el archivo DEBE contener el
  conjunto completo con los filtros de las dos zonas, el término y el orden vigentes.
- **R43** (por evento) — CUANDO el usuario descarga un estado de cuenta, el archivo DEBE contener el
  conjunto completo con el periodo, los filtros de la zona del libro, el término y el orden vigentes;
  la línea del saldo inicial DEBE ser la primera fila con «Más antiguas» y la última con «Más
  recientes».
- **R44** (si/entonces) — SI el conjunto a descargar supera el tope de descarga vigente, ENTONCES el
  sistema DEBE comportarse como hoy (sin archivo y con el aviso existente).

### F. Listado de tiendas

- **R45** (opcional) — DONDE la superficie sea el listado `/wallet/tiendas`, el sistema DEBE ofrecer el
  buscador compartido por nombre de tienda, resuelto en el servidor, que vuelve a la página 1 al
  cambiar el término y cuyo término viaja también a la descarga.

### G. Regresión y textos

- **R46** (por evento) — CUANDO el usuario entra a la caja sin tocar ningún filtro, las cifras de la
  wallet y la página 1 del libro DEBEN ser las mismas que antes de esta ficha.
- **R47** (por evento) — CUANDO el usuario entra a un estado de cuenta sin tocar ningún filtro, las
  tarjetas DEBEN ser las mismas que antes de esta ficha y el libro DEBE llegar en «Más recientes».
- **R48** (ubicuo) — Los textos visibles y los nombres accesibles nuevos DEBEN estar en español claro y
  NO DEBEN usar la sigla «SLA» ni jerga técnica.
- **R49** (si/entonces) — SI una lectura falla, ENTONCES el sistema DEBE avisar en español y conservar
  en pantalla las cifras, el libro y los filtros aplicados que había antes del intento.

## Fuera de alcance

- Rehacer la descarga (columnas a elegir, hoja de detalle por orden): ficha 464.
- Vistas guardadas (ficha 453) y enlaces con filtros en la URL en las wallets.
- El listado `/wallet/satelites` y el de `/wallet/mensajeros` (este ya usa el buscador canónico).
- Otras pantallas de la censo de la 326 fuera de las wallets.

## Preguntas abiertas

1. **Cambio de comportamiento en la caja (R9/R12).** Hoy Entra/Sale y categoría cambian también las
   cifras de la wallet (resumen, composición y desglose). Con la separación pedida dejan de hacerlo:
   solo filtran el libro. ¿Se confirma? Si no, Entra/Sale y categoría tendrían que subir a la zona de
   la wallet.
2. **Qué busca el buscador (R25–R27).** Propuesta: descripción, nombre/referencia anotados y quién
   registró. NO incluye número de guía ni de remisión de las órdenes de un cierre (exigiría cruzar
   cada fila con sus órdenes; encaja mejor con la 464). ¿Basta? ¿Se quiere también ignorar tildes?
3. **Campos de orden (R33).** Solo por fecha del movimiento. ¿Hace falta ordenar también por importe?
4. **Saldo inicial con «Más recientes» (R39/R43).** Propuesta: va al final, donde cae en el tiempo.
   Alternativa: dejarlo siempre arriba como fila de resumen. ¿Cuál?
5. **Entra/Sale en los estados de cuenta.** No se añade (los chips ya separan por tipo). ¿Se quiere
   igualmente un Todo/Abonos/Cargos?
6. **Listados (R45).** Se añade el buscador al listado de tiendas por paridad con el de mensajeros; el
   de satélites se deja como está (conmutador «Con pendiente/Todas»). ¿Correcto?
7. **«Limpiar todo» del libro (R30)** conserva el orden elegido. ¿O debe volver a «Más recientes»?
