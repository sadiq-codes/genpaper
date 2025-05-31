// Citation function schema for AI models
import { z } from 'zod';

export const citationFunctionSchema = {
  name: 'addCitation',
  description: 'Add a citation that was just referenced in the text',
  parameters: {
    type: 'object',
    properties: {
      doi: { 
        type: 'string', 
        nullable: true,
        description: 'DOI if known (e.g., 10.1038/nature12373)'
      },
      title: { 
        type: 'string',
        description: 'Title of the work being cited'
      },
      authors: { 
        type: 'array', 
        items: { type: 'string' },
        description: 'Author names in "Last, First" format',
        minItems: 1
      },
      year: { 
        type: 'integer', 
        nullable: true,
        description: 'Publication year'
      },
      journal: {
        type: 'string',
        nullable: true,
        description: 'Journal or publication venue'
      },
      reason: { 
        type: 'string',
        description: 'Brief explanation of why this source is being cited'
      },
      textSegment: {
        type: 'string',
        description: 'The text segment this citation supports (max 300 chars)',
        maxLength: 300
      }
    },
    required: ['title', 'authors', 'reason']
  }
};

// Zod schema for validation
export const citationSchema = z.object({
  doi: z.string().nullable().optional(),
  title: z.string(),
  authors: z.array(z.string()).min(1, 'At least one author required'),
  year: z.number().nullable().optional(),
  journal: z.string().nullable().optional(),
  reason: z.string(),
  textSegment: z.string().max(300, 'Text segment too long').optional()
});

export type Citation = z.infer<typeof citationSchema>; 