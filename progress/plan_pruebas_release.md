# Plan de pruebas de la release acumulada en `dev` (2026-09-26)

## Qué hay en `dev` que no está en producción
Medido el 2026-09-26: `origin/dev` = `8b44476e`, `origin/prod` = `3965b568` (ancestro de `dev`), 27 migraciones pendientes.

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
| 458-B | Anular un cobro por rechazo y una indemnización desde la caja; comprobantes; flete e IVA netos en analítica; estado de cuenta (servidor) |
| 458-C/D/E | **pendiente 458-C/D/E** (registrar un movimiento y panel «Ver»; estados de cuenta y «Mi wallet»; libro de caja) |
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
   - **Selector de cierre** en `/wallet/tiendas` (desglose de una tienda) y en `/wallet/mensajeros`: ya no se pega un
     identificador; se busca por día o por nombre del mensajero y se elige «Cierre del día · <mensajero> · n movimientos».
     Ningún uuid a la vista (tampoco al pasar el lector de pantalla por «Ver el cierre»).
   - **Filtros de concepto** en `/wallet`, en el desglose de una tienda y en `/mi-wallet`: solo aparecen los conceptos
     con movimientos, cada uno con su número entre paréntesis; el elegido se conserva con «(0)» si deja de tener.
   - **Origen con nombre**: «Cierre del día · 2026-09-12 · <mensajero>», «Gestión de orden · cobro por rechazo · guía …»,
     «Pago de Ordenex a una tienda · <tienda> · <fecha> · SINPE», con «Ver» cuando hay enlace; las descargas llevan el
     mismo texto.
   - **Nombres iguales en el historial**: la misma cuenta se llama igual («<nombre> <apellidos>») al registrar, al anular
     y en las tablas; un mensajero con segundo apellido sale con los dos.
   - **Anulaciones:** el **sueldo** y el **gasto** de Ordenex se revierten con «Reversar» (el panel nuevo llega con la
     **pendiente 458-C/D/E**); la **indemnización** por incidente y las dos líneas del **cobro por rechazo** ofrecen
     «Anular…»: con motivo, se anulan juntas, la tienda recibe el crédito de vuelta y la ganancia baja lo que se había
     cobrado. Un segundo intento dice que ya estaba anulado; lo del cierre no se puede anular (el diálogo lo explica).
   - **Analítica (/analitica, tablero financiero):** tras anular un cobro por rechazo, el **flete y el IVA salen en
     neto** (bruto y neto; el neto baja lo anulado) y el panel mensual dice «Movimiento neto del periodo». Si el tablero
     financiero no aparece, anotarlo: es el riesgo R8 de `docs/release.md`.
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
4. No ve la caja: `/wallet` responde que no existe.

### Tienda
1. Sus órdenes: la nota «pendiente de confirmación» tras la gestión del mensajero; el estado real tras aprobarse el cierre.
2. Novedades: pestaña «Novedad»; ayuda solicitada por el mensajero.
3. **Mi wallet:** saldo, estado de cuenta y fechas de Costa Rica; el filtro de conceptos solo con los suyos y su número.
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

### Pendiente 458-C/D/E
- **458-C** (registrar un movimiento y panel «Ver»): **pendiente 458-C/D/E** — pasos por rol cuando su recorrido esté escrito.
- **458-D** (estados de cuenta y «Mi wallet»): **pendiente 458-C/D/E**.
- **458-E** (libro de caja): **pendiente 458-C/D/E**.

## ¿Se puede desplegar? Lo que cambia en la forma de trabajar
La lista completa —antes, durante, después, decisiones del humano, rollback y riesgos conocidos— está en
`docs/release.md` › «Pendiente para la PRÓXIMA release». Lo que la oficina tiene que saber el día del despliegue: el aviso
del SINPE les va a salir a todos (D1), los estados cambian de nombre y la API de código (D2), y el despliegue va fuera de
horario de reparto (D3).
