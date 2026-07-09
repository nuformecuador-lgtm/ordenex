export interface CrearPermisoInput {
  nombre: string;
  method: string;
  route: string;
}

export interface Permiso {
  id: string;
  nombre: string;
  method: string;
  route: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPermisoRepository {
  crear(input: CrearPermisoInput): Promise<Permiso>;
  contar(): Promise<number>;
}
