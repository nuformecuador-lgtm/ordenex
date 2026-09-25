# Plan de pruebas de la release acumulada en `dev` (2026-09-25)

## Qué hay en `dev` que no está en producción
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
| 460 | Ayuda y asistente actualizados con todo lo anterior |

## Dónde probar
- **URL:** https://ordenex-git-dev-nuformecuador-2824s-projects.vercel.app (siempre la última versión de `dev`).
- **Base:** la de preview, independiente de producción.
- **Usuarios (clave `Preview456Qa!`):** `maestro.qa@ordenex.test`, `admin.qa@ordenex.test`, `tienda.qa@ordenex.test`,
  `satelite.qa@ordenex.test` (bodega QUEPOS) y `mensajero.qa@ordenex.test`. Si alguno pide un código de acceso, se lee
  de los logs de Vercel.
- La reclasificación de los 203 **no se ve en preview** (esos pagos solo existen en producción).

## Qué probar, por rol
### Maestro / admin
1. **Caja (/wallet):** la tarjeta dice «Flujo de dinero registrado». «Registrar movimiento» tiene 7 conceptos en 3 grupos.
   - Registra un **Pago por cuenta de una tienda** (a la tienda QA, beneficiario «Facebook», método, referencia, con y sin
     comprobante): baja la caja y el saldo de la tienda; la ganancia no cambia. Anúlalo con motivo: todo vuelve.
   - Registra **Cobrar un costo a una tienda**: baja el saldo de la tienda; la caja NO se mueve.
   - Registra un **Saldo inicial**: la tarjeta pasa a «Dinero en caja». Anúlalo: vuelve a «Flujo».
   - Las fechas salen en hora de Costa Rica (un movimiento de la noche no salta al día siguiente).
2. **Tiendas (/wallet/tiendas):** el pago por cuenta aparece con su nombre; ningún código raro; el filtro de cierre.
3. **Órdenes (/ordenes):** los nombres nuevos (Entregado, Novedad, Novedad interna, Devolución a origen por rechazo,
   Mensajero recogiendo en la bodega, Por devolver a bodega central); el botón de información en cada estado y en el
   filtro; una orden gestionada y sin cierre aprobado muestra «<Resultado> · pendiente de confirmación» y no ofrece
   «Traspasar» ni «Cambiar día».
4. **Cierres (/cierres-admin):** aprobar un cierre aplica el estado real a sus órdenes; corregir un resultado.
5. **Ayuda y asistente:** botón de ayuda en cada pantalla; pregúntale al asistente «¿qué diferencia hay entre pago por
   cuenta y cobrar un costo?».
6. **Configuración → SINPE:** el SINPE por bodega; al entrar, el aviso «Confirmá el SINPE» (ver «decisiones»).

### Mensajero (en el móvil)
1. Las órdenes asignadas aparecen en el chat antes de recogerlas.
2. Gestionar cada resultado: la orden sale de «por gestionar» y queda pendiente hasta que se aprueba su cierre;
   deshacer; pedir el cierre.
3. El botón de información se abre al tocar. Los nombres nuevos en la tarjeta y en el chat.

### Tienda
1. Sus órdenes: la nota «pendiente de confirmación» tras la gestión del mensajero; el estado real tras aprobarse el cierre.
2. Novedades: pestaña «Novedad»; ayuda solicitada por el mensajero.
3. Mi wallet: saldo, estado de cuenta, un pago hecho por su cuenta y su comprobante; fechas de Costa Rica.
4. Rastreo público de una guía: nombres reales de los estados.

### Satélite (bodega QUEPOS)
1. El cierre de su bodega ya no espera a la central: la oficina lo ve como «Pendiente de conciliar» y lo marca «Recibido».
2. Configurar su SINPE; el aviso de confirmación al entrar.
3. Nombres nuevos y botón de información en «Por recibir» y «En bodega».

### API por clave (si alguien integra)
- Los estados llegan con el código NUEVO y el campo `estadoNombre`; un código viejo en un filtro responde 422 nombrando el nuevo.
- Los webhooks nuevos: gestión registrada, anulada, corregida, ayuda solicitada o resuelta.

## ¿Se puede desplegar? Lo que cambia en la forma de trabajar
Ver la sección homónima del chat del 2026-09-25 y `docs/release.md` › «Pendiente para la PRÓXIMA release».
