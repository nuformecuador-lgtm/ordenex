---
titulo: Ranking
modulo: ranking
pantalla: /ranking
roles: [mensajero, maestro, admin]
actualizado: 2026-09-15
fuentes:
  - app/(app)/ranking/_components/RankingModule.tsx
  - app/(app)/ranking/_components/RankingPodio.tsx
  - app/(app)/ranking/_components/PremioInputRow.tsx
  - app/(app)/ranking/historico/page.tsx
---

# Ranking

El ranking del día, con el podio de los mensajeros que mejor van. Se mide por **efectividad**:
entregadas sobre asignadas, del día en curso.

## Cómo se calcula

```
efectividad = entregadas / asignadas   (hoy)
```

Nada más. No pondera zonas, ni distancias, ni el tamaño del paquete: de lo que te asignaron hoy,
cuánto entregaste.

En la tabla ves las dos cifras por separado —**asignadas** y **entregadas**— además del porcentaje, así
que siempre podés comprobar de dónde sale tu número.

## El podio

Arriba, los primeros puestos del día destacados. Se actualiza a lo largo de la jornada: si entregás
más, subís.

## Premios

Cuando la oficina asigna un premio a un puesto, aparece junto al mensajero con su monto y su
descripción. **Solo la oficina puede ponerlos o cambiarlos** — si sos mensajero los ves, pero no los
editás.

## Histórico

En **Histórico del ranking** consultás el podio de un día pasado eligiendo la fecha.

Si te dice **«No se generó el snapshot de esta fecha»**, significa que ese día no quedó guardada la
foto del ranking — normalmente porque es anterior a que empezara a guardarse. No es un error tuyo.

## Lo que esta pantalla NO hace

- **No cuenta plata.** El ranking mide entregas, no dinero. Tus pagos están en **Cierre del día**.
- **No afecta a tus asignaciones.** Subir en el ranking no te da más paquetes: las asignaciones las
  hace la oficina.
