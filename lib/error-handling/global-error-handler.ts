// Basic global error handler

export function logError(error: Error) {
  console.error('Global Error:', error)
  // Additional error handling logic can be added here
}

// Example usage
// logError(new Error('Test error')) 