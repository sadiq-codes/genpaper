import type { DriveStep } from 'driver.js'

export const PROJECTS_TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="topic-input"]',
    popover: {
      title: 'Start here',
      description: 'Describe what you want to research. Be specific — for example, "Impact of social media on teen mental health 2020-2024" works better than just "social media."',
      side: 'bottom',
      align: 'center',
    },
  },
  {
    element: '[data-tour="paper-type"]',
    popover: {
      title: 'Choose your paper type',
      description: 'Literature review, research article, thesis, or dissertation — pick the format that fits your assignment.',
      side: 'top',
      align: 'start',
    },
  },
  {
    element: '[data-tour="generation-mode"]',
    popover: {
      title: 'AI Generate or Write Yourself',
      description: 'Choose "AI Generate" to have GenPaper write your paper automatically, or "Write myself" to start with a blank document and use AI assistance as you go.',
      side: 'top',
      align: 'start',
    },
  },
  {
    element: '[data-tour="add-sources"]',
    popover: {
      title: 'Add your own sources',
      description: 'Upload PDFs or pick papers from your library. GenPaper also finds real academic sources automatically.',
      side: 'top',
      align: 'start',
    },
  },
  {
    element: '[data-tour="advanced-options"]',
    popover: {
      title: 'Advanced options',
      description: 'Include your own research findings, or restrict sources to only papers you\'ve uploaded. Great for empirical studies or when you have specific sources to use.',
      side: 'top',
      align: 'start',
    },
  },
  {
    element: '[data-tour="start-button"]',
    popover: {
      title: 'Generate your paper',
      description: 'Hit Start and GenPaper searches real databases, finds sources, and writes every section with proper citations.',
      side: 'left',
      align: 'center',
    },
  },
  {
    element: '[data-tour="library-link"]',
    popover: {
      title: 'Your research library',
      description: 'Upload papers here to reuse across projects. You can also search millions of publications.',
      side: 'right',
      align: 'center',
    },
  },
]

export const EDITOR_TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="document-editor"]',
    popover: {
      title: 'Your paper',
      description: 'Your generated paper appears here. Edit it like any document — add text, restructure sections, or refine the writing.',
      side: 'left',
      align: 'center',
    },
  },
  {
    element: '[data-tour="chat-tab"]',
    popover: {
      title: 'AI research chat',
      description: 'Ask questions about your paper, request changes, or get help strengthening arguments. The AI knows your paper and sources.',
      side: 'right',
      align: 'center',
    },
  },
  {
    element: '[data-tour="papers-tab"]',
    popover: {
      title: 'Your sources',
      description: 'See every source used in your paper. Click any citation to view the full reference and abstract.',
      side: 'right',
      align: 'center',
    },
  },
  {
    element: '[data-tour="export-button"]',
    popover: {
      title: 'Export when ready',
      description: 'Download your finished paper as Word, PDF, or LaTeX — formatted and ready to submit.',
      side: 'bottom',
      align: 'end',
    },
  },
  {
    element: '[data-tour="settings-button"]',
    popover: {
      title: 'Paper settings',
      description: 'Change citation style (APA, MLA, Chicago), toggle AI autocomplete, and configure other preferences.',
      side: 'bottom',
      align: 'end',
    },
  },
]
