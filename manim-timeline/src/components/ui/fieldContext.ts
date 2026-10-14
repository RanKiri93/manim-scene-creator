import { createContext, useContext } from 'react';

export interface FieldIds {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

export const FieldContext = createContext<FieldIds | null>(null);

/** Read by the input primitives so a control inside `Field` gets its id and description for free. */
export function useFieldIds(): FieldIds | null {
  return useContext(FieldContext);
}
