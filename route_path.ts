type IsParameter<Part> = Part extends `:${infer ParamName}` ? ParamName : never;
type FilteredParts<Path> = Path extends `${infer PartA}/${infer PartB}`
  ? IsParameter<PartA> | FilteredParts<PartB>
  : IsParameter<Path>;

type ParamValue<Key> = Key extends `${infer Anything}?` ? string | undefined
  : Key extends `${infer Anything}*` ? string[] | undefined
  : Key extends `${infer Anything}+` ? string[]
  : string;

type RemoveOptionalSuffix<Key> = Key extends `${infer Name}?`
  ? RemovePattern<Name>
  : Key extends `${infer Name}*` ? RemovePattern<Name>
  : Key extends `${infer Name}+` ? RemovePattern<Name>
  : RemovePattern<Key>;

type RemovePattern<Key> = Key extends `${infer Name}(${string}` ? Name : Key;

/**
 * Represents a route path with typed parameters.
 * @template Path - The path pattern.
 */
export type RoutePath<Path> = {
  /**
   * Represents the typed parameters extracted from the path pattern.
   * @template Key - The parameter key.
   */
  [Key in FilteredParts<Path> as RemoveOptionalSuffix<Key>]: ParamValue<Key>;
};
