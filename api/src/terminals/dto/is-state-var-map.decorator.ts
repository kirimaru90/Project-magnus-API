import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export const STATE_VAR_TYPES = ['boolean', 'number', 'enum', 'string'] as const;
export type StateVarType = (typeof STATE_VAR_TYPES)[number];

export function IsStateVarMap(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStateVarMap',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const map = value as Record<string, unknown>;
          for (const entry of Object.values(map)) {
            if (
              typeof entry !== 'object' ||
              entry === null ||
              Array.isArray(entry)
            )
              return false;
            const e = entry as Record<string, unknown>;
            if (!STATE_VAR_TYPES.includes(e.type as StateVarType)) return false;
            if (e.type === 'enum') {
              if (!Array.isArray(e.values) || e.values.length === 0)
                return false;
              if (!(e.values as unknown[]).every((v) => typeof v === 'string'))
                return false;
            }
            if (e.values !== undefined) {
              if (
                !Array.isArray(e.values) ||
                !(e.values as unknown[]).every((v) => typeof v === 'string')
              )
                return false;
            }
          }
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const value: unknown = args.value as unknown;
          if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value)
          )
            return `${args.property} must be a plain object`;
          const map = value as Record<string, unknown>;
          for (const [varName, entry] of Object.entries(map)) {
            if (
              typeof entry !== 'object' ||
              entry === null ||
              Array.isArray(entry)
            )
              return `${args.property}.${varName} must be an object`;
            const e = entry as Record<string, unknown>;
            if (!STATE_VAR_TYPES.includes(e.type as StateVarType))
              return `${args.property}.${varName}: type must be one of ${STATE_VAR_TYPES.join(', ')}`;
            if (e.type === 'enum') {
              if (!Array.isArray(e.values) || e.values.length === 0)
                return `${args.property}.${varName}: enum type requires a non-empty values array`;
              if (!(e.values as unknown[]).every((v) => typeof v === 'string'))
                return `${args.property}.${varName}: values must be an array of strings`;
            }
            if (e.values !== undefined) {
              if (
                !Array.isArray(e.values) ||
                !(e.values as unknown[]).every((v) => typeof v === 'string')
              )
                return `${args.property}.${varName}: values must be an array of strings`;
            }
          }
          return `${args.property} is invalid`;
        },
      },
    });
  };
}
