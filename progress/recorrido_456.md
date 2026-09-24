# 456 — Recorrido en navegador (T4.3), 2026-09-24

Un solo dev server (`next dev -p 3456`, salida a `progress/dev_456.log`), Chromium de `@playwright/test`,
base local `ordenex`. Escritorio 1440×900; móvil 390×844 con `hasTouch` y `tap()`. Cada texto se comparó
POR PROGRAMA contra `specs/456-tooltip-estados/textos-aprobados.md` (título = nombre, descripción = fila
de la tabla; la nota de ayuda contra su sección «Pendiente de visto bueno»). Al terminar: servidor
parado y `.next/dev` borrado.

Dato temporal: para ver una tarjeta en «Reparto» (todas las `en_reparto` del mensajero QA tienen gestión
pendiente y no se listan), la orden 111112 pasó a `en_reparto` con `fecha_reparto` de hoy durante la
prueba y se RESTAURÓ después (estatus, `fecha_reparto = null` y `updated_at` originales). Ninguna acción
de escritura se ejecutó (log del servidor: solo lecturas).

| Rol / superficie | Comprobado | Resultado |
|---|---|---|
| admin `/ordenes` | 25 filas, 25 botones (0 filas sin botón); 10 estados distintos, texto EXACTO 10/10; hover abre; Enter abre; Escape cierra y devuelve el foco; casilla de fila intacta tras abrir y tocar la explicación, y marcar la casilla no abre nada | OK |
| admin `/ordenes` filtrado «En reparto» | 7 filas, 7 señales «<resultado> · pendiente de confirmación» con botón; texto = «En reparto» aprobado; filtro aplicado con botón junto a la X («Qué significa «En reparto»»), abrirlo no cambia el filtro | OK |
| Filtro de estado | 20 opciones = 20 botones, mismos nombres y orden que antes; abrir «Novedad» (texto exacto con «24 horas»/«5 días») no marca ni cierra el panel; tocar el texto no cierra; Escape cierra SOLO la explicación (sin la línea retirada, R-456-11); 1 estado → botón junto a la X; 2 → «Estado: 2 seleccionados» y 0 botones | OK |
| axe del panel | `aria-required-children`, `aria-required-parent`, `listitem`: las MISMAS tres en el filtro «Zona» (sin botones) → preexistentes | Anotado |
| Historial | 8 entradas, 14 botones, «Creación» sin botón en su línea, texto exacto | OK |
| `/monitoreo` detalle | 28 botones en la tabla (Estado + Resultado del día); 0 en los contadores del tablero | OK |
| `/incidentes` | 0 incidentes pendientes en la base local: cubierto por `IncidentesAdminModule.test` | Sin datos |
| `/cierres-admin` | detalle con 3 botones; 0 pestañas con botón | OK |
| `/analitica` (admin y maestro) | 2 leyendas «Qué significa cada estado», 15 botones, 0 botones dentro de `aria-hidden`; textos exactos 6/6 | OK |
| Tema oscuro | popup con tokens del tema (fondo `rgb(16,32,58)`, texto `rgb(230,236,248)`) | OK |
| maestro `/ordenes` | 25 botones, textos exactos 6/6 | OK |
| adminTienda `/ordenes` | 26 botones, textos exactos 6/6 | OK |
| adminTienda `/novedades` | listas vacías en la base local (0 tarjetas); pestañas «Ayuda solicitada», «Novedad», «Devolución a origen por plazo vencido» con 0 botones | OK / sin tarjetas |
| adminSatelite «en bodega» | 10 botones (estado y pendiente), textos exactos 3/3; filtro con 20 opciones y 20 botones; tocar la explicación no cierra el panel | OK |
| mensajero (móvil) Reparto, mosaico y detalle | tap abre y sigue abierto; tocar el texto no gestiona (0 paneles, URL igual); tap fuera cierra; tap en la tarjeta sí gestiona; cabecera del panel «Gestionar orden» con botón y texto exacto | OK |
| mensajero Recoger | 3 botones, texto exacto de «Mensajero recogiendo en la bodega» | OK |
| mensajero chat | cabecera con botón; lista con 4 botones hermanos; tocar el botón y su texto no abre la conversación; tocar la fila sí | OK |
| Rastreo público móvil y escritorio (tema oscuro del sistema) | 4 entradas, 5 botones (cabecera pendiente + 4); texto exacto; popup con `tema-claro` y fondo blanco; tocar la explicación no cierra el diálogo ni borra el resultado | OK |

## Alturas (T0.4 → T4.3)

Filas de `/ordenes` y de la satélite, opción del filtro y cabecera del mosaico: IGUALES fila a fila. La
cabecera de la vista «detalle» del mensajero subió de 95 a 108,5 px (el chip largo se partía): arreglado
con el botón superpuesto (R-456-10) y re-medido: **95**. Detalle en `progress/impl_456.md`.
