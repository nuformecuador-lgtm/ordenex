# Ficha 469 — Requisitos

**Buscar una guía (o una remisión) en el libro de la wallet y ver solo los movimientos a los que esa orden
aporta dinero.**

## De qué va, en una línea

El humano, probando el preview el 2026-10-02: *«¿por qué no puedo buscar número de guía en el input de
búsqueda?»*. Hoy el buscador del libro (ficha 463) solo mira la descripción, la anotación y quién registró:
un número de guía no encuentra nada, o encuentra filas que por casualidad llevan esas cifras en el texto.

## Decisiones ya tomadas por el humano (2026-10-02)

1. Si se escribe un número de guía o de remisión en el buscador del libro, salen **los movimientos en los
   que ESA orden aporta dinero** (flete, comisión, IVA, contra-entrega, pago al mensajero por esa gestión,
   indemnización…), **no** todos los movimientos del cierre.
2. Aplica a la caja y a los estados de cuenta (tienda, mensajero, satélite, `/mi-wallet`), con el mismo
   buscador de la barra de la ficha 467.
3. Al abrir una de esas filas, la guía buscada sale **resaltada** en el detalle.
4. Va encima del reparto por guía de la **468** (contra-entrega, pago al mensajero, indemnización de cierre
   y pago devengado pasan a repartirse por guía), en la misma release.

## Depende de / reutiliza

- **468** (en implementación): el catálogo de reparto ampliado (R27/R28 de la 468) y su criterio de aporte.
  Esta ficha **no** añade ningún concepto al reparto: usa el que la 468 deje.
- **344 / 458-D**: el detalle de una fila (qué órdenes componen su importe y cuánto aporta cada una).
- **463**: el buscador del libro, su mínimo de 3 caracteres y el saldo corrido que no cambia con filtros.
- **467**: la barra del libro (el buscador compartido) en las cinco superficies.

## Vocabulario

- **Superficie con búsqueda por guía:** la caja (`/wallet`), el estado de cuenta de una tienda (oficina), el
  de un mensajero (oficina) y `/mi-wallet`. La bodega satélite queda fuera por ahora (pregunta abierta 2).
- **Alcance de la superficie:** en el estado de cuenta de una tienda y en `/mi-wallet`, las órdenes de esa
  tienda; en la caja y en el estado de cuenta de un mensajero, todas las órdenes.
- **Término:** lo escrito en el buscador del libro, sin espacios en los bordes.
- **Orden identificada:** una orden del alcance cuyo número de guía es igual al término, o cuyo número de
  remisión es igual al término sin distinguir mayúsculas.
- **Búsqueda por guía:** la búsqueda cuyo término identifica al menos una orden. Si no identifica ninguna,
  es una **búsqueda de texto** (la de la 463).
- **Movimiento repartible:** el de la 468: nace de un cierre y su concepto se reparte por guía según el
  catálogo vigente.
- **Aportar a un movimiento:** una orden aporta a un movimiento repartible cuando el detalle de esa fila,
  al abrirla, la lista entre sus órdenes.
- **Movimiento de una sola orden:** un movimiento que no nace de un cierre y cuyo origen es una sola orden:
  el cobro a la tienda por un rechazo y su anulación, y la indemnización por un incidente y su anulación
  (pregunta abierta 1).

## Requisitos

### A. Cuándo una búsqueda es por guía

- **R1** (ubicuo): En cada superficie con búsqueda por guía, el buscador del libro DEBE aceptar un número de
  guía o un número de remisión, sin ningún control nuevo en la barra.
- **R2** (si/entonces): SI el término identifica al menos una orden, ENTONCES el sistema DEBE tratar la
  búsqueda como búsqueda por guía.
- **R3** (ubicuo): La guía y la remisión DEBEN compararse completas: buscar «123» NO DEBE identificar la guía
  1234, y buscar «NA-10» NO DEBE identificar la remisión «NA-107».
- **R4** (ubicuo): La remisión DEBE compararse sin distinguir mayúsculas: «na-107» identifica la remisión
  «NA-107».
- **R5** (opcional): DONDE la superficie sea el estado de cuenta de una tienda o `/mi-wallet`, un término que
  solo es guía o remisión de órdenes de OTRA tienda DEBE dar exactamente la misma respuesta que la búsqueda
  de texto de ese término.
- **R6** (si/entonces): SI el término no identifica ninguna orden, ENTONCES el buscador DEBE devolver
  exactamente lo mismo que antes de esta ficha (la búsqueda de texto de la 463).
- **R7** (si/entonces): SI una remisión es la de órdenes de varias tiendas, ENTONCES en la caja y en el
  estado de cuenta de un mensajero el sistema DEBE considerar identificadas todas esas órdenes.

### B. Qué movimientos salen

- **R8** (de estado): MIENTRAS la búsqueda sea por guía, el libro DEBE mostrar cada movimiento repartible al
  que aporta alguna orden identificada.
- **R9** (de estado): MIENTRAS la búsqueda sea por guía, el libro NO DEBE mostrar un movimiento repartible al
  que no aporta ninguna orden identificada, aunque esa orden esté en el mismo cierre.
- **R10** (de estado): MIENTRAS la búsqueda sea por guía, el libro NO DEBE mostrar un movimiento solo porque
  su descripción, su anotación o el nombre de quien lo registró contengan el término.
- **R11** (ubicuo): Un movimiento repartible DEBE salir en la búsqueda por guía si y solo si, al abrir esa
  fila con la misma superficie, su detalle lista alguna orden identificada.
- **R12** (ubicuo): La búsqueda por guía DEBE alcanzar todos los conceptos que el catálogo de reparto vigente
  reparte por guía, incluidos los cuatro que añade la 468 (contra-entrega de la caja, pago al mensajero de la
  caja, indemnización que nace de un cierre y pago devengado del mensajero).
- **R13** (opcional): DONDE la superficie sea el estado de cuenta de un mensajero, el pago tomado del
  efectivo de un cierre NO DEBE salir en la búsqueda por guía, porque no se reparte por guía (R43 de la
  468).
- **R14** (de estado): MIENTRAS la búsqueda sea por guía, el libro DEBE mostrar también cada movimiento de
  una sola orden cuya orden sea una orden identificada *(pendiente de la pregunta abierta 1)*.
- **R15** (ubicuo): Un movimiento al que aportan varias órdenes identificadas DEBE salir una sola vez.

### C. Filtros, saldo y orden

- **R16** (ubicuo): La búsqueda por guía DEBE combinarse con los demás filtros del libro (periodo, «A quién»,
  Entra/Sale, Concepto, Tipo de movimiento, Cierre): un movimiento sale solo si cumple todos.
- **R17** (opcional): DONDE la superficie sea un estado de cuenta, el saldo de cada fila DEBE ser el mismo
  con búsqueda por guía que sin ella: el saldo de la cuenta entera justo después de ese movimiento.
- **R18** (ubicuo): Las cifras de la superficie (las tarjetas del estado de cuenta, el resumen y el desglose
  de la caja) NO DEBEN cambiar al buscar por guía.
- **R19** (ubicuo): El total que muestra la paginación del libro DEBE ser el número exacto de movimientos que
  salen en la búsqueda por guía con los filtros aplicados.
- **R20** (ubicuo): La búsqueda por guía DEBE respetar el orden elegido («Más recientes» / «Más antiguas»).

### D. Lo que se ve en el libro

- **R21** (de estado): MIENTRAS la búsqueda sea por guía, el libro DEBE mostrar, junto a la barra, el aviso
  «Guía o remisión «{término}»: solo se muestran los movimientos en los que esa orden aporta dinero.».
- **R22** (si/entonces): SI la búsqueda es por guía y no sale ningún movimiento, ENTONCES el libro DEBE decir
  «Esa guía o remisión no aporta dinero a ningún movimiento de este libro con los filtros elegidos.».
- **R23** (de estado): MIENTRAS la búsqueda sea de texto, el libro NO DEBE mostrar el aviso de R21.
- **R24** (ubicuo): El texto de ayuda del buscador de cada superficie con búsqueda por guía DEBE nombrar la
  guía y la remisión además de los campos que ya nombra.

### E. La guía resaltada en el detalle

- **R25** (por evento): CUANDO el usuario abre, con búsqueda por guía, una fila repartible, el detalle DEBE
  mostrar destacada, encima de la lista, cada orden identificada que aporta a ese movimiento, con su guía,
  su destinatario, su resultado y su aporte, aunque esa orden no esté en la página visible de la lista.
- **R26** (por evento): CUANDO la lista paginada del detalle contiene una orden identificada, su fila DEBE ir
  resaltada, y el resaltado DEBE distinguirse también sin color (un texto o un icono con nombre accesible).
- **R27** (ubicuo): El aporte de una orden destacada DEBE ser el mismo número que muestra la fila de esa
  orden en la lista del detalle.
- **R28** (si/entonces): SI el detalle se abre sin búsqueda por guía, ENTONCES DEBE ser idéntico al de antes
  de esta ficha: sin bloque destacado y sin filas resaltadas.
- **R29** (opcional): DONDE la superficie sea el estado de cuenta de una tienda o `/mi-wallet`, el detalle NO
  DEBE destacar ni devolver una orden de otra tienda aunque su guía o su remisión sea el término.

### F. La descarga

- **R30** (por evento): CUANDO el usuario descarga el libro con búsqueda por guía, la hoja «Movimientos» DEBE
  tener exactamente los movimientos que muestra la pantalla con esa búsqueda y esos filtros, de todas las
  páginas.
- **R31** (por evento): CUANDO el usuario descarga con «Movimientos y detalle por guía» y búsqueda por guía,
  el archivo DEBE seguir las reglas de la 468: la hoja «Detalle por guía» lleva un bloque por cada guía que
  aporta a algún movimiento de la hoja «Movimientos», y su TOTAL GENERAL es igual al «Total del periodo».
- **R32** (por evento): CUANDO la descarga lleva búsqueda por guía, la hoja «Movimientos» DEBE llevar el aviso
  de filtros de la 468 (R16 de la 468).

### G. Servidor y acceso

- **R33** (ubicuo): La decisión entre búsqueda por guía y búsqueda de texto, y el conjunto de movimientos,
  DEBEN calcularse en el servidor; el navegador solo envía el término.
- **R34** (ubicuo): El criterio «esta orden aporta a este movimiento» de la búsqueda por guía DEBE ser el
  mismo que usa el detalle de una fila. No DEBE existir una segunda definición de ese criterio ni ninguna
  fórmula de dinero nueva.
- **R35** (ubicuo): Los textos visibles nuevos DEBEN estar en español claro y NO DEBEN usar la sigla «SLA» ni
  jerga técnica.
- **R36** (opcional): DONDE la superficie sea el estado de cuenta de una bodega satélite, el buscador DEBE
  seguir buscando solo texto, sin búsqueda por guía *(pendiente de la pregunta abierta 2)*.

## Fuera de alcance

- Una cifra nueva «esta guía aporta en total ₡X». Sería una suma que hoy no existe en pantalla; si se
  quiere, va en otra ficha.
- Buscar parte de un número de guía (por ejemplo, las últimas cifras). La guía se compara completa (R3).
- Guías de una o dos cifras: el buscador exige 3 caracteres (463), igual que el enlace a `/ordenes` del
  detalle. Se hereda y se declara.
- Reordenar o filtrar la hoja «Detalle por guía» para dejar solo la guía buscada: rompería el cuadre de la
  468 (R31).
- Buscar en los listados de wallets (`/wallet/tiendas`, `/wallet/mensajeros`, `/wallet/satelites`).

## Preguntas abiertas (dependen del humano)

1. **Movimientos de una sola orden que no nacen de un cierre.** El cobro a la tienda por un rechazo (y su
   anulación) y la indemnización por un incidente (y su anulación) son dinero de UNA orden, pero no se
   reparten por guía (la 468 los deja en «Movimientos sin guía») y su detalle no lista órdenes. Su origen
   apunta a la gestión o al incidente de esa orden, así que se pueden encontrar sin ninguna fórmula.
   **Propuesta por defecto: sí salen** en la búsqueda por guía (R14), sin resaltado en el detalle, porque no
   hay lista de órdenes que resaltar.
2. **Bodega satélite.** Su libro son consolidaciones de efectivo (declarado / recibido), sin reparto por guía
   (R25 de la 468). Hacer que una guía encuentre «la consolidación que la incluye» sería un criterio de aporte
   nuevo que hoy no existe. **Propuesta por defecto: en la satélite el buscador sigue siendo solo de texto
   (R36)**, y su texto de ayuda no nombra la guía. Si se quiere, va en una ficha aparte con su propio
   criterio.
3. **Guía y remisión a la vez.** Si una remisión numérica coincide con la guía de otra orden, se toman las
   dos órdenes (son ambas «identificadas») y el aviso dice «guía o remisión». **Propuesta por defecto: así**,
   sin pedir al usuario que elija.
