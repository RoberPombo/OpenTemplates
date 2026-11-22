/**
 * Puerto del catálogo de modelos accesibles para la app: los que exponen las
 * suscripciones y proveedores configurados en opencode.
 */
export interface ModelCatalogGateway {
  list(): Promise<string[]>;
}
