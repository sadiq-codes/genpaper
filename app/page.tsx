// File: app/page.tsx

export default function HomePage() {
  return (
    <div>
      <h1>Welcome to the AI Research Assistant!</h1>
      <p>This is the landing page of the application.</p>
      <p>
        {/* Example link, assuming you have an auth flow setup eventually */}
        <a href="/login">Login</a> or <a href="/projects">Go to Dashboard (if logged in)</a>
      </p>
      <p>Current time (for testing): {new Date().toLocaleTimeString()}</p>
    </div>
  );
}