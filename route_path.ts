type IsParameter<Part> = Part extends `:${infer ParamName}` ? ParamName : never;
type FilteredParts<Path> = Path extends `${infer PartA}/${infer PartB}`
  ? IsParameter<PartA> | FilteredParts<PartB>
  : IsParameter<Path>;

type ParamValue<Key> = Key extends `${infer Anything}?` ? string | undefined :
  Key extends `${infer Anything}*` ? string[] | undefined :
  Key extends `${infer Anything}+` ? string[] : string;

type RemoveOptionalSuffix<Key> = Key extends `${infer Name}?` ? RemovePattern<Name> :
  Key extends `${infer Name}*` ? RemovePattern<Name> :
  Key extends `${infer Name}+` ? RemovePattern<Name> : RemovePattern<Key>;

type RemovePattern<Key> = Key extends `${infer Name}(${string}` ? Name : Key;

export type RoutePath<Path> = {
  [Key in FilteredParts<Path> as RemoveOptionalSuffix<Key>]: ParamValue<Key>;
};