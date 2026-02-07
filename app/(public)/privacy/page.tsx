import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for GenPaper - How we collect, use, and protect your data.',
}

export default function PrivacyPolicyPage() {
  const lastUpdated = 'February 7, 2025'
  const companyName = 'GenPaper'
  const contactEmail = process.env.CONTACT_EMAIL || 'support@genpaper.app'
  
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: {lastUpdated}</p>
        
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          
          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">1. Introduction</h2>
            <p>
              {companyName} (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. 
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information 
              when you use our AI-powered research paper generation platform.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">2. Information We Collect</h2>
            
            <h3 className="text-xl font-medium mt-6 mb-3">2.1 Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Account Information:</strong> Email address, name, and password when you create an account
              </li>
              <li>
                <strong>Content:</strong> Research papers, documents, and text you create or upload
              </li>
              <li>
                <strong>Payment Information:</strong> Billing details processed through our payment provider (Polar/Stripe)
              </li>
              <li>
                <strong>Communications:</strong> Messages you send to our support team
              </li>
            </ul>

            <h3 className="text-xl font-medium mt-6 mb-3">2.2 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Usage Data:</strong> Features used, pages visited, actions taken within the Service
              </li>
              <li>
                <strong>Device Information:</strong> Browser type, operating system, device identifiers
              </li>
              <li>
                <strong>Log Data:</strong> IP address, access times, referring URLs
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">3. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide, maintain, and improve the Service</li>
              <li>Process your transactions and manage your subscription</li>
              <li>Send you technical notices, updates, and support messages</li>
              <li>Respond to your comments, questions, and customer service requests</li>
              <li>Monitor and analyze trends, usage, and activities</li>
              <li>Detect, investigate, and prevent fraudulent transactions and abuse</li>
              <li>Personalize and improve your experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">4. AI Processing</h2>
            <p className="font-semibold">Important Information About AI Processing:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Your content is processed by AI language models to generate and improve papers
              </li>
              <li>
                We use third-party AI providers (OpenAI, Anthropic) to power our features
              </li>
              <li>
                Content sent to AI providers is subject to their privacy policies and data handling practices
              </li>
              <li>
                We do not use your content to train our own AI models
              </li>
              <li>
                AI-generated outputs may be temporarily cached to improve performance
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">5. Information Sharing</h2>
            <p>We may share your information with:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Service Providers:</strong> Third parties that help us operate the Service 
                (hosting, payment processing, AI providers, analytics)
              </li>
              <li>
                <strong>Legal Requirements:</strong> When required by law, court order, or governmental authority
              </li>
              <li>
                <strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets
              </li>
              <li>
                <strong>With Your Consent:</strong> When you explicitly authorize us to share information
              </li>
            </ul>
            <p className="mt-4">
              We do NOT sell your personal information to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">6. Data Retention</h2>
            <p>
              We retain your information for as long as your account is active or as needed to provide 
              the Service. After account deletion:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Account data is deleted within 30 days</li>
              <li>Content and documents are deleted within 30 days</li>
              <li>Anonymized analytics data may be retained longer</li>
              <li>Backup copies may persist for up to 90 days</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">7. Your Rights</h2>
            <p>Depending on your location, you may have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Access:</strong> Request a copy of your personal data
              </li>
              <li>
                <strong>Correction:</strong> Request correction of inaccurate data
              </li>
              <li>
                <strong>Deletion:</strong> Request deletion of your data (&quot;right to be forgotten&quot;)
              </li>
              <li>
                <strong>Portability:</strong> Request your data in a portable format
              </li>
              <li>
                <strong>Objection:</strong> Object to certain processing of your data
              </li>
              <li>
                <strong>Restriction:</strong> Request restriction of processing
              </li>
            </ul>
            <p className="mt-4">
              To exercise these rights, contact us at{' '}
              <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                {contactEmail}
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">8. Cookies and Tracking</h2>
            <p>We use cookies and similar technologies to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Keep you logged in</li>
              <li>Remember your preferences</li>
              <li>Understand how you use the Service</li>
              <li>Improve performance and user experience</li>
            </ul>
            <p className="mt-4">
              You can control cookies through your browser settings. Disabling cookies may affect 
              Service functionality.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">9. Security</h2>
            <p>
              We implement appropriate technical and organizational measures to protect your data, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Encryption in transit (HTTPS/TLS)</li>
              <li>Encryption at rest for sensitive data</li>
              <li>Regular security assessments</li>
              <li>Access controls and authentication</li>
            </ul>
            <p className="mt-4">
              However, no method of transmission or storage is 100% secure. We cannot guarantee 
              absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">10. International Transfers</h2>
            <p>
              Your information may be transferred to and processed in countries other than your own. 
              These countries may have different data protection laws. We ensure appropriate safeguards 
              are in place for such transfers.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">11. Children&apos;s Privacy</h2>
            <p>
              The Service is not intended for users under 16 years of age. We do not knowingly collect 
              information from children under 16. If you believe we have collected such information, 
              please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">12. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material 
              changes by posting the new policy on this page and updating the &quot;Last updated&quot; date. 
              Continued use of the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mt-8 mb-4">13. Contact Us</h2>
            <p>
              For questions about this Privacy Policy or our data practices, please contact us at:{' '}
              <a href={`mailto:${contactEmail}`} className="text-primary hover:underline">
                {contactEmail}
              </a>
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
