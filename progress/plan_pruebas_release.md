# Plan de pruebas de la release acumulada en `dev` (2026-09-26)

## Qué hay en `dev` que no está en producción
Medido el 2026-09-26: `origin/dev` = `2849185a` (la 458 completa: A–E), `origin/prod` = `3965b568` (ancestro de `dev`), 27 migraciones pendientes (la 458-C/D/E no trae ninguna).

| Ficha | Qué cambia |
|---|---|
| 429 | El SINPE es uno por bodega, editable desde la app (antes uno global) |
| 430 | Las órdenes asignadas entran al chat del mensajero antes de recogerlas |
| 431 | La satélite cierra sola; la aprobación de la central pasa a «Pendiente de conciliar / Recibido» |
| 432 | La siembra del SINPE corre dentro del despliegue |
| 433–435 | Módulo de ayuda dentro de la app (maestro y admin leen todo; el resto, lo suyo) |
| 436 | Asistente que responde cómo usar la app |
| 454 | Al gestionar, la orden sigue «En reparto» con la nota «<Resultado> · pendiente de confirmación»; el estado real se aplica al aprobar el cierre |
| 455 | Un solo nombre por estado en toda la app, también en la API y los webhooks (códigos nuevos) |
| 456 | Botón de información junto a cada estado |
| 459 | La caja muestra el dinero real; «Pago por cuenta de una tienda»; saldo inicial opcional; reclasificación de los 203 pagos de Nuform |
| 460 | Ayuda y asistente actualizados con la 454, la 456 y la 459 |
| 461 | «Ordenex le cobra a una tienda» es ganancia; cada movimiento dice quién le paga a quién; se puede anular una corrección de caja; filtros por día de Costa Rica; un doble clic ya no registra dos veces |
| 457 | «Una tienda le paga a Ordenex»: la tienda con saldo en contra salda su deuda, con método, referencia y comprobante |
| 458-A | Selector de cierre (en vez de pegar el identificador), filtro de conceptos solo con los que tienen movimientos, origen con nombre y enlace, el mismo nombre de la cuenta en todo el historial |
| 458-B | Anular un cobro por rechazo y una indemnización desde la caja; comprobantes; flete e IVA netos (solo servidor: el tablero financiero de /analitica está apagado); estado de cuenta (servidor) |
| 458-C | Un solo «Registrar un movimiento» con diez conceptos, «Así queda» y comprobante; cada fila del libro con «Ver» y «Anular…» |
| 458-D | Estado de cuenta de cada tienda, mensajero y bodega satélite (`/wallet/tiendas/<id>`, `/wallet/mensajeros/<id>`, `/wallet/satelites/<id>`); `/mi-wallet` pasa a ser el estado de cuenta de la tienda |
| 458-E | Libro de caja con columnas nuevas (A quién, Registró) y filtros Todo/Entra/Sale y «A quién»; las tarjetas cuentan lo filtrado |
| 462 | A las 7:00 de Costa Rica, aviso de los paquetes reprogramados para hoy que esperan la aprobación de un cierre |

## Dónde probar
- **URL:** https://ordenex-git-dev-nuformecuador-2824s-projects.vercel.app (siempre la última versión de `dev`).
- **Base:** la de preview, independiente de producción. Preview **sí** migra al desplegar `dev` (`MIGRATE_ON_PREVIEW=true`); comprobar en el log del último build de preview que no quedó ninguna pendiente.
- **Usuarios (clave `Preview456Qa!`):** `maestro.qa@ordenex.test`, `admin.qa@ordenex.test`, `tienda.qa@ordenex.test`,
  `satelite.qa@ordenex.test` (bodega QUEPOS) y `mensajero.qa@ordenex.test`. Si alguno pide un código de acceso, se lee
  de los logs de Vercel.
- **Antes de empezar:** el bucket `wallet-comprobantes` tiene que existir en el Supabase de **preview** (hoy no existe en
  ninguno; paso A4 de `docs/release.md`). Sin él, todo lo que dice «con comprobante» falla con «No se pudo guardar el
  comprobante…». Y el asistente necesita `ANTHROPIC_API_KEY` en Preview (A5).
- **El modal del SINPE:** al entrar, maestro, admin y satélite ven «Confirmá el SINPE de …», que tapa la pantalla (riesgo
  R1). Se cierra con «Ahora no» y se sigue; confirmarlo es el paso 7 de maestro/admin.
- **Lo que no se ve en preview:** la reclasificación de los 203 (esos pagos solo existen en producción) y el cobro por
  rechazo si no hay ninguno aprobado en esa base.
- **Para cada prueba de dinero**, apuntar antes y después las cifras de la tarjeta de `/wallet`: cifra principal, Entró,
  Salió, De las tiendas, Ganancia de Ordenex, capital; y el saldo de la tienda en `/wallet/tiendas`.

## Qué probar, por rol
### Maestro / admin
1. **Caja (/wallet):** la tarjeta dice «Flujo de dinero registrado». «Registrar movimiento» tiene los conceptos en 3
   grupos, cada uno con una frase que dice qué pasa con el dinero.
   - **Pago por cuenta de una tienda** (a la tienda QA, beneficiario «Facebook», método, referencia, con y sin
     comprobante): baja la caja y el saldo de la tienda; la ganancia no cambia. Anúlalo con motivo: todo vuelve.
   - **Saldo inicial**: la tarjeta pasa a «Dinero en caja». Anúlalo: vuelve a «Flujo».
   - Las fechas salen en hora de Costa Rica (un movimiento de la noche no salta al día siguiente), también en el filtro
     por fecha y en el nombre del archivo descargado.
2. **La 461 — quién le paga a quién:**
   - **«Ordenex le cobra a una tienda»** por 42.000: el aviso dice «Cobro registrado. El saldo de <tienda> queda en …»;
     **la cifra principal, Entró y Salió no cambian**; «De las tiendas» baja 42.000 y **la ganancia sube 42.000** (el
     cobro es ganancia). En el libro: «Ordenex le cobra a una tienda», con el nombre de la tienda y «Anular…».
   - **Anula ese cobro** con motivo: la ganancia y «De las tiendas» vuelven; la fila original dice «Anulado» y aparece
     «Cobro a una tienda anulado» fechado hoy.
   - **Sueldo, Gasto de Ordenex, Aporte y Corrección de caja (suma y resta):** se registran con su nombre claro.
   - **Anular la corrección de caja** (la que se arregló en el recorrido de la 461): «Anular…» con motivo en una
     corrección que suma y en una que resta; el contra-asiento sale por el mismo monto y la caja vuelve a la de antes.
   - **Doble clic** en «Registrar» de cualquier concepto: queda UNA sola fila.
   - Los nombres son los mismos en el diálogo, el libro, `/wallet/tiendas`, `/mi-wallet` y las descargas; ningún
     código crudo.
3. **La 457 — «Una tienda le paga a Ordenex»** (con la tienda QA en contra: primero cóbrale más de lo que tiene):
   - En «Registrar movimiento», el concepto «Una tienda le paga a Ordenex», con la pista «Solo se admite si la tienda
     tiene saldo en contra, y hasta lo que debe.»
   - Registra 4.000 **sin** comprobante (SINPE con referencia, fecha de ayer): Entró, la cifra principal y «De las
     tiendas» suben 4.000; **la ganancia y el capital no cambian**; el saldo de la tienda sube 4.000.
   - Registra otro **con** comprobante (PDF) y ábrelo con «Ver comprobante».
   - Un monto mayor que la deuda: «La tienda debe ₡…: el pago no puede superar ese importe.». Una tienda sin deuda:
     «Esta tienda no tiene saldo en contra: no hay nada que pagar.»
   - Doble clic: una sola fila; el aviso dice «Este pago ya estaba registrado, por ₡…».
   - «Anular…» con motivo: todo vuelve; un segundo intento responde que ya estaba anulado.
   - En `/wallet/tiendas`, la tienda en contra tiene el botón «Registrar pago de la tienda a Ordenex»; al saldar,
     la tabla se actualiza sin recargar y el botón desaparece.
4. **La 458-A/B — la wallet por dentro:**
   - **Selector de cierre** en el estado de cuenta de una tienda y de un mensajero (paso 13) y en `/mi-wallet`: ya no se pega un
     identificador; se busca por día o por nombre del mensajero y se elige «Cierre del día · <mensajero> · n movimientos».
     Ningún uuid a la vista (tampoco al pasar el lector de pantalla por «Ver el cierre»).
   - **Filtro de concepto** en `/wallet`: solo aparecen los conceptos con movimientos, cada uno con su número entre
     paréntesis; el elegido se conserva con «(0)» si deja de tener. (En los estados de cuenta y en `/mi-wallet` el filtro
     son los chips Todo · Cierres · Pagos · Cobros · Correcciones.)
   - **Origen con nombre**: «Cierre del día · 2026-09-12 · <mensajero>», «Gestión de orden · cobro por rechazo · guía …»,
     «Pago de Ordenex a una tienda · <tienda> · <fecha> · SINPE», con «Ver» cuando hay enlace; las descargas llevan el
     mismo texto.
   - **Nombres iguales en el historial**: la misma cuenta se llama igual («<nombre> <apellidos>») al registrar, al anular
     y en las tablas; un mensajero con segundo apellido sale con los dos.
   - **Anulaciones:** se prueban en el paso 14 (ya no existe «Reversar»: todo se anula con «Ver» → «Anular…»).
   - **Analítica:** el **tablero financiero de `/analitica` está apagado a propósito** (su sección está comentada en
     `AnaliticaShell`): el flete y el IVA netos de la 458-B y «Movimiento neto del periodo» **no se ven en pantalla**.
     No se buscan; no es un fallo (riesgo R8 de `docs/release.md`).
5. **Órdenes (/ordenes):** los nombres nuevos (Entregado, Novedad, Novedad interna, Devolución a origen por rechazo,
   Mensajero recogiendo en la bodega, Por devolver a bodega central); el botón de información en cada estado y en el
   filtro; una orden gestionada y sin cierre aprobado muestra «<Resultado> · pendiente de confirmación» y no ofrece
   «Traspasar» ni «Cambiar día».
6. **Cierres (/cierres-admin):** aprobar un cierre aplica el estado real a sus órdenes; corregir un resultado.
7. **Configuración → SINPE:** el SINPE por bodega; el aviso «Confirmá el SINPE» al entrar; corregirlo y confirmarlo:
   no vuelve a salir.
8. **La 462 — el aviso de las 7:** con una orden reprogramada para hoy cuyo cierre sigue sin aprobar, a las 7:00 de
   Costa Rica llega a la campana del admin el aviso de «paquetes reprogramados para hoy» que esperan un cierre, y en
   `/ordenes` y `/cierres-admin` se ven marcadas. La notificación al celular va a admin y adminSatelite, **no** al
   maestro (decisión del humano, 2026-09-25). (En preview solo se ve si la base tiene ese caso a esa hora; si no, se anota N/V y se mira en producción.)
9. **Ayuda y asistente:** botón de ayuda en cada pantalla; pregúntale al asistente «¿qué diferencia hay entre pago por
   cuenta y cobrar un costo?», «¿sube la ganancia si una tienda me paga?» (debe decir que no) y «¿cómo anulo un pago de
   una tienda?» (la respuesta no debe cortarse a media frase).

### Mensajero (en el móvil)
1. Las órdenes asignadas aparecen en el chat antes de recogerlas, marcadas como de mañana si lo son.
2. Gestionar cada resultado: la orden sale de «por gestionar» y queda pendiente hasta que se aprueba su cierre;
   deshacer; pedir el cierre.
3. El botón de información se abre al tocar. Los nombres nuevos en la tarjeta y en el chat.
4. No ve la caja: `/wallet` responde que no existe. Tampoco `/mi-wallet` ni los estados de cuenta (la 458, abajo).

### Tienda
1. Sus órdenes: la nota «pendiente de confirmación» tras la gestión del mensajero; el estado real tras aprobarse el cierre.
2. Novedades: pestaña «Novedad»; ayuda solicitada por el mensajero.
3. **Mi wallet** (lo nuevo de la 458-D está en «La 458 completa», abajo): saldo, estado de cuenta y fechas de Costa Rica.
   Los movimientos de la oficina con su nombre claro: «Ordenex te cobró» / «Ordenex anuló un cobro y te lo devolvió»,
   «Ordenex pagó un gasto por ti · … · A Facebook», **«Le pagaste a Ordenex»** / «Ordenex anuló el pago que le hiciste»,
   y el comprobante que subió Ordenex. No ve nada de otras tiendas ni de la caja.
4. Rastreo público de una guía: nombres reales de los estados.
5. Pregúntale al asistente «¿qué es Le pagaste a Ordenex?»: responde con su documento, no con los de la oficina.

### Satélite (bodega QUEPOS)
1. El cierre de su bodega ya no espera a la central: la oficina lo ve como «Pendiente de conciliar» y lo marca «Recibido»;
   mientras tanto, la satélite **asigna** órdenes sin bloqueo y puede consolidar otra vez.
2. La central marca «Recibido» por menos del total y el saldo enseña la diferencia; revierte la marca y vuelve.
3. Configurar su SINPE; el aviso de confirmación al entrar.
4. Nombres nuevos y botón de información en «Por recibir» y «En bodega».
5. La 462: si tiene reprogramadas retenidas, el aviso de las 7 le llega también, incluida la notificación al celular.

### API por clave (si alguien integra)
- Los estados llegan con el código NUEVO y el campo `estadoNombre`; un código viejo en un filtro responde 422 nombrando el nuevo.
- Los webhooks nuevos: gestión registrada, anulada, corregida, ayuda solicitada o resuelta; el `estado_actualizado`
  llega al aprobar el cierre, no al gestionar.
- La guía que se manda a los integradores es `docs/api/CHANGELOG.md` (entrada del 2026-09-24).

### La 458 completa (C/D/E): la wallet rediseñada, por rol
Con los usuarios de arriba, apuntando antes y después las cifras de la tarjeta de `/wallet` (cifra principal, Entró,
Salió, De las tiendas, Ganancia de Ordenex, capital). Regla general: **ningún uuid a la vista** (ni en textos, ni en
nombres accesibles, ni en las descargas) y ningún botón «Reversar». Los pasos siguen la numeración de cada rol de arriba.

#### Maestro y admin
10. **Registrar un movimiento (458-C)** — `/wallet` → «Registrar movimiento»:
    - Salen **diez conceptos en tres grupos**: «Sale dinero de Ordenex» (Gasto de Ordenex · Sueldo · Ordenex paga un
      gasto de una tienda · Corrección de caja (resta) · Ordenex le paga a una tienda · Ordenex le paga a un mensajero),
      «Llega dinero a la caja» (Aporte de dinero a la caja · Una tienda le paga a Ordenex · Corrección de caja (suma)) y
      «Se descuenta del saldo de una tienda» (Ordenex le cobra a una tienda); más un enlace a las plantillas de gastos
      fijos. Cada concepto dice con una frase qué le pasa al dinero.
    - **«A quién» obligatorio en Sueldo y en Gasto de Ordenex**: sin él no deja registrar. En Corrección de caja es
      opcional. Las cuentas de tienda y mensajero se eligen buscando por nombre (solo activas).
    - **«Así queda»**: al escribir el monto muestra antes → después de la cuenta, la cifra principal, la ganancia, «Lo que
      Ordenex les debe a las tiendas» y «Saldo inicial y aportes», con «no cambia» donde no se mueve. Tras registrar,
      la tarjeta dice exactamente lo que prometió. Un cobro mayor que el saldo de la tienda avisa antes: «Así, <tienda>
      queda con el saldo en contra: -₡…. Le deberá ese dinero a Ordenex.»
    - **Comprobante**: registrar un Sueldo con un PDF y abrirlo desde «Ver». Si el bucket no existe en preview sale «No
      se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.» y **no** se escribe nada (anotarlo:
      es A4). A una fila sin comprobante se le adjunta uno desde «Ver» → «Adjuntar comprobante» (una sola vez).
    - **Doble clic** en «Registrar»: una sola fila; el aviso dice que ya estaba registrado, sin error.
11. **«Ver» y «Anular…» en el libro (458-C/E)** — en cualquier fila de `/wallet`:
    - «Ver» abre el panel con A quién, Por qué, **Registró** (persona o «Automático…», con el **día y la hora** en que
      se registró), Estado («Vigente» / «Anulado»; «—» si no hay documento) y «Cómo quedó».
    - «Anular…» pide motivo (obligatorio). Tras anular, la fila sale tachada con la insignia «Anulado» (la insignia sin
      tachar) y aparece su contra-asiento; el panel de la fila anulada dice **quién anuló, el día, el motivo y «Cómo»**
      (método y referencia, si el documento los tiene). Un segundo intento desde otra pestaña: «Ya estaba anulado; no se
      registró nada más.» Lo que viene de un cierre no se puede anular (el panel lo explica).
12. **Libro de caja (458-E)** — `/wallet`:
    - Columnas **Fecha · Movimiento y motivo · A quién · Monto · Registró · Ver**. «Monto» lleva la insignia
      Entra/Sale y el dueño. «A quién» de una tienda o un mensajero enlaza a su estado de cuenta (paso 13).
    - Filtros: **Todo / Entra / Sale** (se aplica al pulsarlo), **«A quién»** (buscar una tienda, un mensajero o un
      nombre libre, como el de un sueldo), **concepto** y **periodo**. Con cada filtro, **las tarjetas (Movimientos,
      Entró, Salió) = la suma de las filas filtradas**; «Todos» y «Limpiar» quitan el filtro. Un sueldo anulado,
      filtrado por su nombre, trae el sueldo y su anulación, y se compensan.
    - La descarga trae las mismas columnas y lo mismo que se ve (0 uuid).
13. **Estados de cuenta (458-D)**:
    - **Tienda** — `/wallet/tiendas` → «Ver estado de cuenta» (`/wallet/tiendas/<id>`): tarjeta «Saldo actual» con
      «Ordenex le debe ₡… a <tienda>» o «<tienda> le debe ₡… a Ordenex», saldo inicial, abonos, cargos y saldo al final;
      primera fila «Saldo inicial», **saldo corrido** fila a fila, y la última fila = la tarjeta = el saldo de la lista.
      Chips Todo · Cierres · Pagos · Cobros · Correcciones. **Filtro por cierre** (buscar por día o por mensajero:
      «Cierre del … · <mensajero> · N movimientos»; al elegirlo, esas N filas). Una fila de cierre **despliega sus
      órdenes** (guías y su aporte). La fila de un pago dice «Cómo se pagó: SINPE · referencia …». Registrar desde aquí
      un cobro o un pago (el diálogo sale con la tienda ya elegida) y anularlo desde «Ver»: la tarjeta cambia sin
      recargar. Con la tienda a favor se ofrece «Ordenex le paga a la tienda»; en contra, «La tienda le paga a Ordenex» y
      el otro deshabilitado con su explicación. **Descarga**: Fecha · Movimiento · Motivo · Origen · Cómo se pagó ·
      Registró · Cargo · Abono · Saldo · Estado; última fila = tarjeta; 0 uuid.
    - **Mensajero** — `/wallet/mensajeros/<id>`: «Ordenex le debe ₡… a <mensajero>»; registrar un pago (se ve cuánto se
      aplica y cuánto queda pendiente) y anularlo desde «Ver» (vuelve el saldo; `/cierres-admin` sigue igual). Filtro por
      un cierre **con pagos**: trae las filas del cierre **y** los pagos registrados contra ese cierre con sus
      anulaciones, y el número del selector coincide con las filas. Abrir una fila de cierre dice que el importe es el
      total que dejó el cierre, sin reparto por orden.
    - **Satélite** — `/wallet/satelites` → «Ver estado de cuenta» (`/wallet/satelites/<id>`): estado de cuenta de la
      bodega con sus consolidaciones debajo; «Marcar recibido» por un monto distinto del declarado: el saldo enseña la
      diferencia («Recibido incompleto» o «… entregó ₡… de más») y la fila del listado cambia con él.
14. **Anular desde «Ver»**, cada uno con motivo, apuntando las cifras antes y después:
    - **Sueldo**: la cifra principal y la ganancia vuelven a las de antes; aparece «Anulación de: <motivo>».
    - **Gasto de Ordenex**: igual; aparece una Corrección de caja (suma) por el mismo monto.
    - **Cobro por rechazo** (si la base de preview tiene uno aprobado; si no, N/V): el panel dice «Es un cobro a la
      tienda por el flete de un rechazo…»; al anular salen las dos líneas (flete e IVA) juntas, la ganancia baja lo
      cobrado, «De las tiendas» sube lo mismo, la cifra principal no cambia y la tienda recibe el crédito.
    - **Indemnización por un incidente** (si hay una; si no, N/V): aparece una Corrección de caja (suma) por el mismo
      monto y la caja vuelve a la de antes.
    - Un segundo intento con cualquiera de ellos: «Ya estaba anulado».

#### Tienda (`tienda.qa`)
6. **`/mi-wallet` es ahora su estado de cuenta** (solo lectura): arriba el **resumen de tres cifras** «A tu favor ·
   Cargos de Ordenex · Ya pagado» con «Saldo a favor» (A favor / En contra / En cero) y su nota; debajo la tarjeta
   «Saldo actual · Ordenex te debe ₡…» (o lo que debe). **Resumen = tarjeta = saldo corrido de la última fila**, también
   después de cambiar de chip. Chips Todo · Cierres · Pagos · Cobros · Correcciones; selector de cierre («Cierre del … ·
   N movimientos», sin mensajero); una fila de cierre despliega SUS órdenes.
7. **Sin nombres de Ordenex**: no hay «Registró» ni ningún nombre del personal; **0 botones** de registrar, anular,
   adjuntar, cobrar o pagar.
8. **«Anulado por Ordenex»**: pedir a la oficina (maestro/admin) que le cobre algo y lo anule; la fila sale tachada con
   «Anulado por Ordenex el <día> a las <hora de Costa Rica> · <motivo>», **sin el nombre** de quien anuló (tampoco en la
   descarga).
9. **Comprobante**: «Ver comprobante» en una fila que lo tiene lo abre en otra pestaña; en una sin él: «Este registro no
   tiene comprobante.».
10. **Descarga**: las mismas filas, sin la columna «Registró», 0 uuid.

#### Mensajero y satélite (`mensajero.qa`, `satelite.qa`)
- **Sin acceso**: `/wallet`, `/wallet/tiendas`, `/wallet/tiendas/<id>`, `/wallet/mensajeros/<id>`,
  `/wallet/satelites/<id>` y `/mi-wallet` responden que no existen (404), los dos roles.

## ¿Se puede desplegar? Lo que cambia en la forma de trabajar
La lista completa —antes, durante, después, decisiones del humano, rollback y riesgos conocidos— está en
`docs/release.md` › «Pendiente para la PRÓXIMA release». Lo que la oficina tiene que saber el día del despliegue: el aviso
del SINPE les va a salir a todos (D1), los estados cambian de nombre y la API de código (D2), y el despliegue va fuera de
horario de reparto (D3).
