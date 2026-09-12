export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  additionalProperties?: boolean;
};

export class Schema<T = any> {
  constructor(
    public readonly schema: JsonSchema,
    private readonly validator: (value: unknown, path: string) => T = (value) => value as T,
    public readonly optionalFlag = false,
    public readonly defaultValue: unknown = undefined,
    public readonly hasDefault = false
  ) {}

  optional(): Schema<T | undefined> {
    return new Schema(this.schema, this.validator, true, this.defaultValue, this.hasDefault);
  }

  default(value: T): Schema<T> {
    return new Schema({ ...this.schema, default: value }, this.validator, this.optionalFlag, value, true);
  }

  min(value: number): Schema<T> {
    return this.withConstraint({ minimum: value, minLength: value, minItems: value });
  }

  max(value: number): Schema<T> {
    return this.withConstraint({ maximum: value, maxLength: value, maxItems: value });
  }

  int(): Schema<T> { return this; }

  private withConstraint(extra: JsonSchema): Schema<T> {
    return new Schema({ ...this.schema, ...extra }, this.validator, this.optionalFlag, this.defaultValue, this.hasDefault);
  }

  toJSONSchema(): JsonSchema {
    return this.schema;
  }

  parse(value: unknown, path = '$'): T {
    if (value === undefined && this.hasDefault) return this.defaultValue as T;
    if (value === undefined && this.optionalFlag) return undefined as T;
    if (value === undefined) throw new Error(`${path} is required`);
    return this.validator(value, path);
  }
}

const primitive = (type: string, check: (value: unknown) => boolean): Schema<any> =>
  new Schema({ type }, (value, path) => {
    if (!check(value)) throw new Error(`${path} must be ${type}`);
    return value;
  });

export const z = {
  string(): Schema<string> {
    return new Schema({ type: 'string' }, (value, path) => {
      if (typeof value !== 'string') throw new Error(`${path} must be string`);
      return value;
    });
  },
  number(): Schema<number> {
    return new Schema({ type: 'number' }, (value, path) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be number`);
      return value;
    });
  },
  boolean(): Schema<boolean> {
    return new Schema({ type: 'boolean' }, (value, path) => {
      if (typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
      return value;
    });
  },
  unknown(): Schema<unknown> {
    return new Schema({}, (value) => value);
  },
  enum<const T extends readonly string[]>(values: T): Schema<T[number]> {
    return new Schema<T[number]>({ enum: [...values] }, (value, path) => {
      if (!values.includes(value as T[number])) throw new Error(`${path} must be one of: ${values.join(', ')}`);
      return value as T[number];
    });
  },
  array<T>(item: Schema<T>): Schema<T[]> {
    return new Schema({ type: 'array', items: item.toJSONSchema() }, (value, path) => {
      if (!Array.isArray(value)) throw new Error(`${path} must be array`);
      const out = value.map((v, i) => item.parse(v, `${path}[${i}]`));
      const min = (item as any).__minItems;
      const max = (item as any).__maxItems;
      if (min !== undefined && out.length < min) throw new Error(`${path} must contain at least ${min} items`);
      if (max !== undefined && out.length > max) throw new Error(`${path} must contain at most ${max} items`);
      return out;
    });
  },
  object<T extends Record<string, Schema<any>>>(shape: T): Schema<{ [K in keyof T]: ReturnType<T[K]['parse']> }> {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, schema] of Object.entries(shape)) {
      properties[key] = schema.toJSONSchema();
      if (!(schema as Schema).optionalFlag && !(schema as Schema).hasDefault) required.push(key);
    }
    return new Schema<any>({ type: 'object', properties, required, additionalProperties: false }, (value, path) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be object`);
      const input = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) output[key] = schema.parse(input[key], `${path}.${key}`);
      return output;
    });
  }
};

// Attach min/max metadata to array schemas through a small compatible helper.
const arrayBase = z.array;
z.array = function<T>(item: Schema<T>): Schema<T[]> {
  const s = arrayBase(item);
  const originalMin = s.min;
  const originalMax = s.max;
  (s as any).min = (n: number) => { const r = originalMin.call(s, n); (r as any).__minItems = n; return r; };
  (s as any).max = (n: number) => { const r = originalMax.call(s, n); (r as any).__maxItems = n; return r; };
  return s;
};
