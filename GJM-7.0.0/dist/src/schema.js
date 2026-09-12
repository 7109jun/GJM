export class Schema {
    schema;
    validator;
    optionalFlag;
    defaultValue;
    hasDefault;
    constructor(schema, validator = (value) => value, optionalFlag = false, defaultValue = undefined, hasDefault = false) {
        this.schema = schema;
        this.validator = validator;
        this.optionalFlag = optionalFlag;
        this.defaultValue = defaultValue;
        this.hasDefault = hasDefault;
    }
    optional() {
        return new Schema(this.schema, this.validator, true, this.defaultValue, this.hasDefault);
    }
    default(value) {
        return new Schema({ ...this.schema, default: value }, this.validator, this.optionalFlag, value, true);
    }
    min(value) {
        return this.withConstraint({ minimum: value, minLength: value, minItems: value });
    }
    max(value) {
        return this.withConstraint({ maximum: value, maxLength: value, maxItems: value });
    }
    int() { return this; }
    withConstraint(extra) {
        return new Schema({ ...this.schema, ...extra }, this.validator, this.optionalFlag, this.defaultValue, this.hasDefault);
    }
    toJSONSchema() {
        return this.schema;
    }
    parse(value, path = '$') {
        if (value === undefined && this.hasDefault)
            return this.defaultValue;
        if (value === undefined && this.optionalFlag)
            return undefined;
        if (value === undefined)
            throw new Error(`${path} is required`);
        return this.validator(value, path);
    }
}
const primitive = (type, check) => new Schema({ type }, (value, path) => {
    if (!check(value))
        throw new Error(`${path} must be ${type}`);
    return value;
});
export const z = {
    string() {
        return new Schema({ type: 'string' }, (value, path) => {
            if (typeof value !== 'string')
                throw new Error(`${path} must be string`);
            return value;
        });
    },
    number() {
        return new Schema({ type: 'number' }, (value, path) => {
            if (typeof value !== 'number' || !Number.isFinite(value))
                throw new Error(`${path} must be number`);
            return value;
        });
    },
    boolean() {
        return new Schema({ type: 'boolean' }, (value, path) => {
            if (typeof value !== 'boolean')
                throw new Error(`${path} must be boolean`);
            return value;
        });
    },
    unknown() {
        return new Schema({}, (value) => value);
    },
    enum(values) {
        return new Schema({ enum: [...values] }, (value, path) => {
            if (!values.includes(value))
                throw new Error(`${path} must be one of: ${values.join(', ')}`);
            return value;
        });
    },
    array(item) {
        return new Schema({ type: 'array', items: item.toJSONSchema() }, (value, path) => {
            if (!Array.isArray(value))
                throw new Error(`${path} must be array`);
            const out = value.map((v, i) => item.parse(v, `${path}[${i}]`));
            const min = item.__minItems;
            const max = item.__maxItems;
            if (min !== undefined && out.length < min)
                throw new Error(`${path} must contain at least ${min} items`);
            if (max !== undefined && out.length > max)
                throw new Error(`${path} must contain at most ${max} items`);
            return out;
        });
    },
    object(shape) {
        const properties = {};
        const required = [];
        for (const [key, schema] of Object.entries(shape)) {
            properties[key] = schema.toJSONSchema();
            if (!schema.optionalFlag && !schema.hasDefault)
                required.push(key);
        }
        return new Schema({ type: 'object', properties, required, additionalProperties: false }, (value, path) => {
            if (value === null || typeof value !== 'object' || Array.isArray(value))
                throw new Error(`${path} must be object`);
            const input = value;
            const output = {};
            for (const [key, schema] of Object.entries(shape))
                output[key] = schema.parse(input[key], `${path}.${key}`);
            return output;
        });
    }
};
// Attach min/max metadata to array schemas through a small compatible helper.
const arrayBase = z.array;
z.array = function (item) {
    const s = arrayBase(item);
    const originalMin = s.min;
    const originalMax = s.max;
    s.min = (n) => { const r = originalMin.call(s, n); r.__minItems = n; return r; };
    s.max = (n) => { const r = originalMax.call(s, n); r.__maxItems = n; return r; };
    return s;
};
//# sourceMappingURL=schema.js.map