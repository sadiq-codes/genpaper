/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-direct-db-access-from-apps',
      comment: 'App components should not directly access database',
      severity: 'error',
      from: {
        path: '^(app|components)/'
      },
      to: {
        path: '^lib/(db|supabase)/'
      }
    },
    {
      name: 'no-direct-db-access-from-tools',
      comment: 'AI tools should not directly access database',
      severity: 'error', 
      from: {
        path: '^lib/ai/tools/'
      },
      to: {
        path: '^lib/(db|supabase)/'
      }
    },
    {
      name: 'services-only-for-db',
      comment: 'Only services should access database directly',
      severity: 'error',
      from: {
        pathNot: '^(lib/services|lib/db|lib/supabase)/'
      },
      to: {
        path: '^lib/(db|supabase)/'
      }
    }
  ],
  options: {
    // Include TypeScript files
    tsPreCompilationDeps: true,
    includeOnly: '^(app|components|lib)/',
    exclude: {
      path: 'node_modules'
    },
    reporterOptions: {
      text: {
        highlightFocused: true
      }
    }
  }
};