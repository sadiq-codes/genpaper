import { welcomeEmail } from './templates/welcome'
import {
  dripStep1,
  dripStep2,
  dripStep3,
  dripStep4,
  dripStep5,
  dripStep6,
} from './templates/drip-steps'

export interface DripStep {
  step: number
  delayDays: number
  subject: string
  buildHtml: (opts: { name: string; userId: string }) => string
}

export const DRIP_STEPS: DripStep[] = [
  {
    step: 0,
    delayDays: 0,
    subject: "Welcome to GenPaper — let's write your first paper",
    buildHtml: welcomeEmail,
  },
  {
    step: 1,
    delayDays: 1,
    subject: 'Create your first research paper in 3 minutes',
    buildHtml: dripStep1,
  },
  {
    step: 2,
    delayDays: 3,
    subject: 'Your research library is waiting',
    buildHtml: dripStep2,
  },
  {
    step: 3,
    delayDays: 5,
    subject: 'Ask your paper anything with AI chat',
    buildHtml: dripStep3,
  },
  {
    step: 4,
    delayDays: 7,
    subject: 'Perfect citations. One-click export.',
    buildHtml: dripStep4,
  },
  {
    step: 5,
    delayDays: 14,
    subject: '5 ways to get more from GenPaper',
    buildHtml: dripStep5,
  },
  {
    step: 6,
    delayDays: 21,
    subject: "You've been writing — ready for more?",
    buildHtml: dripStep6,
  },
]

export const TOTAL_DRIP_STEPS = DRIP_STEPS.length
