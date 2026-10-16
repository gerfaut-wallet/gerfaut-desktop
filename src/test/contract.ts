// Schemas that read the JSON of gerfaut-core the way a type of
// src/lib/ipc.ts says it is, for the contract test (bridge.test.ts).
//
// A schema is tied to its type both ways: `Schema<A>` is not a
// `Schema<B>` unless A and B are the same type, and an object schema
// lists exactly the fields of its type, optional ones as optional. So
// the type checker holds each schema to its type in ipc.ts, and the
// test holds each reference JSON of the core to its schema: between the
// two, the JSON is held to the type.

/** What reading the reference files found, and what they never held. */
export class Reading {
  readonly issues: string[] = [];
  private readonly seen = new Map<string, Set<string>>();
  private readonly offered = new Map<string, Set<string>>();
  private readonly ignoredUsed = new Set<string>();

  /** `ignored`: keys the core sends that a type leaves out on
      purpose, as `Type.key`, with the reason. */
  constructor(private readonly ignored: Readonly<Record<string, string>>) {}

  fail(at: string, message: string): void {
    this.issues.push(`${at}: ${message}`);
  }

  /** `name` can hold `value`: a field of an object, a variant. */
  offer(name: string, value: string): void {
    let values = this.offered.get(name);
    if (!values) this.offered.set(name, (values = new Set()));
    values.add(value);
  }

  /** The core sent `value` where `name` reads. */
  see(name: string, value: string): void {
    let values = this.seen.get(name);
    if (!values) this.seen.set(name, (values = new Set()));
    values.add(value);
  }

  /** Whether `Type.key` is a key the type leaves out on purpose. */
  ignores(name: string, key: string): boolean {
    const id = `${name}.${key}`;
    if (!(id in this.ignored)) return false;
    this.ignoredUsed.add(id);
    return true;
  }

  /** What the app reads that no reference file ever held, as
      `Type.key` and `Type=variant`: a field or a variant of this app
      the core never sends. */
  neverSent(): string[] {
    const out: string[] = [];
    for (const [name, values] of this.offered) {
      const seen = this.seen.get(name) ?? new Set();
      for (const value of values) {
        if (!seen.has(value)) out.push(value.startsWith("=") ? `${name}${value}` : `${name}.${value}`);
      }
    }
    return out.sort();
  }

  /** Exceptions declared for keys no reference file sends any more. */
  unusedIgnores(): string[] {
    return Object.keys(this.ignored).filter((id) => !this.ignoredUsed.has(id));
  }
}

/** What every schema is, whatever it reads. */
export type AnySchema = Schema<any>;
type Field = AnySchema | Optional<any>;

export interface Schema<T> {
  /** Never set: a function of T in and out, which makes `Schema<T>`
      neither wider nor narrower than T. */
  readonly __type?: (value: T) => T;
  check(value: unknown, at: string, reading: Reading): void;
  /** Called once per schema reachable from the contract, so that what
      it can hold is known before anything is read. */
  offer(reading: Reading, done: Set<AnySchema>): void;
}

/** A field a type marks optional. */
export interface Optional<T> {
  readonly optional: Schema<T>;
}

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];

/** The fields of T, each with a schema of exactly its type. */
export type Fields<T> = {
  [K in keyof T]-?: K extends OptionalKeys<T> ? Optional<Exclude<T[K], undefined>> : Schema<T[K]>;
};

type Variants<T, Tag extends keyof T> = {
  [V in T[Tag] & string]: Fields<Omit<Extract<T, Record<Tag, V>>, Tag>>;
};

function kind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `the ${typeof value} ${JSON.stringify(value)}`;
}

function primitive<T>(name: string, test: (value: unknown) => boolean): Schema<T> {
  return {
    check(value, at, reading) {
      if (!test(value)) reading.fail(at, `${kind(value)} where the app reads ${name}`);
    },
    offer() {},
  };
}

export const str = primitive<string>("a string", (value) => typeof value === "string");
export const num = primitive<number>("a number", (value) => typeof value === "number");
export const bool = primitive<boolean>("a boolean", (value) => typeof value === "boolean");

/** One of a set of strings, every one of which the core is expected
    to send somewhere. */
export function literal<const L extends string>(name: string, ...values: L[]): Schema<L> {
  return {
    check(value, at, reading) {
      if (typeof value === "string" && (values as string[]).includes(value)) {
        reading.see(name, `=${value}`);
      } else {
        reading.fail(at, `${kind(value)} is not a ${name} this app knows`);
      }
    },
    offer(reading) {
      for (const value of values) reading.offer(name, `=${value}`);
    },
  };
}

/** Either of two sets of strings. */
export function either<A extends string, B extends string>(a: Schema<A>, b: Schema<B>): Schema<A | B> {
  return {
    check(value, at, reading) {
      const tried = new Reading({});
      a.check(value, at, tried);
      (tried.issues.length === 0 ? a : b).check(value, at, reading);
    },
    offer(reading, done) {
      visit(a, reading, done);
      visit(b, reading, done);
    },
  };
}

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return {
    check(value, at, reading) {
      if (value !== null) schema.check(value, at, reading);
    },
    offer(reading, done) {
      visit(schema, reading, done);
    },
  };
}

export function optional<T>(schema: Schema<T>): Optional<T> {
  return { optional: schema };
}

export function array<T>(schema: Schema<T>): Schema<T[]> {
  return {
    check(value, at, reading) {
      if (!Array.isArray(value)) return reading.fail(at, `${kind(value)} where the app reads a list`);
      value.forEach((item, i) => schema.check(item, `${at}[${i}]`, reading));
    },
    offer(reading, done) {
      visit(schema, reading, done);
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An object of any keys, every value read by `schema`. */
export function record<T>(schema: Schema<T>): Schema<Record<string, T>> {
  return {
    check(value, at, reading) {
      if (!isObject(value)) return reading.fail(at, `${kind(value)} where the app reads an object`);
      for (const [key, item] of Object.entries(value)) schema.check(item, `${at}.${key}`, reading);
    },
    offer(reading, done) {
      visit(schema, reading, done);
    },
  };
}

/** An object keyed by some of the strings of `keys`. */
export function partialRecord<K extends string, T>(keys: Schema<K>, schema: Schema<T>): Schema<Partial<Record<K, T>>> {
  return {
    check(value, at, reading) {
      if (!isObject(value)) return reading.fail(at, `${kind(value)} where the app reads an object`);
      for (const [key, item] of Object.entries(value)) {
        keys.check(key, `${at} key ${JSON.stringify(key)}`, reading);
        schema.check(item, `${at}.${key}`, reading);
      }
    },
    offer(reading, done) {
      visit(keys, reading, done);
      visit(schema, reading, done);
    },
  };
}

/** A schema read when first needed: a type that holds itself. */
export function lazy<T>(make: () => Schema<T>): Schema<T> {
  return {
    check: (value, at, reading) => make().check(value, at, reading),
    offer: (reading, done) => visit(make(), reading, done),
  };
}

function checkFields(
  name: string,
  fields: Record<string, Field>,
  value: Record<string, unknown>,
  at: string,
  reading: Reading,
  skip?: string,
): void {
  for (const [key, item] of Object.entries(value)) {
    if (key === skip) continue;
    const field = fields[key];
    if (!field) {
      if (!reading.ignores(name, key)) reading.fail(`${at}.${key}`, `sent by the core, ignored by ${name}`);
      continue;
    }
    reading.see(name, key);
    ("optional" in field ? field.optional : field).check(item, `${at}.${key}`, reading);
  }
  for (const [key, field] of Object.entries(fields)) {
    if (!("optional" in field) && !(key in value)) {
      reading.fail(`${at}.${key}`, `required by ${name}, absent from what the core sends`);
    }
  }
}

function offerFields(
  name: string,
  fields: Record<string, Field>,
  reading: Reading,
  done: Set<AnySchema>,
): void {
  for (const [key, field] of Object.entries(fields)) {
    reading.offer(name, key);
    visit("optional" in field ? field.optional : field, reading, done);
  }
}

/** An object with exactly the fields of T. `name` is how a failure
    names it: the type, or the field an anonymous type sits in. */
export function object<T>(name: string) {
  return (fields: Fields<T>): Schema<T> => {
    const all = fields as unknown as Record<string, Field>;
    return {
      check(value, at, reading) {
        if (!isObject(value)) return reading.fail(at, `${kind(value)} where ${name} reads an object`);
        checkFields(name, all, value, at, reading);
      },
      offer(reading, done) {
        offerFields(name, all, reading, done);
      },
    };
  };
}

/** A union of objects told apart by the string under `tag`: every
    variant of T, each with exactly its fields. */
export function tagged<T>(name: string) {
  return <Tag extends keyof T & string>(tag: Tag, variants: Variants<T, Tag>): Schema<T> => {
    const all = variants as unknown as Record<string, Record<string, Field>>;
    return {
      check(value, at, reading) {
        if (!isObject(value)) return reading.fail(at, `${kind(value)} where ${name} reads an object`);
        const variant = value[tag];
        if (typeof variant !== "string" || !(variant in all)) {
          return reading.fail(`${at}.${tag}`, `${kind(variant)} is not a variant of ${name}`);
        }
        reading.see(name, `=${variant}`);
        checkFields(`${name}=${variant}`, all[variant], value, at, reading, tag);
      },
      offer(reading, done) {
        for (const [variant, fields] of Object.entries(all)) {
          reading.offer(name, `=${variant}`);
          offerFields(`${name}=${variant}`, fields, reading, done);
        }
      },
    };
  };
}

function visit(schema: AnySchema, reading: Reading, done: Set<AnySchema>): void {
  if (done.has(schema)) return;
  done.add(schema);
  schema.offer(reading, done);
}

/** Registers everything the schemas can hold, before any file is read. */
export function offerAll(schemas: Iterable<AnySchema>, reading: Reading): void {
  const done = new Set<AnySchema>();
  for (const schema of schemas) visit(schema, reading, done);
}
