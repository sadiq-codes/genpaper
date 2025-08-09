import { z } from 'zod'

// Edit operation schema
export const EditOpZ = z.object({
  id: z.string().uuid(),
  range: z
    .object({ start: z.number().int().min(0), end: z.number().int().min(0) })
    .partial()
    .optional(),
  anchor: z
    .object({ before: z.string().max(200), after: z.string().max(200) })
    .partial()
    .optional(),
  replacement: z.string(),
  note: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})
.refine((d) => d.range || d.anchor, { message: 'range or anchor required' })

// Edit proposal schema
export const EditProposalZ = z.object({
  baseSha: z.string(),
  operations: z.array(EditOpZ).min(1),
})

export type EditOp = z.infer<typeof EditOpZ>
export type EditProposal = z.infer<typeof EditProposalZ>